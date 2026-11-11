// TEST ONLY. Hand-built RGBA fixtures for the palette tests (ONB-05, RESEARCH Pattern 5).
// Everything here is deterministic: no Math.random. The shuffle uses a fixed LCG seed so a
// permutation test reproduces exactly.
import type { PixelBuffer } from "../palette";

export type Fill = { hex: string; pixels: number; alpha?: number };

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** A width x height buffer filled row-major with each fill in turn (fills must cover it). */
export function buildPixels(
  width: number,
  height: number,
  fills: readonly Fill[],
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  let p = 0;
  for (const f of fills) {
    const [r, g, b] = rgb(f.hex);
    for (let i = 0; i < f.pixels && p < width * height; i++, p++) {
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      data[p * 4 + 3] = f.alpha ?? 255;
    }
  }
  if (p !== width * height) throw new Error("fills do not cover the buffer");
  return { data, width, height };
}

/** Deterministic Fisher-Yates over whole pixels with a fixed-seed LCG. */
export function shufflePixels(px: PixelBuffer, seed: number): PixelBuffer {
  const n = px.width * px.height;
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const src = order[i]! * 4;
    data.set(px.data.subarray(src, src + 4), i * 4);
  }
  return { data, width: px.width, height: px.height };
}

/** 60% deep blue, 40% warm off-white on a 10x10 grid. */
export const TWO_COLOUR = buildPixels(10, 10, [
  { hex: "#1f5f8b", pixels: 60 },
  { hex: "#f2f2ef", pixels: 40 },
]);

/** Six far-apart colours with distinct counts on a 12x10 grid. */
export const SIX_COLOUR = buildPixels(12, 10, [
  { hex: "#c0392b", pixels: 30 },
  { hex: "#27ae60", pixels: 25 },
  { hex: "#2c3e50", pixels: 20 },
  { hex: "#f1c40f", pixels: 18 },
  { hex: "#8e44ad", pixels: 15 },
  { hex: "#ecf0f1", pixels: 12 },
]);

/** Many near colours (a soft gradient) on a 64x64 grid: exercises real median cuts. */
export function gradientPixels(): PixelBuffer {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 4;
      data[i + 1] = y * 4;
      data[i + 2] = ((x + y) * 2) & 255;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

export const TRANSPARENT = buildPixels(8, 8, [
  { hex: "#ff0000", pixels: 64, alpha: 0 },
]);

export const FLAT = buildPixels(16, 16, [{ hex: "#336699", pixels: 256 }]);
