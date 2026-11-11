// The organization design contract every theme module codes against (THEME-01..06,
// CONTEXT A1-Q1, D44-D48). `OrganizationDesign` is what `organizations.design` stores;
// `PublicDesign` is the render-only projection a visitor's page may read and never carries
// the authored `source`. Types only: Edge-safe.
import type { Role, RoleMap } from "./roles";

export type { Role, RoleMap } from "./roles";

/** sRGB channels as 0..255 floats (unclamped where noted). */
export type Rgb = { r: number; g: number; b: number };

/** OKLCH: l 0..1, c chroma (>= 0), h degrees in [0, 360). */
export type Oklch = { l: number; c: number; h: number };

/** One measured pair after solving. */
export type PairResult = {
  fg: Role;
  bg: Role;
  ratio: number;
  min: number | null;
  pass: boolean;
};

/** One role the solver moved to meet a pair minimum (reported to the importer). */
export type Adjustment = {
  role: Role;
  from: string;
  to: string;
  fromL: number;
  toL: number;
  reason: string;
  fallback: boolean;
};

export type ThemeTypography = {
  headingFamily: string;
  bodyFamily: string;
  body: string;
  h3: string;
  h2: string;
  display: string;
};

export type ThemeRounded = { button: string; media: string };

export type ThemeShadows = { overlay: string };

export type OrganizationDesign = {
  schemaVersion: 2;
  name: string;
  source: {
    designMd: { frontMatter: Record<string, unknown>; body: string };
    sidecar: Record<string, unknown> | null;
  };
  roles: RoleMap;
  typography: ThemeTypography;
  rounded: ThemeRounded;
  spacing: Record<string, string>;
  shadows: ThemeShadows;
  motion: Record<string, unknown>;
  contrast: { pairs: PairResult[]; adjustments: Adjustment[] };
  importedAt: string;
  /** sha256 of the authored source, 64 lowercase hex. */
  sourceHash: string;
};

/** What a public tenant page may render. Never includes `source`. */
export type PublicDesign = Pick<
  OrganizationDesign,
  | "schemaVersion"
  | "name"
  | "roles"
  | "typography"
  | "rounded"
  | "shadows"
  | "sourceHash"
>;
