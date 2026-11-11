// sitemap.xml from the site index (07-31 choices 3, 10; CONT-13, CONT-37, D277).
// Each <loc> is origin + the stored site-relative path, the same URL as the page's canonical
// tag (canonicalUrl/slugPathFor). Every value is XML-escaped (T-07-31-04).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import type { SiteIndexPage } from "./types";

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Trailing-slash-free origin + path ("/" stays "/"). */
export function indexUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

export function sitemapXml(input: {
  origin: string;
  pages: readonly Pick<SiteIndexPage, "path" | "lastmod">[];
}): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of input.pages) {
    out.push("  <url>");
    out.push(`    <loc>${xmlEscape(indexUrl(input.origin, p.path))}</loc>`);
    if (p.lastmod) out.push(`    <lastmod>${xmlEscape(p.lastmod)}</lastmod>`);
    out.push("  </url>");
  }
  out.push("</urlset>");
  return `${out.join("\n")}\n`;
}
