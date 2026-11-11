"use server";
// First-use tours: seen state (11-48; DASH-17, D208; T-11-48-01, T-11-48-02). Public POST
// endpoint: the argument is untrusted. The person and org come only from the session
// (runAction). Only TOURS ids are written (isTourId). Under impersonation it is a silent
// no-op ({ seen: false }): CDS staff never consume an owner's tours. "Show the tours again"
// (Profile) clears the list with resetToursAction (actions/profile.ts).
import { markTourSeen } from "@cds/db";
import { isTourId } from "@cds/ui/hub/help";
import { runAction, type ActionResult } from "../../lib/action";

const BAD_TOUR_COPY = "That didn't work. Reload the page and try again.";

export async function markTourSeenAction(
  id: unknown,
): Promise<ActionResult<{ seen: boolean }>> {
  if (!isTourId(id)) {
    return { ok: false, code: "invalid_input", message: BAD_TOUR_COPY };
  }
  return runAction(async ({ ctx }) => {
    if (ctx.impersonator || ctx.systemJob || !ctx.actor) return { seen: false };
    // IN-E02: one locked append in @cds/db (two tabs finishing tours never drop an id).
    await markTourSeen(ctx, id);
    return { seen: true };
  });
}
