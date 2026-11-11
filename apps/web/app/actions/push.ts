"use server";
// Push actions (11-22; DASH-34, DASH-36; T-11-22-03). Public POST endpoints: arguments are
// untrusted. The person and org come only from the session (runAction).
// - savePushSubscriptionAction: the browser's PushSubscription JSON. Shape-checked here
//   (validatePushSubscription: https endpoint ≤ 1024, no IP/local host, P-256 key, 16-byte
//   auth) and again by savePushSubscription, which also refuses impersonation.
// - removePushDeviceAction: one of the caller's own devices (another person's id → NotFound).
// - dismissPhoneAlertsAction: "Not now" on the Today card, saved per person (seen flag
//   `phone_alerts`); a silent no-op under impersonation (the card is absent there anyway).
import { ImpersonationDenied } from "@cds/core";
import {
  markSeen,
  removePushSubscription,
  savePushSubscription,
  validatePushSubscription,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";

/** Seen flag for the Today card (a "use server" file exports async functions only). */
const PHONE_ALERTS_FLAG = "phone_alerts";

const ERR_PUSH = "We couldn't turn on alerts just now. Try again in a minute.";
const DEVICE_ID = /^[a-z0-9]{15}$/;

export async function savePushSubscriptionAction(
  sub: unknown,
): Promise<ActionResult<{ id: string }>> {
  let clean: ReturnType<typeof validatePushSubscription>;
  try {
    clean = validatePushSubscription(sub);
  } catch {
    return { ok: false, code: "invalid_input", message: ERR_PUSH };
  }
  return runAction(async ({ ctx }) => {
    if (ctx.impersonator) {
      throw new ImpersonationDenied("staff cannot turn on alerts for a member");
    }
    return savePushSubscription(ctx, {
      endpoint: clean.endpoint,
      keys: { p256dh: clean.p256dh, auth: clean.auth },
      uaFamily: clean.uaFamily,
    });
  });
}

export async function removePushDeviceAction(
  id: unknown,
): Promise<ActionResult<{ removed: true }>> {
  if (typeof id !== "string" || !DEVICE_ID.test(id)) {
    return {
      ok: false,
      code: "invalid_input",
      message: "That device wasn't found. Reload the page and try again.",
    };
  }
  return runAction(async ({ ctx }) => {
    await removePushSubscription(ctx, id);
    return { removed: true as const };
  });
}

export async function dismissPhoneAlertsAction(): Promise<
  ActionResult<{ dismissed: boolean }>
> {
  return runAction(async ({ ctx }) => {
    if (ctx.impersonator) return { dismissed: false };
    await markSeen(ctx, PHONE_ALERTS_FLAG);
    return { dismissed: true };
  });
}
