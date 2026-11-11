// 14-35 (DOM-10, D172, D-UI-P14-12, D-UI-P14-13; T-14-35-01..03): review mode on the preview
// host. Routes: /_site/review/start turns a valid owner review token into the host-only cds_rv
// cookie; /_site/review/mark and /_site/review/send refuse a foreign Origin and a missing or
// invalid cookie, Looks good moves on to the next unreviewed page, Needs a change opens the note
// page. Chrome: the ReviewBar is a no-JS nav with aria-pressed choices; the strip's review
// variant keeps its 32px box; the layout puts the skip link before the strip and never shows
// review chrome on a custom host.
import { signReviewToken } from "@cds/db";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  header: null as string | null,
  path: null as string | null,
  query: null as string | null,
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9" });
    if (state.header !== null) h.set("x-cds-tenant-host", state.header);
    if (state.path !== null) h.set("x-cds-tenant-path", state.path);
    if (state.query !== null) h.set("x-cds-form-query", state.query);
    return h;
  },
  cookies: async () => ({
    get: (name: string) =>
      state.cookies[name] === undefined
        ? undefined
        : { name, value: state.cookies[name] },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  siteContextForHost: vi.fn(),
  reviewContextForToken: vi.fn(),
  reviewPages: vi.fn(),
  markPage: vi.fn(),
  markPhoneCheck: vi.fn(),
  requestPageChange: vi.fn(),
  readSiteManifest: vi.fn(),
  readPublicSiteSettings: vi.fn(),
  readPublicDesign: vi.fn(),
  readAddonSiteState: vi.fn(),
  readPublicAddonRecords: vi.fn(),
  readPublicBusiness: vi.fn(),
  readPublicLogoId: vi.fn(),
  resolvePublicMedia: vi.fn(),
  readPublishedSitePolicy: vi.fn(),
  readPublicAnalytics: vi.fn(),
  readPublicPopups: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { GET: start } =
  await import("../app/tenant/[host]/%5Fsite/review/start/route");
const { POST: mark } =
  await import("../app/tenant/[host]/%5Fsite/review/mark/route");
const { POST: send } =
  await import("../app/tenant/[host]/%5Fsite/review/send/route");
const { default: NotePage } =
  await import("../app/tenant/[host]/%5Fsite/review/note/page");
const { ReviewBar } = await import("../app/tenant/[host]/_chrome/ReviewBar");
const { PreviewStrip } =
  await import("../app/tenant/[host]/_chrome/PreviewStrip");
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");

const ORG = "orgaaaaaaaaaaaa";
const OTHER = "orgbbbbbbbbbbbb";
const OWNER = "useraaaaaaaaaaa";
const HOST = "rivera.sites.localhost";
const HOME = "homeaaaaaaaaaaa";
const ABOUT = "aboutaaaaaaaaaa";
const MENU = "menuaaaaaaaaaaa";

const PAGES = () => [
  { id: HOME, title: "Home", path: "/", status: "looks_good" },
  { id: ABOUT, title: "About us", path: "/about", status: "not_looked" },
  { id: MENU, title: "Menu", path: "/menu", status: "not_looked" },
];

const ctx = { orgId: ORG, actor: OWNER, role: "owner" };

function site(hostKind: "preview" | "custom" | "redirect" = "preview") {
  return { orgId: ORG, host: HOST, hostKind, primaryHost: HOST };
}

const savedEnv = process.env.CDS_ENV;

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  state.header = HOST;
  state.path = null;
  state.query = null;
  state.cookies = {};
  db.siteContextForHost.mockResolvedValue(site());
  db.reviewContextForToken.mockResolvedValue(ctx);
  db.reviewPages.mockResolvedValue(PAGES());
  db.markPage.mockResolvedValue({});
  db.markPhoneCheck.mockResolvedValue({});
  db.requestPageChange.mockResolvedValue({ ticketNumber: 1042 });
  db.readSiteManifest.mockResolvedValue(null);
  db.readPublicSiteSettings.mockResolvedValue({ banner: null });
  db.readPublicDesign.mockResolvedValue(null);
  db.readAddonSiteState.mockResolvedValue({ active: [], hiddenPageIds: [] });
  db.readPublicAddonRecords.mockResolvedValue([]);
  db.readPublicBusiness.mockResolvedValue(null);
  db.readPublicLogoId.mockResolvedValue(null);
  db.resolvePublicMedia.mockResolvedValue({});
  db.readPublishedSitePolicy.mockResolvedValue(null);
  db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: null });
  db.readPublicPopups.mockResolvedValue([]);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = savedEnv;
});

const params = { params: Promise.resolve({ host: HOST }) };

async function land(token: string, next?: string) {
  const q = new URLSearchParams({ t: token });
  if (next !== undefined) q.set("next", next);
  return start(
    new Request(`http://${HOST}:3000/_site/review/start?${q.toString()}`),
    params,
  );
}

function post(
  path: string,
  fields: Record<string, string>,
  opts: { origin?: string | null; cookie?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const origin =
    opts.origin === undefined ? `http://${HOST}:3000` : opts.origin;
  if (origin !== null) headers.origin = origin;
  const cookie = opts.cookie === undefined ? "cds_rv=tok" : opts.cookie;
  if (cookie !== null) headers.cookie = cookie;
  return new Request(`http://${HOST}:3000${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

describe("GET /_site/review/start (choice 1)", () => {
  it("sets a host-only HttpOnly Lax cookie and lands on next", async () => {
    const t = signReviewToken(ORG, OWNER, "review");
    const res = await land(t, "/about");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/about");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toContain(`cds_rv=${t}`);
    expect(c).toContain("Path=/");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).not.toMatch(/Domain=/i);
    expect(c).not.toContain("Secure");
    const age = Number(/Max-Age=(\d+)/.exec(c)?.[1]);
    expect(age).toBeGreaterThan(3500);
    expect(age).toBeLessThanOrEqual(3600);
  });

  it("adds Secure in production", async () => {
    process.env.CDS_ENV = "production";
    process.env.CDS_LINK_SECRET ??= "x".repeat(48);
    const t = signReviewToken(ORG, OWNER, "review");
    const res = await land(t);
    expect(res.headers.get("set-cookie")).toContain("; Secure");
  });

  it("without next: the first page not yet Looks good; a phone token lands on Home", async () => {
    let res = await land(signReviewToken(ORG, OWNER, "review"));
    expect(res.headers.get("location")).toBe("/about");
    res = await land(signReviewToken(ORG, OWNER, "phone"), "/menu");
    expect(res.headers.get("location")).toBe("/");
  });

  it("never follows an unsafe next", async () => {
    for (const bad of ["//evil.com", "https://evil.com", "/a/b", "/\\evil"]) {
      const res = await land(signReviewToken(ORG, OWNER, "review"), bad);
      expect(res.headers.get("location"), bad).toBe("/about");
    }
  });

  it("refuses another org's, a junk or an expired token, a custom host, a lapsed owner", async () => {
    const cases: [string, () => void][] = [
      [signReviewToken(OTHER, OWNER, "review"), () => {}],
      ["junk", () => {}],
      [
        signReviewToken(ORG, OWNER, "review", Date.now() - 2 * 3600_000),
        () => {},
      ],
      [
        signReviewToken(ORG, OWNER, "review"),
        () => db.siteContextForHost.mockResolvedValue(site("custom")),
      ],
      [
        signReviewToken(ORG, OWNER, "review"),
        () => db.reviewContextForToken.mockResolvedValue(null),
      ],
    ];
    for (const [t, setup] of cases) {
      setup();
      const res = await land(t);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("POST /_site/review/mark (choice 2)", () => {
  it("refuses a foreign, missing or null Origin (T-14-35-01)", async () => {
    for (const origin of [
      "https://evil.com",
      `http://${HOST}.evil.com`,
      null,
      "null",
    ]) {
      const res = await mark(
        post(
          "/_site/review/mark",
          { page: ABOUT, choice: "looks_good" },
          { origin },
        ),
        params,
      );
      expect(res.status, String(origin)).toBe(403);
    }
    expect(db.markPage).not.toHaveBeenCalled();
  });

  it("production needs https and no port", async () => {
    process.env.CDS_ENV = "production";
    let res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(res.status).toBe(403);
    res = await mark(
      post(
        "/_site/review/mark",
        { page: ABOUT, choice: "looks_good" },
        { origin: `https://${HOST}` },
      ),
      params,
    );
    expect(res.status).toBe(303);
  });

  it("refuses a missing or invalid cookie (T-14-35-02)", async () => {
    let res = await mark(
      post(
        "/_site/review/mark",
        { page: ABOUT, choice: "looks_good" },
        { cookie: null },
      ),
      params,
    );
    expect(res.status).toBe(403);
    db.reviewContextForToken.mockResolvedValue(null);
    res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(res.status).toBe(403);
    db.reviewContextForToken.mockResolvedValue({ ...ctx, orgId: OTHER });
    res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(res.status).toBe(403);
    expect(db.markPage).not.toHaveBeenCalled();
  });

  it("refuses on a custom host", async () => {
    db.siteContextForHost.mockResolvedValue(site("custom"));
    const res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  it("looks_good marks and goes to the next unreviewed page with the status", async () => {
    const res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(db.markPage).toHaveBeenCalledWith(ctx, ABOUT, "looks_good");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/menu?rs=marked&rp=${ABOUT}`);
  });

  it("looks_good on the last unreviewed page stays with rs=done", async () => {
    db.reviewPages.mockResolvedValue(
      PAGES().map((p) => (p.id === MENU ? p : { ...p, status: "looks_good" })),
    );
    const res = await mark(
      post("/_site/review/mark", { page: MENU, choice: "looks_good" }),
      params,
    );
    expect(res.headers.get("location")).toBe("/menu?rs=done");
  });

  it("needs_change opens the note page; phone ticks the phone check", async () => {
    let res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "needs_change" }),
      params,
    );
    expect(res.headers.get("location")).toBe(
      `/_site/review/note?page=${ABOUT}`,
    );
    expect(db.markPage).not.toHaveBeenCalled();
    res = await mark(
      post("/_site/review/mark", { page: HOME, choice: "phone" }),
      params,
    );
    expect(db.markPhoneCheck).toHaveBeenCalledWith(ctx);
    expect(res.headers.get("location")).toBe("/?rs=phone");
  });

  it("an unknown page or choice is refused; a failure comes back as rs=error", async () => {
    let res = await mark(
      post("/_site/review/mark", {
        page: "zzzzzzzzzzzzzzz",
        choice: "looks_good",
      }),
      params,
    );
    expect(res.status).toBe(403);
    res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "delete" }),
      params,
    );
    expect(res.status).toBe(403);
    db.markPage.mockRejectedValue(new Error("boom"));
    res = await mark(
      post("/_site/review/mark", { page: ABOUT, choice: "looks_good" }),
      params,
    );
    expect(res.headers.get("location")).toBe("/about?rs=error");
  });
});

describe("POST /_site/review/send and the note page (choice 3)", () => {
  it("files the note and returns to the page with rs=sent", async () => {
    const res = await send(
      post("/_site/review/send", {
        page: ABOUT,
        note: "Change the phone number in the footer.",
      }),
      params,
    );
    expect(db.requestPageChange).toHaveBeenCalledWith(
      ctx,
      ABOUT,
      "Change the phone number in the footer.",
    );
    expect(res.headers.get("location")).toBe("/about?rs=sent");
  });

  it("checks Origin and cookie; a short note comes back with NOTE-SHORT", async () => {
    let res = await send(
      post(
        "/_site/review/send",
        { page: ABOUT, note: "A long enough note here." },
        { origin: "https://evil.com" },
      ),
      params,
    );
    expect(res.status).toBe(403);
    res = await send(
      post(
        "/_site/review/send",
        { page: ABOUT, note: "A long enough note here." },
        { cookie: null },
      ),
      params,
    );
    expect(res.status).toBe(403);
    res = await send(
      post("/_site/review/send", { page: ABOUT, note: "short" }),
      params,
    );
    expect(res.headers.get("location")).toBe(
      `/_site/review/note?page=${ABOUT}&e=short&n=short`,
    );
    expect(db.requestPageChange).not.toHaveBeenCalled();
  });

  it("the note page: platform chrome, heading, form to send, NOTE-SHORT, noindex", async () => {
    state.cookies = { cds_rv: "tok" };
    const el = await NotePage({
      params: Promise.resolve({ host: HOST }),
      searchParams: Promise.resolve({ page: ABOUT, e: "short", n: "short" }),
    });
    const out = renderToStaticMarkup(el as ReactElement);
    expect(out).toContain("What should change on About us?");
    expect(out).toContain('action="/_site/review/send"');
    expect(out).toContain('name="note"');
    expect(out).toContain("Tell us a little more, at least 10 characters.");
    expect(out).toContain("Send to CDS");
    expect(out).toContain('href="/about"');
    expect(out).toContain('aria-label="Preview notice"');
    expect(out).not.toContain("data-site");
    expect(out).not.toContain("<script");
    expect(out.indexOf("Skip to content")).toBeLessThan(
      out.indexOf("Preview notice"),
    );
  });

  it("the note page without a valid cookie says the link ended", async () => {
    db.reviewContextForToken.mockResolvedValue(null);
    state.cookies = { cds_rv: "tok" };
    const out = renderToStaticMarkup(
      (await NotePage({
        params: Promise.resolve({ host: HOST }),
        searchParams: Promise.resolve({ page: ABOUT }),
      })) as ReactElement,
    );
    expect(out).toContain("This review link has ended");
    expect(out).not.toContain('name="note"');
  });

  it("WR-D02: a review read that throws shows the link-ended page, never a 500", async () => {
    state.cookies = { cds_rv: "tok" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fail of [
      () => db.reviewContextForToken.mockRejectedValue(new Error("pb down")),
      () => {
        db.reviewContextForToken.mockResolvedValue(ctx);
        db.reviewPages.mockRejectedValue(new Error("pb down"));
      },
    ]) {
      fail();
      const out = renderToStaticMarkup(
        (await NotePage({
          params: Promise.resolve({ host: HOST }),
          searchParams: Promise.resolve({ page: ABOUT }),
        })) as ReactElement,
      );
      expect(out).toContain("This review link has ended");
      expect(out).not.toContain('name="note"');
    }
    spy.mockRestore();
  });
});

describe("ReviewBar and the review strip (choice 4)", () => {
  const bar = (status = "not_looked") =>
    renderToStaticMarkup(
      <ReviewBar
        page={{ id: ABOUT, title: "About us", status }}
        index={2}
        total={3}
        prevHref="/"
        nextHref="/menu"
      />,
    );

  it("is a labelled nav with no-JS POST buttons carrying aria-pressed and the page name", () => {
    const out = bar("looks_good");
    expect(out).toContain('aria-label="Page review"');
    expect(out.startsWith("<nav")).toBe(true);
    expect(out).toContain('method="post"');
    expect(out).toContain('action="/_site/review/mark"');
    expect(out).toMatch(/value="looks_good" aria-pressed="true"/);
    expect(out).toMatch(/value="needs_change" aria-pressed="false"/);
    expect(out).toContain(": About us");
    expect(out).toContain("Page 2 of 3");
    expect(out).toContain("Previous page");
    expect(out).toContain("Next page");
    expect(out).toContain("h-[88px]");
    expect(out).toContain("sm:h-14");
    expect(out).toContain("h-11");
    expect(out).not.toContain("<script");
    expect(out).not.toMatch(/\son[a-z]+=/);
  });

  it("the review strip keeps 32px and shows the page line or the status", () => {
    const out = renderToStaticMarkup(
      <PreviewStrip
        variant="review"
        review={{
          page: { index: 3, total: 7, title: "About us" },
          status: null,
          backHref: "https://cds.test/hub/review",
          phoneCheckPageId: null,
        }}
      />,
    );
    expect(out).toContain("h-8");
    expect(out).toContain("Review mode · Page 3 of 7 · ");
    expect(out).toContain('title="About us"');
    expect(out).toContain('href="https://cds.test/hub/review"');
    expect(out).toContain("Back to your review");
    const status = renderToStaticMarkup(
      <PreviewStrip
        variant="review"
        review={{
          page: null,
          status: "Thanks. Phone check done.",
          backHref: "/x",
          phoneCheckPageId: HOME,
        }}
      />,
    );
    expect(status).toContain('role="status"');
    expect(status).toContain("Thanks. Phone check done.");
    expect(status).toContain("Checked on my phone");
    expect(status).toContain('value="phone"');
  });
});

describe("tenant layout in review mode (choice 4)", () => {
  async function render(
    hostKind: "preview" | "custom" | "redirect" = "preview",
  ): Promise<string> {
    db.siteContextForHost.mockResolvedValue(site(hostKind));
    return renderToStaticMarkup(
      (await TenantLayout({
        children: <p>child</p>,
        params: Promise.resolve({ host: HOST }),
      })) as ReactElement,
    );
  }

  it("valid cookie on a review page: skip link, review strip, padded root, bar", async () => {
    state.cookies = { cds_rv: signReviewToken(ORG, OWNER, "review") };
    state.path = "/about";
    const out = await render();
    expect(out.startsWith("<a")).toBe(true);
    expect(out.indexOf("Skip to content")).toBeLessThan(
      out.indexOf('data-preview-strip="review"'),
    );
    expect(out).toContain("Review mode · Page 2 of 3 · ");
    expect(out).toContain('aria-label="Page review"');
    expect(out).toContain("pb-[calc(88px+env(safe-area-inset-bottom))]");
    expect(out.indexOf("data-site")).toBeLessThan(out.indexOf("Page review"));
    // One skip link only.
    expect(out.split("Skip to content").length).toBe(2);
  });

  it("shows the one-line status from rs", async () => {
    state.cookies = { cds_rv: signReviewToken(ORG, OWNER, "review") };
    state.path = "/menu";
    state.query = `?rs=marked&rp=${ABOUT}`;
    const out = await render();
    expect(out).toContain('role="status"');
    expect(out).toContain("Marked About us as looks good.");
  });

  it("phone session: Checked on my phone on the first page only", async () => {
    state.cookies = { cds_rv: signReviewToken(ORG, OWNER, "phone") };
    state.path = "/";
    expect(await render()).toContain("Checked on my phone");
    state.path = "/about";
    expect(await render()).not.toContain("Checked on my phone");
  });

  it("custom and redirect hosts never render review chrome (T-14-35-03)", async () => {
    state.cookies = { cds_rv: signReviewToken(ORG, OWNER, "review") };
    state.path = "/about";
    for (const kind of ["custom", "redirect"] as const) {
      const out = await render(kind);
      expect(out, kind).not.toContain("Page review");
      expect(out, kind).not.toContain("Preview notice");
    }
    expect(db.reviewContextForToken).not.toHaveBeenCalled();
  });

  it("an invalid or lapsed cookie renders the normal strip and no bar", async () => {
    state.cookies = { cds_rv: signReviewToken(ORG, OWNER, "review") };
    state.path = "/about";
    db.reviewContextForToken.mockResolvedValue(null);
    const out = await render();
    expect(out).toContain('data-preview-strip="normal"');
    expect(out).not.toContain("Page review");
  });
});
