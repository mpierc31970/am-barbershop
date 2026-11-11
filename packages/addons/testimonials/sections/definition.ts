// The Testimonials block (ADDON-02, ADDON-08; D36, D253; invariants 5 and 6; T-05-35).
// Pure. The block holds settings only; the testimonials themselves are live data resolved
// at render (server.ts blockData). Full width only: layout belongs to the container.
import { InvalidInput } from "@cds/core";
import {
  FULL_WIDTH_ONLY,
  emptyRefs,
  type SectionTypeDefinition,
} from "@cds/core/content";

export type TestimonialsLayout = "grid" | "single";
export type TestimonialsShow = "all" | "featured";

export type TestimonialsBlockContent = {
  heading: string;
  layout: TestimonialsLayout;
  show: TestimonialsShow;
  limit: number;
};

declare module "@cds/core/content" {
  interface SectionTypeMap {
    testimonials: TestimonialsBlockContent;
  }
}

export const HEADING_MAX = 120;
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 12;
export const LIMIT_DEFAULT = 6;

export function defaultTestimonialsContent(): TestimonialsBlockContent {
  return {
    heading: "What people say",
    layout: "grid",
    show: "all",
    limit: LIMIT_DEFAULT,
  };
}

const own = (o: object, k: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined;

function clampLimit(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.round(v)));
}

export function validateTestimonialsContent(
  raw: unknown,
): TestimonialsBlockContent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput("malformed testimonials block");
  }
  const heading = own(raw, "heading");
  const layout = own(raw, "layout");
  const show = own(raw, "show");
  return {
    heading:
      typeof heading === "string" ? heading.trim().slice(0, HEADING_MAX) : "",
    layout: layout === "single" ? "single" : "grid",
    show: show === "featured" ? "featured" : "all",
    limit: clampLimit(own(raw, "limit")),
  };
}

export const testimonialsSection: SectionTypeDefinition = {
  type: "testimonials",
  label: "Testimonials",
  description: "Quotes from your customers",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultTestimonialsContent(),
  validate: (raw) => validateTestimonialsContent(raw),
  mapRichText: (content) => ({ ...(content as TestimonialsBlockContent) }),
  textsOf: (content) =>
    [(content as TestimonialsBlockContent).heading].filter(
      (t) => typeof t === "string" && t !== "",
    ),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};
