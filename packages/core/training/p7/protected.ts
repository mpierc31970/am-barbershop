// P7 training: Protected pages + 404 (owner 07-32; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "password-pages",
    title: "Password pages",
    requirement: "CONT-28",
    kind: "feature",
    howTo: "docs/how-to/password-pages.md",
    video: null,
  },
  {
    id: "page-not-found",
    title: "Page not found",
    requirement: "CONT-28",
    kind: "feature",
    howTo: "docs/how-to/page-not-found.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze([
  "password-pages",
  "page-not-found",
]);
