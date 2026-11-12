import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "../middleware";
import { suspendedHtml } from "../lib/suspended-page";
import { MARKETING_ROUTE_PREFIXES } from "../lib/old-urls";
import { MARKETING_ROUTES } from "@cds/core/marketing";

// 13-22 / 14-18: the tenant branch lazily imports @cds/db for one resolveOrganization read
// (suspension + redirects). Unit tests stub it; suspended-site.integration.test.tsx drives the
// real read against PocketBase.
type Org = {
  orgId: string;
  slug: string;
  host: string;
  hostKind: "preview" | "custom" | "redirect";
  primaryHost: string | null;
  suspended: boolean;
  redirectTo: string | null;
  live: boolean;
};
type Verified =
  { status: "valid"; orgId: string } | { status: "expired" | "invalid" };
const org = (host: string, over: Partial<Org> = {}): Org => ({
  orgId: "orgaaaaaaaaaaaa",
  slug: "acme",
  host,
  hostKind: "custom",
  primaryHost: host,
  suspended: false,
  redirectTo: null,
  live: false,
  ...over,
});
const tokenOrg = (t: unknown, prefix: string): Verified =>
  typeof t === "string" && t.startsWith(prefix)
    ? { status: "valid", orgId: t.slice(prefix.length) }
    : { status: "invalid" };
const suspension = vi.hoisted(() => ({
  resolveOrganization: vi.fn<(host: string) => Promise<unknown>>(
    async () => null,
  ),
  verifyPreviewToken: vi.fn<(t: unknown) => unknown>(),
  verifyReviewToken: vi.fn<(t: unknown) => unknown>(),
}));
vi.mock("@cds/db", () => suspension);
function resetDb() {
  suspension.resolveOrganization.mockReset();
  suspension.resolveOrganization.mockImplementation(async (h: string) =>
    org(h),
  );
  suspension.verifyPreviewToken.mockReset();
  suspension.verifyPreviewToken.mockImplementation((t) => tokenOrg(t, "pv-"));
  suspension.verifyReviewToken.mockReset();
  suspension.verifyReviewToken.mockImplementation((t) => tokenOrg(t, "rv-"));
}
resetDb();

function req(url: string, host: string) {
  return new NextRequest(url, { headers: { host } });
}

describe("middleware hostname routing (PLAT-02, D4)", () => {
  it("rewrites a tenant host to /tenant/<host>/<path>", async () => {
    const res = await middleware(
      req("http://acme-yoga.com/about", "acme-yoga.com"),
    );
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).toBeTruthy();
    expect(new URL(rewrite!).pathname).toBe("/tenant/acme-yoga.com/about");
  });

  it("rewrites the tenant form endpoint (07-19)", async () => {
    const res = await middleware(
      req("http://acme-yoga.com/api/forms/abc123", "acme-yoga.com"),
    );
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(new URL(rewrite!).pathname).toBe(
      "/tenant/acme-yoga.com/api/forms/abc123",
    );
    expect(
      unstable_doesMiddlewareMatch({ config, url: "/api/forms/abc123" }),
    ).toBe(true);
  });

  it("preserves search params on the tenant rewrite", async () => {
    const res = await middleware(
      req("http://acme-yoga.com/classes?day=mon", "acme-yoga.com"),
    );
    const rewrite = new URL(res.headers.get("x-middleware-rewrite")!);
    expect(rewrite.pathname).toBe("/tenant/acme-yoga.com/classes");
    expect(rewrite.searchParams.get("day")).toBe("mon");
  });

  it("passes platform hosts through", async () => {
    const res = await middleware(
      req("http://cds.needtobeedgy.com/hub", "cds.needtobeedgy.com"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.status).toBe(200);
  });

  it("serves /legal pages on the platform host without a rewrite (09-09)", async () => {
    for (const path of ["/legal/terms-of-service", "/legal/dpa/v1"]) {
      const res = await middleware(
        req(`http://cds.needtobeedgy.com${path}`, "cds.needtobeedgy.com"),
      );
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("returns 404 for /tenant paths on a platform host (T-01-06)", async () => {
    expect(
      (
        await middleware(
          req("http://localhost:3000/tenant/x", "localhost:3000"),
        )
      ).status,
    ).toBe(404);
    expect(
      (await middleware(req("http://localhost:3000/tenant", "localhost:3000")))
        .status,
    ).toBe(404);
  });

  it("returns 400 for a malformed host", async () => {
    expect(
      (await middleware(req("http://localhost/", "bad host"))).status,
    ).toBe(400);
  });

  it("does not trust x-forwarded-host (T-01-04)", async () => {
    const r = new NextRequest("http://acme-yoga.com/", {
      headers: { host: "acme-yoga.com", "x-forwarded-host": "localhost" },
    });
    const rewrite = (await middleware(r)).headers.get("x-middleware-rewrite");
    expect(new URL(rewrite!).pathname).toBe("/tenant/acme-yoga.com");
  });

  it("carries the validated tenant host in a request header (WR-02)", async () => {
    const r = new NextRequest("http://acme-yoga.com/", {
      headers: { host: "acme-yoga.com", "x-cds-tenant-host": "victim.com" },
    });
    const res = await middleware(r);
    expect(res.headers.get("x-middleware-request-x-cds-tenant-host")).toBe(
      "acme-yoga.com",
    );
  });

  it("strips a client-sent tenant header on platform hosts (WR-02)", async () => {
    const r = new NextRequest("http://localhost:3000/hub", {
      headers: { host: "localhost:3000", "x-cds-tenant-host": "victim.com" },
    });
    const res = await middleware(r);
    expect(
      res.headers.get("x-middleware-request-x-cds-tenant-host"),
    ).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain(
      "x-cds-tenant-host",
    );
  });

  it("forwards the tenant query for the 404 page and strips a client copy (WR-C02)", async () => {
    const r = new NextRequest(
      "http://acme-yoga.com/system-404?form=f1&sent=1",
      {
        headers: { host: "acme-yoga.com", "x-cds-form-query": "?form=evil" },
      },
    );
    expect(
      (await middleware(r)).headers.get(
        "x-middleware-request-x-cds-form-query",
      ),
    ).toBe("?form=f1&sent=1");
    const bare = new NextRequest("http://acme-yoga.com/", {
      headers: { host: "acme-yoga.com", "x-cds-form-query": "?form=evil" },
    });
    expect(
      (await middleware(bare)).headers.get(
        "x-middleware-request-x-cds-form-query",
      ),
    ).toBeNull();
    const hub = new NextRequest("http://localhost:3000/?a=1", {
      headers: { host: "localhost:3000", "x-cds-form-query": "?form=evil" },
    });
    expect(
      (await middleware(hub)).headers.get(
        "x-middleware-request-x-cds-form-query",
      ),
    ).toBeNull();
  });

  it("replaces a client-sent x-cds-path with the real path on platform hosts (09-15, Pattern 7)", async () => {
    const r = new NextRequest("http://localhost:3000/hub/website?tab=pages", {
      headers: { host: "localhost:3000", "x-cds-path": "/evil" },
    });
    expect(
      (await middleware(r)).headers.get("x-middleware-request-x-cds-path"),
    ).toBe("/hub/website?tab=pages");
  });

  it("removes x-cds-path on tenant hosts (09-15)", async () => {
    const r = new NextRequest("http://acme-yoga.com/about", {
      headers: { host: "acme-yoga.com", "x-cds-path": "/hub/evil" },
    });
    const res = await middleware(r);
    expect(res.headers.get("x-middleware-request-x-cds-path")).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain(
      "x-cds-path",
    );
  });

  it("omits x-cds-path over 2048 characters (09-15 choice 2)", async () => {
    const r = new NextRequest(
      `http://localhost:3000/hub/website?q=${"a".repeat(2100)}`,
      { headers: { host: "localhost:3000", "x-cds-path": "/evil" } },
    );
    expect(
      (await middleware(r)).headers.get("x-middleware-request-x-cds-path"),
    ).toBeNull();
  });

  it("excludes /api/health from the matcher", async () => {
    expect(config.matcher.join(" ")).toContain("api/health");
  });

  it("excludes exactly /api/jobs/quotes (06-09, RESEARCH Pitfall 5)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/quotes$");
  });

  it("excludes exactly /api/jobs/media (07-02, Finding 5)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/media$");
  });

  it("excludes exactly /api/jobs/assembly (08-17)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/assembly$");
  });

  it("excludes exactly /api/jobs/retention (09-21, RESEARCH Pitfall 11)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/retention$");
  });

  it("excludes exactly /api/jobs/billing (10-21, RESEARCH Pitfall 12)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/billing$");
  });

  it("excludes exactly /api/jobs/alerts (11-23)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/alerts$");
  });

  it("excludes exactly /api/jobs/reports (11-34)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/reports$");
  });

  it("excludes exactly /api/jobs/indexing (13-19)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/indexing$");
  });

  it("excludes exactly /api/jobs/review (13-29)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/review$");
  });

  it("excludes exactly /api/jobs/demo (13-31)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/demo$");
  });

  it("excludes exactly /api/monitor/status (13-40)", async () => {
    expect(config.matcher.join(" ")).toContain("api/monitor/status$");
  });

  it("excludes exactly /api/jobs/health (13-44)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/health$");
  });

  it("excludes exactly the edge and domains job paths (14-18, RESEARCH Pitfall 3)", async () => {
    const m = config.matcher.join(" ");
    expect(m).toContain("api/edge/ask$|api/edge/routes$|api/jobs/domains$");
  });

  it("excludes exactly /api/jobs/support (12-31)", async () => {
    expect(config.matcher.join(" ")).toContain("api/jobs/support$");
  });

  // Evaluated with Next's own matcher compiler, so this is what runs in production.
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url });

  it("skips only the exact excluded paths (IN-01)", async () => {
    for (const url of [
      "/api/health",
      "/api/health?x=1",
      "/api/jobs/quotes",
      "/api/jobs/media",
      "/api/jobs/media?x=1",
      "/api/jobs/assembly",
      "/api/jobs/assembly?x=1",
      "/api/jobs/retention",
      "/api/jobs/retention?x=1",
      "/api/jobs/billing",
      "/api/jobs/billing?x=1",
      "/api/jobs/alerts",
      "/api/jobs/alerts?x=1",
      "/api/jobs/reports",
      "/api/jobs/reports?x=1",
      "/api/jobs/support",
      "/api/jobs/support?x=1",
      "/api/jobs/indexing",
      "/api/jobs/indexing?x=1",
      "/api/jobs/review",
      "/api/jobs/review?x=1",
      "/api/jobs/demo",
      "/api/jobs/demo?x=1",
      "/api/monitor/status",
      "/api/monitor/status?x=1",
      "/api/jobs/health",
      "/api/jobs/health?x=1",
      "/api/edge/ask",
      "/api/edge/ask?domain=acme.com",
      "/api/edge/routes",
      "/api/jobs/domains",
      "/api/jobs/domains?x=1",
      "/api/jobs/exports",
      "/api/jobs/exports?x=1",
      "/api/jobs/studio",
      "/favicon.ico",
      "/_next/static/chunks/a.js",
      "/_next/image",
      "/_next/image?url=%2Fa.png&w=64&q=75",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("runs on look-alike paths, so the tenant header is still stripped (IN-01)", async () => {
    for (const url of [
      "/",
      "/about",
      "/api/healthz",
      "/api/health-anything",
      "/api/health/sub",
      "/api/jobs/quotes/x",
      "/api/jobs/quotesx",
      "/api/jobs/media/x",
      "/api/jobs/mediax",
      "/api/jobs/assembly/x",
      "/api/jobs/assemblyx",
      "/api/jobs/retention/x",
      "/api/jobs/retentionx",
      "/api/jobs/exports/x",
      "/api/jobs/exportsx",
      "/api/jobs/billing/x",
      "/api/jobs/billingx",
      "/api/jobs/alerts/x",
      "/api/jobs/alertsx",
      "/api/jobs/reports/x",
      "/api/jobs/reportsx",
      "/api/jobs/support/x",
      "/api/jobs/review/x",
      "/api/jobs/reviewx",
      "/api/jobs/demo/x",
      "/api/jobs/demox",
      "/api/monitor/status/x",
      "/api/monitor/statusx",
      "/api/monitor",
      "/api/jobs/supportx",
      "/api/jobs/indexing/x",
      "/api/jobs/indexingx",
      "/api/jobs/health/x",
      "/api/jobs/healthx",
      "/api/jobsx",
      "/api/jobs",
      "/api/edge",
      "/api/edge/askx",
      "/api/edge/ask/x",
      "/api/edge/routesx",
      "/api/edge/routes/x",
      "/api/jobs/domainsx",
      "/api/jobs/domains/x",
      "/favicon-ico",
      "/favicon.icox",
      "/_next/imagex",
      "/_next/staticx",
      "/tenant/x",
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });
});

describe("security headers (WR-B06)", async () => {
  const cases: [string, NextResponse][] = [
    [
      "hub",
      await middleware(
        req("http://cds.needtobeedgy.com/hub/website", "cds.needtobeedgy.com"),
      ),
    ],
    [
      "sign-in",
      await middleware(req("http://localhost:3000/sign-in", "localhost:3000")),
    ],
    [
      "tenant",
      await middleware(req("http://acme-yoga.com/about", "acme-yoga.com")),
    ],
    [
      "platform 404",
      await middleware(req("http://localhost:3000/tenant/x", "localhost:3000")),
    ],
    ["invalid host", await middleware(req("http://localhost/", "bad host"))],
  ];

  it.each(cases)("%s cannot be framed by any origin", (_name, res) => {
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps hub URLs on the platform origin, tenant sites use the browser default", async () => {
    expect(cases[0]![1].headers.get("referrer-policy")).toBe("same-origin");
    expect(cases[2]![1].headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("keeps Next's inline bootstrap working until nonces are wired", async () => {
    // Platform: script-src limits origins to the app + Turnstile (06-15) but keeps inline.
    const hub = cases[0]![1].headers.get("content-security-policy") ?? "";
    expect(hub).toContain("script-src 'self' 'unsafe-inline'");
    expect(hub).not.toMatch(/style-src|default-src/);
    // Tenant sites: no script, style or default restriction.
    const tenant = cases[2]![1].headers.get("content-security-policy") ?? "";
    expect(tenant).not.toMatch(/script-src|style-src|default-src/);
  });
});

describe("suspended sites (13-22, STAFF-22, P13-P3)", () => {
  afterEach(resetDb);

  it("runs the middleware on the Node.js runtime", () => {
    expect((config as { runtime?: string }).runtime).toBe("nodejs");
  });

  it("answers the neutral 503 on every path class of a suspended host", async () => {
    suspension.resolveOrganization.mockImplementation(async (host: string) =>
      org(host, { suspended: host === "acme-yoga.com" }),
    );
    for (const path of [
      "/",
      "/about",
      "/_media/x/y",
      "/api/forms/abc123",
      "/api/gate",
      "/api/m",
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
    ]) {
      const res = await middleware(
        req(`http://acme-yoga.com${path}`, "acme-yoga.com"),
      );
      expect(res.status, path).toBe(503);
      expect(res.headers.get("retry-after"), path).toBe("86400");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("x-middleware-rewrite"), path).toBeNull();
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      const body = await res.text();
      expect(body).toContain("This site is temporarily unavailable.");
      expect(body).not.toContain("acme");
    }
  });

  it("serves a site that is not suspended", async () => {
    const res = await middleware(
      req("http://acme-yoga.com/about", "acme-yoga.com"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBeTruthy();
    expect(suspension.resolveOrganization).toHaveBeenCalledWith(
      "acme-yoga.com",
    );
  });

  it("never reads suspension on a platform host", async () => {
    await middleware(req("http://localhost:3000/hub", "localhost:3000"));
    await middleware(req("http://localhost:3000/tenant/x", "localhost:3000"));
    await middleware(req("http://localhost/", "bad host"));
    expect(suspension.resolveOrganization).not.toHaveBeenCalled();
  });

  it("fails open when the read throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    suspension.resolveOrganization.mockImplementation(async () => {
      throw new TypeError("down");
    });
    const res = await middleware(req("http://acme-yoga.com/", "acme-yoga.com"));
    expect(res.headers.get("x-middleware-rewrite")).toBeTruthy();
    expect(err).toHaveBeenCalledWith(
      "[middleware] suspension check failed",
      "TypeError",
    );
    err.mockRestore();
  });

  it("the page is neutral: no script, no link, no branding", () => {
    const html = suspendedHtml();
    expect(html).toContain('lang="en"');
    expect(html).toContain("<title>Temporarily unavailable</title>");
    expect(html).toContain("Please check back later.");
    expect(html).not.toMatch(/<script|<a |href=|CDS|Connections/i);
  });
});

describe("redirect hosts and preview after launch (14-18, P14-P5, P14-P6)", () => {
  afterEach(resetDb);

  function withCookie(url: string, host: string, cookie?: string) {
    return new NextRequest(url, {
      headers: cookie ? { host, cookie } : { host },
    });
  }

  it("301s a redirect host to redirect_to keeping path + query on every path", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      h === "old-acme.com"
        ? org(h, {
            hostKind: "redirect",
            redirectTo: "acme.com",
            primaryHost: "acme.com",
          })
        : org(h),
    );
    for (const path of [
      "/",
      "/robots.txt",
      "/sitemap.xml",
      "/_media/x",
      "/about?ref=a&b=2",
    ]) {
      const res = await middleware(
        req(`https://old-acme.com${path}`, "old-acme.com"),
      );
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location"), path).toBe(`https://acme.com${path}`);
      expect(res.headers.get("cache-control"), path).toBe(
        "public, max-age=300",
      );
      expect(res.headers.get("x-middleware-rewrite"), path).toBeNull();
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
    }
  });

  it("never takes the target from the request (T-14-18-02)", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "redirect", redirectTo: "acme.com" }),
    );
    const r = new NextRequest("https://old-acme.com/x?to=evil.com", {
      headers: { host: "old-acme.com", "x-forwarded-host": "evil.com" },
    });
    const res = await middleware(r);
    expect(new URL(res.headers.get("location")!).host).toBe("acme.com");
  });

  it("serves a redirect row with no target (fails open)", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "redirect", redirectTo: null }),
    );
    const res = await middleware(req("https://old-acme.com/", "old-acme.com"));
    expect(res.headers.get("x-middleware-rewrite")).toBeTruthy();
  });

  const PREVIEW = "acme.sites.localhost";
  const livePreview = async (h: string) =>
    h === PREVIEW
      ? org(h, { hostKind: "preview", live: true, primaryHost: "acme.com" })
      : org(h);

  it("301s a plain visitor to the live domain after launch (no-store)", async () => {
    suspension.resolveOrganization.mockImplementation(livePreview);
    const res = await middleware(req(`https://${PREVIEW}/about?x=1`, PREVIEW));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://acme.com/about?x=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("renders the preview host after launch with a valid org-matched cookie", async () => {
    suspension.resolveOrganization.mockImplementation(livePreview);
    for (const cookie of [
      "cds_pv=pv-orgaaaaaaaaaaaa",
      "cds_rv=rv-orgaaaaaaaaaaaa",
      "other=1; cds_rv=rv-orgaaaaaaaaaaaa",
    ]) {
      const res = await middleware(
        withCookie(`https://${PREVIEW}/about`, PREVIEW, cookie),
      );
      expect(res.status, cookie).toBe(200);
      expect(res.headers.get("x-middleware-rewrite"), cookie).toBeTruthy();
    }
  });

  it("301s with an invalid cookie or another org's cookie", async () => {
    suspension.resolveOrganization.mockImplementation(livePreview);
    for (const cookie of [
      "cds_pv=junk",
      "cds_rv=junk",
      "cds_pv=pv-orgbbbbbbbbbbbb",
      "cds_rv=rv-orgbbbbbbbbbbbb",
      "cds_pv=rv-orgaaaaaaaaaaaa",
    ]) {
      const res = await middleware(
        withCookie(`https://${PREVIEW}/about`, PREVIEW, cookie),
      );
      expect(res.status, cookie).toBe(301);
    }
  });

  it("14-35: never 301s the token landing routes (the cookie is set there)", async () => {
    suspension.resolveOrganization.mockImplementation(livePreview);
    for (const path of [
      "/_site/preview?t=x",
      "/_site/review/start?t=x",
      "/_site/review/mark",
    ]) {
      const res = await middleware(req(`https://${PREVIEW}${path}`, PREVIEW));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-rewrite"), path).toBeTruthy();
    }
    // Only those exact routes: a look-alike page still redirects.
    for (const path of [
      "/_site/previewx",
      "/_site/review",
      "/_site/icon.png",
    ]) {
      const res = await middleware(req(`https://${PREVIEW}${path}`, PREVIEW));
      expect(res.status, path).toBe(301);
    }
  });

  it("does not redirect the preview host before launch, or when it is the primary", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "preview", live: false, primaryHost: "acme.com" }),
    );
    let res = await middleware(req(`https://${PREVIEW}/`, PREVIEW));
    expect(res.headers.get("x-middleware-rewrite")).toBeTruthy();
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "preview", live: true, primaryHost: h }),
    );
    res = await middleware(req(`https://${PREVIEW}/`, PREVIEW));
    expect(res.headers.get("x-middleware-rewrite")).toBeTruthy();
  });

  it("suspension wins over a redirect (one read)", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "redirect", redirectTo: "acme.com", suspended: true }),
    );
    const res = await middleware(req("https://old-acme.com/", "old-acme.com"));
    expect(res.status).toBe(503);
    expect(suspension.resolveOrganization).toHaveBeenCalledTimes(1);
  });
});

describe("x-cds-tenant-path (14-18 choice 4, T-14-18-01)", () => {
  afterEach(resetDb);

  it("sets the tenant path on tenant rewrites, replacing a client copy", async () => {
    const r = new NextRequest("http://acme-yoga.com/about?x=1", {
      headers: { host: "acme-yoga.com", "x-cds-tenant-path": "/evil" },
    });
    expect(
      (await middleware(r)).headers.get(
        "x-middleware-request-x-cds-tenant-path",
      ),
    ).toBe("/about");
  });

  it("omits a path over 512 characters", async () => {
    const r = new NextRequest(`http://acme-yoga.com/${"a".repeat(600)}`, {
      headers: { host: "acme-yoga.com", "x-cds-tenant-path": "/evil" },
    });
    const res = await middleware(r);
    expect(
      res.headers.get("x-middleware-request-x-cds-tenant-path"),
    ).toBeNull();
  });

  it("strips a client copy on platform hosts", async () => {
    const r = new NextRequest("http://localhost:3000/hub", {
      headers: { host: "localhost:3000", "x-cds-tenant-path": "/evil" },
    });
    const res = await middleware(r);
    expect(
      res.headers.get("x-middleware-request-x-cds-tenant-path"),
    ).toBeNull();
    expect(res.headers.get("x-middleware-override-headers")).not.toContain(
      "x-cds-tenant-path",
    );
  });
});

describe("tenant internal edge routes (14-18 choice 3)", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
  });

  const rewritten = async (url: string, host: string) => {
    const res = await middleware(req(url, host));
    const r = res.headers.get("x-middleware-rewrite");
    return r ? new URL(r).pathname : null;
  };

  it("rewrites /.well-known/cds-host to the %5Fedge/cds-host route with the tenant header", async () => {
    const res = await middleware(
      req("https://acme.com/.well-known/cds-host", "acme.com"),
    );
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe(
      "/tenant/acme.com/_edge/cds-host",
    );
    expect(res.headers.get("x-middleware-request-x-cds-tenant-host")).toBe(
      "acme.com",
    );
  });

  it("answers the host proof on redirect and post-launch preview hosts (no 301)", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      h === "old-acme.com"
        ? org(h, { hostKind: "redirect", redirectTo: "acme.com" })
        : org(h, { hostKind: "preview", live: true, primaryHost: "acme.com" }),
    );
    expect(
      await rewritten(
        "https://old-acme.com/.well-known/cds-host",
        "old-acme.com",
      ),
    ).toBe("/tenant/old-acme.com/_edge/cds-host");
    expect(
      await rewritten(
        "https://acme.sites.localhost/.well-known/cds-host",
        "acme.sites.localhost",
      ),
    ).toBe("/tenant/acme.sites.localhost/_edge/cds-host");
  });

  it("answers the host proof on a suspended site; every other path stays 503 (WR-B01)", async () => {
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { suspended: true }),
    );
    expect(
      await rewritten("https://acme.com/.well-known/cds-host", "acme.com"),
    ).toBe("/tenant/acme.com/_edge/cds-host");
    const other = await middleware(req("https://acme.com/", "acme.com"));
    expect(other.status).toBe(503);
    expect(
      (await middleware(req(`https://acme.com/${KEY}.txt`, "acme.com"))).status,
    ).toBe(503);
  });

  it("rewrites /<key>.txt to the %5Fedge/indexnow route only for the valid env key", async () => {
    vi.stubEnv("CDS_INDEXNOW_KEY", KEY);
    expect(await rewritten(`https://acme.com/${KEY}.txt`, "acme.com")).toBe(
      "/tenant/acme.com/_edge/indexnow",
    );
    expect(await rewritten("https://acme.com/other.txt", "acme.com")).toBe(
      "/tenant/acme.com/other.txt",
    );
    vi.stubEnv("CDS_INDEXNOW_KEY", "short");
    expect(await rewritten("https://acme.com/short.txt", "acme.com")).toBe(
      "/tenant/acme.com/short.txt",
    );
    vi.stubEnv("CDS_INDEXNOW_KEY", "");
    expect(await rewritten("https://acme.com/.txt", "acme.com")).toBe(
      "/tenant/acme.com/.txt",
    );
  });

  it("the key file on a redirect host still 301s", async () => {
    vi.stubEnv("CDS_INDEXNOW_KEY", KEY);
    suspension.resolveOrganization.mockImplementation(async (h: string) =>
      org(h, { hostKind: "redirect", redirectTo: "acme.com" }),
    );
    const res = await middleware(
      req(`https://old-acme.com/${KEY}.txt`, "old-acme.com"),
    );
    expect(res.status).toBe(301);
  });

  it("never rewrites on a platform host", async () => {
    const res = await middleware(
      req("http://localhost:3000/.well-known/cds-host", "localhost:3000"),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

// 15-22 choice 2 (HUB-03, HUB-04; P15-P11, P15-P17, P15-P26; A1-Q5, A3-Q4).
describe("old URLs on platform hosts (15-22, HUB-03)", () => {
  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
  });
  const hub = (path: string, method = "GET") =>
    middleware(
      new NextRequest(`http://cds.needtobeedgy.com${path}`, {
        method,
        headers: { host: "cds.needtobeedgy.com" },
      }),
    );

  it.each([
    ["/services", "/add-ons"],
    ["/testimonials", "/work"],
    ["/book", "/contact?topic=call"],
    ["/terms", "/legal/terms-of-service"],
    ["/resources", "/"],
    ["/admin", "/sign-in"],
    ["/admin/login", "/sign-in"],
    ["/admin/schedule", "/sign-in"],
    ["/api/newsletter/unsubscribe", "/unsubscribe"],
    ["/api/newsletter/subscribe", "/"],
  ])("GET %s → 301 %s on the platform host", async (path, location) => {
    const res = await hub(path);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      `http://cds.needtobeedgy.com${location}`,
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("drops the request's own query from a fixed target", async () => {
    const res = await hub("/book?next=https://evil.example");
    expect(res.headers.get("location")).toBe(
      "http://cds.needtobeedgy.com/contact?topic=call",
    );
  });

  it("POST unsubscribe → 200 empty (RFC 8058), POST subscribe → 410", async () => {
    const un = await hub("/api/newsletter/unsubscribe", "POST");
    expect(un.status).toBe(200);
    expect(un.headers.get("location")).toBeNull();
    expect(await un.text()).toBe("");
    const sub = await hub("/api/newsletter/subscribe", "POST");
    expect(sub.status).toBe(410);
    expect(await sub.text()).toBe("");
  });

  it("hub pages that exist pass through (no redirect)", async () => {
    for (const path of ["/privacy", "/unsubscribe"]) {
      const res = await hub(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("A&M fork: CDS-only surfaces 404 on platform hosts", async () => {
    for (const path of [
      "/",
      "/about",
      "/pricing",
      "/studio",
      "/add-ons/x",
      "/start",
      "/hub/checkout",
      "/hub/settings/billing",
      "/hub/settings/connect/refresh",
      "/hub/settings/quotes/abc",
      "/report",
      "/report?site=acme-yoga.com",
    ]) {
      expect((await hub(path)).status, path).toBe(404);
    }
  });

  it("the same paths on a tenant host are rewritten, never redirected (T-15-22-03)", async () => {
    for (const path of ["/services", "/book", "/admin/login", "/terms"]) {
      const res = await middleware(
        req(`http://acme-yoga.com${path}`, "acme-yoga.com"),
      );
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(
        new URL(res.headers.get("x-middleware-rewrite")!).pathname,
        path,
      ).toBe(`/tenant/acme-yoga.com${path}`);
    }
    const post = await middleware(
      new NextRequest("http://acme-yoga.com/api/newsletter/subscribe", {
        method: "POST",
        headers: { host: "acme-yoga.com" },
      }),
    );
    expect(new URL(post.headers.get("x-middleware-rewrite")!).pathname).toBe(
      "/tenant/acme-yoga.com/api/newsletter/subscribe",
    );
  });
});

describe("marketing noindex header (15-22, A3-Q4)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const robots = async (path: string) =>
    (
      await middleware(req(`http://localhost:3000${path}`, "localhost:3000"))
    ).headers.get("x-robots-tag");

  it("MARKETING_ROUTE_PREFIXES equals the MARKETING_ROUTES paths", () => {
    expect([...MARKETING_ROUTE_PREFIXES]).toEqual(
      MARKETING_ROUTES.map((r) => r.path),
    );
    expect(Object.isFrozen(MARKETING_ROUTE_PREFIXES)).toBe(true);
  });

  it("outside production every marketing path carries noindex, nofollow", async () => {
    vi.stubEnv("CDS_ENV", "dev");
    for (const path of ["/privacy"]) {
      expect(await robots(path), path).toBe("noindex, nofollow");
    }
    expect(await robots("/sign-in")).toBeNull();
    expect(await robots("/hub/website")).toBeNull();
    expect(await robots("/pricing-old")).toBeNull();
  });

  it("production marketing paths carry no X-Robots-Tag", async () => {
    vi.stubEnv("CDS_ENV", "production");
    for (const path of ["/", "/pricing", "/add-ons/credentials"]) {
      expect(await robots(path), path).toBeNull();
    }
  });

  it("the /staff header is unchanged in every environment", async () => {
    for (const env of ["dev", "production"]) {
      vi.stubEnv("CDS_ENV", env);
      expect(await robots("/staff"), env).toBe("noindex, nofollow");
      expect(await robots("/staff/pipeline"), env).toBe("noindex, nofollow");
    }
  });

  it("tenant marketing-looking paths never get the hub header", async () => {
    vi.stubEnv("CDS_ENV", "dev");
    const res = await middleware(
      req("http://acme-yoga.com/pricing", "acme-yoga.com"),
    );
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });
});

// The apex and platform hosts are parsed once per module, so each case loads a fresh copy.
describe("www → apex (15-22, HUB-04, P15-P17)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return (await import("../middleware")).middleware;
  }
  const APEX = "connectionsdesignstudios.com";
  const HOSTS = `${APEX},www.${APEX},localhost`;

  it("301s www.<apex> to https://<apex> keeping path and query", async () => {
    const mw = await load({
      PLATFORM_HOSTS: HOSTS,
      CDS_PLATFORM_URL: `https://${APEX}`,
    });
    const res = await mw(
      new NextRequest(`http://www.${APEX}/pricing?x=1&y=two`, {
        headers: { host: `www.${APEX}`, "x-forwarded-host": "evil.example" },
      }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(
      `https://${APEX}/pricing?x=1&y=two`,
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("www wins before the old-URL table (one hop to the apex)", async () => {
    const mw = await load({
      PLATFORM_HOSTS: HOSTS,
      CDS_PLATFORM_URL: `https://${APEX}/`,
    });
    const res = await mw(
      new NextRequest(`http://www.${APEX}/services`, {
        headers: { host: `www.${APEX}` },
      }),
    );
    expect(res.headers.get("location")).toBe(`https://${APEX}/services`);
  });

  it("the apex itself is never redirected", async () => {
    const mw = await load({
      PLATFORM_HOSTS: HOSTS,
      CDS_PLATFORM_URL: `https://${APEX}`,
    });
    const res = await mw(
      new NextRequest(`http://${APEX}/sign-in`, { headers: { host: APEX } }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("no apex configured → no www redirect", async () => {
    const mw = await load({ PLATFORM_HOSTS: HOSTS, CDS_PLATFORM_URL: "" });
    const res = await mw(
      new NextRequest(`http://www.${APEX}/sign-in`, {
        headers: { host: `www.${APEX}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("www not in PLATFORM_HOSTS stays a tenant host (rewritten)", async () => {
    const mw = await load({
      PLATFORM_HOSTS: `${APEX},localhost`,
      CDS_PLATFORM_URL: `https://${APEX}`,
    });
    const res = await mw(
      new NextRequest(`http://www.${APEX}/pricing`, {
        headers: { host: `www.${APEX}` },
      }),
    );
    expect(res.headers.get("location")).toBeNull();
    expect(new URL(res.headers.get("x-middleware-rewrite")!).pathname).toBe(
      `/tenant/www.${APEX}/pricing`,
    );
  });
});

describe("A&M fork: the admin area on the site's own host (SITE_ADMIN_HOST)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const SITE = "barber.example.com";
  const ADMIN = "admin.barber.example.com";
  async function load() {
    vi.resetModules();
    vi.stubEnv("PLATFORM_HOSTS", ADMIN);
    vi.stubEnv("SITE_ADMIN_HOST", SITE);
    return (await import("../middleware")).middleware;
  }

  it("serves sign-in, hub and staff on the site host from the platform group", async () => {
    const mw = await load();
    for (const path of ["/sign-in", "/hub/website", "/staff/sign-in"]) {
      const res = await mw(req(`http://${SITE}${path}`, SITE));
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(res.status).toBe(200);
    }
  });

  it("serves admin paths on the internal localhost fetch (Server Action redirects)", async () => {
    const mw = await load();
    const res = await mw(req("http://localhost:3000/hub", "localhost:3000"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("keeps every other path on the public site", async () => {
    const mw = await load();
    const res = await mw(req(`http://${SITE}/about`, SITE));
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      `/tenant/${SITE}/about`,
    );
  });

  it("301s the old admin host's pages to the site host, but not its /api", async () => {
    const mw = await load();
    const res = await mw(req(`http://${ADMIN}/hub/website?x=1`, ADMIN));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://${SITE}/hub/website?x=1`);
    const api = await mw(req(`http://${ADMIN}/api/email/x`, ADMIN));
    expect(api.status).not.toBe(301);
  });
});
