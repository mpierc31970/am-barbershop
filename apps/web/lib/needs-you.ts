// The per-request Needs-you list (DASH-20, DASH-27, DASH-37; 11-13 choice 5; RESEARCH
// Pattern 3). React `cache` makes the layout (sidebar / tab badges, bell) and /hub/today
// share one listNeedsYou computation per request. Add-on providers are built here from the
// registry (active and not paused, invariant 4/9) and handed to @cds/db as `deps.today`.
// Server only. No session: an empty list. A failed active/paused read skips every add-on
// provider and reports "addons" in `failed`, so add-on badges are omitted, never wrong.
import {
  ADDON_REGISTRY,
  ADDON_SERVER,
  activeTodayProviders,
} from "@cds/addon-registry/server";
import {
  activeAddons,
  listNeedsYou,
  pausedAddons,
  type NeedsYouAddonProvider,
  type NeedsYouResult,
  type OrgContext,
} from "@cds/db";
import { cache } from "react";
import { getHubSession } from "./session";

const EMPTY: NeedsYouResult = { items: [], failed: [] };

/** The org's add-on Needs-you providers, or null when the add-on state can't be read. */
export async function activeTodayDeps(
  ctx: OrgContext,
): Promise<NeedsYouAddonProvider[] | null> {
  try {
    const [active, paused] = await Promise.all([
      activeAddons(ctx),
      pausedAddons(ctx),
    ]);
    return activeTodayProviders(ADDON_REGISTRY, ADDON_SERVER, active, paused);
  } catch (err) {
    console.error(
      "[needs-you] addons failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

export const getNeedsYou = cache(async (): Promise<NeedsYouResult> => {
  const session = await getHubSession();
  if (!session) return EMPTY;
  const { ctx } = session;
  const today = await activeTodayDeps(ctx);
  const out = await listNeedsYou(ctx, {
    today: today ?? [],
    registry: ADDON_REGISTRY,
    now: new Date(),
  });
  return today ? out : { items: out.items, failed: [...out.failed, "addons"] };
});
