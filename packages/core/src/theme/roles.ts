// The one theme role vocabulary and the one contrast pair table (THEME-06, CONTEXT A2-Q1,
// CONTEXT A3-Q1, D-UI-P4-1). Every later theme module (solver, validator, emitter, importer,
// the drift and contrast tests) reads these; nothing else may declare roles or pairs.
// Pure and Edge-safe: no enums, no parameter properties (erasableSyntaxOnly).

/** The eight colour roles a site theme defines. Emitted as `--site-<role>`. */
export const ROLES = [
  "surface",
  "surface-raised",
  "text",
  "text-muted",
  "primary",
  "primary-contrast",
  "accent",
  "border",
] as const;

export type Role = (typeof ROLES)[number];

/** One lowercase `#rrggbb` value per role. */
export type RoleMap = Record<Role, string>;

/** A foreground/background pair and its WCAG minimum; `null` = reported, not enforced. */
export type ContrastPair = { fg: Role; bg: Role; min: number | null };

/** The solver aims this far above each minimum so hex rounding never lands below it. */
export const SOLVER_MARGIN = 0.05;

/**
 * The contrast pair table. Primary pairs are 4.5 (D-UI-P4-1: primary is used as link and
 * button text colour, stricter than CONTEXT A3-Q1's 3:1). Accent is decorative/large, 3.0.
 * Border on surface is reported but not enforced (CONTEXT A3-Q1).
 */
export const CONTRAST_PAIRS = [
  { fg: "text", bg: "surface", min: 4.5 },
  { fg: "text", bg: "surface-raised", min: 4.5 },
  { fg: "text-muted", bg: "surface", min: 4.5 },
  { fg: "text-muted", bg: "surface-raised", min: 4.5 },
  { fg: "primary", bg: "surface", min: 4.5 },
  { fg: "primary", bg: "surface-raised", min: 4.5 },
  { fg: "accent", bg: "surface", min: 3 },
  { fg: "accent", bg: "surface-raised", min: 3 },
  { fg: "primary-contrast", bg: "primary", min: 4.5 },
  { fg: "border", bg: "surface", min: null },
] as const satisfies readonly ContrastPair[];

/** The pairs the solver and validator enforce (every pair with a minimum). */
export const ENFORCED_PAIRS: readonly ContrastPair[] = CONTRAST_PAIRS.filter(
  (p) => p.min !== null,
);

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_SET.has(value);
}
