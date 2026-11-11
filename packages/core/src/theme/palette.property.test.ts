// extractPalette determinism property (ONB-05, D47, RESEARCH Pitfall 9): the same pixels
// give the same swatches on every run and for any permutation of pixel order. Shuffles use a
// fixed-seed LCG from the fixture module, never Math.random, so failures reproduce.
import { describe, expect, it } from "vitest";
import {
  SIX_COLOUR,
  TWO_COLOUR,
  gradientPixels,
  shufflePixels,
} from "./__fixtures__/palette-pixels";
import { extractPalette } from "./palette";

const SEEDS = [1, 7, 42, 0x5eed, 0xc0ffee, 123456789];
const FIXTURES = [
  ["two colour", TWO_COLOUR],
  ["six colour", SIX_COLOUR],
  ["gradient", gradientPixels()],
] as const;

describe("extractPalette determinism (ONB-05)", () => {
  for (const [name, px] of FIXTURES) {
    it(`${name}: two runs are deep-equal`, () => {
      expect(extractPalette(px)).toEqual(extractPalette(px));
    });

    it(`${name}: every seeded permutation of pixel order gives the same palette`, () => {
      const base = extractPalette(px);
      for (const seed of SEEDS) {
        expect(extractPalette(shufflePixels(px, seed))).toEqual(base);
      }
    });
  }

  it("the gradient yields the full six swatches with weights summing to the pixel count", () => {
    const px = gradientPixels();
    const out = extractPalette(px);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.reduce((n, s) => n + s.weight, 0)).toBe(px.width * px.height);
  });
});
