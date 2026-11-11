// Testimonials training (ADDON-10, D110; invariant 4: an add-on is not complete until someone
// can be taught to use it). The steps live in the how-to; addons:gen bakes its Use table.
import type { TrainingEntry } from "@cds/core/training";

export const TRAINING: readonly TrainingEntry[] = [
  {
    id: "addon-testimonials",
    title: "How Testimonials works",
    requirement: "ADDON-08",
    kind: "feature",
    howTo: "docs/how-to/addon-testimonials.md",
    video: null,
  },
];
