// Business hours block (owner 07-07; CONT-27, D257).
//
// Data-bound: the content holds options only. The hours, time zone and "Open now" state are
// read live from the org's public business projection (coreData.business, 07-07's
// core-block-data.ts), so the block never goes stale when the owner edits their hours.
// Renderer and editor: 07-24.
// Deny by default: only the two option keys survive.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, text } from "../validate-helpers";

export type HoursBlockContent = {
  heading: string;
  show_open_now: boolean;
};

export const HOURS_HEADING_MAX = 120;

export function defaultHoursBlock(): HoursBlockContent {
  return { heading: "Opening hours", show_open_now: true };
}

export function validateHoursBlock(value: unknown): HoursBlockContent {
  const raw = asRecord(value);
  const v = own(raw, "show_open_now");
  return {
    heading: text(raw, "heading", HOURS_HEADING_MAX),
    show_open_now: typeof v === "boolean" ? v : true,
  };
}

export const hoursSection: SectionTypeDefinition = {
  type: "hours",
  label: "Business hours",
  description: "Your opening hours, with 'Open now'",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultHoursBlock(),
  validate: (raw) => validateHoursBlock(raw),
  mapRichText: (content) => (isRecord(content) ? { ...content } : content),
  textsOf: (content) =>
    isRecord(content) &&
    typeof content.heading === "string" &&
    content.heading !== ""
      ? [content.heading]
      : [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
