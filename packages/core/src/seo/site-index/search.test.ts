// CONT-28 site search (07-31 choice 11): tokenizer, stemLite, ranking, paging, snippets.
import { describe, expect, it } from "vitest";
import { SEARCH_PER_PAGE, searchSiteIndex, stemLite, tokenize } from "./search";
import type { SiteIndex } from "./types";

function idx(over: Partial<SiteIndex> = {}): SiteIndex {
  return {
    v: 1,
    built_at: "x",
    site: {
      name: "Crumb",
      summary: "",
      language: "en",
      allow_ai_crawlers: true,
    },
    pages: [
      {
        id: "1",
        path: "/classes",
        title: "Bread classes",
        description: "",
        text: "Learn sourdough with us. Hands on.",
        lastmod: "",
      },
      {
        id: "2",
        path: "/sourdough",
        title: "Sourdough",
        description: "Our signature loaf",
        text: "Crusty bread.",
        lastmod: "",
      },
    ],
    records: [
      {
        kind: "Service",
        group: "Services",
        title: "Sourdough workshop",
        text: "Three hours",
        path: "/",
      },
    ],
    ...over,
  };
}

describe("tokenize / stemLite", () => {
  it("english stems and drops stopwords", () => {
    expect(tokenize("Sourdough classes", "en")).toEqual(["sourdough", "class"]);
    expect(stemLite("baking")).toBe("bak");
    expect(stemLite("baked")).toBe("bak");
    expect(stemLite("berries")).toBe("berry");
    expect(stemLite("glass")).toBe("glass");
    expect(stemLite("quickly")).toBe("quick");
    expect(tokenize("the Café", "en-US")).toEqual(["cafe"]);
  });
  it("other languages: no stemming, no stopwords", () => {
    expect(tokenize("las clases", "es")).toEqual(["las", "clases"]);
  });
  it("drops 1-char non-digit tokens, keeps digits", () => {
    expect(tokenize("a b 7 ok", "es")).toEqual(["7", "ok"]);
  });
});

describe("searchSiteIndex", () => {
  it("ranks a title match above a text match and labels records", () => {
    const r = searchSiteIndex(idx(), "sourdough");
    if (r.empty) throw new Error("empty");
    expect(r.total).toBe(3);
    expect(r.results[0]!.path).toBe("/sourdough");
    expect(r.results.at(-1)!.path).toBe("/classes");
    const svc = r.results.find((x) => x.kind === "Service");
    expect(svc?.title).toBe("Sourdough workshop");
    expect(r.results.find((x) => x.path === "/classes")!.kind).toBeNull();
  });
  it("prefix-matches terms of 3+ chars", () => {
    const r = searchSiteIndex(idx(), "sourd");
    if (r.empty) throw new Error("empty");
    expect(r.total).toBe(3);
  });
  it("ANDs two terms", () => {
    const r = searchSiteIndex(idx(), "sourdough crusty");
    if (r.empty) throw new Error("empty");
    expect(r.results.map((x) => x.path)).toEqual(["/sourdough"]);
  });
  it("pages 10 per page and clamps", () => {
    const pages = Array.from({ length: 23 }, (_, i) => ({
      id: String(i),
      path: `/p${String(i).padStart(2, "0")}`,
      title: `Page ${String(i).padStart(2, "0")}`,
      description: "",
      text: "muffin",
      lastmod: "",
    }));
    const index = idx({ pages, records: [] });
    const p2 = searchSiteIndex(index, "muffin", { page: 2 });
    if (p2.empty) throw new Error("empty");
    expect(SEARCH_PER_PAGE).toBe(10);
    expect(p2.pages).toBe(3);
    expect(p2.results.map((x) => x.title)).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `Page ${String(i + 10).padStart(2, "0")}`,
      ),
    );
    const p99 = searchSiteIndex(index, "muffin", { page: 99 });
    if (p99.empty) throw new Error("empty");
    expect(p99.page).toBe(3);
    expect(p99.results).toHaveLength(3);
  });
  it("empty and long queries", () => {
    expect(searchSiteIndex(idx(), "   ")).toEqual({ empty: true });
    expect(searchSiteIndex(idx(), "")).toEqual({ empty: true });
    const r = searchSiteIndex(idx(), "x".repeat(300));
    if (r.empty) throw new Error("empty");
    expect(r.query.length).toBe(100);
  });
  it("a null index finds nothing", () => {
    const r = searchSiteIndex(null, "bread");
    if (r.empty) throw new Error("empty");
    expect(r.total).toBe(0);
  });
  it("snippets mark every matched word and stay short", () => {
    const long = `${"filler words here ".repeat(30)}sourdough loaves and more sourdough ${"tail text ".repeat(40)}`;
    const index = idx({
      pages: [
        {
          id: "1",
          path: "/x",
          title: "X",
          description: "",
          text: long,
          lastmod: "",
        },
      ],
      records: [],
    });
    const r = searchSiteIndex(index, "sourdough");
    if (r.empty) throw new Error("empty");
    const seg = r.results[0]!.snippet;
    const marked = seg.filter((s) => s.match).map((s) => s.text);
    expect(marked).toEqual(["sourdough", "sourdough"]);
    const joined = seg.map((s) => s.text).join("");
    expect(joined.startsWith("…")).toBe(true);
    expect(joined.endsWith("…")).toBe(true);
    expect(joined.replace(/…/g, "").length).toBeLessThanOrEqual(160);
  });
  it("uses the description as snippet when it matches", () => {
    const r = searchSiteIndex(idx(), "signature");
    if (r.empty) throw new Error("empty");
    expect(r.results[0]!.snippet.map((s) => s.text).join("")).toBe(
      "Our signature loaf",
    );
  });
});
