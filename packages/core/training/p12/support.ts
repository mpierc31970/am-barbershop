// P12 training: CDS Support (owner 12-33; SUPPORT-01, COMM-01..12, CUSTOM-01, D110).
//
// Feature entries only; ids double as the help ids the Support screens use
// (`support.messages`, `support.follow-ticket`, …; apps/web/lib/help-index.ts resolves a
// dotted id that is a core training id to itself). The `support` entry itself stays in
// p11/pages.ts (its how-to, docs/how-to/cds-support.md, was rewritten for P12). Staff
// procedures (docs/how-to/support-staff-clis.md) never get an entry here (T-12-33-01).
// Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "support.messages",
    title: "Messages with CDS",
    requirement: "COMM-01",
    kind: "feature",
    howTo: "docs/how-to/messages-with-cds.md",
    video: null,
  },
  {
    id: "support.get-help",
    title: "Get help (file a ticket)",
    requirement: "COMM-06",
    kind: "feature",
    howTo: "docs/how-to/get-help.md",
    video: null,
  },
  {
    id: "support.follow-ticket",
    title: "Follow a ticket",
    requirement: "COMM-09",
    kind: "feature",
    howTo: "docs/how-to/follow-a-ticket.md",
    video: null,
  },
  {
    id: "support.documents",
    title: "Documents from CDS",
    requirement: "COMM-04",
    kind: "feature",
    howTo: "docs/how-to/documents-from-cds.md",
    video: null,
  },
  {
    id: "support.ideas",
    title: "Suggest a feature",
    requirement: "CUSTOM-01",
    kind: "feature",
    howTo: "docs/how-to/suggest-a-feature.md",
    video: null,
  },
  {
    id: "service-notices",
    title: "Service notices and locked pages",
    requirement: "COMM-11",
    kind: "feature",
    howTo: "docs/how-to/service-notices-and-locked-pages.md",
    video: null,
  },
  {
    id: "paid-services",
    title: "Paid services and your Care hour",
    requirement: "SUPPORT-03",
    kind: "feature",
    howTo: "docs/how-to/paid-services-and-care-hour.md",
    video: null,
  },
  {
    id: "what-support-includes",
    title: "What support includes",
    requirement: "SUPPORT-01",
    kind: "feature",
    howTo: "docs/how-to/what-support-includes.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze([
  "support.messages",
  "support.get-help",
  "support.follow-ticket",
  "support.documents",
  "support.ideas",
  "service-notices",
  "paid-services",
  "what-support-includes",
]);
