// @cds/addon-registry (pure, client-safe entry): the one path from platform code to add-ons
// (ADDON-01, ADDON-10; invariants 4 and 5; RESEARCH Pattern 1, Pitfall 1).
//
// Composes the codegen'd manifests (npm run addons:gen) into ADDON_REGISTRY. Only pure
// manifests and baked how-to steps are imported here, so lib/section-registry.ts and the
// "use client" builder can import this entry. No @cds/db, no node:*, no server modules.
import { composeAddonRegistry, type AddonRegistry } from "@cds/core/addons";
import type { SectionTypeDefinition } from "@cds/core/content";
import { HOWTO_STEPS, RUNBOOKS, type HowToStep } from "./generated/howto";
import { MANIFESTS } from "./generated/manifests";

export type { HowToStep } from "./generated/howto";

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

const NO_STEPS: readonly HowToStep[] = Object.freeze([]);

/** Every add-on, composed and checked at load (a bad manifest throws naming its slug). */
export const ADDON_REGISTRY: AddonRegistry = composeAddonRegistry(MANIFESTS, {
  fileExists: (p) => hasOwn(HOWTO_STEPS, p) || RUNBOOKS.includes(p),
});

/** Every add-on section type, for composeSectionRegistry(CORE_SECTIONS, ADDON_SECTIONS). */
export const ADDON_SECTIONS: readonly SectionTypeDefinition[] =
  ADDON_REGISTRY.sections();

/** The baked "Use" steps of an add-on how-to (Pitfall 10); empty when unknown. */
export function howToSteps(path: string): readonly HowToStep[] {
  if (typeof path !== "string" || !hasOwn(HOWTO_STEPS, path)) return NO_STEPS;
  return HOWTO_STEPS[path]!;
}
