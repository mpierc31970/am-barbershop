// Gallery view helpers (07-22; CONT-22, D228; 07-22 decisions 2 and 3; UI-SPEC row 357,
// breakpoints lines 699-700).
//
// Pure, no React. `galleryPhotos` turns stored images into renderable photos using only the
// MediaDelivery map (coreData.media): a missing asset is dropped, a soft-deleted one keeps
// showing (D275). `galleryPageHref` builds the only page URLs the gallery emits, from a
// validated section id and integers (T-07-22-03). Column classes come from a static
// table so Tailwind sees literal strings.
import type { GalleryContent } from "@cds/core/content";
import { mediaSrc, mediaSrcSet, resolveMedia } from "../items/media";
import type { ResolvedMedia } from "../types";

export interface GalleryPhotoView {
  id: string;
  /** 0-based position across the whole gallery (not the page). */
  index: number;
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  caption: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dim = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

export function galleryPhotos(
  content: Partial<GalleryContent> | null | undefined,
  media: Readonly<Record<string, ResolvedMedia>>,
): GalleryPhotoView[] {
  const images = Array.isArray(content?.images) ? content.images : [];
  const out: GalleryPhotoView[] = [];
  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const asset = resolveMedia(media, image.asset, "image");
    if (!asset) continue;
    const src = mediaSrc(asset.src);
    if (src === "") continue;
    const srcSet = mediaSrcSet(asset.srcSet);
    out.push({
      id: str(image.id) || `photo-${out.length}`,
      index: out.length,
      src,
      srcSet: srcSet || undefined,
      width: dim(asset.width),
      height: dim(asset.height),
      alt: str(image.alt) || str(asset.alt),
      caption: str(image.caption),
    });
  }
  return out;
}

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Link to page `n` of gallery `key`: `?g<key>=n#gallery-<key>`. Other galleries' pages in
 * `pages` are kept (sorted keys) so two galleries on one page do not reset each other;
 * page 1 drops this gallery's key; an empty query yields just the anchor.
 */
export function galleryPageHref(
  key: string,
  n: number,
  pages: Readonly<Record<string, number>>,
): string {
  const entries: [string, number][] = [];
  for (const k of Object.keys(pages).sort()) {
    if (k === key || !KEY_RE.test(k)) continue;
    const v = pages[k];
    if (Number.isInteger(v) && v > 1 && v <= 999) entries.push([k, v]);
  }
  if (Number.isInteger(n) && n > 1) entries.push([key, n]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = entries.map(([k, v]) => `g${k}=${v}`).join("&");
  return `${query ? `?${query}` : ""}#gallery-${key}`;
}

// 2 on phones, at most 4 until 1024px, the chosen count from 1024px.
const GRID_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-4 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-4 lg:grid-cols-6",
};

export function gridColumnsClass(columns: number): string {
  return GRID_COLUMNS[columns] ?? GRID_COLUMNS[3];
}

/** `sizes` for a grid photo: a column of the 1056px content box at each breakpoint. */
export function gallerySizes(columns: number): string {
  const c = GRID_COLUMNS[columns] ? columns : 3;
  const md = Math.min(c, 4);
  const lg = Math.round(1056 / c);
  return `(min-width: 1024px) ${lg}px, (min-width: 768px) ${Math.round(100 / md)}vw, 50vw`;
}
