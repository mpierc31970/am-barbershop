"use server";
// Launch review actions (14-34 choice 4; DOM-10, D172, D26; 14-UI-SPEC "Launch review";
// T-14-34-03). Public POST endpoints (Next server actions: POST, origin-checked) that take no
// arguments: the org and the person come only from the session (runAction), never the browser.
// Each calls the 14-33 @cds/db function, which checks `launch_review:write` (Owner only) and
// refuses staff impersonating through IMPERSONATION_DENY; those refusals map to the owner-only
// and IMPERSONATING copy here. Ready to launch's DomainNotReady keeps its own code and the
// DOMAIN-NOT-READY words; the other refusals ("Finish N more item(s) above.", FACTS-EMAIL,
// "Your site isn't ready for review yet.") are InvalidInput, shown as written.
import { P14_COPY } from "@cds/core/dns";
import {
  DomainNotReady,
  markKeyFacts,
  markPhoneCheck,
  submitLaunchReview,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const COPY = {
  forbidden: "Only the owner can approve the launch.",
  impersonation:
    "You're viewing as support staff, so this is turned off. Only the owner can approve the launch.",
};

function revalidate(): void {
  for (const path of ["/hub/review", "/hub/today"]) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.error(
        "[launch-review] revalidate failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
  }
}

/** Key facts: "Confirm these details" (blocked by an unconfirmed email, FACTS-EMAIL). */
export async function confirmKeyFactsAction(): Promise<ActionResult<null>> {
  const res = await runAction(async ({ ctx }) => {
    await markKeyFacts(ctx);
    return null;
  }, COPY);
  if (res.ok) revalidate();
  return res;
}

/** Phone check: "I checked it on my phone". */
export async function phoneCheckedAction(): Promise<ActionResult<null>> {
  const res = await runAction(async ({ ctx }) => {
    await markPhoneCheck(ctx);
    return null;
  }, COPY);
  if (res.ok) revalidate();
  return res;
}

/** Ready to launch: all six items and a prepared domain (D26: CDS then gives it a final look). */
export async function submitLaunchReviewAction(): Promise<
  ActionResult<{ submittedAt: string }>
> {
  let notReady = false;
  const res = await runAction(async ({ ctx }) => {
    try {
      const out = await submitLaunchReview(ctx);
      return { submittedAt: out.submittedAt };
    } catch (err) {
      if (err instanceof DomainNotReady) notReady = true;
      throw err;
    }
  }, COPY);
  if (notReady) {
    return {
      ok: false,
      code: "domain_not_ready",
      message: P14_COPY.DOMAIN_NOT_READY,
    };
  }
  if (res.ok) revalidate();
  return res;
}
