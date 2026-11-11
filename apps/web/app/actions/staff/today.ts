"use server";
// Today and Find actions (13-47 choices 2, 4; STAFF-20; T-13-47-01, T-13-47-02). Public POST
// endpoints: the query is untrusted (trimmed, capped at 100 in staffFind; pb.filter bindings in
// every read). runStaffAction re-reads the staff session (signed out -> session_ended) and the
// matrix (`console`) before the @cds/db call, which checks it again. Errors are logged by
// class name only; the query text is never logged.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { staffFind, staffTodayCounts, type StaffTodayBadges } from "@cds/db";
import type { StaffFindEntry, StaffFindTicket } from "@cds/ui/staff";
import { runStaffAction, type ActionResult } from "../../../lib/staff-action";

/** Body cap before staffFind trims to 100. */
const MAX_QUERY = 200;

export type StaffFindHit = StaffFindTicket | StaffFindEntry;

/**
 * Ctrl K: tickets (an exact number first), then Sites and Cases entries found for the query.
 * Screens are filtered client-side from STAFF_SECTIONS.
 */
export async function findAction(
  q: unknown,
): Promise<ActionResult<StaffFindHit[]>> {
  const text = typeof q === "string" ? q.slice(0, MAX_QUERY) : "";
  return runStaffAction("console", {}, async (ctx) => {
    if (!text.trim()) return [];
    const res = await staffFind(ctx, text);
    return [...res.tickets, ...res.sites, ...res.cases];
  });
}

/** The sidebar badges, re-read every 60 s and on focus (D-UI-P13-20). */
export async function todayBadgesAction(): Promise<
  ActionResult<StaffTodayBadges>
> {
  return runStaffAction("console", {}, async (ctx) => {
    const counts = await staffTodayCounts(ctx, {
      manifests: ADDON_REGISTRY.list(),
    });
    return counts.badges;
  });
}
