// P7 training: Site-part histories (owner 07-29; CONT-32, CONT-36, D110, D184).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "site-history",
    title: "Site history (menu, footer, banner, settings)",
    requirement: "CONT-36",
    kind: "feature",
    howTo: "docs/how-to/site-history.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["site-history"]);
