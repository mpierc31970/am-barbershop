import { describe, expect, it } from "vitest";
import { seoHealth, SEO_RULE_WEIGHTS, type SeoPageInput } from "./index";

function page(over: Partial<SeoPageInput> = {}): SeoPageInput {
  return {
    id: "p1",
    title: "Home",
    slug: "",
    metaTitle: "Acme Plumbing | Austin plumbers",
    metaDescription:
      "Licensed Austin plumbers for repairs, water heaters and drains. Same-day visits and fair prices.",
    h1Count: 1,
    imagesWithoutAlt: 0,
    brokenInternalLinks: 0,
    ...over,
  };
}

describe("seoHealth", () => {
  it("weights sum to 100", () => {
    const sum = Object.values(SEO_RULE_WEIGHTS).reduce((s, n) => s + n, 0);
    expect(sum).toBe(100);
  });

  it("a page meeting every rule scores 100 with no fixes", () => {
    expect(seoHealth([page()], { sitemapOk: true })).toEqual({
      score: 100,
      fixes: [],
    });
  });

  it("missing description names the page", () => {
    const r = seoHealth(
      [page(), page({ id: "p2", title: "About us", metaDescription: "" })],
      { sitemapOk: true },
    );
    expect(r.score).toBe(90);
    expect(r.fixes).toEqual([
      {
        pageId: "p2",
        rule: "description",
        message: "Add a description to About us",
      },
    ]);
  });

  it("returns at most three fixes, highest weight first", () => {
    const bad = page({
      id: "p9",
      title: "Services",
      metaTitle: "",
      metaDescription: "short",
      h1Count: 2,
      imagesWithoutAlt: 3,
      brokenInternalLinks: 1,
    });
    const r = seoHealth([bad], { sitemapOk: false });
    expect(r.score).toBe(0);
    expect(r.fixes).toHaveLength(3);
    expect(r.fixes.map((f) => f.rule)).toEqual(["title", "description", "h1"]);
    expect(r.fixes[1].message).toBe("Lengthen the description on Services");
    expect(r.fixes.every((f) => f.pageId === "p9")).toBe(true);
  });

  it("title too long is a fix; out-of-range lengths fail", () => {
    const r = seoHealth([page({ title: "Blog", metaTitle: "x".repeat(61) })], {
      sitemapOk: true,
    });
    expect(r.score).toBe(80);
    expect(r.fixes[0]).toMatchObject({ rule: "title", pageId: "p1" });
    expect(r.fixes[0].message).toBe("Shorten the title on Blog");
  });

  it("sitemap failure costs 5 and is listed with no page", () => {
    const r = seoHealth([page()], { sitemapOk: false });
    expect(r.score).toBe(95);
    expect(r.fixes).toEqual([
      {
        pageId: null,
        rule: "sitemap",
        message: "Your sitemap could not be reached",
      },
    ]);
  });

  it("empty page list scores 100 only when the sitemap is ok", () => {
    expect(seoHealth([], { sitemapOk: true })).toEqual({
      score: 100,
      fixes: [],
    });
    expect(seoHealth([], { sitemapOk: false }).score).toBe(95);
  });

  it("averages page rules across pages", () => {
    const r = seoHealth(
      [page(), page({ id: "p2", title: "Team", imagesWithoutAlt: 2 })],
      { sitemapOk: true },
    );
    expect(r.score).toBe(90);
    expect(r.fixes[0].message).toBe("Add alt text to 2 images on Team");
  });

  it("an untitled page is named by its slug", () => {
    const r = seoHealth([page({ title: "", slug: "contact", h1Count: 0 })], {
      sitemapOk: true,
    });
    expect(r.fixes[0].message).toBe("Add one main heading to contact");
  });
});
