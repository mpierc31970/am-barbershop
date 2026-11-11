// Row layout rules (CONT-03, D31, invariant 6) and the width flip (CONT-06, D76).
//
// Ported from donor src/lib/section-layouts.ts. Layout belongs to the container, not the
// content: every predefined block is full width only, and only `columns` chooses a split,
// so there is exactly one place layout is picked. The per-type allowlist that the donor
// kept here (LAYOUTS_FOR_TYPE) now lives on each registry definition's `layouts`, because
// add-ons contribute section types (CONT-02); clampLayout takes that list directly.
import type { RowLayout } from "./types";

/**
 * How many columns each row layout draws. The `columns` block derives its column count
 * from here rather than storing one, so the data can never disagree with the grid the
 * row renderer actually draws.
 */
export const COLUMN_COUNT: Record<RowLayout, number> = {
  full: 1,
  "50-50": 2,
  "25-75": 2,
  "75-25": 2,
  "40-60": 2,
  "60-40": 2,
  "30-70": 2,
  "70-30": 2,
  "33-33-33": 3,
  "25-50-25": 3,
  "25-25-25-25": 4,
  "20-20-20-20-20": 5,
};

// Derived from COLUMN_COUNT (rather than hand-listed) so a new RowLayout entry can't
// compile without also appearing here.
export const ALL_LAYOUTS: readonly RowLayout[] = Object.freeze(
  Object.keys(COLUMN_COUNT) as RowLayout[],
);

/** The allowlist of every predefined (non-columns) block. */
export const FULL_WIDTH_ONLY: readonly RowLayout[] = Object.freeze([
  "full",
] as RowLayout[]);

/** Own-property check, so inherited keys like "toString" are never a layout. */
export function isRowLayout(value: unknown): value is RowLayout {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(COLUMN_COUNT, value)
  );
}

export function columnCountFor(layout: RowLayout): number {
  return isRowLayout(layout) ? COLUMN_COUNT[layout] : 1;
}

/**
 * Resolve a stored `row_layout` to one the block type can honour.
 *
 * Stored rows may hold anything (a direct action call, an older row), so this is the
 * read-path and write-path guard. It resolves to the FIRST entry of the allowlist rather
 * than to a "nearest" layout, which would need a distance metric that does not exist.
 */
export function clampLayout(
  allowed: readonly RowLayout[],
  layout: unknown,
): RowLayout {
  if (isRowLayout(layout) && (allowed as readonly string[]).includes(layout)) {
    return layout;
  }
  return allowed[0] ?? "full";
}

/**
 * The six asymmetric two-column layouts and their mirror (D76, CONTEXT A4-Q2). Flipping
 * swaps the widths only: content stays in its stored column, so the wide column's content
 * becomes narrow. Symmetric and 3+ column layouts have nothing to flip.
 */
export const FLIP_PAIRS = {
  "25-75": "75-25",
  "75-25": "25-75",
  "40-60": "60-40",
  "60-40": "40-60",
  "30-70": "70-30",
  "70-30": "30-70",
} as const satisfies Partial<Record<RowLayout, RowLayout>>;

export function canFlip(layout: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLIP_PAIRS, layout);
}

/** The mirrored layout, or the same layout when it cannot flip. Content is untouched. */
export function flipLayout(layout: RowLayout): RowLayout {
  return canFlip(layout)
    ? (FLIP_PAIRS as Record<string, RowLayout>)[layout]!
    : layout;
}
