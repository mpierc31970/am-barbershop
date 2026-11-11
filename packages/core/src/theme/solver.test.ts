// THEME-05: the WCAG AA contrast solver (D47 constraint 1, CONTEXT A3-Q2/Q3, RESEARCH
// Pattern 2, Pitfalls 3-5). Named palettes are the 04-UI-SPEC authored values: Almanac must
// report 0 adjustments, Tidewater exactly 1 (D-UI-P4-7).
import { describe, expect, it } from "vitest";
import { hexToOklch } from "./color";
import { contrastRatio } from "./contrast";
import { ENFORCED_PAIRS, ROLES, type RoleMap } from "./roles";
import { evaluatePairs, solveContrast } from "./solver";

const NEUTRAL: RoleMap = {
  surface: "#fbfaf8",
  "surface-raised": "#f1efea",
  text: "#1d1c1a",
  "text-muted": "#5e5a54",
  primary: "#1d1c1a",
  "primary-contrast": "#ffffff",
  accent: "#8a4b2a",
  border: "#d8d4cc",
};

const ALMANAC: RoleMap = {
  surface: "#f7f1e8",
  "surface-raised": "#ede3d3",
  text: "#2a211b",
  "text-muted": "#6a5a4c",
  primary: "#9a3b22",
  "primary-contrast": "#fff8f0",
  accent: "#56642a",
  border: "#d8cab4",
};

const TIDEWATER: RoleMap = {
  surface: "#f3f6f8",
  "surface-raised": "#e1eaef",
  text: "#0f1d26",
  "text-muted": "#465a66",
  primary: "#1f3fcc",
  "primary-contrast": "#ffffff",
  accent: "#f06a4d",
  border: "#c3d1d9",
};

function assertAllEnforcedPass(roles: RoleMap): void {
  for (const p of ENFORCED_PAIRS) {
    const ratio = contrastRatio(roles[p.fg], roles[p.bg]);
    expect(ratio, `${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(p.min ?? 0);
  }
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("evaluatePairs", () => {
  it("returns one row per pair, rounded to 2 dp, border reported not enforced", () => {
    const rows = evaluatePairs(ALMANAC);
    expect(rows).toHaveLength(10);
    const border = rows.find((r) => r.fg === "border");
    expect(border?.min).toBeNull();
    expect(border?.pass).toBe(true);
    for (const r of rows) {
      expect(Math.round(r.ratio * 100) / 100).toBe(r.ratio);
    }
  });

  it("matches the UI-SPEC Almanac ratios", () => {
    const rows = evaluatePairs(ALMANAC);
    const get = (fg: string, bg: string) =>
      rows.find((r) => r.fg === fg && r.bg === bg)?.ratio;
    expect(get("text", "surface")).toBe(14.04);
    expect(get("primary", "surface")).toBe(6.19);
    expect(get("primary-contrast", "primary")).toBe(6.6);
    expect(get("accent", "surface-raised")).toBe(5.08);
  });

  it("passes on the unrounded ratio", () => {
    // #767676 on #ffffff is 4.54: passes 4.5 even though it is under the solver margin.
    const roles = { ...NEUTRAL, surface: "#ffffff", "text-muted": "#767676" };
    const row = evaluatePairs(roles).find(
      (r) => r.fg === "text-muted" && r.bg === "surface",
    );
    expect(row?.pass).toBe(true);
  });
});

describe("solveContrast named palettes", () => {
  it("Neutral: no adjustments, roles unchanged", () => {
    const out = solveContrast(NEUTRAL);
    expect(out.adjustments).toEqual([]);
    expect(out.roles).toEqual(NEUTRAL);
    expect(out.pairs.every((p) => p.pass)).toBe(true);
  });

  it("Almanac: no adjustments, roles unchanged (lowercased)", () => {
    const upper = Object.fromEntries(
      ROLES.map((r) => [r, ALMANAC[r].toUpperCase()]),
    ) as RoleMap;
    const out = solveContrast(upper);
    expect(out.adjustments).toEqual([]);
    expect(out.roles).toEqual(ALMANAC);
    expect(out.pairs.every((p) => p.pass)).toBe(true);
  });

  it("Tidewater: exactly one adjustment, accent, hue held", () => {
    const out = solveContrast(TIDEWATER);
    expect(out.adjustments).toHaveLength(1);
    const [adj] = out.adjustments;
    expect(adj?.role).toBe("accent");
    expect(adj?.from).toBe("#f06a4d");
    expect(adj?.reason).toBe("accent on surface-raised 2.50 < 3.00");
    expect(adj?.fallback).toBe(false);
    expect(adj?.to).toBe(out.roles.accent);

    const accent = out.roles.accent;
    const onSurface = contrastRatio(accent, out.roles.surface);
    const onRaised = contrastRatio(accent, out.roles["surface-raised"]);
    expect(onSurface).toBeGreaterThanOrEqual(3);
    expect(onRaised).toBeGreaterThanOrEqual(3);
    expect(Math.min(onSurface, onRaised)).toBeGreaterThanOrEqual(3.05);
    expect(
      hueDelta(hexToOklch(accent).h, hexToOklch("#f06a4d").h),
    ).toBeLessThanOrEqual(1);

    for (const r of ROLES) {
      if (r !== "accent") expect(out.roles[r], r).toBe(TIDEWATER[r]);
    }
    assertAllEnforcedPass(out.roles);
  });
});

describe("solveContrast rules", () => {
  it("does not move a passing value just above its minimum (Pitfall 4)", () => {
    const roles: RoleMap = {
      ...NEUTRAL,
      surface: "#ffffff",
      "surface-raised": "#ffffff",
      "text-muted": "#767676",
    };
    const ratio = contrastRatio("#767676", "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.55);
    const out = solveContrast(roles);
    expect(out.roles["text-muted"]).toBe("#767676");
    expect(out.adjustments.some((a) => a.role === "text-muted")).toBe(false);
  });

  it("two-background infeasible palette moves surface-raised before any fallback (Pitfall 3)", () => {
    const roles: RoleMap = {
      surface: "#ffffff",
      "surface-raised": "#333333",
      text: "#888888",
      "text-muted": "#888888",
      primary: "#777777",
      "primary-contrast": "#ffffff",
      accent: "#999999",
      border: "#cccccc",
    };
    const out = solveContrast(roles);
    assertAllEnforcedPass(out.roles);
    const raisedIdx = out.adjustments.findIndex(
      (a) => a.role === "surface-raised",
    );
    expect(raisedIdx).toBeGreaterThanOrEqual(0);
    expect(out.adjustments[raisedIdx]?.fallback).toBe(false);
    const firstFallback = out.adjustments.findIndex((a) => a.fallback);
    if (firstFallback >= 0) expect(firstFallback).toBeGreaterThan(raisedIdx);
    expect(out.roles.surface).toBe("#ffffff");
  });

  it("solves primary-contrast against the solved primary", () => {
    const roles: RoleMap = {
      ...NEUTRAL,
      surface: "#ffffff",
      "surface-raised": "#f5f5f5",
      primary: "#ffcc00",
      "primary-contrast": "#333333",
    };
    // #333333 passes on the authored yellow, fails once primary is darkened.
    expect(contrastRatio("#333333", "#ffcc00")).toBeGreaterThanOrEqual(4.5);
    const out = solveContrast(roles);
    expect(out.adjustments.map((a) => a.role)).toContain("primary");
    expect(out.adjustments.map((a) => a.role)).toContain("primary-contrast");
    expect(
      contrastRatio(out.roles["primary-contrast"], out.roles.primary),
    ).toBeGreaterThanOrEqual(4.5);
    assertAllEnforcedPass(out.roles);
  });

  it("is deterministic and never mutates its input", () => {
    const input = { ...TIDEWATER };
    const snapshot = { ...input };
    const a = solveContrast(input);
    const b = solveContrast(input);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });

  it("outputs lowercase #rrggbb for every role", () => {
    const out = solveContrast({ ...TIDEWATER, accent: "#F06A4D" });
    for (const r of ROLES) expect(out.roles[r]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
