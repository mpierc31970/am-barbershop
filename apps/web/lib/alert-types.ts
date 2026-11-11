// Alert types one person may choose channels for (11-24; DASH-36, D285, D313; T-11-24-01).
// Core types plus the alert types of the org's active, unpaused add-ons, composed in registry order,
// then filtered by the person's role and grants (eligibleFor: billing Owner only, Viewers
// Summary only). The Profile lists exactly these, and the profile actions refuse any other
// type. Delivery re-checks eligibility at raise time (raiseAlert), so a stale choice never
// widens what reaches someone.
// Server-only: reads the org's active add-ons.
import { ADDON_REGISTRY } from "@cds/addon-registry";
import {
  composeAlertTypes,
  eligibleFor,
  type AlertTypeSpec,
} from "@cds/core/alerts";
import { activeAddons, pausedAddons, type OrgContext } from "@cds/db";

export async function alertTypesFor(
  ctx: OrgContext,
): Promise<readonly AlertTypeSpec[]> {
  let active: readonly string[] = [];
  let paused: readonly string[] = [];
  try {
    [active, paused] = await Promise.all([
      activeAddons(ctx),
      pausedAddons(ctx),
    ]);
  } catch {
    // An outage reading add-ons leaves the core types; add-on rows come back next load.
    active = [];
  }
  // Review 11 IN-C03: a paused add-on (billing lapse, invariant 9) raises nothing, so its
  // types are not offered, matching activeTodayDeps.
  const manifests = ADDON_REGISTRY.list().filter(
    (m) => active.includes(m.slug) && !paused.includes(m.slug),
  );
  const subject = { role: ctx.role, grants: ctx.grants };
  return composeAlertTypes(manifests).filter((t) => eligibleFor(subject, t));
}
