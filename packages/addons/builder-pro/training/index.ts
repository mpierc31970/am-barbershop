// Builder Pro training (BILL-14, D110; invariant 4: an add-on is not complete until someone
// can be taught to use it). The steps live in the how-tos; addons:gen bakes their Use tables.
// 10-42: the Pro table gets its own entry (its recording script is a video of its own).
import type { TrainingEntry } from "@cds/core/training";

export const TRAINING: readonly TrainingEntry[] = [
  {
    id: "addon-builder-pro",
    title: "How Builder Pro works",
    requirement: "BILL-14",
    kind: "feature",
    howTo: "docs/how-to/addon-builder-pro.md",
    video: null,
  },
  {
    id: "addon-builder-pro-table",
    title: "Use the Pro table",
    requirement: "BILL-14",
    kind: "feature",
    howTo: "docs/how-to/pro-table.md",
    video: null,
  },
];
