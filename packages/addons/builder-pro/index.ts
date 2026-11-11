// @cds/addon-builder-pro: the manifest (BILL-14, D233, D234; 10-07). Manifest-only: no
// collections, no records, no block, no page and no hub screen (nav.placement "none"), so
// adding it is an entitlement grant and nothing else (invariant 3: no migrations folder).
// Removing it or a billing lapse disables the Pro features; everything the owner set up is
// kept (invariant 9). Pure and client-safe.
import { defineAddon } from "@cds/core/addons";
import { BUILDER_PRO_CONFIG } from "./addon.config";
import { TRAINING } from "./training";

export default defineAddon({
  slug: BUILDER_PRO_CONFIG.slug,
  name: BUILDER_PRO_CONFIG.name,
  summary: BUILDER_PRO_CONFIG.summary,
  category: BUILDER_PRO_CONFIG.category,
  version: BUILDER_PRO_CONFIG.version,
  order: BUILDER_PRO_CONFIG.order,
  visibility: "public",
  paths: ["standard", "studio"],
  requires: [],
  conflicts: [],
  nav: {
    placement: "none",
    label: "Builder Pro",
    icon: "ListChecks",
    unlocks: "Pro features in Forms",
  },
  sections: [],
  collections: {},
  records: {},
  install: {},
  uninstall: { retain: "all" },
  training: TRAINING,
});
