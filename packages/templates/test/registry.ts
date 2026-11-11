// The shared test registry and SlotEnv helper (08-12; TMPL-03, invariant 4). Real core
// section validators plus one local fake add-on section, so slot tests check blocks against
// the real validators without importing an add-on. Real add-on sections are validated again
// by saveSection in 08-16.
import { defineAddon, type AddonManifest } from "@cds/core/addons";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  emptyRefs,
  FULL_WIDTH_ONLY,
  type SectionTypeDefinition,
} from "@cds/core/content";
import { templateCopy, type SlotEnv } from "@cds/core/templates";

declare module "@cds/core/content" {
  interface SectionTypeMap {
    "fake-proof-block": { heading: string };
  }
}

function heading(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "";
  const v = Object.prototype.hasOwnProperty.call(raw, "heading")
    ? (raw as { heading?: unknown }).heading
    : undefined;
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

const fakeProofSection: SectionTypeDefinition = {
  type: "fake-proof-block",
  label: "Proof (fake add-on)",
  description: "Test-only add-on section for template slot tests.",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => ({ heading: "" }),
  validate: (raw) => ({ heading: heading(raw) }),
  mapRichText: (content) => ({ heading: heading(content) }),
  textsOf: (content) => [heading(content)].filter(Boolean),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => emptyRefs(),
};

export const TEST_SECTIONS = composeSectionRegistry(CORE_SECTIONS, [
  fakeProofSection,
]);

export const FAKE_PROOF_MANIFEST: AddonManifest = defineAddon({
  slug: "fake-proof",
  name: "Fake proof",
  summary: "A test-only add-on that fills the proof slot.",
  category: "content",
  version: "1.0.0",
  order: 999,
  visibility: "private",
  paths: ["standard", "studio"],
  requires: [],
  conflicts: [],
  nav: { placement: "tab", item: "website", label: "Proof", icon: "Globe" },
  sections: [fakeProofSection],
  collections: {},
  records: {},
  install: {},
  uninstall: { retain: "all" },
  training: [],
  templateSlots: [
    {
      slot: "proof",
      section_type: "fake-proof-block",
      content: () => ({ heading: "Kind words" }),
    },
  ],
});

/** A SlotEnv for slot tests: home page, nothing placed, no active add-ons. */
export function makeEnv(overrides: Partial<SlotEnv> = {}): SlotEnv {
  return {
    templateId: "test-template",
    pageKey: "home",
    activeAddons: new Set<string>(),
    addons: { list: () => [FAKE_PROOF_MANIFEST] },
    copy: templateCopy,
    refs: { contactFormId: "F1", contactFormItemId: "I1" },
    placed: new Set<string>(),
    ...overrides,
  };
}
