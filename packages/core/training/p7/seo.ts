// P7 training: SEO (owner 07-30; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "seo-and-sharing",
    title: "SEO & sharing",
    requirement: "CONT-14",
    kind: "feature",
    howTo: "docs/how-to/seo-and-sharing.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["seo-and-sharing"]);
