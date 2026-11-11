// @cds/core/addons: the add-on contract (ADDON-01, ADDON-02, ADDON-07, ADDON-09, ADDON-15;
// D35, D264; invariants 4 and 5). Manifest types, defineAddon, typed errors, constants and
// composeAddonRegistry. Pure and Edge-safe: no node:*, no @cds/db. Never re-exported from
// the @cds/core root.
export * from "./constants";
export * from "./errors";
export type * from "./types";
export {
  defineAddon,
  assertManifestShape,
  privacyClauseProblem,
} from "./define";
export { composeAddonRegistry } from "./compose";
export { trainingForActive } from "./training";
