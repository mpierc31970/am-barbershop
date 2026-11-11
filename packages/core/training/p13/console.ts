// P13 training: the tenant side of the staff console (owner 13-50; STAFF-21, STAFF-22, D110).
//
// Feature entries only, for the two P13 screens an org member touches: rating a resolved
// ticket (hub ticket page and the email link) and the hosting-rules notice / suspension strip
// with its emails. Every role may read both, so this module exports no ownerOnly /
// ownerAdminOnly list. Staff console how-tos (route /staff…, baked into STAFF_HELP) and the
// public /report how-to (visitors are not hub users) never get an entry here (T-13-50-01).
// Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "support.rating",
    title: "Rate a resolved ticket",
    requirement: "STAFF-21",
    kind: "feature",
    howTo: "docs/how-to/rate-a-resolved-ticket.md",
    video: null,
  },
  {
    id: "site-suspension",
    title: "Content notices and suspension",
    requirement: "STAFF-22",
    kind: "feature",
    howTo: "docs/how-to/content-notices-and-suspension.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze([
  "support.rating",
  "site-suspension",
]);
