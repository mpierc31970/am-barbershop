// Gallery mosaic rows (07-22; CONT-22, decision 3).
import { describe, expect, it } from "vitest";
import {
  GALLERY_JUSTIFY_DEFAULTS,
  justifyGalleryRows,
} from "./gallery-justify";

const p43 = { width: 4, height: 3 };

describe("justifyGalleryRows", () => {
  it("returns no rows for no photos", () => {
    expect(justifyGalleryRows([])).toEqual([]);
  });

  it("3 photos at 4:3 do not fill 1056px: one last row with a spacer", () => {
    const rows = justifyGalleryRows([p43, p43, p43]);
    expect(rows).toHaveLength(1);
    expect(rows[0].last).toBe(true);
    expect(rows[0].spacer).toBeGreaterThan(0);
    expect(rows[0].items.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it("complete rows fit at or under the target and carry spacer 0", () => {
    const sizes = Array.from({ length: 12 }, () => p43);
    const rows = justifyGalleryRows(sizes);
    const { width, gap, target } = GALLERY_JUSTIFY_DEFAULTS;
    for (const row of rows.filter((r) => !r.last)) {
      const sum = row.items.reduce((s, i) => s + i.aspect, 0);
      const height = (width - gap * (row.items.length - 1)) / sum;
      expect(height).toBeLessThanOrEqual(target);
      expect(row.spacer).toBe(0);
    }
    const all = rows.flatMap((r) => r.items.map((i) => i.index));
    expect(all).toEqual(sizes.map((_, i) => i));
  });

  it("treats missing, zero and NaN sizes as square, and clamps extremes", () => {
    const rows = justifyGalleryRows([
      {},
      { width: 0, height: 10 },
      { width: Number.NaN, height: 3 },
      { width: 1000, height: 100 },
      { width: 100, height: 1000 },
    ]);
    const aspects = rows.flatMap((r) => r.items.map((i) => i.aspect));
    expect(aspects).toEqual([1, 1, 1, 4, 0.25]);
  });

  it("handles 200 photos in one pass, every index exactly once", () => {
    const sizes = Array.from({ length: 200 }, (_, i) => ({
      width: 300 + (i % 7) * 100,
      height: 400,
    }));
    const rows = justifyGalleryRows(sizes);
    const all = rows.flatMap((r) => r.items.map((i) => i.index));
    expect(all).toEqual(sizes.map((_, i) => i));
    expect(rows.filter((r) => r.last).length).toBeLessThanOrEqual(1);
  });

  it("honours a phone target", () => {
    const sizes = Array.from({ length: 6 }, () => p43);
    const wide = justifyGalleryRows(sizes, { width: 375, target: 160 });
    expect(wide.length).toBeGreaterThan(1);
  });
});
