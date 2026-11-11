// Staff-facing slot words (D-UI-P8-27; UI-SPEC "Slot labels"). One source for the build
// report email, the CLI and the P13 console.
import type { SlotSource } from "./types";

export const SLOT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  hero: "Hero",
  intro: "Intro",
  services: "Services",
  proof: "Proof",
  "hours-location": "Hours and map",
  contact: "Contact",
  "closing-cta": "Call to action",
  about: "About text",
  team: "Team",
  gallery: "Gallery",
  faq: "Questions and answers",
});

export const SOURCE_WORDS: Readonly<Record<SlotSource, string>> = Object.freeze(
  {
    provided: "Filled",
    fallback: "Default used",
    omitted: "Left out",
  },
);

/** The staff label for a slot name; an unknown name is shown as is. */
export function slotLabel(name: string): string {
  return Object.hasOwn(SLOT_LABELS, name) ? SLOT_LABELS[name]! : name;
}

/**
 * The one photo polish line (CONTEXT A4-Q2): asset ids placed without a reviewed
 * description, deduped by id across pages. Null when there are none.
 */
export function photoPolishLine(ids: Iterable<string>): string | null {
  const n = new Set(ids).size;
  return n === 0 ? null : `Photos · ${n} need a reviewed description`;
}
