// P8 training: Services and Our team blocks (owner 08-04; TMPL-01, CONT-32, D110).
//
// Spread into CORE_TRAINING by 08-05 with the block registration: until `services` and
// `team` are in CORE_SECTIONS, these block entries would break "exactly one entry per
// block". Block entries use the section type id. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  Object.freeze({
    id: "services",
    title: "Services block",
    requirement: "TMPL-01",
    kind: "block",
    howTo: "docs/how-to/block-services.md",
    video: null,
  }),
  Object.freeze({
    id: "team",
    title: "Our team block",
    requirement: "TMPL-01",
    kind: "block",
    howTo: "docs/how-to/block-team.md",
    video: null,
  }),
] satisfies TrainingEntry[]);

export const features: readonly string[] = Object.freeze([]);
