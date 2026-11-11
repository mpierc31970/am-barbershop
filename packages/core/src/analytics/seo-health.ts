// SEO health score (11-06; D188, DASH-11). Computed on read from published pages: a 0-100
// score plus the top three fixes, each naming the page. Length maxima reuse SEO_LIMITS
// from @cds/core/seo (07-30) so the score and the page SEO checklist agree.
import { SEO_LIMITS } from "../seo";

export interface SeoPageInput {
  id: string;
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  h1Count: number;
  imagesWithoutAlt: number;
  brokenInternalLinks: number;
}

export interface SeoSiteInput {
  sitemapOk: boolean;
}

export type SeoRule =
  "title" | "description" | "h1" | "alt" | "links" | "sitemap";

export interface SeoFix {
  /** null for site-wide fixes (sitemap). */
  pageId: string | null;
  rule: SeoRule;
  message: string;
}

export interface SeoHealth {
  score: number;
  fixes: SeoFix[];
}

/** Weights sum to 100. Page rules are averaged over pages; sitemap is site-wide. */
export const SEO_RULE_WEIGHTS = Object.freeze({
  title: 20,
  description: 20,
  h1: 20,
  alt: 20,
  links: 15,
  sitemap: 5,
} satisfies Record<SeoRule, number>);

export const SEO_HEALTH_LENGTHS = Object.freeze({
  titleMin: 10,
  titleMax: SEO_LIMITS.title,
  descriptionMin: 50,
  descriptionMax: SEO_LIMITS.description,
});

export const MAX_SEO_FIXES = 3;

const PAGE_RULES = ["title", "description", "h1", "alt", "links"] as const;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function pageName(p: SeoPageInput): string {
  return str(p.title) || str(p.slug) || "Home";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function lengthFix(
  value: string,
  min: number,
  max: number,
  noun: string,
  name: string,
): string | null {
  if (value === "") return `Add a ${noun} to ${name}`;
  if (value.length < min) return `Lengthen the ${noun} on ${name}`;
  if (value.length > max) return `Shorten the ${noun} on ${name}`;
  return null;
}

/** The failing message for one rule on one page, or null when it passes. */
function checkRule(
  rule: (typeof PAGE_RULES)[number],
  p: SeoPageInput,
): string | null {
  const name = pageName(p);
  const L = SEO_HEALTH_LENGTHS;
  switch (rule) {
    case "title":
      return lengthFix(
        str(p.metaTitle) || str(p.title),
        L.titleMin,
        L.titleMax,
        "title",
        name,
      );
    case "description":
      return lengthFix(
        str(p.metaDescription),
        L.descriptionMin,
        L.descriptionMax,
        "description",
        name,
      );
    case "h1": {
      const n = num(p.h1Count);
      if (n === 1) return null;
      return n < 1
        ? `Add one main heading to ${name}`
        : `Use only one main heading on ${name}`;
    }
    case "alt": {
      const n = num(p.imagesWithoutAlt);
      return n > 0
        ? `Add alt text to ${plural(n, "image", "images")} on ${name}`
        : null;
    }
    case "links": {
      const n = num(p.brokenInternalLinks);
      return n > 0
        ? `Fix ${plural(n, "broken link", "broken links")} on ${name}`
        : null;
    }
  }
}

export function seoHealth(
  pages: readonly SeoPageInput[],
  site: SeoSiteInput,
): SeoHealth {
  const W = SEO_RULE_WEIGHTS;
  const failures: (SeoFix & { weight: number; order: number })[] = [];
  let earned = 0;
  let order = 0;

  for (const rule of PAGE_RULES) {
    let passed = 0;
    for (const p of pages) {
      const message = checkRule(rule, p);
      if (message === null) passed += 1;
      else
        failures.push({
          pageId: p.id,
          rule,
          message,
          weight: W[rule],
          order: order++,
        });
    }
    // No published pages: page rules pass vacuously.
    earned += pages.length === 0 ? W[rule] : (W[rule] * passed) / pages.length;
  }

  if (site.sitemapOk) earned += W.sitemap;
  else
    failures.push({
      pageId: null,
      rule: "sitemap",
      message: "Your sitemap could not be reached",
      weight: W.sitemap,
      order: order++,
    });

  failures.sort((a, b) => b.weight - a.weight || a.order - b.order);
  const fixes = failures
    .slice(0, MAX_SEO_FIXES)
    .map(({ pageId, rule, message }) => ({ pageId, rule, message }));

  const score = Math.max(0, Math.min(100, Math.round(earned)));
  return { score, fixes };
}
