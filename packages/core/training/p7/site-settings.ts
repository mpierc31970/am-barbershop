// P7 training: Site settings (owner 07-26; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "site-settings",
    title: "Site settings",
    requirement: "CONT-29",
    kind: "feature",
    howTo: "docs/how-to/site-settings.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["site-settings"]);
