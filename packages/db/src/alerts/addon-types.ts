// Add-on alert types (11-50; DASH-34..37, D313). `@cds/addon-registry/server` registers every
// add-on manifest here at load (the same pattern as registerAddonCollections), so raiseAlert
// and the alerts job accept add-on alert types without each caller composing them. Callers
// may still pass `types` (tests do). Until the registry loads, only the core types exist:
// an add-on alert raised then is refused (fail closed, logged), never sent untyped.
import {
  composeAlertTypes,
  type AlertTypeSpec,
  type AlertSource,
} from "@cds/core/alerts";

let registered: readonly AlertTypeSpec[] | null = null;

/** Register the add-on manifests (registry order). Throws on a duplicate type, at load. */
export function registerAddonAlertTypes(
  manifests: readonly AlertSource[],
): void {
  registered = composeAlertTypes(manifests);
}

/** Core types plus the registered add-on types (core only before registration). */
export function registeredAlertTypes(): readonly AlertTypeSpec[] {
  return registered ?? composeAlertTypes([]);
}

/** Tests only: forget the registration. */
export function resetAddonAlertTypesForTests(): void {
  registered = null;
}
