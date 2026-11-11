// The owner-labelled font pairings for the intake mood board (CONTEXT A4-Q4, UI-SPEC
// "Font pairing cards"). Data only: every named face must exist in the P4 FONT_CATALOG
// (pairings.test.ts checks it). "Let CDS choose" carries nulls, meaning CDS picks later and
// the preview renders in System Sans. Pure and Edge-safe.

export type FontPairing = {
  id: string;
  label: string;
  heading: string | null;
  body: string | null;
  helper?: string;
};

export const CDS_CHOOSE_PAIRING_ID = "cds-choose";

export const FONT_PAIRINGS: readonly FontPairing[] = [
  {
    id: CDS_CHOOSE_PAIRING_ID,
    label: "Let Support choose",
    heading: null,
    body: null,
    helper: "We'll pick fonts that fit your mood board.",
  },
  {
    id: "warm-classic",
    label: "Warm and classic",
    heading: "Fraunces",
    body: "Source Serif 4",
  },
  {
    id: "calm-bookish",
    label: "Calm and bookish",
    heading: "Newsreader",
    body: "Newsreader",
  },
  {
    id: "bold-clear",
    label: "Bold and clear",
    heading: "Archivo",
    body: "Public Sans",
  },
  {
    id: "friendly-relaxed",
    label: "Friendly and relaxed",
    heading: "Bricolage Grotesque",
    body: "Figtree",
  },
  {
    id: "clean-modern",
    label: "Clean and modern",
    heading: "Instrument Sans",
    body: "Instrument Sans",
  },
  {
    id: "trustworthy-practical",
    label: "Trustworthy and practical",
    heading: "Literata",
    body: "Work Sans",
  },
];

/** The pairing with this id; anything unknown (or not a string) is "Let CDS choose". */
export function findPairing(id: unknown): FontPairing {
  const hit =
    typeof id === "string" ? FONT_PAIRINGS.find((p) => p.id === id) : undefined;
  return hit ?? FONT_PAIRINGS[0]!;
}
