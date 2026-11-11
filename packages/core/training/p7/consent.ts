// P7 training: Consent + pop-ups (owner 07-14; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "cookie-consent",
    title: "Cookie notice and click-to-load media",
    requirement: "CONT-34",
    kind: "feature",
    howTo: "docs/how-to/cookie-consent.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["cookie-consent"]);
