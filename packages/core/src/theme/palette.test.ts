// extractPalette unit tests (ONB-05, D47, CONTEXT A4-Q2, RESEARCH Pattern 5, T-06-05).
import { describe, expect, it } from "vitest";
import {
  FLAT,
  SIX_COLOUR,
  TRANSPARENT,
  TWO_COLOUR,
} from "./__fixtures__/palette-pixels";
import { downsampleSize, extractPalette } from "./palette";

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function withinBin(a: string, b: string): boolean {
  const x = channels(a);
  const y = channels(b);
  return x.every((v, i) => Math.abs(v - y[i]!) <= 4);
}

describe("extractPalette (ONB-05)", () => {
  it("a two-colour image gives two swatches, heavier first, within one bin of the inputs", () => {
    const out = extractPalette(TWO_COLOUR);
    expect(out).toHaveLength(2);
    expect(out[0]!.weight).toBe(60);
    expect(out[1]!.weight).toBe(40);
    expect(withinBin(out[0]!.hex, "#1f5f8b")).toBe(true);
    expect(withinBin(out[1]!.hex, "#f2f2ef")).toBe(true);
    for (const s of out) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("a six-colour image gives six swatches sorted by weight then hex, weights summing to the pixels", () => {
    const out = extractPalette(SIX_COLOUR);
    expect(out).toHaveLength(6);
    expect(out.map((s) => s.weight)).toEqual([30, 25, 20, 18, 15, 12]);
    expect(out.reduce((n, s) => n + s.weight, 0)).toBe(120);
    const expected = [
      "#c0392b",
      "#27ae60",
      "#2c3e50",
      "#f1c40f",
      "#8e44ad",
      "#ecf0f1",
    ];
    out.forEach((s, i) => expect(withinBin(s.hex, expected[i]!)).toBe(true));
  });

  it("honours max", () => {
    const out = extractPalette(SIX_COLOUR, { max: 3 });
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.reduce((n, s) => n + s.weight, 0)).toBe(120);
  });

  it("a fully transparent image gives []", () => {
    expect(extractPalette(TRANSPARENT)).toEqual([]);
  });

  it("a flat colour gives one swatch", () => {
    const out = extractPalette(FLAT);
    expect(out).toHaveLength(1);
    expect(out[0]!.weight).toBe(256);
    expect(withinBin(out[0]!.hex, "#336699")).toBe(true);
  });

  it("a malformed buffer gives [] rather than throwing", () => {
    expect(
      extractPalette({ data: new Uint8Array(4), width: 10, height: 10 }),
    ).toEqual([]);
    expect(
      extractPalette({ data: new Uint8Array(0), width: 0, height: 0 }),
    ).toEqual([]);
  });

  it("downsampleSize keeps the long side at 128 or below with integer maths", () => {
    expect(downsampleSize(4000, 3000)).toEqual({ width: 128, height: 96 });
    expect(downsampleSize(3000, 4000)).toEqual({ width: 96, height: 128 });
    expect(downsampleSize(50, 40)).toEqual({ width: 50, height: 40 });
    expect(downsampleSize(10000, 1)).toEqual({ width: 128, height: 1 });
  });

  it("a 1000x1000 buffer completes in under 100 ms (T-06-05)", () => {
    const w = 1000;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      data[i * 4] = i & 255;
      data[i * 4 + 1] = (i >> 8) & 255;
      data[i * 4 + 2] = (i >> 4) & 255;
      data[i * 4 + 3] = 255;
    }
    extractPalette({ data, width: w, height: w }); // warm up the JIT
    const t0 = performance.now();
    const out = extractPalette({ data, width: w, height: w });
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });
});
