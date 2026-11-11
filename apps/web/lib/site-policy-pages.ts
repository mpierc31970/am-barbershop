// Tenant Privacy policy and Terms pages (09-22; AGR-08, D217; CONTEXT A5-Q2, A5-Q3). Server-only.
//
// One loader (choice 1) feeds the /privacy and /terms routes and the footer links, so a
// footer link never points at a 404 and a published page is never unlinked. The read is
// readPublishedSitePolicy through the 60 s site cache: null until the owner acknowledged, or
// when the legal inputs were blanked since. Any failed read is null (fail closed, never a
// 500; T-09-22-02).
//
// SECURITY (T-09-22-01, RESEARCH Pitfall 8): renderSitePolicy already escapes tenant input;
// the HTML still passes the legal sanitiser here as defence in depth. The sanitiser's legal
// allowlist has no <div>, so the core Draft box wrapper is removed first and PolicyPage
// renders the Draft box itself from the `draft` flag.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { sanitizeLegalHtml as cleanLegalHtml } from "@cds/core/content/sanitize";
import type { SitePolicyPage } from "@cds/core/legal";
import { robotsFor, suggestTitle } from "@cds/core/seo";
import type { SiteContext } from "@cds/db";
import type { Metadata } from "next";
import { getPublicBusiness, getPublishedSitePolicy } from "./site-cache";
import { siteForRoute } from "./tenant";

export type SitePolicyView = {
  title: string;
  /** Sanitised legal HTML (h2, h3, p, lists, strong, https/mailto links). */
  html: string;
  /** "YYYY-MM-DD" (format with formatLegalDate). */
  lastUpdated: string;
  draft: boolean;
};

export type PolicyLinks = { privacy: boolean; terms: boolean };

const DRAFT_BOX = /^\s*<div role="note" data-policy-draft="">[\s\S]*?<\/div>/;

function dayOf(at: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(at);
  return m ? m[1]! : at;
}

/** The published page for an already-resolved site, or null. Never throws. */
export async function sitePolicyForSite(
  site: SiteContext,
  page: SitePolicyPage,
): Promise<SitePolicyView | null> {
  try {
    const p = await getPublishedSitePolicy(site, page, ADDON_REGISTRY);
    if (!p) return null;
    return {
      title: p.title,
      html: cleanLegalHtml(String(p.html ?? "").replace(DRAFT_BOX, "")),
      lastUpdated: dayOf(String(p.lastUpdated ?? "")),
      draft: p.draft === true,
    };
  } catch {
    console.error("[site] policy page read failed");
    return null;
  }
}

/** The /privacy or /terms page for this request's tenant host, or null (the route 404s). */
export async function loadSitePolicyPage(
  host: string,
  page: SitePolicyPage,
): Promise<SitePolicyView | null> {
  const site = await siteForRoute(host);
  if (!site) return null;
  return sitePolicyForSite(site, page);
}

/** Footer and sitemap visibility: the same read as the routes. Never throws. */
export async function policyLinksFor(site: SiteContext): Promise<PolicyLinks> {
  const [privacy, terms] = await Promise.all([
    sitePolicyForSite(site, "privacy"),
    sitePolicyForSite(site, "terms"),
  ]);
  return { privacy: privacy !== null, terms: terms !== null };
}

/** UI-SPEC H1 / title per page. */
export const SITE_POLICY_TITLES: Record<SitePolicyPage, string> = {
  privacy: "Privacy policy",
  terms: "Terms",
};

/**
 * Route metadata (choice 3): "{title} | {business}" like every tenant page, robots from the
 * host kind (preview hosts noindex, D170). Never throws.
 */
export async function sitePolicyMetadata(
  host: string,
  page: SitePolicyPage,
): Promise<Metadata> {
  const title = SITE_POLICY_TITLES[page];
  try {
    const site = await siteForRoute(host);
    if (!site) return { title };
    const business = await getPublicBusiness(site).catch(() => null);
    return {
      title: suggestTitle(title, business?.name ?? ""),
      robots: robotsFor({ hostKind: site.hostKind }),
    };
  } catch {
    return { title };
  }
}
