// Services block (owner 08-04; TMPL-01, TMPL-02).
//
// P8 (08-04): data-bound core block, CONTEXT A3-Q3, D253; content holds display options
// only; items come live from coreData; registered with its renderer and editor in 08-05.
// The services list is read from the org's published services (coreData.services, 08-08),
// so the block never goes stale and never copies service records into content (D37, D257).
// Deny by default: only the five option keys survive.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, text } from "../validate-helpers";

export const SERVICES_DISPLAYS = ["list", "cards"] as const;
export type ServicesDisplay = (typeof SERVICES_DISPLAYS)[number];

/** How many services to show; 0 = All. */
export const SERVICES_LIMITS = [0, 3, 6, 9, 12] as const;
export type ServicesLimit = (typeof SERVICES_LIMITS)[number];

export type ServicesBlockContent = {
  heading: string;
  display: ServicesDisplay;
  limit: ServicesLimit;
  show_descriptions: boolean;
  show_durations: boolean;
};

export const SERVICES_HEADING_MAX = 120;

export function defaultServicesBlock(): ServicesBlockContent {
  return {
    heading: "Services",
    display: "cards",
    limit: 0,
    show_descriptions: true,
    show_durations: true,
  };
}

function flag(raw: Record<string, unknown>, key: string): boolean {
  const v = own(raw, key);
  return typeof v === "boolean" ? v : true;
}

export function validateServicesBlock(value: unknown): ServicesBlockContent {
  const raw = asRecord(value);
  const d = defaultServicesBlock();
  const display = own(raw, "display");
  const limit = own(raw, "limit");
  return {
    heading:
      typeof own(raw, "heading") === "string"
        ? text(raw, "heading", SERVICES_HEADING_MAX)
        : d.heading,
    display: (SERVICES_DISPLAYS as readonly unknown[]).includes(display)
      ? (display as ServicesDisplay)
      : d.display,
    limit: (SERVICES_LIMITS as readonly unknown[]).includes(limit)
      ? (limit as ServicesLimit)
      : d.limit,
    show_descriptions: flag(raw, "show_descriptions"),
    show_durations: flag(raw, "show_durations"),
  };
}

export const servicesSection: SectionTypeDefinition = {
  type: "services",
  label: "Services",
  description: "Your services and prices, always up to date",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultServicesBlock(),
  validate: (raw) => validateServicesBlock(raw),
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
