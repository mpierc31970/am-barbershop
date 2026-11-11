// THEME-05: OKLCH colour maths (hand-written, no colour dependency; CONTEXT Claude's
// Discretion, 04-RESEARCH "Code Examples"). T-04-01: parseColor is strict and toHex output is
// always #rrggbb. Seeded PRNG (mulberry32), no new dependency, so failures reproduce.
import { describe, expect, it } from "vitest";
import {
  gamutMap,
  hexToOklch,
  inGamut,
  oklchToHex,
  oklchToSrgb,
  parseColor,
  srgbToOklch,
  toHex,
} from "./color";

const ITERATIONS = 500;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rand: () => number, n: number): number {
  return Math.floor(rand() * n);
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe("parseColor", () => {
  it("accepts hex, rgb() and oklch() forms", () => {
    const accepted = [
      "#F06A4D",
      "#f6a",
      "rgb(240 106 77)",
      "rgb(240, 106, 77)",
      "oklch(0.684 0.17 33.7)",
      "oklch(68.4% 0.17 33.7)",
    ];
    for (const s of accepted) expect(parseColor(s), s).not.toBeNull();
  });

  it("parses hex and rgb to the same channels", () => {
    expect(parseColor("#F06A4D")).toEqual({ r: 240, g: 106, b: 77 });
    expect(parseColor("rgb(240 106 77)")).toEqual({ r: 240, g: 106, b: 77 });
    expect(parseColor("rgb(240, 106, 77)")).toEqual({ r: 240, g: 106, b: 77 });
    expect(parseColor("#f6a")).toEqual({ r: 255, g: 102, b: 170 });
  });

  it("treats oklch L as 0..1 or percent identically", () => {
    const a = parseColor("oklch(0.684 0.17 33.7)");
    const b = parseColor("oklch(68.4% 0.17 33.7)");
    expect(a && toHex(a)).toBe(b && toHex(b));
  });

  it("rejects everything else", () => {
    const rejected = [
      "red",
      "#12345",
      "rgb(1 2)",
      "url(x)",
      "}",
      "",
      "rgb(256 0 0)",
      "#ff00ff;",
    ];
    for (const s of rejected) expect(parseColor(s), s).toBeNull();
  });
});

describe("toHex", () => {
  it("always returns lowercase #rrggbb, clamped and rounded", () => {
    expect(toHex({ r: 300, g: -5, b: 127.6 })).toBe("#ff0080");
    expect(toHex({ r: Number.NaN, g: 0, b: 0 })).toMatch(/^#[0-9a-f]{6}$/);
    const rand = mulberry32(7);
    for (let i = 0; i < ITERATIONS; i++) {
      const out = toHex({
        r: rand() * 400 - 70,
        g: rand() * 400 - 70,
        b: rand() * 400 - 70,
      });
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("OKLCH conversion", () => {
  it("matches the reference value for #f06a4d", () => {
    const o = hexToOklch("#f06a4d");
    expect(Math.abs(o.l - 0.684)).toBeLessThan(0.005);
    expect(Math.abs(o.h - 33.7)).toBeLessThan(0.5);
  });

  it("white is l=1, c=0 and black is l=0", () => {
    const w = srgbToOklch({ r: 255, g: 255, b: 255 });
    expect(w.l).toBeCloseTo(1, 4);
    expect(w.c).toBeLessThan(1e-4);
    expect(srgbToOklch({ r: 0, g: 0, b: 0 }).l).toBeCloseTo(0, 6);
  });

  it("hue is normalised to [0, 360)", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const h = srgbToOklch({
        r: int(rand, 256),
        g: int(rand, 256),
        b: int(rand, 256),
      }).h;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it(`round-trips ${ITERATIONS} seeded random hex colours within 1 per channel`, () => {
    const rand = mulberry32(20260927);
    for (let i = 0; i < ITERATIONS; i++) {
      const hex = toHex({
        r: int(rand, 256),
        g: int(rand, 256),
        b: int(rand, 256),
      });
      const back = oklchToHex(hexToOklch(hex));
      const a = channels(hex);
      const b = channels(back);
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs((a[k] ?? 0) - (b[k] ?? 0)),
          `${hex} -> ${back}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("gamutMap", () => {
  it("reduces chroma only, at fixed l and h, until in gamut", () => {
    const out = { l: 0.7, c: 0.4, h: 150 };
    expect(inGamut(oklchToSrgb(out))).toBe(false);
    const mapped = gamutMap(out);
    expect(inGamut(oklchToSrgb(mapped))).toBe(true);
    expect(mapped.l).toBe(0.7);
    expect(mapped.h).toBe(150);
    expect(mapped.c).toBeLessThan(0.4);
    expect(mapped.c).toBeGreaterThan(0);
  });

  it("leaves an in-gamut colour unchanged", () => {
    const o = hexToOklch("#8a4b2a");
    expect(gamutMap(o)).toEqual(o);
  });
});
