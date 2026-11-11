// The WCAG AA contrast solver (THEME-05, D47 constraint 1, CONTEXT A3-Q2/Q3, RESEARCH
// Pattern 2). Runs at import time only, never at render (D47 c2).
//
// Order is fixed so the result is deterministic:
//   1. surface and surface-raised are backgrounds and stay put;
//   2. text, text-muted, primary and accent are each solved against all their backgrounds;
//   3. primary-contrast is solved last, against the solved primary;
//   4. only when a two-background foreground has no in-hue solution does surface-raised
//      move toward surface (Pitfall 3), and only after that does a foreground fall back to
//      near-black / near-white (flagged `fallback: true`).
// A value is moved only when it fails its minimum (Pitfall 4). A moved value shifts its OKLCH
// lightness by the smallest amount that reaches min + SOLVER_MARGIN, keeping hue and chroma
// (oklchToHex gamut-maps). Every candidate is measured as its quantized #rrggbb (Pitfall 5).
// Thresholds come only from CONTRAST_PAIRS. All loops have fixed bounds (T-04-10).
// Pure and Edge-safe.
import { InvalidInput } from "../errors";
import { hexToOklch, oklchToHex, parseColor, toHex } from "./color";
import {
  contrastFromLuminance,
  contrastRatio,
  relativeLuminance,
} from "./contrast";
import {
  CONTRAST_PAIRS,
  ENFORCED_PAIRS,
  ROLES,
  SOLVER_MARGIN,
  type ContrastPair,
  type Role,
  type RoleMap,
} from "./roles";
import type { Adjustment, Oklch, PairResult } from "./types";

/** Coarse lightness scan per direction (finds the first passing step). */
const SCAN_STEPS = 100;
/** Binary-search refinement between the last failing and first passing step. */
const REFINE_ITERATIONS = 40;
/** Coarse scan of surface-raised's path toward surface. */
const RAISED_SCAN_STEPS = 25;
/** At most one surface-raised move per foreground, plus one. */
const MAX_RAISED_ROUNDS = 5;

const FOREGROUNDS: readonly Role[] = [
  "text",
  "text-muted",
  "primary",
  "accent",
];
const NEAR_BLACK = "#111111";
const NEAR_WHITE = "#fafafa";

export type SolveResult = {
  roles: RoleMap;
  pairs: PairResult[];
  adjustments: Adjustment[];
};

function pairsFor(fg: Role): readonly ContrastPair[] {
  return ENFORCED_PAIRS.filter((p) => p.fg === fg);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Bounded luminance memo: the searches measure the same hex values many times. */
const LUM_CACHE = new Map<string, number>();
const LUM_CACHE_MAX = 4096;

function lum(hex: string): number {
  let v = LUM_CACHE.get(hex);
  if (v === undefined) {
    v = relativeLuminance(hex);
    if (LUM_CACHE.size >= LUM_CACHE_MAX) LUM_CACHE.clear();
    LUM_CACHE.set(hex, v);
  }
  return v;
}

function meets(
  fgHex: string,
  pairs: readonly ContrastPair[],
  roles: RoleMap,
  margin: number,
): boolean {
  const fg = lum(fgHex);
  return pairs.every(
    (p) => contrastFromLuminance(fg, lum(roles[p.bg])) >= (p.min ?? 0) + margin,
  );
}

/** The failing pair with the largest shortfall, formatted for the report. */
function worstReason(
  fgHex: string,
  pairs: readonly ContrastPair[],
  roles: RoleMap,
): string {
  let worst: { pair: ContrastPair; ratio: number; gap: number } | null = null;
  for (const pair of pairs) {
    const ratio = contrastRatio(fgHex, roles[pair.bg]);
    const gap = ratio - (pair.min ?? 0);
    if (worst === null || gap < worst.gap) worst = { pair, ratio, gap };
  }
  if (!worst) return "";
  return `${worst.pair.fg} on ${worst.pair.bg} ${worst.ratio.toFixed(2)} < ${(worst.pair.min ?? 0).toFixed(2)}`;
}

type Grid = { dark: string[]; light: string[] };

/** Bounded memo of scan grids; results never depend on it (T-04-10: size capped). */
const GRID_CACHE = new Map<string, Grid>();
const GRID_CACHE_MAX = 64;

function lightnessAt(start: Oklch, sign: 1 | -1, d: number): string {
  return oklchToHex({
    l: Math.min(1, Math.max(0, start.l + sign * d)),
    c: start.c,
    h: start.h,
  });
}

function spanOf(start: Oklch, sign: 1 | -1): number {
  return sign < 0 ? start.l : 1 - start.l;
}

/** The quantized coarse-scan candidates of a colour, in both lightness directions. */
function gridFor(fgHex: string): Grid {
  const cached = GRID_CACHE.get(fgHex);
  if (cached) return cached;
  const start = hexToOklch(fgHex);
  const build = (sign: 1 | -1) => {
    const span = spanOf(start, sign);
    if (!(span > 0)) return [];
    return Array.from({ length: SCAN_STEPS }, (_, i) =>
      lightnessAt(start, sign, (span * (i + 1)) / SCAN_STEPS),
    );
  };
  const grid = { dark: build(-1), light: build(1) };
  if (GRID_CACHE.size >= GRID_CACHE_MAX) GRID_CACHE.clear();
  GRID_CACHE.set(fgHex, grid);
  return grid;
}

/**
 * Smallest lightness step in one direction whose quantized hex meets every pair at
 * min + margin, or null. The coarse scan finds the first passing step (the predicate is not
 * monotone with two backgrounds); the refinement keeps `hi` always passing.
 */
function searchDirection(
  fgHex: string,
  sign: 1 | -1,
  pairs: readonly ContrastPair[],
  roles: RoleMap,
  margin: number,
): { hex: string; dL: number } | null {
  const start = hexToOklch(fgHex);
  const span = spanOf(start, sign);
  const candidates = sign < 0 ? gridFor(fgHex).dark : gridFor(fgHex).light;
  const first = candidates.findIndex((hex) => meets(hex, pairs, roles, margin));
  if (first < 0) return null;
  let lo = (span * first) / SCAN_STEPS;
  let hi = (span * (first + 1)) / SCAN_STEPS;
  let best = candidates[first] ?? "";
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const hex = lightnessAt(start, sign, mid);
    if (meets(hex, pairs, roles, margin)) {
      hi = mid;
      best = hex;
    } else lo = mid;
  }
  return { hex: best, dL: hi };
}

/** In-hue solution for a failing foreground: the smaller |deltaL| of the two directions. */
function solveInHue(
  fgHex: string,
  pairs: readonly ContrastPair[],
  roles: RoleMap,
): string | null {
  // Aim for the margin; accept a bare pass only when the margin is out of reach.
  for (const margin of [SOLVER_MARGIN, 0]) {
    const dark = searchDirection(fgHex, -1, pairs, roles, margin);
    const light = searchDirection(fgHex, 1, pairs, roles, margin);
    const best =
      dark && light ? (light.dL < dark.dL ? light : dark) : (dark ?? light);
    if (best) return best.hex;
  }
  return null;
}

/** True when the authored value passes or some coarse in-hue candidate does. */
function feasible(fgHex: string, fg: Role, roles: RoleMap): boolean {
  const pairs = pairsFor(fg);
  if (meets(fgHex, pairs, roles, 0)) return true;
  const grid = gridFor(fgHex);
  return [...grid.dark, ...grid.light].some((hex) =>
    meets(hex, pairs, roles, 0),
  );
}

/**
 * Move surface-raised's lightness toward surface's luminance by the smallest step that makes
 * `fg` solvable in hue (Pitfall 3). Hue and chroma of surface-raised are kept.
 */
function moveRaised(roles: RoleMap, fg: Role, fgHex: string): string | null {
  const raised = hexToOklch(roles["surface-raised"]);
  // Direction by WCAG luminance, not OKLCH L: at equal L two hues can differ in luminance.
  // The path runs to black or white, so it always crosses surface's luminance, where the
  // two backgrounds act as one and a single-background solution exists.
  const darker = lum(roles["surface-raised"]) > lum(roles.surface);
  const span = darker ? -raised.l : 1 - raised.l;
  if (span === 0) return null;
  const at = (t: number) =>
    oklchToHex({
      l: Math.min(1, Math.max(0, raised.l + span * t)),
      c: raised.c,
      h: raised.h,
    });
  const ok = (t: number) =>
    feasible(fgHex, fg, { ...roles, "surface-raised": at(t) });

  let lo = 0;
  let hi = -1;
  for (let i = 1; i <= RAISED_SCAN_STEPS; i++) {
    const t = i / RAISED_SCAN_STEPS;
    if (ok(t)) {
      hi = t;
      break;
    }
    lo = t;
  }
  if (hi < 0) return null;
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  const hex = at(hi);
  return hex === roles["surface-raised"] ? null : hex;
}

function adjustment(
  role: Role,
  from: string,
  to: string,
  reason: string,
  fallback: boolean,
): Adjustment {
  return {
    role,
    from,
    to,
    fromL: round(hexToOklch(from).l, 4),
    toL: round(hexToOklch(to).l, 4),
    reason,
    fallback,
  };
}

/** Solve one foreground against the current backgrounds; fallback when nothing in hue passes. */
function solveForeground(
  fg: Role,
  authored: string,
  roles: RoleMap,
): { hex: string; adjustment: Adjustment | null } {
  const pairs = pairsFor(fg);
  if (meets(authored, pairs, roles, 0))
    return { hex: authored, adjustment: null };
  const reason = worstReason(authored, pairs, roles);
  const inHue = solveInHue(authored, pairs, roles);
  if (inHue !== null) {
    return {
      hex: inHue,
      adjustment: adjustment(fg, authored, inHue, reason, false),
    };
  }
  const score = (hex: string) =>
    Math.min(
      ...pairs.map((p) => contrastRatio(hex, roles[p.bg]) - (p.min ?? 0)),
    );
  const hex = score(NEAR_WHITE) > score(NEAR_BLACK) ? NEAR_WHITE : NEAR_BLACK;
  return { hex, adjustment: adjustment(fg, authored, hex, reason, true) };
}

function normalize(input: RoleMap): RoleMap {
  const out = {} as RoleMap;
  for (const role of ROLES) {
    const rgb = parseColor(input[role]);
    if (!rgb) throw new InvalidInput(`role ${role} is not a colour`);
    out[role] = toHex(rgb);
  }
  return out;
}

/** One row per CONTRAST_PAIRS entry. `ratio` is rounded for display; `pass` uses the exact ratio. */
export function evaluatePairs(roles: RoleMap): PairResult[] {
  return CONTRAST_PAIRS.map((p) => {
    const ratio = contrastRatio(roles[p.fg], roles[p.bg]);
    return {
      fg: p.fg,
      bg: p.bg,
      ratio: round(ratio, 2),
      min: p.min,
      pass: p.min === null || ratio >= p.min,
    };
  });
}

/** Bring every enforced pair to its minimum. Pure, deterministic, never mutates `input`. */
export function solveContrast(input: RoleMap): SolveResult {
  const authored = normalize(input);
  let roles: RoleMap = { ...authored };
  const adjustments: Adjustment[] = [];

  // Background last resort (Pitfall 3): move surface-raised only while some foreground has
  // no in-hue solution against both backgrounds.
  let raisedReason: string | null = null;
  for (let round = 0; round < MAX_RAISED_ROUNDS; round++) {
    const stuck = FOREGROUNDS.find((fg) => !feasible(authored[fg], fg, roles));
    if (stuck === undefined) break;
    const moved = moveRaised(roles, stuck, authored[stuck]);
    if (moved === null) break;
    raisedReason ??= `${worstReason(authored[stuck], pairsFor(stuck), roles)} (no in-hue solution)`;
    roles = { ...roles, "surface-raised": moved };
  }
  if (raisedReason !== null) {
    adjustments.push(
      adjustment(
        "surface-raised",
        authored["surface-raised"],
        roles["surface-raised"],
        raisedReason,
        false,
      ),
    );
  }

  for (const fg of FOREGROUNDS) {
    const solved = solveForeground(fg, authored[fg], roles);
    roles = { ...roles, [fg]: solved.hex };
    if (solved.adjustment) adjustments.push(solved.adjustment);
  }

  // primary-contrast depends on the solved primary, so it goes last.
  const pc = solveForeground(
    "primary-contrast",
    authored["primary-contrast"],
    roles,
  );
  roles = { ...roles, "primary-contrast": pc.hex };
  if (pc.adjustment) adjustments.push(pc.adjustment);

  return { roles, pairs: evaluatePairs(roles), adjustments };
}
