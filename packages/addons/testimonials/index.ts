// @cds/addon-testimonials: the manifest (ADDON-01, ADDON-02, ADDON-08; D35, D36). Pure and
// client-safe: the registry's "." entry imports this into the builder bundle, so nothing
// here reaches @cds/db, node:* or a React component.
import { defineAddon } from "@cds/core/addons";
import { TESTIMONIALS_CONFIG } from "./addon.config";
import { TESTIMONIALS_COLLECTIONS } from "./collections";
import { TESTIMONIALS_CSV } from "./csv";
import { INSTALL } from "./install";
import { TESTIMONIAL_RECORDS } from "./records";
import {
  defaultTestimonialsContent,
  testimonialsSection,
} from "./sections/definition";
import { TRAINING } from "./training";
import { UNINSTALL } from "./uninstall";

export type {
  TestimonialsBlockContent,
  TestimonialsLayout,
  TestimonialsShow,
} from "./sections/definition";

export default defineAddon({
  slug: TESTIMONIALS_CONFIG.slug,
  name: TESTIMONIALS_CONFIG.name,
  summary: TESTIMONIALS_CONFIG.summary,
  category: TESTIMONIALS_CONFIG.category,
  version: TESTIMONIALS_CONFIG.version,
  order: TESTIMONIALS_CONFIG.order,
  visibility: "public",
  paths: ["standard", "studio", "shop"],
  requires: [],
  conflicts: [],
  nav: {
    placement: "tab",
    item: "website",
    label: "Testimonials",
    icon: "MessageSquareQuote",
  },
  sections: [testimonialsSection],
  collections: TESTIMONIALS_COLLECTIONS,
  records: { testimonials: TESTIMONIAL_RECORDS },
  install: INSTALL,
  uninstall: UNINSTALL,
  training: TRAINING,
  csv: { testimonials: TESTIMONIALS_CSV },
  // Template slot (08-07, CONTEXT A1-Q4): placed by assembly only when already active.
  templateSlots: [
    {
      slot: "proof",
      section_type: "testimonials",
      content: () => defaultTestimonialsContent(),
    },
  ],
  // Privacy policy clause (09-11, AGR-08, D217): read by renderSitePolicy while active. DRAFT.
  privacyClauses: [
    {
      id: "testimonials",
      heading: "Testimonials",
      what: "Names, quotes and optional photos that customers send us or that we add with their permission, shown as reviews on this site.",
      why: "To show visitors what other customers say about our work.",
      howLong:
        "Until we remove the testimonial, or sooner if the person asks us to take it down.",
    },
  ],
  // Intake "People & proof" step (CONTEXT A3-Q5). Intake holds rows on the intake record and
  // never writes this collection (invariant 3). No emails: nothing here sends mail in v1.0.
  intake: {
    records: {
      collection: "testimonials",
      csv: "testimonials",
      label: "Paste or import your testimonials",
      addOneLabel: "Add one by one",
    },
  },
});
