// Gallery mosaic layout (owner 07-22; CONT-22, D228; CONTEXT row 5; RESEARCH "Justified
// rows"; 07-22 decision 3).
//
// Greedy justified rows computed on the server: photos are added to a row at the target
// height until the row is at least as wide as the content box, then the row closes. The
// function returns only the grouping and each photo's aspect: renderers give every photo
// `flex-grow: aspect` (basis 0) so rows scale with the container without client JS. The
// trailing short row carries a `spacer` grow that fills the remainder, so it is never
// stretched. One pass with a running aspect sum (200 photos, no quadratic blow-up).
// Pure and Edge-safe: no node:, no next/* imports. Named exports only.

export const GALLERY_JUSTIFY_DEFAULTS = Object.freeze({
  /** Nominal content width: RowRenderer max-w-[1120px] minus md:px-8 on both sides. */
  width: 1056,
  target: 240,
  phoneTarget: 160,
  gap: 8,
  minAspect: 0.25,
  maxAspect: 4,
} as const);

export type GalleryJustifyRow = {
  items: { index: number; aspect: number }[];
  last: boolean;
  spacer: number;
};

export type GalleryJustifyOptions = {
  width: number;
  target: number;
  phoneTarget: number;
  gap: number;
  minAspect: number;
  maxAspect: number;
};

function aspectOf(
  size: { width?: number; height?: number } | undefined,
  o: GalleryJustifyOptions,
): number {
  const w = Number(size?.width);
  const h = Number(size?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return Math.min(o.maxAspect, Math.max(o.minAspect, w / h));
}

export function justifyGalleryRows(
  sizes: readonly { width?: number; height?: number }[],
  opts: Partial<GalleryJustifyOptions> = {},
): GalleryJustifyRow[] {
  const o: GalleryJustifyOptions = { ...GALLERY_JUSTIFY_DEFAULTS, ...opts };
  const target = o.target > 0 ? o.target : GALLERY_JUSTIFY_DEFAULTS.target;
  const rows: GalleryJustifyRow[] = [];
  let row: { index: number; aspect: number }[] = [];
  let sum = 0;
  for (let index = 0; index < sizes.length; index++) {
    const aspect = aspectOf(sizes[index], o);
    row.push({ index, aspect });
    sum += aspect;
    const height = (o.width - o.gap * (row.length - 1)) / sum;
    if (height <= target) {
      rows.push({ items: row, last: false, spacer: 0 });
      row = [];
      sum = 0;
    }
  }
  if (row.length > 0) {
    const spacer = Math.max(
      0,
      (o.width - o.gap * (row.length - 1)) / target - sum,
    );
    rows.push({ items: row, last: true, spacer });
  }
  return rows;
}
