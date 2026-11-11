// Shared props for the core section components (CONT-03, D31) and the site type scale
// (03-UI-SPEC "Site fallback scale": exactly four named sizes; weights 400/600).
import type { BackgroundVariant, RowLayout } from "@cds/core/content";

export interface SectionComponentProps<C = unknown> {
  /** Validated, sanitized content for the section type (published JSON). */
  content: C;
  /** Already clamped to the type's allowed layouts. */
  layout: RowLayout;
  background: BackgroundVariant;
  /** This block's main heading is the page h1 (D-UI-11). */
  isH1Owner: boolean;
  /** First block on the page: its first image loads eagerly. */
  isFirst: boolean;
  /** Request time, for schedule-driven items (countdown). */
  now: Date;
  /**
   * Ids of the pop-ups that can open on this page (PopupHost renders exactly these).
   * A pop-up button pointing anywhere else is not rendered (WR-C07). Omitted = no
   * filtering (the builder preview, which renders no pop-ups).
   */
  openablePopups?: ReadonlySet<string>;
  /**
   * Core bound data for the whole page (business, forms, media). Core blocks only; add-on
   * renderers get `data` instead and never see this (T-07-05-03).
   */
  coreData?: CoreBoundData;
  /** Stable section id (pagination params, anchors); core blocks only (07-22). */
  sectionId?: string;
}

/**
 * One library asset, resolved for public rendering. Produced by apps/web
 * `core-block-data.ts` (07-12): URLs always come from `MediaDelivery`, never a raw storage
 * key. `@cds/db` returns a structurally identical shape without importing this package.
 */
export interface ResolvedMedia {
  id: string;
  kind: "image" | "video" | "audio";
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  poster?: string;
  captions?: string;
  mime?: string;
  deleted?: boolean;
}

/**
 * Public data core blocks bind to, built once per page by the app loader. Public
 * projections only (T-07-05-03). `business` is filled by 07-07 (address, hours, time
 * zone, socials), `forms` by 07-19 keyed by form id, `media` by 07-12 keyed by asset id.
 * Each renderer narrows its own slice.
 */
export interface CoreBoundData {
  business?: Readonly<Record<string, unknown>>;
  forms?: Readonly<Record<string, unknown>>;
  media: Readonly<Record<string, ResolvedMedia>>;
  /** Browser Maps Embed key, 07-24; never a URL (ConsentFrame builds the frame URL). */
  mapKey?: string;
  /** Absolute page URL + title for share buttons, 07-24; 07-30 swaps in the canonical URL. */
  share?: { url: string; title: string };
  /** Gallery page per section id from `?g<id>=N` (07-22); absent = page 1. */
  galleryPages?: Readonly<Record<string, number>>;
  /**
   * P8 (08-05); filled by apps/web/lib/core-block-data.ts in 08-08, published only, D253.
   * The org's services in owner order, for the Services block. Never hidden rows.
   */
  services?: readonly PublicService[];
  /**
   * P8 (08-05); filled by apps/web/lib/core-block-data.ts in 08-08, published only, D253.
   * The org's team in owner order, for the Our team block. Never emails or user ids.
   */
  team?: readonly PublicTeamMember[];
  /**
   * True only in the builder preview (08-08 sets it). Data-bound blocks with nothing to show
   * render an editor-only empty card instead of nothing. Public output never sets it.
   */
  editorPreview?: boolean;
}

/** One published service (08-05; public projection, D253). */
export interface PublicService {
  id: string;
  name: string;
  description: string;
  price_type: "fixed" | "from" | "free" | "ask";
  price_cents: number | null;
  duration_minutes: number | null;
}

/** One published team member (08-05; public projection, D253). */
export interface PublicTeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  photo?: ResolvedMedia;
}

/**
 * Props for an add-on block renderer (ADDON-02, ADDON-08): the core section props plus the
 * data the add-on server module computed for this section (blockData, D253).
 */
export type AddonSectionProps<
  C = Record<string, unknown>,
  D = unknown,
> = SectionComponentProps<C> & { data: D };

export type HeadingLevel = 1 | 2 | 3;

export const HEADING_CLASSES: Record<HeadingLevel, string> = {
  1: "text-[length:var(--site-text-display)] font-semibold leading-[1.1] tracking-[-0.02em]",
  2: "text-[length:var(--site-text-h2)] font-semibold leading-[1.2]",
  3: "text-[length:var(--site-text-h3)] font-semibold leading-[1.3]",
};

export const BODY_CLASS = "text-[length:var(--site-text-body)] leading-[1.6]";
