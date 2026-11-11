// The page-builder content model (CONT-01, CONT-03, D31, D32, invariant 6).
//
// Ported from donor DCR-Website src/types/content.ts. These are the JSON shapes stored in
// page_sections.content / settings and in the published page JSON (D187, D253). They are
// app-level shapes, not database row types. Pure and Edge-safe: types plus one const list.
//
// Deliberate differences from the donor:
// - The full-width layout id is "full" (the id every P3 plan, renderer and thumbnail uses).
// - `SectionType` is not a fixed union here. registry.ts owns it as `keyof SectionTypeMap`,
//   which add-ons extend by declaration merging (CONT-02, invariant 5).
// - Only the five core section content shapes ship (CONTEXT A2-Q4). There is no raw-HTML
//   section type anywhere in core (CONT-32, D281).
// - Button items gain `action` + `popup_id` (CONT-11); a `countdown` item kind is added.
// - P7 (07-08) adds video, audio, form and embed items and the image item's library `asset`.
import type { AudioProvider, EmbedProvider, VideoProvider } from "./media-link";

// ---------------------------------------------------------------------------
// Row / section layout primitives
// ---------------------------------------------------------------------------

export type RowLayout =
  | "full"
  | "50-50"
  | "25-75"
  | "75-25"
  | "40-60"
  | "60-40"
  | "30-70"
  | "70-30"
  | "33-33-33"
  | "25-50-25"
  | "25-25-25-25"
  | "20-20-20-20-20";

// ---------------------------------------------------------------------------
// Section content shapes (stored in page_sections.content). Field names verbatim.
// ---------------------------------------------------------------------------

export interface HeroContent {
  tagline?: string;
  heading?: string;
  heading_accent?: string;
  subtitle?: string;
  cta_primary_text?: string;
  cta_primary_link?: string;
  cta_secondary_text?: string;
  cta_secondary_link?: string;
  trust_text?: string;
  image_url?: string;
  image_alt?: string;
  /** Media library asset id (P8, R-3); wins over image_url when it resolves. */
  image_asset?: string;
}

export interface TextImageContent {
  heading?: string;
  /** Rich text (sanitized by the db layer). */
  text?: string;
  image_url?: string;
  image_alt?: string;
  quote?: string;
  list_items?: string[];
  cta_text?: string;
  cta_link?: string;
  phone?: string;
}

export interface CtaBannerContent {
  heading?: string;
  description?: string;
  button_text?: string;
  button_link?: string;
}

export interface TextOnlyContent {
  heading?: string;
  /** Rich text (sanitized by the db layer). */
  text?: string;
}

// ---------------------------------------------------------------------------
// Per-section presentation settings (stored in page_sections.settings)
// ---------------------------------------------------------------------------

/**
 * Which band a row sits in. Rows alternate down the page so consecutive sections don't
 * run together; "main" is the default page ground.
 */
export type BackgroundVariant = "main" | "alternate";

/**
 * Donor fields kept field-for-field so stored rows round-trip, all optional. Only
 * `background_variant` is honoured: the rest would be raw styling, which invariant 7
 * (D183) forbids. Renderers and publish ignore them.
 */
export interface SectionSettings {
  background_variant?: BackgroundVariant;
  bg_color?: string;
  text_color?: string;
  padding_y?: string;
  max_width?: string;
  css_class?: string;
  reverse_columns?: boolean;
}

// ---------------------------------------------------------------------------
// Columns block: the one container type. Depth is fixed at two levels
// (block -> column -> item); a column holds primitives only, never another block.
// ---------------------------------------------------------------------------

export const COLUMN_ITEM_KINDS = [
  "heading",
  "text",
  "list",
  "image",
  "button",
  "spacer",
  "divider",
  "countdown",
  "video",
  "audio",
  "form",
  "embed",
] as const;

export type ColumnItemKind = (typeof COLUMN_ITEM_KINDS)[number];

/** What a button does: follow its link, or open one of the site's pop-ups (CONT-11). */
export type ButtonAction = "link" | "popup";

export type ColumnItem =
  | { id: string; kind: "heading"; text: string; level: 2 | 3 }
  | { id: string; kind: "text"; html: string }
  | { id: string; kind: "list"; items: string[] }
  | ImageColumnItem
  | {
      id: string;
      kind: "button";
      text: string;
      link: string;
      style: "primary" | "secondary";
      action: ButtonAction;
      /** The pop-up this button opens; "" when action is "link". */
      popup_id: string;
    }
  | { id: string; kind: "spacer"; height: "sm" | "md" | "lg" }
  | { id: string; kind: "divider" }
  | {
      id: string;
      kind: "countdown";
      /** UTC ISO-8601 instant the countdown runs to ("" while unset in the editor). */
      target_at: string;
      /** What visitors see once the countdown reaches zero. */
      zero_message: string;
    }
  | VideoColumnItem
  | AudioColumnItem
  | FormColumnItem
  | EmbedColumnItem;

// P7 item kinds (07-08). No URL or HTML is ever stored for a provider link: only
// `{ provider, provider_id }`, which mediaLinkFrom re-validates on every read (D281).
// `asset`, `cover` and `form_id` are record ids that assertRefsOwned checks against the
// organization on every save (sections and pop-ups).

export interface ImageColumnItem {
  id: string;
  kind: "image";
  /** Absolute http(s) URL; "" when `asset` is set. */
  url: string;
  alt: string;
  /** Library asset id (07-17 picker); when set it wins over url and url is "". */
  asset?: string;
  /** Stock photo credit (07-30, CONT-28): set only for a Free photos pick. */
  credit?: ImageCredit;
}

/** "Photo by <name> on Unsplash|Pexels" (07-30; the credit URL host is checked on save). */
export interface ImageCredit {
  name: string;
  url: string;
  source: "unsplash" | "pexels";
}

export type VideoShape = "16:9" | "9:16" | "1:1";
export type MediaItemSource = "media" | "link";

export interface VideoColumnItem {
  id: string;
  kind: "video";
  /** Required: screen readers and search engines use it. */
  title: string;
  /** An uploaded MP4 from the media library, or an allowlisted provider link. */
  source: MediaItemSource;
  /** media_assets id when source is "media"; "" otherwise. */
  asset: string;
  /** Allowlisted provider when source is "link"; "" otherwise. */
  provider: VideoProvider | "";
  /** Provider id in media-link.ts grammar; re-validated by mediaLinkFrom on every read. */
  provider_id: string;
  /** Optional cover image (media_assets id); "" for none. */
  cover: string;
  shape: VideoShape;
  controls: boolean;
  loop: boolean;
  /** Muted autoplay; only ever true for an uploaded video (links force false). */
  autoplay: boolean;
}

export interface AudioColumnItem {
  id: string;
  kind: "audio";
  title: string;
  source: MediaItemSource;
  /** media_assets id (an MP3) when source is "media"; "" otherwise. */
  asset: string;
  provider: AudioProvider | "";
  /** Re-validated by mediaLinkFrom on every read. */
  provider_id: string;
}

export interface FormColumnItem {
  id: string;
  kind: "form";
  /** forms record id ("" only while unset in the editor). */
  form_id: string;
}

export interface EmbedColumnItem {
  id: string;
  kind: "embed";
  title: string;
  /** Curated embed allowlist only (Calendly, public Google Calendar). */
  provider: EmbedProvider | "";
  /** Re-validated by mediaLinkFrom on every read. */
  provider_id: string;
}

export interface Column {
  id: string;
  items: ColumnItem[];
}

export interface ColumnsContent {
  columns: Column[];
}

// ---------------------------------------------------------------------------
// Published output (D187, D253, CONT-31): config only, served from JSON.
// ---------------------------------------------------------------------------

export interface PageSeo {
  meta_title?: string;
  meta_description?: string;
  /** A pasted (or Free photos) share image link; cleared when share_image is set. */
  og_image?: string;
  /** Library asset id of the page's share image (07-30); clears og_image when set. */
  share_image?: string;
}

export interface PublishedSection {
  id: string;
  section_type: string;
  /** Already clamped to the section type's allowed layouts. */
  row_layout: RowLayout;
  /** Validated and sanitized content for `section_type`. */
  content: unknown;
  settings: { background_variant: BackgroundVariant };
}

export interface PublishedPage {
  version: 1;
  page: {
    id: string;
    slug: string;
    title: string;
    seo: PageSeo;
    password_protected: boolean;
  };
  sections: PublishedSection[];
  published_at: string;
}

export interface SiteManifest {
  version: 1;
  pages: Record<
    string,
    { id: string; title: string; published_at: string; protected: boolean }
  >;
  /** Old published slug -> current slug. */
  redirects: Record<string, string>;
  updated_at: string;
}
