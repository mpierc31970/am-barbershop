// P8 training: automated site assembly (owner 08-09; TMPL-*, CONT-32, D110).
//
// Wired into CORE_TRAINING by 08-04 so 08-09 fills only this file. Feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "site-assembly",
    title: "Your first site, assembled",
    requirement: "TMPL-04",
    kind: "feature",
    howTo: "docs/how-to/site-assembly.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze(["site-assembly"]);
