// P7 training: Section group B blocks (owner 07-07; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  Object.freeze({
    id: "faq",
    title: "FAQ block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-faq.md",
    video: null,
  }),
  Object.freeze({
    id: "table",
    title: "Table block",
    requirement: "CONT-26",
    kind: "block",
    howTo: "docs/how-to/block-table.md",
    video: null,
  }),
  Object.freeze({
    id: "icon-list",
    title: "Icon list block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-icon-list.md",
    video: null,
  }),
  Object.freeze({
    id: "hours",
    title: "Business hours block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-hours.md",
    video: null,
  }),
  Object.freeze({
    id: "map",
    title: "Map block",
    requirement: "CONT-24",
    kind: "block",
    howTo: "docs/how-to/block-map.md",
    video: null,
  }),
  Object.freeze({
    id: "social",
    title: "Social and sharing block",
    requirement: "CONT-27",
    kind: "block",
    howTo: "docs/how-to/block-social.md",
    video: null,
  }),
  // 07-24: the picker's Suggested group (five presets, multi-block).
  Object.freeze({
    id: "presets",
    title: "Suggested blocks",
    requirement: "CONT-27",
    kind: "feature",
    howTo: "docs/how-to/block-presets.md",
    video: null,
  }),
] satisfies TrainingEntry[]);
export const features: readonly string[] = Object.freeze(["presets"]);
