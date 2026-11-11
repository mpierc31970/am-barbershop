// P7 training: Section group A blocks (owner 07-06; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  Object.freeze({
    id: "gallery",
    title: "Gallery block",
    requirement: "CONT-22",
    kind: "block",
    howTo: "docs/how-to/block-gallery.md",
    video: null,
  }),
  Object.freeze({
    id: "slider",
    title: "Slider block",
    requirement: "CONT-23",
    kind: "block",
    howTo: "docs/how-to/block-slider.md",
    video: null,
  }),
  Object.freeze({
    id: "tabs",
    title: "Tabs block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-tabs.md",
    video: null,
  }),
  Object.freeze({
    id: "logo-strip",
    title: "Logo strip block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-logo-strip.md",
    video: null,
  }),
  Object.freeze({
    id: "stats",
    title: "Stats block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-stats.md",
    video: null,
  }),
] satisfies TrainingEntry[]);
export const features: readonly string[] = Object.freeze([]);
