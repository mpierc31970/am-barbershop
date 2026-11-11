// Gallery block (owner 07-06; CONT-22, D228; CONTEXT decisions 1, 2 and 5).
//
// Content holds media asset ids with a per-use description and caption, never URLs: the
// site resolves ids through ResolvedMedia, and 07-04's assertRefsOwned scopes every id in
// refsOf().media to the org on save (T-07-06-01). Renderer and editor: 07-22.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { nonEmpty } from "../items/walk";
import {
  asRecord,
  isRecord,
  oneOf,
  own,
  safeId,
  text,
} from "../validate-helpers";
import {
  assertUniqueIds,
  assetId,
  bool,
  boundedArray,
  intInRange,
  mediaRefs,
} from "./helpers-a";

export type GalleryDisplay = "grid" | "mosaic" | "slider";

export type GalleryImage = {
  id: string;
  /** Media asset id (org-scoped on save). */
  asset: string;
  /** Per-use description override; "" = use the media library description. */
  alt: string;
  /**
   * false = UI-SPEC "Needs description" (alt prefilled from a file name stays amber until
   * the owner edits it); 07-22's editor sets it.
   */
  alt_reviewed: boolean;
  caption: string;
};

export type GalleryContent = {
  heading: string;
  display: GalleryDisplay;
  columns: number;
  per_page: number;
  show_captions: boolean;
  lightbox: boolean;
  images: GalleryImage[];
};

export const GALLERY_LIMITS = Object.freeze({
  maxImages: 200,
  columnsMin: 2,
  columnsMax: 6,
  columnsDefault: 3,
  perPageChoices: Object.freeze([6, 9, 12, 18, 24, 48] as const),
  perPageDefault: 12,
  altMax: 250,
  captionMax: 200,
} as const);

const DISPLAYS: readonly GalleryDisplay[] = ["grid", "mosaic", "slider"];
/** Over-limit copy: validator and editor share it (07-22 decision 11). */
export const GALLERY_MAX_COPY =
  "A gallery holds up to 200 photos. Start a second gallery for more.";
const ASSET_COPY = "Pick each photo from your media.";

export function defaultGalleryContent(): GalleryContent {
  return {
    heading: "",
    display: "grid",
    columns: GALLERY_LIMITS.columnsDefault,
    per_page: GALLERY_LIMITS.perPageDefault,
    show_captions: false,
    lightbox: true,
    images: [],
  };
}

function validateImage(value: unknown): GalleryImage {
  const raw = asRecord(value);
  return {
    id: safeId(own(raw, "id")),
    asset: assetId(own(raw, "asset"), ASSET_COPY),
    alt: text(raw, "alt", GALLERY_LIMITS.altMax),
    alt_reviewed: bool(raw, "alt_reviewed", false),
    caption: text(raw, "caption", GALLERY_LIMITS.captionMax),
  };
}

export function validateGalleryContent(value: unknown): GalleryContent {
  const raw = asRecord(value);
  const perPage = own(raw, "per_page");
  const images = boundedArray(
    raw,
    "images",
    GALLERY_LIMITS.maxImages,
    GALLERY_MAX_COPY,
  ).map(validateImage);
  assertUniqueIds(images);
  return {
    heading: text(raw, "heading"),
    display: oneOf(own(raw, "display"), DISPLAYS, "grid"),
    columns: intInRange(
      own(raw, "columns"),
      GALLERY_LIMITS.columnsMin,
      GALLERY_LIMITS.columnsMax,
      GALLERY_LIMITS.columnsDefault,
    ),
    per_page: (GALLERY_LIMITS.perPageChoices as readonly unknown[]).includes(
      perPage,
    )
      ? (perPage as number)
      : GALLERY_LIMITS.perPageDefault,
    show_captions: bool(raw, "show_captions", false),
    lightbox: bool(raw, "lightbox", true),
    images,
  };
}

// ---- Pages (07-22; CONT-22, D228: numbered server pages, no infinite scroll) ----------

/** Query parameter prefix: `?g<sectionId>=N`. One owner for the `g` prefix. */
export const GALLERY_PAGE_PARAM_PREFIX = "g";

const PAGE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PAGE_NUM_RE = /^\d{1,3}$/;
const MAX_PAGE_KEYS = 20;

/**
 * Gallery page per section id from untrusted search params (T-07-22-01): own-property
 * scan, at most 20 `g*` keys looked at, ids `[A-Za-z0-9_-]{1,40}`, integers 1..999,
 * arrays take the first value. Never throws.
 */
export function parseGalleryPages(
  params: unknown,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (params === null || typeof params !== "object") return Object.freeze(out);
  let seen = 0;
  for (const key of Object.keys(params)) {
    if (!key.startsWith(GALLERY_PAGE_PARAM_PREFIX)) continue;
    if (seen >= MAX_PAGE_KEYS) break;
    seen++;
    const id = key.slice(GALLERY_PAGE_PARAM_PREFIX.length);
    if (!PAGE_ID_RE.test(id)) continue;
    let raw: unknown = (params as Record<string, unknown>)[key];
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw !== "string" || !PAGE_NUM_RE.test(raw)) continue;
    const n = Number(raw);
    if (n < 1 || n > 999) continue;
    out[id] = n;
  }
  return Object.freeze(out);
}

/** One page of a gallery; out-of-range requests clamp, never error. */
export function sliceGalleryPage<T>(
  items: readonly T[],
  perPage: number,
  requested?: number,
): { items: T[]; page: number; pages: number } {
  const size =
    Number.isInteger(perPage) && perPage > 0
      ? perPage
      : GALLERY_LIMITS.perPageDefault;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const want =
    typeof requested === "number" && Number.isInteger(requested)
      ? requested
      : 1;
  const page = Math.min(pages, Math.max(1, want));
  const start = (page - 1) * size;
  return { items: items.slice(start, start + size), page, pages };
}

function imagesOf(content: unknown): GalleryImage[] {
  return isRecord(content) && Array.isArray(content.images)
    ? (content.images.filter(isRecord) as GalleryImage[])
    : [];
}

export const gallerySection: SectionTypeDefinition = {
  type: "gallery",
  label: "Gallery",
  description: "A grid, mosaic or slideshow of photos",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultGalleryContent(),
  validate: (raw) => validateGalleryContent(raw),
  mapRichText: (content) => ({ ...(content as GalleryContent) }),
  textsOf: (content) => {
    const images = imagesOf(content);
    return nonEmpty([
      isRecord(content) ? (content.heading as string) : "",
      ...images.map((i) => i.alt),
      ...images.map((i) => i.caption),
    ]);
  },
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: (content) =>
    mediaRefs(nonEmpty(imagesOf(content).map((i) => i.asset))),
};
