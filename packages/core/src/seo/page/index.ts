// Page SEO: JSON-LD, canonical, checklist (owner 07-30; CONT-13, CONT-14, CONT-28, CONT-35).
// Pure and Edge-safe: no node:, no rich-text cleaner, no next/* imports. Named exports only.
export {
  buildJsonLd,
  sanitizeAddonNodes,
  serializeJsonLd,
  type JsonLdBusiness,
  type JsonLdGraph,
  type JsonLdHours,
  type JsonLdInput,
  type JsonLdMedia,
} from "./jsonld";
export { SCHEMA_TYPE_BY_BUSINESS, schemaTypeFor } from "./business-schema";
export {
  NOINDEX_PAGE_KINDS,
  absoluteUrl,
  canonicalOrigin,
  canonicalUrl,
  pageMeta,
  robotsFor,
  slugPathFor,
  type HostKind,
  type MetaImage,
  type MetaImageSource,
  type PageMeta,
  type PageMetaInput,
  type RobotsData,
} from "./meta";
export {
  CHECKLIST_COPY,
  NAV_FIX_HREF,
  TEXT_ON_IMAGE,
  VAGUE_LINK_TEXT,
  checklistCount,
  pageChecklist,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistOptions,
  type ChecklistSite,
  type ChecklistTheme,
  type FixTarget,
  type TextOnImageRule,
} from "./checklist";
export { SEO_LIMITS, suggestDescription, suggestTitle } from "./suggest";
export type { SeoSection } from "./content-walk";
