// TEST-ONLY fixture add-on (CONT-02). Not exported from the content barrel and never
// registered by the app. It proves two things: an add-on can extend SectionTypeMap by
// declaration merging, and composeSectionRegistry accepts its runtime definition.
// Real add-ons (P5) augment "@cds/core/content"; this fixture sits inside the package, so
// it augments the registry module by relative path.
import { FULL_WIDTH_ONLY } from "../layouts";
import { emptyRefs, type SectionTypeDefinition } from "../registry";
import { InvalidInput } from "../../errors";

declare module "../registry" {
  interface SectionTypeMap {
    "fixture-quote": { text: string };
  }
}

function quoteText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput("malformed fixture content");
  }
  const v = Object.prototype.hasOwnProperty.call(raw, "text")
    ? (raw as { text?: unknown }).text
    : undefined;
  return typeof v === "string" ? v.trim().slice(0, 500) : "";
}

export const fixtureAddonSection: SectionTypeDefinition = {
  type: "fixture-quote",
  label: "Quote (fixture)",
  description: "Test-only add-on section type.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => ({ text: "" }),
  validate: (raw) => ({ text: quoteText(raw) }),
  mapRichText: (content) => ({ text: (content as { text: string }).text }),
  textsOf: (content) => [(content as { text: string }).text].filter(Boolean),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};
