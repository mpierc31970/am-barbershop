// The mood board palette (ONB-05, D47, CONTEXT A4-Q2, RESEARCH Pattern 5 and Pitfall 9): a
// deterministic median cut over an integer OKLab histogram. It runs in the browser the
// moment an owner picks an image and again on the server after upload, so it is pure and
// browser-safe: no node:*, no Date, no randomness, no Map/Set iteration order dependence
// (bins are walked by index) and every comparator is a total order.
//
// Steps: integer nearest-sample downsample to <= 128 px on the long side (T-06-05) -> skip
// alpha < 128 -> 5-bit bins in a fixed 32768-entry histogram -> OKLab of each occupied bin
// centre rounded to fixed-point integers (x10000) so engine ulp differences in cbrt/pow never
// change a split -> median cut on integers -> count-weighted integer mean of each box's sRGB
// bin centres -> sort (weight desc, hex asc) -> merge near-duplicates.
// It returns swatches only; it never writes organizations.design (D47 constraint 2).
import { srgbToOklch, toHex } from "./color";

/** RGBA, 4 bytes per pixel, row-major. */
export type PixelBuffer = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

/** One palette colour. `weight` is the integer pixel count after downsampling. */
export type Swatch = { hex: string; weight: number };

/** The long side is sampled down to at most this many pixels before any work. */
export const PALETTE_MAX_SIDE = 128;
/** Default number of swatches. */
export const PALETTE_DEFAULT_MAX = 6;
/** Pixels with alpha below this are ignored (transparent backgrounds). */
const ALPHA_MIN = 128;
/** Fixed-point scale for OKLab coordinates. */
const FIXED = 10000;
/**
 * Two swatches closer than this in fixed-point OKLab (0.03 in OKLab units, just below a
 * noticeable difference at swatch size) merge into the heavier one.
 */
export const PALETTE_MERGE_DISTANCE = 300;
const BIN_COUNT = 32768;

/** Integer size of the long side scaled to <= maxSide, aspect kept, never below 1. */
export function downsampleSize(
  width: number,
  height: number,
  maxSide: number = PALETTE_MAX_SIDE,
): { width: number; height: number } {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const long = Math.max(w, h);
  if (long <= maxSide) return { width: w, height: h };
  if (w >= h) {
    return {
      width: maxSide,
      height: Math.max(1, Math.floor((h * maxSide) / w)),
    };
  }
  return { width: Math.max(1, Math.floor((w * maxSide) / h)), height: maxSide };
}

type Point = { bin: number; L: number; A: number; B: number; count: number };
type Box = { points: Point[]; count: number; minBin: number };

function binCentre(bin: number): [number, number, number] {
  return [
    ((bin >> 10) & 31) * 8 + 4,
    ((bin >> 5) & 31) * 8 + 4,
    (bin & 31) * 8 + 4,
  ];
}

function labFixed(r: number, g: number, b: number): [number, number, number] {
  const o = srgbToOklch({ r, g, b });
  const hr = (o.h * Math.PI) / 180;
  return [
    Math.round(o.l * FIXED),
    Math.round(o.c * Math.cos(hr) * FIXED),
    Math.round(o.c * Math.sin(hr) * FIXED),
  ];
}

function makeBox(points: Point[]): Box {
  let count = 0;
  let minBin = BIN_COUNT;
  for (const p of points) {
    count += p.count;
    if (p.bin < minBin) minBin = p.bin;
  }
  return { points, count, minBin };
}

/** Axis index 0/1/2 (L/a/b) with the largest integer range, ties L > a > b; -1 when flat. */
function splitAxis(box: Box): number {
  const ranges = [0, 0, 0];
  const keys = ["L", "A", "B"] as const;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of box.points) {
      const v = p[keys[k]!];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    ranges[k] = hi - lo;
  }
  let best = -1;
  let bestRange = 0;
  for (let k = 0; k < 3; k++) {
    if (ranges[k]! > bestRange) {
      best = k;
      bestRange = ranges[k]!;
    }
  }
  return best;
}

function splitBox(box: Box, axis: number): [Box, Box] {
  const key = (["L", "A", "B"] as const)[axis]!;
  const sorted = [...box.points].sort(
    (x, y) => x[key] - y[key] || x.bin - y.bin,
  );
  let cum = 0;
  let cut = sorted.length - 1;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i]!.count;
    if (cum * 2 >= box.count) {
      cut = i + 1;
      break;
    }
  }
  cut = Math.min(Math.max(cut, 1), sorted.length - 1);
  return [makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut))];
}

function swatchOf(box: Box): Swatch {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of box.points) {
    const [cr, cg, cb] = binCentre(p.bin);
    r += cr * p.count;
    g += cg * p.count;
    b += cb * p.count;
  }
  const n = box.count;
  return {
    hex: toHex({
      r: Math.round(r / n),
      g: Math.round(g / n),
      b: Math.round(b / n),
    }),
    weight: n,
  };
}

function bySwatch(x: Swatch, y: Swatch): number {
  if (x.weight !== y.weight) return y.weight - x.weight;
  return x.hex < y.hex ? -1 : x.hex > y.hex ? 1 : 0;
}

function hexLab(hex: string): [number, number, number] {
  return labFixed(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
}

function mergeClose(sorted: Swatch[]): Swatch[] {
  const kept: { s: Swatch; lab: [number, number, number] }[] = [];
  const limit = PALETTE_MERGE_DISTANCE * PALETTE_MERGE_DISTANCE;
  for (const s of sorted) {
    const lab = hexLab(s.hex);
    const into = kept.find(({ lab: k }) => {
      const dL = k[0] - lab[0];
      const dA = k[1] - lab[1];
      const dB = k[2] - lab[2];
      return dL * dL + dA * dA + dB * dB < limit;
    });
    if (into) into.s = { hex: into.s.hex, weight: into.s.weight + s.weight };
    else kept.push({ s: { ...s }, lab });
  }
  return kept.map((k) => k.s).sort(bySwatch);
}

/**
 * Up to `max` (default 6) swatches, heaviest first (ties by hex). Identical pixels, in any
 * order, always give an identical result. A fully transparent or empty buffer gives [].
 */
export function extractPalette(
  px: PixelBuffer,
  opts: { max?: number } = {},
): Swatch[] {
  const max = Math.max(
    1,
    Math.min(16, Math.floor(opts.max ?? PALETTE_DEFAULT_MAX)),
  );
  const w = Math.floor(px.width);
  const h = Math.floor(px.height);
  if (!(w > 0 && h > 0) || px.data.length < w * h * 4) return [];

  const { width: tw, height: th } = downsampleSize(w, h);
  const hist = new Uint32Array(32768);
  const data = px.data;
  for (let y = 0; y < th; y++) {
    const sy = Math.floor((y * h) / th);
    for (let x = 0; x < tw; x++) {
      const sx = Math.floor((x * w) / tw);
      const i = (sy * w + sx) * 4;
      if (data[i + 3]! < ALPHA_MIN) continue;
      const bin =
        ((data[i]! >> 3) << 10) |
        ((data[i + 1]! >> 3) << 5) |
        (data[i + 2]! >> 3);
      hist[bin]! += 1;
    }
  }

  const points: Point[] = [];
  for (let bin = 0; bin < BIN_COUNT; bin++) {
    const count = hist[bin]!;
    if (count === 0) continue;
    const [r, g, b] = binCentre(bin);
    const [L, A, B] = labFixed(r, g, b);
    points.push({ bin, L, A, B, count });
  }
  if (points.length === 0) return [];

  const boxes: Box[] = [makeBox(points)];
  while (boxes.length < max) {
    let pick = -1;
    let axis = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.points.length < 2) continue;
      const ax = splitAxis(box);
      if (ax < 0) continue;
      const cur = pick < 0 ? null : boxes[pick]!;
      if (
        cur === null ||
        box.count > cur.count ||
        (box.count === cur.count && box.minBin < cur.minBin)
      ) {
        pick = i;
        axis = ax;
      }
    }
    if (pick < 0) break;
    const [a, b] = splitBox(boxes[pick]!, axis);
    boxes.splice(pick, 1, a, b);
  }

  return mergeClose(boxes.map(swatchOf).sort(bySwatch));
}
