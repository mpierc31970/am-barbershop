// THEME-05: the one WCAG 2.2 contrast implementation (CONTEXT A3-Q4). Reference values are
// the existing tokens-contrast test and the 04-UI-SPEC contrast tables (re-computed in
// 04-RESEARCH "Code Examples").
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("accepts uppercase hex", () => {
    expect(relativeLuminance("#F06A4D")).toBe(relativeLuminance("#f06a4d"));
  });

  it("rejects anything but #rrggbb", () => {
    for (const bad of [
      "#fff",
      "fff",
      "#12345",
      "#gggggg",
      "red",
      "",
      "#ffffff ",
    ]) {
      expect(() => relativeLuminance(bad), bad).toThrow(InvalidInput);
    }
  });
});

describe("contrastRatio", () => {
  it("black on white is 21, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
  });

  it("#777777 on white rounds to 4.48 (just under AA)", () => {
    expect(contrastRatio("#777777", "#ffffff").toFixed(2)).toBe("4.48");
  });

  it("reproduces the Neutral preset ratios from the UI-SPEC", () => {
    expect(contrastRatio("#1d1c1a", "#fbfaf8").toFixed(2)).toBe("16.32");
    expect(contrastRatio("#5e5a54", "#fbfaf8").toFixed(2)).toBe("6.57");
    expect(contrastRatio("#ffffff", "#1d1c1a").toFixed(2)).toBe("17.03");
  });

  it("reproduces the Tidewater accent ratios", () => {
    expect(contrastRatio("#f06a4d", "#e1eaef").toFixed(2)).toBe("2.50");
    expect(contrastRatio("#f06a4d", "#f3f6f8").toFixed(2)).toBe("2.81");
  });

  it("throws InvalidInput on a bad argument", () => {
    expect(() => contrastRatio("#000000", "white")).toThrow(InvalidInput);
  });
});
