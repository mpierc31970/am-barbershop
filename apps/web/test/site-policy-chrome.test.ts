// 09-22 Task 2: footer policy links in the site chrome and the sitemap entries (AGR-08, AGR-09;
// D217, D249; choice 2). Same loader as the routes; fail closed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sitePolicyForSite: vi.fn(),
  policyLinksFor: vi.fn(),
  getSiteIndex: vi.fn(),
  siteForRoute: vi.fn(),
}));

vi.mock("../lib/site-policy-pages", () => ({
  sitePolicyForSite: m.sitePolicyForSite,
  policyLinksFor: m.policyLinksFor,
}));
vi.mock("../lib/site-cache", () => ({
  getSiteIndex: m.getSiteIndex,
  getPublicBusiness: async () => null,
  getAddonSiteState: async () => ({ hiddenPageIds: [] }),
  getSiteLogoId: async () => null,
}));
vi.mock("../lib/tenant", () => ({ siteForRoute: m.siteForRoute }));

const { fallbackChrome, loadSiteChrome } = await import("../lib/site-chrome");
const sitemap = await import("../app/tenant/[host]/sitemap.xml/route");

const SITE = {
  orgId: "org1",
  host: "rivera.test",
  primaryHost: "rivera.test",
  hostKind: "custom",
} as never;
const NOW = new Date("2026-10-08T00:00:00Z");
const LIVE = {
  banner: null,
  popups: [],
  nav: null,
  footer: null,
  settings: {},
} as never;

function view(lastUpdated: string) {
  return { title: "x", html: "<p>x</p>", lastUpdated, draft: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.siteForRoute.mockResolvedValue(SITE);
  m.getSiteIndex.mockResolvedValue({
    pages: [{ path: "/", lastmod: "2026-10-01" }],
  });
});

describe("site chrome policy links", () => {
  it("loadSiteChrome carries the loader's links", async () => {
    m.policyLinksFor.mockResolvedValue({ privacy: true, terms: false });
    const c = await loadSiteChrome(SITE, {
      live: LIVE,
      manifest: null,
      now: NOW,
    });
    expect(c.policyLinks).toEqual({ privacy: true, terms: false });
    expect(m.policyLinksFor).toHaveBeenCalledWith(SITE);
  });

  it("a failed policy read hides both links, chrome still loads", async () => {
    m.policyLinksFor.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = await loadSiteChrome(SITE, {
      live: LIVE,
      manifest: null,
      now: NOW,
    });
    err.mockRestore();
    expect(c.policyLinks).toEqual({ privacy: false, terms: false });
    expect(c.reportHref).not.toBe("");
  });

  it("fallbackChrome sets no policy links (fail closed), Report kept", () => {
    const c = fallbackChrome("rivera.test", NOW);
    expect(c.policyLinks).toEqual({ privacy: false, terms: false });
    expect(c.reportHref).not.toBe("");
  });
});

async function getSitemap(): Promise<string> {
  const r = await sitemap.GET(new Request("https://rivera.test/sitemap.xml"), {
    params: Promise.resolve({ host: "rivera.test" }),
  });
  expect(r.status).toBe(200);
  return r.text();
}

describe("sitemap policy entries", () => {
  it("lists /privacy and /terms once published, with their last update", async () => {
    m.sitePolicyForSite.mockImplementation(async (_s: unknown, page: string) =>
      view(page === "privacy" ? "2026-10-08" : "2026-10-07"),
    );
    const xml = await getSitemap();
    expect(xml).toContain("<loc>https://rivera.test/</loc>");
    expect(xml).toContain(
      "<loc>https://rivera.test/privacy</loc>\n    <lastmod>2026-10-08</lastmod>",
    );
    expect(xml).toContain(
      "<loc>https://rivera.test/terms</loc>\n    <lastmod>2026-10-07</lastmod>",
    );
  });

  it("IN-C05: a builder page at /privacy or /terms is never listed (shadowed, no duplicate)", async () => {
    m.getSiteIndex.mockResolvedValue({
      pages: [
        { path: "/", lastmod: "2026-10-01" },
        { path: "/privacy", lastmod: "2026-09-01" },
        { path: "/Terms/", lastmod: "2026-09-01" },
        { path: "/privacy-faq", lastmod: "2026-09-02" },
      ],
    });
    m.sitePolicyForSite.mockImplementation(async (_s: unknown, page: string) =>
      page === "privacy" ? view("2026-10-08") : null,
    );
    const xml = await getSitemap();
    expect(
      xml.match(/<loc>https:\/\/rivera\.test\/privacy<\/loc>/g),
    ).toHaveLength(1);
    expect(xml).toContain("<lastmod>2026-10-08</lastmod>");
    expect(xml).not.toContain("2026-09-01");
    expect(xml.toLowerCase()).not.toContain("/terms");
    expect(xml).toContain("https://rivera.test/privacy-faq");
  });

  it("leaves them out until published", async () => {
    m.sitePolicyForSite.mockImplementation(async (_s: unknown, page: string) =>
      page === "terms" ? view("2026-10-07") : null,
    );
    const xml = await getSitemap();
    expect(xml).not.toContain("/privacy");
    expect(xml).toContain("https://rivera.test/terms");
  });

  it("no index and no policies -> empty urlset; unknown host 404", async () => {
    m.getSiteIndex.mockRejectedValue(new Error("down"));
    m.sitePolicyForSite.mockResolvedValue(null);
    expect(await getSitemap()).not.toContain("<url>");
    m.siteForRoute.mockResolvedValue(null);
    const r = await sitemap.GET(new Request("https://x.test/sitemap.xml"), {
      params: Promise.resolve({ host: "x.test" }),
    });
    expect(r.status).toBe(404);
  });
});
