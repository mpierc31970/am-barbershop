// @cds/addon-registry/server (Node): registers every add-on's collections and section owners
// with @cds/db at load and exposes the add-on server modules (ADDON-01, ADDON-03; RESEARCH Pattern 3).
//
// Import it once, for its side effect, before any export, restore or field-doc run:
// exportTenant fails closed until this has loaded. Erasable TypeScript only and no .tsx in
// its import chain: scripts load it under node --experimental-strip-types.
import type { CollectionSpec } from "@cds/core";
import {
  registerAddonAlertTypes,
  registerAddonCollections,
  registerSectionAddonOwners,
} from "@cds/db";
import { SERVER_MODULES } from "./generated/server";
import { ADDON_REGISTRY } from "./index";
import type { AddonServerModule } from "./types";

export type {
  AddonRecordLike,
  AddonSectionRef,
  AddonServerModule,
  AddonServerToday,
  OrgContextLike,
} from "./types";
export { ADDON_REGISTRY };
// 11-08 (DASH-21): Today card / Needs-you providers for active, unpaused add-ons.
export {
  activeTodayProviders,
  assertTodayExports,
  type TodayProvider,
  type TodayServerModules,
} from "./today";

const bySlug: Record<string, Record<string, CollectionSpec>> = {};
for (const m of ADDON_REGISTRY.list()) bySlug[m.slug] = { ...m.collections };
registerAddonCollections(bySlug);
// Every saveSection / undoDeleteSection checks add-on blocks against this lookup, even when
// the caller passes none (A-WR-04: the gate fails closed, it is not opt-in).
registerSectionAddonOwners(ADDON_REGISTRY);
// 11-50: raiseAlert and the alerts job accept add-on alert types (manifest `alerts`).
registerAddonAlertTypes(ADDON_REGISTRY.list());

/** Server module per slug (blockCollections + pure blockData). */
export const ADDON_SERVER: Readonly<Record<string, AddonServerModule>> =
  SERVER_MODULES;
