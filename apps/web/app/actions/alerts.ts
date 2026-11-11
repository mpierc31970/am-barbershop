"use server";
// Bell actions (11-21; DASH-37; 11-UI-SPEC "Bell"; T-11-21-04). Public POST endpoints:
// arguments are untrusted. The person and org come only from the session (runAction), and
// markAlertRead / markAllRead bind every read and write to (org, actor), so another
// person's alert id is NotFound. Under impersonation both are silent no-ops in @cds/db.
import { markAlertRead, markAllRead } from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";

const ALERT_ID = /^[a-z0-9]{15}$/;

const BAD_ID_COPY = "That alert wasn't found. Reload the page and try again.";

/** Opening a bell row marks it read (the row then navigates to its item). */
export async function markAlertReadAction(
  id: unknown,
): Promise<ActionResult<{ read: true }>> {
  if (typeof id !== "string" || !ALERT_ID.test(id)) {
    return { ok: false, code: "invalid_input", message: BAD_ID_COPY };
  }
  return runAction(async ({ ctx }) => {
    await markAlertRead(ctx, id);
    return { read: true as const };
  });
}

/** Mark all as read: every unread alert of the signed-in person on this site. */
export async function markAllAlertsReadAction(): Promise<
  ActionResult<{ marked: number }>
> {
  return runAction(({ ctx }) => markAllRead(ctx));
}
