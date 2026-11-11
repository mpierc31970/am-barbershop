// The mood board proposal (ONB-05, D47, CONTEXT A4-Q3/Q4, RESEARCH Pattern 5): palette
// swatches become the eight P4 roles, which then go through the ONE contrast solver, so every
// enforced pair passes. P4's importer role mapper is Node-only and needs authored colour
// metadata, so it is not reused here; this module stays browser-safe.
//
// A proposal is data only. It is stored on the intake record and previewed; it is never
// written to the organization's stored design (D47 constraint 2: a person approves the theme,
// the importer writes it). Pure and deterministic; never throws.
import { hexToOklch, oklchToHex } from "./color";
import { contrastRatio } from "./contrast";
import { NEUTRAL_DESIGN } from "./neutral";
import { findPairing } from "./pairings";
import type { Swatch } from "./palette";
import type { RoleMap } from "./roles";
import { solveContrast, type SolveResult } from "./solver";
import type { Oklch, PublicDesign } from "./types";

export type MoodboardProposal = {
  swatches: Swatch[];
  roles: RoleMap;
  adjustments: SolveResult["adjustments"];
  pairs: SolveResult["pairs"];
};

/** Chroma below this is a neutral (grey, cream, near-black). */
export const CHROMA_NEUTRAL = 0.04;
const PRIMARY_L_MIN = 0.25;
const PRIMARY_L_MAX = 0.75;
/** An accent must sit at least this far round the hue wheel from primary. */
export const ACCENT_MIN_HUE_DISTANCE = 40;
const WHITE = "#ffffff";
const HEX = /^#[0-9a-f]{6}$/;

type Entry = { hex: string; weight: number; o: Oklch };

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function entries(swatches: readonly Swatch[]): Entry[] {
  const out: Entry[] = [];
  for (const s of swatches) {
    if (typeof s?.hex !== "string") continue;
    const hex = s.hex.toLowerCase();
    if (!HEX.test(hex)) continue;
    const weight = Number.isFinite(s.weight) ? s.weight : 0;
    out.push({ hex, weight, o: hexToOklch(hex) });
  }
  return out.sort(
    (x, y) =>
      y.weight - x.weight || (x.hex < y.hex ? -1 : x.hex > y.hex ? 1 : 0),
  );
}

function neutralProposal(swatches: Swatch[]): MoodboardProposal {
  const solved = solveContrast(NEUTRAL_DESIGN.roles);
  return {
    swatches,
    roles: solved.roles,
    adjustments: solved.adjustments,
    pairs: solved.pairs,
  };
}

/** Swatches -> the eight roles -> solveContrast. Empty or unusable input gives the neutral set. */
export function proposeRoles(swatches: readonly Swatch[]): MoodboardProposal {
  const list = Array.isArray(swatches) ? swatches : [];
  const copy = list.map((s) => ({ hex: s.hex, weight: s.weight }));
  const all = entries(list);
  if (all.length === 0) return neutralProposal(copy);

  const chromatic = all.filter((e) => e.o.c >= CHROMA_NEUTRAL);

  // 1-2. primary: heaviest chromatic swatch in the usable lightness band, else the top
  // (chromatic if any) swatch shifted into the band.
  const inBand = chromatic.find(
    (e) => e.o.l >= PRIMARY_L_MIN && e.o.l <= PRIMARY_L_MAX,
  );
  const primarySrc = inBand ?? chromatic[0] ?? all[0]!;
  const primaryO: Oklch = inBand
    ? primarySrc.o
    : {
        ...primarySrc.o,
        l: clamp(primarySrc.o.l, PRIMARY_L_MIN + 0.1, PRIMARY_L_MAX - 0.1),
      };
  const tinted = primaryO.c >= CHROMA_NEUTRAL;
  const h = primaryO.h;

  // 3. accent: the next chromatic swatch at least 40 degrees away, else a complementary tint.
  const accentSrc = chromatic.find(
    (e) => e !== primarySrc && hueDistance(e.o.h, h) >= ACCENT_MIN_HUE_DISTANCE,
  );
  const accentO: Oklch = accentSrc
    ? accentSrc.o
    : {
        l: 0.6,
        c: tinted ? clamp(primaryO.c, 0.08, 0.15) : 0.1,
        h: (h + 180) % 360,
      };

  // 4-8. surfaces, text and border, tinted with primary's hue.
  const tint = tinted ? 0.01 : 0;
  const lightest = [...all]
    .filter((e) => e.o.l > 0.9)
    .sort((x, y) => y.o.l - x.o.l || (x.hex < y.hex ? -1 : 1))[0];
  const surfaceO: Oklch = lightest ? lightest.o : { l: 0.98, c: tint, h };
  const raisedO: Oklch = { ...surfaceO, l: clamp(surfaceO.l - 0.03, 0, 1) };
  const textO: Oklch = { l: 0.22, c: tinted ? 0.02 : 0, h };
  const mutedO: Oklch = { l: textO.l + 0.25, c: textO.c, h };
  const borderO: Oklch = { l: (surfaceO.l + mutedO.l) / 2, c: tint, h };

  const surface = oklchToHex(surfaceO);
  const primary = oklchToHex(primaryO);
  // 9. primary-contrast: white or surface, whichever reads better on primary.
  const primaryContrast =
    contrastRatio(WHITE, primary) > contrastRatio(surface, primary)
      ? WHITE
      : surface;

  // 10. the one solver.
  const solved = solveContrast({
    surface,
    "surface-raised": oklchToHex(raisedO),
    text: oklchToHex(textO),
    "text-muted": oklchToHex(mutedO),
    primary,
    "primary-contrast": primaryContrast,
    accent: oklchToHex(accentO),
    border: oklchToHex(borderO),
  });
  return {
    swatches: copy,
    roles: solved.roles,
    adjustments: solved.adjustments,
    pairs: solved.pairs,
  };
}

/**
 * A render-only design for the mood board preview card (designToCssVars input). Sizes,
 * radii and shadow come from the neutral preset; faces come from the pairing, System Sans
 * for "Let CDS choose". The sourceHash is fixed so the preview never collides with a real
 * tenant hash scope.
 */
export function proposalToPreviewDesign(
  p: MoodboardProposal,
  pairingId: string,
  name: string,
): PublicDesign {
  const pairing = findPairing(pairingId);
  return {
    schemaVersion: 2,
    name: typeof name === "string" && name.trim() ? name.trim() : "Preview",
    roles: { ...p.roles },
    typography: {
      ...NEUTRAL_DESIGN.typography,
      headingFamily: pairing.heading ?? "System Sans",
      bodyFamily: pairing.body ?? "System Sans",
    },
    rounded: { ...NEUTRAL_DESIGN.rounded },
    shadows: { ...NEUTRAL_DESIGN.shadows },
    sourceHash: "f".repeat(64),
  };
}
