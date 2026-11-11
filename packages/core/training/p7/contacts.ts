// P7 training: Contacts (owner 07-16; CONT-32, D110).
//
// Block entries use the section type id, item entries `item:<kind>`; feature ids also go in
// `features`. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "contacts",
    title: "Contacts",
    requirement: "CONTACTS-01",
    kind: "feature",
    howTo: "docs/how-to/contacts.md",
    video: null,
  },
]);
export const features: readonly string[] = Object.freeze(["contacts"]);
