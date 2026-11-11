// Site index shapes (07-31 choice 4; CONT-37, CONT-13, CONT-15, CONT-28; D277, D187;
// Pitfall 13). index.json holds public fields only, deny by default: parseSiteIndex drops
// every unknown key. Paths are site-relative; routes add the origin (choice 3).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.

export const SITE_INDEX_VERSION = 1;

export type SiteIndexPage = {
  id: string;
  path: string;
  title: string;
  description: string;
  text: string;
  lastmod: string;
};

export type SiteIndexRecord = {
  kind: string;
  group: string;
  title: string;
  text: string;
  path: string;
  lastmod?: string;
};

export type SiteIndexSite = {
  name: string;
  summary: string;
  language: string;
  allow_ai_crawlers: boolean;
};

export type SiteIndex = {
  v: typeof SITE_INDEX_VERSION;
  built_at: string;
  /**
   * 14-21 (CONT-16, CONTEXT Area 3): when live data (banner, pop-ups, add-on records) last
   * changed site-wide. Every page's lastmod is at least this. Absent until the first one.
   */
  live_changed_at?: string;
  site: SiteIndexSite;
  pages: SiteIndexPage[];
  records: SiteIndexRecord[];
};

/** One page as the db builder sees it, before the exclusion rule. */
export type PageIndexCandidate = {
  id: string;
  slug: string;
  kind: string;
  title: string;
  seoTitle: string;
  description: string;
  text: string;
  lastmod: string;
  inManifest: boolean;
  hasRow: boolean;
  protected: boolean;
  held: boolean;
  addonHidden: boolean;
};

export type SiteIndexInput = {
  builtAt: string;
  /** 14-21: written to the header as `live_changed_at` when non-empty. */
  liveChangedAt?: string;
  site: { name: string; language: string; allowAiCrawlers: boolean };
  candidates: readonly PageIndexCandidate[];
  records: readonly SiteIndexRecord[];
};
