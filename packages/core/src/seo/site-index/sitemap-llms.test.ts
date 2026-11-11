// CONT-13 sitemap.xml + llms.txt renderers (07-31 choices 3, 10).
import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms";
import { sitemapXml } from "./sitemap";
import type { SiteIndex } from "./types";

const index: SiteIndex = {
  v: 1,
  built_at: "2026-10-02T00:00:00.000Z",
  site: {
    name: "Crumb\n& Co",
    summary: "Fresh bread daily.",
    language: "en",
    allow_ai_crawlers: true,
  },
  pages: [
    {
      id: "a",
      path: "/",
      title: "Home",
      description: "Welcome",
      text: "",
      lastmod: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "b",
      path: "/a&b'%22",
      title: "Tricky [title]\nbreak",
      description: "",
      text: "",
      lastmod: "2026-10-01T00:00:00.000Z",
    },
  ],
  records: [
    {
      kind: "Service",
      group: "Services",
      title: "Bread class",
      text: "Two hours, $40",
      path: "/",
    },
    {
      kind: "Testimonial",
      group: "Testimonials",
      title: "Ann",
      text: "Great",
      path: "/about#reviews",
    },
  ],
};

describe("sitemapXml", () => {
  it("renders declaration, namespace, one url per page in order, escaped", () => {
    const xml = sitemapXml({
      origin: "https://crumb.example",
      pages: index.pages,
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://crumb.example/",
      "https://crumb.example/a&amp;b&apos;%22",
    ]);
    expect(xml.match(/<lastmod>/g)).toHaveLength(2);
  });
});

describe("llmsTxt", () => {
  it("has the llmstxt.org shape", () => {
    const txt = llmsTxt({ origin: "https://crumb.example", index });
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# Crumb & Co");
    expect(txt).toContain("> Fresh bread daily.");
    expect(txt).toContain("## Pages");
    expect(txt).toContain("- [Home](https://crumb.example/): Welcome");
    expect(txt).toContain(
      "- [Tricky (title) break](https://crumb.example/a&b'%22)",
    );
    expect(txt).toContain("## Services");
    expect(txt).toContain(
      "- [Bread class](https://crumb.example/): Two hours, $40",
    );
    expect(txt).toContain("## Testimonials");
    expect(txt.indexOf("## Services")).toBeLessThan(
      txt.indexOf("## Testimonials"),
    );
  });

  it("omits the summary and empty groups", () => {
    const txt = llmsTxt({
      origin: "https://crumb.example",
      index: { ...index, site: { ...index.site, summary: "" }, records: [] },
    });
    expect(txt).not.toContain(">");
    expect(txt).not.toContain("## Services");
  });
});
