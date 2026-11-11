// Site index builder + its one exclusion predicate (owner 07-31; CONT-37, D277).
// Pure and Edge-safe: no node:, no rich-text cleaner, no next/* imports. Named exports only.
export {
  SITE_INDEX_VERSION,
  type PageIndexCandidate,
  type SiteIndex,
  type SiteIndexInput,
  type SiteIndexPage,
  type SiteIndexRecord,
  type SiteIndexSite,
} from "./types";
export {
  isIndexablePage,
  recordTargetsIndexablePage,
  type IndexableFlags,
} from "./rule";
export {
  SITE_INDEX_LIMITS,
  buildSiteIndex,
  cutText,
  parseSiteIndex,
  safeIndexPath,
  sanitizeIndexRecords,
} from "./build";
export { AI_CRAWLER_AGENTS, robotsTxt } from "./robots";
export { indexUrl, sitemapXml, xmlEscape } from "./sitemap";
export { llmsTxt } from "./llms";
export {
  ENGLISH_STOPWORDS,
  SEARCH_LIMITS,
  SEARCH_PER_PAGE,
  normalizeQuery,
  searchSiteIndex,
  stemLite,
  tokenize,
  type SearchOutcome,
  type SearchResult,
  type SnippetSegment,
} from "./search";
