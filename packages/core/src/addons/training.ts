// Training shown in the dashboard: core entries plus only active add-ons' training
// (ADDON-11, invariant 4, D110). Pure and Edge-safe.
import type { TrainingEntry } from "../../training/entries";
import type { AddonRegistry } from "./types";

/** Core first, then each active add-on's training in registry order; unknown slugs are ignored. */
export function trainingForActive(
  core: readonly TrainingEntry[],
  registry: AddonRegistry,
  active: readonly string[],
): TrainingEntry[] {
  const on = new Set(active);
  return [
    ...core,
    ...registry
      .list()
      .filter((m) => on.has(m.slug))
      .flatMap((m) => m.training),
  ];
}
