// imageWidthCandidates (07-12 choice 3; D255).
import { describe, expect, it } from "vitest";
import { imageWidthCandidates, largestCandidateUpTo } from "./srcset";

describe("imageWidthCandidates", () => {
  it("lists every width below the photo plus w2560 at web width", () => {
    expect(imageWidthCandidates(2000, 2000)).toEqual([
      ["w480", 480],
      ["w960", 960],
      ["w1600", 1600],
      ["w2560", 2000],
    ]);
    expect(imageWidthCandidates(700, 700)).toEqual([
      ["w480", 480],
      ["w2560", 700],
    ]);
    expect(imageWidthCandidates(400, 400)).toEqual([["w2560", 400]]);
    expect(imageWidthCandidates(3000, 2560)).toEqual([
      ["w480", 480],
      ["w960", 960],
      ["w1600", 1600],
      ["w2560", 2560],
    ]);
  });

  it("a zero or non-finite width gives only w2560 at webWidth", () => {
    expect(imageWidthCandidates(0, 300)).toEqual([["w2560", 300]]);
    expect(imageWidthCandidates(Number.NaN, 300)).toEqual([["w2560", 300]]);
    expect(imageWidthCandidates(Infinity, 300)).toEqual([["w2560", 300]]);
  });
});

describe("largestCandidateUpTo", () => {
  it("picks w1600 when present, else the widest no wider than 1600 px", () => {
    expect(largestCandidateUpTo(imageWidthCandidates(2000, 2000))).toEqual([
      "w1600",
      1600,
    ]);
    expect(largestCandidateUpTo(imageWidthCandidates(700, 700))).toEqual([
      "w2560",
      700,
    ]);
    expect(largestCandidateUpTo(imageWidthCandidates(400, 400))).toEqual([
      "w2560",
      400,
    ]);
  });
});
