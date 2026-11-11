"use server";
// Ratings & SLA action (13-42 choice 4; STAFF-21, D212, P13-P32). A public POST endpoint: the
// argument is untrusted. Thin caller of @cds/db staffMarkRatingFollowedUp (stamps
// `rating_followed_at`, audited `support.rating_followed_up` with the organization; a second
// mark is a no-op). Gated on `support_reply`, the key the db function authorizes (both staff
// roles), no step-up. Errors are logged by class name only.
import { parseTicketNumber } from "@cds/core/support";
import { staffMarkRatingFollowedUp } from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

const FEATURE = "support_reply";

export type FollowedUpActionResult = {
  number: number;
  message: string;
  changed: boolean;
};

function refresh(): void {
  for (const path of ["/staff/tickets", "/staff"]) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.error("[staff ratings] revalidate failed", errorName(err));
    }
  }
}

/** Mark a thumbs-down "Followed up" (clears it from the list and Today). */
export async function markRatingFollowedUpAction(
  number: unknown,
): Promise<ActionResult<FollowedUpActionResult>> {
  let n: number;
  try {
    n = parseTicketNumber(number);
  } catch {
    return {
      ok: false,
      code: "not_found",
      message: "That ticket wasn't found.",
    };
  }
  const result = await runStaffAction(FEATURE, {}, async (ctx) => {
    const r = await staffMarkRatingFollowedUp(ctx, n);
    return {
      number: r.number,
      changed: r.changed,
      message: `#${r.number} marked followed up.`,
    };
  });
  if (result.ok) refresh();
  return result;
}
