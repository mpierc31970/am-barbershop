// proposeRoles + proposalToPreviewDesign (ONB-05, D47, CONTEXT A4-Q3, RESEARCH Pattern 5).
import { describe, expect, it } from "vitest";
import { hexToOklch } from "./color";
import { designToCssVars } from "./emit";
import type { Swatch } from "./palette";
import {
  ACCENT_MIN_HUE_DISTANCE,
  CHROMA_NEUTRAL,
  proposalToPreviewDesign,
  proposeRoles,
} from "./propose";
import { ROLES } from "./roles";

const VIVID: Swatch[] = [
  { hex: "#1f5f8b", weight: 400 },
  { hex: "#f2f2ef", weight: 300 },
  { hex: "#e07a1f", weight: 150 },
  { hex: "#2e7d32", weight: 90 },
  { hex: "#121212", weight: 60 },
];
const NEUTRALS: Swatch[] = [
  { hex: "#f4f1ea", weight: 500 },
  { hex: "#9a948a", weight: 300 },
  { hex: "#2b2a28", weight: 200 },
];
const SINGLE: Swatch[] = [{ hex: "#d81b60", weight: 1 }];
const DARK_ONLY: Swatch[] = [
  { hex: "#0b1a3a", weight: 10 },
  { hex: "#050505", weight: 5 },
];

const FIXTURES: [string, Swatch[]][] = [
  ["vivid", VIVID],
  ["all-neutral", NEUTRALS],
  ["single", SINGLE],
  ["dark-only", DARK_ONLY],
  ["empty", []],
];

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("proposeRoles (ONB-05, D47)", () => {
  for (const [name, swatches] of FIXTURES) {
    it(`${name}: all eight roles are #rrggbb and every enforced pair passes`, () => {
      const p = proposeRoles(swatches);
      for (const r of ROLES) expect(p.roles[r]).toMatch(/^#[0-9a-f]{6}$/);
      const enforced = p.pairs.filter((x) => x.min !== null);
      expect(enforced.length).toBeGreaterThan(0);
      for (const pair of enforced) expect(pair.pass).toBe(true);
    });
  }

  it("primary is the heaviest chromatic swatch in the lightness band", () => {
    const p = proposeRoles(VIVID);
    // #1f5f8b is chromatic, mid lightness and heaviest: it passes AA on a light surface.
    expect(p.roles.primary).toBe("#1f5f8b");
    const o = hexToOklch(p.roles.primary);
    expect(o.c).toBeGreaterThanOrEqual(CHROMA_NEUTRAL);
  });

  it("accent sits at least 40 degrees from primary when a second chromatic swatch exists", () => {
    const p = proposeRoles(VIVID);
    const d = hueDistance(
      hexToOklch(p.roles.primary).h,
      hexToOklch(p.roles.accent).h,
    );
    expect(d).toBeGreaterThanOrEqual(ACCENT_MIN_HUE_DISTANCE);
  });

  it("a top swatch outside the band is shifted into it", () => {
    const p = proposeRoles(DARK_ONLY);
    const l = hexToOklch(p.roles.primary).l;
    expect(l).toBeGreaterThanOrEqual(0.25);
    expect(l).toBeLessThanOrEqual(0.75);
  });

  it("uses a very light swatch as surface when one exists", () => {
    expect(proposeRoles(VIVID).roles.surface).toBe("#f2f2ef");
  });

  it("is deterministic and keeps the swatches it was given", () => {
    const a = proposeRoles(VIVID);
    expect(proposeRoles(VIVID)).toEqual(a);
    expect(a.swatches).toEqual(VIVID);
  });

  it("never throws on junk input", () => {
    const junk = [
      { hex: "nope", weight: 1 },
      { hex: "#12", weight: Number.NaN },
    ] as Swatch[];
    expect(() => proposeRoles(junk)).not.toThrow();
    expect(() => proposeRoles(null as unknown as Swatch[])).not.toThrow();
  });
});

describe("proposalToPreviewDesign", () => {
  it("builds a PublicDesign designToCssVars renders with the proposal's roles", () => {
    const p = proposeRoles(VIVID);
    const d = proposalToPreviewDesign(p, "warm-classic", "Sunrise Bakery");
    const css = designToCssVars(d);
    expect(css).toContain("--site-primary:");
    expect(css).toContain(`--site-primary:${p.roles.primary};`);
    expect(css).toContain("Fraunces");
    expect(d.name).toBe("Sunrise Bakery");
  });

  it("Let CDS choose (and unknown ids) render in System Sans", () => {
    const p = proposeRoles([]);
    for (const id of ["cds-choose", "nope"]) {
      const d = proposalToPreviewDesign(p, id, "");
      expect(d.typography.headingFamily).toBe("System Sans");
      expect(d.typography.bodyFamily).toBe("System Sans");
      expect(designToCssVars(d)).toContain("--site-primary:");
    }
  });
});
