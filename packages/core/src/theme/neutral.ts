// The neutral preset (UI-SPEC "Theme 0"): the P3 look restated as a theme. Used for any
// organization whose `design` is missing or invalid, and per token by the emitter when one
// stored value fails its grammar. Plain and legible, not CDS-branded (D63). System Sans in
// both roles, so it downloads no font. Must itself pass validateOrganizationDesign (tested).
// Pure and Edge-safe.
import { evaluatePairs } from "./solver";
import type { OrganizationDesign, RoleMap } from "./types";

/** The data-theme attribute for the neutral preset (first 8 of its all-zero sourceHash). */
export const NEUTRAL_HASH = "00000000";

const NEUTRAL_ROLES: RoleMap = {
  surface: "#fbfaf8",
  "surface-raised": "#f1efea",
  text: "#1d1c1a",
  "text-muted": "#5e5a54",
  primary: "#1d1c1a",
  "primary-contrast": "#ffffff",
  accent: "#8a4b2a",
  border: "#d8d4cc",
};

export const NEUTRAL_DESIGN: OrganizationDesign = {
  schemaVersion: 2,
  name: "Neutral",
  source: {
    designMd: { frontMatter: { name: "Neutral" }, body: "" },
    sidecar: null,
  },
  roles: NEUTRAL_ROLES,
  typography: {
    headingFamily: "System Sans",
    bodyFamily: "System Sans",
    body: "18px",
    h3: "24px",
    h2: "36px",
    display: "clamp(2.5rem, 4vw + 1rem, 3.5rem)",
  },
  rounded: { button: "4px", media: "4px" },
  spacing: {},
  shadows: { overlay: "0 16px 48px rgb(0 0 0 / 0.18)" },
  motion: {},
  contrast: { pairs: evaluatePairs(NEUTRAL_ROLES), adjustments: [] },
  importedAt: "1970-01-01T00:00:00.000Z",
  sourceHash: "0".repeat(64),
};
