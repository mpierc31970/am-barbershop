"use server";
// Service notice actions (12-14 choice 4; COMM-11, P12-P10; 12-UI-SPEC line 574). Public POST
// endpoint: the argument is untrusted. The person and org come only from the session
// (runAction). Dismissing a planned-work notice adds `notice:<windowId>` to this person's
// member_prefs.dismissed (the existing list, no new field); activeServiceNotices drops it on
// the next read. Under impersonation it is a silent no-op: CDS staff never write the owner's
// prefs (the strip still hides for this page view).
import { markDismissed } from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

/** A PocketBase record id (service_windows.id). */
const WINDOW_ID = /^[a-z0-9]{1,30}$/;

const BAD_ID_COPY = "That didn't work. Reload the page and try again.";

export async function dismissNoticeAction(
  id: unknown,
): Promise<ActionResult<{ dismissed: boolean }>> {
  if (typeof id !== "string" || !WINDOW_ID.test(id)) {
    return { ok: false, code: "invalid_input", message: BAD_ID_COPY };
  }
  return runAction(async ({ ctx }) => {
    if (ctx.impersonator) return { dismissed: false };
    await markDismissed(ctx, `notice:${id}`);
    try {
      revalidatePath("/hub", "layout");
    } catch (err) {
      console.error(
        "[notices] revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
    return { dismissed: true };
  });
}
