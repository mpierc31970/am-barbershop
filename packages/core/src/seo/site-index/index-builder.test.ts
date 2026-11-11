// CONT-37 (D277, Pitfall 13): one exclusion rule, one index, four consumers that cannot see
// an excluded page. 07-31 Task 1.
import { describe, expect, it } from "vitest";
import { canonicalUrl } from "../page/meta";
import {
  SITE_INDEX_LIMITS,
  buildSiteIndex,
  isIndexablePage,
  llmsTxt,
  parseSiteIndex,
  robotsTxt,
  sanitizeIndexRecords,
  searchSiteIndex,
  sitemapXml,
  type PageIndexCandidate,
  type SiteIndexInput,
} from "./index";

const BASE: PageIndexCandidate = {
  id: "p_home",
  slug: "home",
  kind: "builder",
  title: "Home",
  seoTitle: "",
  description: "Fresh bread baked daily in Austin.",
  text: "Welcome to the bakery. We bake sourdough every morning.",
  lastmod: "2026-10-01T00:00:00.000Z",
  inManifest: true,
  hasRow: true,
  protected: false,
  held: false,
  addonHidden: false,
};

function cand(over: Partial<PageIndexCandidate>): PageIndexCandidate {
  return { ...BASE, ...over };
}

function fixture(): SiteIndexInput {
  return {
    builtAt: "2026-10-02T00:00:00.000Z",
    site: { name: "Crumb & Co", language: "en", allowAiCrawlers: false },
    candidates: [
      cand({}),
      cand({
        id: "p_about",
        slug: "about",
        title: "About us",
        description: "",
        text: "Our story began with one oven.",
      }),
      cand({
        id: "p_members",
        slug: "members",
        title: "Members Lounge",
        description: "Secret recipes",
        text: "zanzibarquince only for members",
        protected: true,
      }),
      cand({
        id: "p_promo",
        slug: "draft-promo",
        title: "Draft Promo",
        description: "",
        text: "heldwordxylo promo text",
        held: true,
      }),
      cand({
        id: "p_404",
        slug: "system-404",
        kind: "system-404",
        title: "Page not found",
        text: "notfoundword",
      }),
      cand({
        id: "p_events",
        slug: "events",
        title: "Events Calendar",
        text: "hiddeneventword",
        addonHidden: true,
      }),
    ],
    records: [
      {
        kind: "Service",
        group: "Services",
        title: "Bread class",
        text: "Two hours",
        path: "/",
      },
      {
        kind: "Service",
        group: "Services",
        title: "Cake class",
        text: "Three hours",
        path: "/",
      },
      {
        kind: "Member perk",
        group: "Perks",
        title: "Perk",
        text: "x",
        path: "/members",
      },
    ],
  };
}

describe("isIndexablePage (the one rule)", () => {
  const ok = {
    inManifest: true,
    hasRow: true,
    protected: false,
    held: false,
    kind: "builder",
    addonHidden: false,
  };
  it("accepts a public builder page", () => {
    expect(isIndexablePage(ok)).toBe(true);
  });
  it.each([
    ["inManifest", false],
    ["hasRow", false],
    ["protected", true],
    ["held", true],
    ["kind", "system-404"],
    ["addonHidden", true],
  ])("rejects when %s = %s", (key, value) => {
    expect(isIndexablePage({ ...ok, [key]: value })).toBe(false);
  });
  it("accepts an unknown non-noindex kind", () => {
    expect(isIndexablePage({ ...ok, kind: "landing" })).toBe(true);
  });
});

describe("buildSiteIndex", () => {
  it("keeps only indexable pages and writes nothing of the excluded ones", () => {
    const index = buildSiteIndex(fixture());
    expect(index.pages.map((p) => p.path)).toEqual(["/", "/about"]);
    const raw = JSON.stringify(index);
    for (const leak of [
      "Members Lounge",
      "Secret recipes",
      "zanzibarquince",
      "members",
      "Draft Promo",
      "draft-promo",
      "heldwordxylo",
      "notfoundword",
      "system-404",
      "hiddeneventword",
      "Events Calendar",
    ]) {
      expect(raw).not.toContain(leak);
    }
    expect(index.records.map((r) => r.title)).toEqual([
      "Bread class",
      "Cake class",
    ]);
    expect(index.site.summary).toBe("Fresh bread baked daily in Austin.");
    expect(index.site.allow_ai_crawlers).toBe(false);
  });

  it("uses the SEO title when set", () => {
    const index = buildSiteIndex({
      ...fixture(),
      candidates: [cand({ seoTitle: "Best Bakery" })],
    });
    expect(index.pages[0]!.title).toBe("Best Bakery");
  });

  it("CONT-37: all four consumers miss protected and held pages", () => {
    const index = buildSiteIndex(fixture());
    const origin = "https://crumb.example";
    const outputs = [
      sitemapXml({ origin, pages: index.pages }),
      robotsTxt({
        hostKind: "custom",
        allowAiCrawlers: false,
        sitemapUrl: `${origin}/sitemap.xml`,
      }),
      llmsTxt({ origin, index }),
    ];
    for (const out of outputs) {
      for (const leak of [
        "members",
        "Members Lounge",
        "zanzibarquince",
        "draft-promo",
        "Draft Promo",
        "heldwordxylo",
      ]) {
        expect(out).not.toContain(leak);
      }
    }
    for (const word of ["zanzibarquince", "heldwordxylo", "notfoundword"]) {
      const r = searchSiteIndex(index, word);
      expect(r.empty).toBe(false);
      if (!r.empty) expect(r.total).toBe(0);
    }
  });

  it("caps pages, page text and records", () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      cand({
        id: `p${i}`,
        slug: i === 0 ? "home" : `page-${i}`,
        text: "word ".repeat(10_000),
      }),
    );
    const records = Array.from({ length: 1500 }, (_, i) => ({
      kind: "Service",
      group: "Services",
      title: `S${i}`,
      text: "y ".repeat(3000),
      path: "/",
    }));
    const index = buildSiteIndex({ ...fixture(), candidates: many, records });
    expect(index.pages).toHaveLength(SITE_INDEX_LIMITS.pages);
    const cap = Math.min(20_000, Math.floor(1_200_000 / 500));
    for (const p of index.pages) {
      expect(p.text.length).toBeLessThanOrEqual(cap);
      expect(p.text.endsWith("word")).toBe(true);
    }
    expect(index.records).toHaveLength(1000);
    for (const r of index.records) {
      expect(r.text.length).toBeLessThanOrEqual(2000);
    }
  });
});

describe("sanitizeIndexRecords", () => {
  const d = { kind: "Testimonial", group: "Testimonials" };
  it("keeps good records and drops bad ones", () => {
    const out = sanitizeIndexRecords(
      [
        null,
        "x",
        [],
        { title: "", path: "/" },
        { title: "Ok", path: "/" },
        { title: "Frag", path: "/reviews#top-1" },
        { title: "BadFrag", path: "/reviews#<x>" },
        { title: "Rel", path: "reviews" },
        { title: "Dbl", path: "//evil.com" },
        { title: "Dots", path: "/a/../b" },
        { title: "Space", path: "/a b" },
        { title: "Scheme", path: "javascript:alert(1)" },
        { title: "Query", path: "/a?b=1" },
        { title: "Abs", path: "https://x.y/" },
        { title: "T".repeat(500), path: "/", kind: "K".repeat(80) },
      ],
      d,
    );
    expect(out.map((r) => r.title.slice(0, 5))).toEqual([
      "Ok",
      "Frag",
      "TTTTT",
    ]);
    expect(out[0]!.kind).toBe("Testimonial");
    expect(out[2]!.title.length).toBeLessThanOrEqual(200);
    expect(out[2]!.kind.length).toBeLessThanOrEqual(40);
  });
  it("never throws on hostile input", () => {
    const evil = {};
    Object.defineProperty(evil, "title", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const cyc: Record<string, unknown> = { title: "Cyc", path: "/" };
    cyc.self = cyc;
    expect(() => sanitizeIndexRecords([evil, cyc], d)).not.toThrow();
    expect(sanitizeIndexRecords([evil, cyc], d)).toHaveLength(1);
    expect(sanitizeIndexRecords(undefined, d)).toEqual([]);
    const lots = Array.from({ length: 10_000 }, (_, i) => ({
      title: `t${i}`,
      path: "/",
    }));
    expect(sanitizeIndexRecords(lots, d)).toHaveLength(200);
  });
});

describe("parseSiteIndex", () => {
  it("round-trips a built index", () => {
    const index = buildSiteIndex(fixture());
    expect(parseSiteIndex(JSON.parse(JSON.stringify(index)))).toEqual(index);
  });
  it("rejects malformed or wrong-version input and drops unknown keys", () => {
    const index = buildSiteIndex(fixture());
    expect(parseSiteIndex(null)).toBeNull();
    expect(parseSiteIndex("x")).toBeNull();
    expect(parseSiteIndex({ ...index, v: 2 })).toBeNull();
    expect(parseSiteIndex({ ...index, pages: "x" })).toBeNull();
    expect(
      parseSiteIndex({ ...index, pages: [{ ...index.pages[0], path: "//x" }] }),
    ).toBeNull();
    const extra = parseSiteIndex({
      ...index,
      secret: 1,
      site: { ...index.site, password_hash: "h" },
      pages: index.pages.map((p) => ({ ...p, token: "t" })),
    });
    expect(JSON.stringify(extra)).not.toMatch(/secret|password_hash|token/);
  });
});

describe("sitemap URLs equal the canonical", () => {
  it("matches canonicalUrl for each page", () => {
    const index = buildSiteIndex(fixture());
    const xml = sitemapXml({
      origin: "https://crumb.example",
      pages: index.pages,
    });
    for (const slug of ["home", "about"]) {
      expect(xml).toContain(
        `<loc>${canonicalUrl({ primaryHost: "crumb.example", fallbackHost: "x", slug })}</loc>`,
      );
    }
  });
});
