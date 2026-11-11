// P7 training: Column items (owner 07-08; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "item:video",
    title: "Video item",
    requirement: "CONT-17",
    kind: "item",
    howTo: "docs/how-to/item-video.md",
    video: null,
  },
  {
    id: "item:audio",
    title: "Audio item",
    requirement: "CONT-27",
    kind: "item",
    howTo: "docs/how-to/item-audio.md",
    video: null,
  },
  {
    id: "item:form",
    title: "Form item",
    requirement: "CONT-25",
    kind: "item",
    howTo: "docs/how-to/item-form.md",
    video: null,
  },
  {
    id: "item:embed",
    title: "Booking calendar item",
    requirement: "CONT-27",
    kind: "item",
    howTo: "docs/how-to/item-embed.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze([]);
