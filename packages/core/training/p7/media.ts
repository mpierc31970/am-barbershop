// P7 training: Media library (owner 07-17; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "media-library",
    title: "Media library",
    requirement: "CONT-21",
    kind: "feature",
    howTo: "docs/how-to/media-library.md",
    video: null,
  },
  {
    id: "video-upload",
    title: "Video upload",
    requirement: "CONT-18",
    kind: "feature",
    howTo: "docs/how-to/video-upload.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze([
  "media-library",
  "video-upload",
]);
