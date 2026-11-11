// 04-12: an Almanac-like stored design for hub preview tests (THEME-02; 04-UI-SPEC "Theme in
// the hub"). Its sourceHash scopes the emitted rule to data-theme="a1b2c3d4".
import { NEUTRAL_DESIGN, type PublicDesign } from "@cds/core/theme";

export const ALMANAC_HASH = "a1b2c3d4";

export const ALMANAC: PublicDesign = {
  schemaVersion: NEUTRAL_DESIGN.schemaVersion,
  name: "Almanac",
  roles: {
    surface: "#faf6ee",
    "surface-raised": "#f1e9d8",
    text: "#231c14",
    "text-muted": "#5e5243",
    primary: "#7a2e1d",
    "primary-contrast": "#ffffff",
    accent: "#2f5d50",
    border: "#d9ccb4",
  },
  typography: {
    ...NEUTRAL_DESIGN.typography,
    headingFamily: "Fraunces",
    bodyFamily: "Newsreader",
  },
  rounded: { ...NEUTRAL_DESIGN.rounded },
  shadows: { ...NEUTRAL_DESIGN.shadows },
  sourceHash: ALMANAC_HASH.repeat(8),
};
