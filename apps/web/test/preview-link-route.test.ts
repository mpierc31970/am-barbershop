// 14-20 (DOM-07, D22; T-14-20-02, T-14-20-03): the preview host's /_site/preview?t= landing.
// A valid, org-matched token on a preview host becomes the host-only cds_pv cookie (HttpOnly,
// SameSite=Lax, Max-Age = the remaining TTL, Secure only in production) and a 303 to the page;
// an expired, tampered or other-org token never gets a draft cookie (Max-Age 300, 303 to "/").
import { PREVIEW_LINK_MS, signPreviewToken } from "@cds/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  previewPageForLink: vi.fn(),
  mintPreviewLink: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const site = vi.hoisted(() => ({
  siteForRoute: vi.fn(),
  getManifest: vi.fn(),
}));
vi.mock("../lib/tenant", () => ({ siteForRoute: site.siteForRoute }));
vi.mock("../lib/site-cache", () => ({ getManifest: site.getManifest }));

// 14-20 choice 1: the action, with runAction reduced to "a session exists".
const hub = vi.hoisted(() => ({ host: "localhost:3000" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: hub.host }),
}));
vi.mock("../lib/action", () => ({
  runAction: async (fn: (s: { ctx: unknown }) => Promise<unknown>) => {
    try {
      return {
        ok: true,
        data: await fn({ ctx: { orgId: "orgaaaaaaaaaaaa" } }),
      };
    } catch (err) {
      return { ok: false, code: "x", message: (err as Error).name };
    }
  },
}));
const { mintPreviewLinkAction } = await import("../app/actions/preview-link");

const { GET } = await import("../app/tenant/[host]/%5Fsite/preview/route");
const { INVALID_LINK_COOKIE_SECONDS } = await import("../lib/redirect-host");

const ORG = "orgaaaaaaaaaaaa";
const OTHER = "orgbbbbbbbbbbbb";
const PAGE = "pageaaaaaaaaaaa";
const HOST = "rivera.sites.localhost";

function previewSite(hostKind: "preview" | "custom" = "preview") {
  return {
    orgId: ORG,
    host: HOST,
    hostKind,
    primaryHost: HOST,
  };
}

async function land(token: string | null) {
  const url = `http://${HOST}/_site/preview${token === null ? "" : `?t=${encodeURIComponent(token)}`}`;
  return GET(new Request(url), {
    params: Promise.resolve({ host: HOST }),
  });
}

const savedEnv = process.env.CDS_ENV;
const savedSecret = process.env.CDS_LINK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  site.siteForRoute.mockResolvedValue(previewSite());
  site.getManifest.mockResolvedValue({
    version: 1,
    pages: {
      home: {
        id: "homeaaaaaaaaaaa",
        title: "Home",
        published_at: "",
        protected: false,
      },
      about: { id: PAGE, title: "About", published_at: "", protected: false },
    },
    redirects: {},
    updated_at: "",
  });
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = savedEnv;
  if (savedSecret === undefined) delete process.env.CDS_LINK_SECRET;
  else process.env.CDS_LINK_SECRET = savedSecret;
});

describe("GET /_site/preview (DOM-07)", () => {
  it("valid token: 303 to the page's published path with the draft cookie", async () => {
    delete process.env.CDS_ENV;
    const token = signPreviewToken(ORG, PAGE);
    const res = await land(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/about");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`cds_pv=${token}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toMatch(/Domain=/i);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(PREVIEW_LINK_MS / 1000 - 60);
    expect(maxAge).toBeLessThanOrEqual(PREVIEW_LINK_MS / 1000);
    expect(db.previewPageForLink).not.toHaveBeenCalled();
  });

  it("Secure is added in production", async () => {
    process.env.CDS_ENV = "production";
    process.env.CDS_LINK_SECRET = "test-link-secret-0123456789abcdef0123456789";
    const res = await land(signPreviewToken(ORG, PAGE));
    expect(res.headers.get("set-cookie")).toContain("; Secure");
  });

  it("a draft-only page lands on its draft slug", async () => {
    const draftOnly = "draftaaaaaaaaaa";
    db.previewPageForLink.mockResolvedValue({
      status: "draft",
      page: { page: { id: draftOnly, slug: "new-menu" } },
    });
    const res = await land(signPreviewToken(ORG, draftOnly));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/new-menu");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("expired token: no draft cookie, 303 to / with a short-lived marker", async () => {
    const token = signPreviewToken(
      ORG,
      PAGE,
      Date.now() - PREVIEW_LINK_MS - 1000,
    );
    const res = await land(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`Max-Age=${INVALID_LINK_COOKIE_SECONDS}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("another org's token is refused (T-14-20-02)", async () => {
    const res = await land(signPreviewToken(OTHER, PAGE));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain(
      `Max-Age=${INVALID_LINK_COOKIE_SECONDS}`,
    );
    expect(db.previewPageForLink).not.toHaveBeenCalled();
  });

  it("a tampered token is refused", async () => {
    const token = signPreviewToken(ORG, PAGE);
    const res = await land(`${token.slice(0, -2)}xx`);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain(
      `Max-Age=${INVALID_LINK_COOKIE_SECONDS}`,
    );
  });

  it("a custom host never takes a draft cookie", async () => {
    site.siteForRoute.mockResolvedValue(previewSite("custom"));
    const res = await land(signPreviewToken(ORG, PAGE));
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain(
      `Max-Age=${INVALID_LINK_COOKIE_SECONDS}`,
    );
  });

  it("junk is never echoed into the header", async () => {
    const res = await land("a;b\r\nX: y");
    expect(res.headers.get("set-cookie")).toContain("cds_pv=invalid;");
  });

  it("no token: 303 to / without a cookie; unknown host 404", async () => {
    const res = await land(null);
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toBeNull();
    site.siteForRoute.mockResolvedValue(null);
    const miss = await land(signPreviewToken(ORG, PAGE));
    expect(miss.status).toBe(404);
  });
});

describe("mintPreviewLinkAction (14-20 choice 1)", () => {
  it("returns the preview host landing URL (dev: http + hub port)", async () => {
    delete process.env.CDS_ENV;
    db.mintPreviewLink.mockResolvedValue({
      host: HOST,
      token: "v1.tok",
      expiresAt: 1,
    });
    const res = await mintPreviewLinkAction(PAGE);
    expect(res).toEqual({
      ok: true,
      data: { url: `http://${HOST}:3000/_site/preview?t=v1.tok`, expiresAt: 1 },
    });
    expect(db.mintPreviewLink).toHaveBeenCalledWith(
      { orgId: "orgaaaaaaaaaaaa" },
      PAGE,
    );
  });

  it("is https without a port in production", async () => {
    process.env.CDS_ENV = "production";
    db.mintPreviewLink.mockResolvedValue({
      host: HOST,
      token: "t",
      expiresAt: 1,
    });
    const res = await mintPreviewLinkAction(PAGE);
    expect(res.ok && res.data.url).toBe(`https://${HOST}/_site/preview?t=t`);
  });

  it("refuses a malformed page id before any read", async () => {
    const res = await mintPreviewLinkAction("../x");
    expect(res.ok).toBe(false);
    expect(db.mintPreviewLink).not.toHaveBeenCalled();
  });
});
