// 09-22: tenant /privacy and /terms loader (AGR-08, D217; CONTEXT A5-Q2, A5-Q3; T-09-22-01,
// T-09-22-02). One loader feeds both routes and the footer links, so they never disagree.
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  readPublishedSitePolicy: vi.fn(),
  siteForRoute: vi.fn(),
}));

vi.mock("../lib/site-cache", () => ({
  getPublishedSitePolicy: (site: unknown, page: string, registry: unknown) =>
    reads.readPublishedSitePolicy(site, registry, page),
}));
vi.mock("../lib/tenant", () => ({ siteForRoute: reads.siteForRoute }));
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => [] },
}));

const { loadSitePolicyPage, policyLinksFor, sitePolicyForSite } =
  await import("../lib/site-policy-pages");

const SITE = { orgId: "org1", host: "rivera.test" } as never;
const DRAFT =
  '<div role="note" data-policy-draft=""><p>Draft: this page is a starting template and has not been reviewed by a lawyer.</p></div>';

function published(over: Record<string, unknown> = {}) {
  return {
    page: "privacy",
    templateVersion: 1,
    title: "Privacy policy",
    html: `${DRAFT}<h2>Who we are</h2><p>We are Rivera.</p><p><a href="mailto:hi@rivera.test">hi@rivera.test</a></p>`,
    clauseIds: [],
    coveredLabels: [],
    draft: true,
    lastUpdated: "2026-10-08 12:30:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  reads.readPublishedSitePolicy.mockReset();
  reads.siteForRoute.mockReset();
  reads.siteForRoute.mockResolvedValue(SITE);
});

describe("loadSitePolicyPage", () => {
  it("is null when the host resolves to no site", async () => {
    reads.siteForRoute.mockResolvedValue(null);
    expect(await loadSitePolicyPage("nope.test", "privacy")).toBeNull();
    expect(reads.readPublishedSitePolicy).not.toHaveBeenCalled();
  });

  it("is null until the owner has acknowledged", async () => {
    reads.readPublishedSitePolicy.mockResolvedValue(null);
    expect(await loadSitePolicyPage("rivera.test", "terms")).toBeNull();
    expect(reads.readPublishedSitePolicy).toHaveBeenCalledWith(
      SITE,
      expect.anything(),
      "terms",
    );
  });

  it("is null (never a 500) when the read throws", async () => {
    reads.readPublishedSitePolicy.mockRejectedValue(new Error("pb down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadSitePolicyPage("rivera.test", "privacy")).toBeNull();
    err.mockRestore();
  });

  it("returns sanitised html, the draft flag and the day of last update", async () => {
    reads.readPublishedSitePolicy.mockResolvedValue(
      published({
        html: `${DRAFT}<h2 onclick="x()">Who we are</h2><script>alert(1)</script><p>We are <a href="javascript:alert(1)">Rivera</a>.</p><p><a href="mailto:hi@rivera.test">hi@rivera.test</a></p>`,
      }),
    );
    const p = await loadSitePolicyPage("rivera.test", "privacy");
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Privacy policy");
    expect(p!.draft).toBe(true);
    expect(p!.lastUpdated).toBe("2026-10-08");
    expect(p!.html).not.toContain("<script");
    expect(p!.html).not.toContain("alert(1)");
    expect(p!.html).not.toContain("onclick");
    expect(p!.html).toContain("<h2>Who we are</h2>");
    expect(p!.html).toContain('<a href="mailto:hi@rivera.test">');
    // The Draft box is rendered by PolicyPage from the flag, not left as loose text.
    expect(p!.html).not.toContain("Draft:");
  });

  it("keeps a non-draft body as is", async () => {
    reads.readPublishedSitePolicy.mockResolvedValue(
      published({ html: "<h2>Terms</h2><p>Be kind.</p>", draft: false }),
    );
    const p = await loadSitePolicyPage("rivera.test", "terms");
    expect(p!.draft).toBe(false);
    expect(p!.html).toBe("<h2>Terms</h2><p>Be kind.</p>");
  });
});

describe("policyLinksFor", () => {
  it("mirrors the loader for both pages", async () => {
    reads.readPublishedSitePolicy.mockImplementation(
      async (_s: unknown, _r: unknown, page: string) =>
        page === "privacy" ? published() : null,
    );
    expect(await policyLinksFor(SITE)).toEqual({ privacy: true, terms: false });
    reads.readPublishedSitePolicy.mockResolvedValue(published());
    expect(await policyLinksFor(SITE)).toEqual({ privacy: true, terms: true });
  });

  it("hides both links when the reads fail (fail closed)", async () => {
    reads.readPublishedSitePolicy.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await policyLinksFor(SITE)).toEqual({
      privacy: false,
      terms: false,
    });
    err.mockRestore();
  });

  it("agrees with sitePolicyForSite", async () => {
    reads.readPublishedSitePolicy.mockResolvedValue(null);
    expect(await sitePolicyForSite(SITE, "privacy")).toBeNull();
    expect(await policyLinksFor(SITE)).toEqual({
      privacy: false,
      terms: false,
    });
  });
});
