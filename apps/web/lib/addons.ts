import "@cds/addon-registry/server";
// Add-on dependencies for every @cds/db add-on call from apps/web (ADDON-04, ADDON-05,
// ADDON-07; RESEARCH Pattern 3). The registry's server entry is imported first, for its side
// effect: it registers every add-on collection with @cds/db, so exports and restores fail
// closed without it. One factory wires the composed content deps, the add-on registry and
// the BillingGate (the no-charge stand-in until P10, GO-LIVE). Server-only.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { getBillingGate, type AddonDeps } from "@cds/db";
import { contentDeps } from "./content";

export function addonDeps(): AddonDeps {
  return {
    ...contentDeps(),
    addons: ADDON_REGISTRY,
    billing: getBillingGate(),
  };
}
