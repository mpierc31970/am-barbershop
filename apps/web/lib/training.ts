// Training for the signed-in org (ADDON-11, D87, D110; CONTEXT A4-Q4). Core entries plus
// only the org's active add-ons' training, so a removed add-on's how-to is unreachable.
// Server-only: reads the org's add-on state through @cds/db. Client drawers receive steps
// as plain data, never this module.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { trainingForActive } from "@cds/core/addons";
import { CORE_TRAINING, type TrainingEntry } from "@cds/core/training";
import { activeAddons, type OrgContext } from "@cds/db";

export async function getTrainingFor(
  ctx: OrgContext,
): Promise<TrainingEntry[]> {
  return trainingForActive(
    CORE_TRAINING,
    ADDON_REGISTRY,
    await activeAddons(ctx),
  );
}
