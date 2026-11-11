// P7 training: Nav + footer (owner 07-25; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "site-navigation",
    title: "Site menu",
    requirement: "CONT-13",
    kind: "feature",
    howTo: "docs/how-to/site-navigation.md",
    video: null,
  },
  {
    id: "site-footer",
    title: "Site footer",
    requirement: "CONT-13",
    kind: "feature",
    howTo: "docs/how-to/site-footer.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze([
  "site-navigation",
  "site-footer",
]);
