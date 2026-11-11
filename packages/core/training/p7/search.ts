// P7 training: Index + search (owner 07-31; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "site-search",
    title: "Site search, sitemap and AI files",
    requirement: "CONT-37",
    kind: "feature",
    howTo: "docs/how-to/site-search.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["site-search"]);
