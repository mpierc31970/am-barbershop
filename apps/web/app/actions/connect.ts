"use server";
// Settings › Payments Server Actions (10-25; BILL-06, PAY-03, PAY-10; CONTEXT A1; D285, D296;
// T-10-25-01, T-10-25-02). Public POST endpoints with no arguments: the org, role and
// impersonation come only from the session cookie (runAction).
//   - startConnectAction: owner only, refused under impersonation (`connect:write` at the
//     chokepoint, TEN-15). Returns the hosted onboarding URL to this caller only; the client
//     navigates (no redirect inside runAction). The link is minted per click and never logged.
//   - checkConnectAction: Owner or Admin (`connect:read`); asks the gateway for the account's
//     state, applies it and returns the panel view (the `?connect=return` re-check and the
//     Check again button).
import {
  paymentsMode,
  refreshConnectStatus,
  startStripeConnect,
} from "@cds/db";
import type { ConnectPanelView } from "@cds/ui/hub/billing";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { connectPanelView } from "../(platform)/hub/settings/payments-view";

/** UI-SPEC Settings › Payments: Admin line and IMPERSONATING-CONNECT. */
const COPY = {
  forbidden: "Only the site owner can connect or change Stripe.",
  impersonation:
    "You're viewing as CDS staff, so Stripe changes are turned off. Only the owner can connect Stripe.",
};

function testMode(): boolean {
  try {
    return paymentsMode() === "fake";
  } catch {
    return false;
  }
}

/** Connect your Stripe account / Finish Stripe setup. */
export async function startConnectAction(): Promise<
  ActionResult<{ url: string }>
> {
  return runAction(async ({ ctx }) => {
    const { url } = await startStripeConnect(ctx);
    return { url };
  }, COPY);
}

/** Re-check the account with Stripe and return the panel's view. */
export async function checkConnectAction(): Promise<
  ActionResult<ConnectPanelView>
> {
  return runAction(async ({ ctx }) => {
    const status = await refreshConnectStatus(ctx);
    try {
      // The tab label count and the hub's Needs-you follow the new state.
      revalidatePath("/hub", "layout");
    } catch {
      // Outside a request (tests) there is nothing to revalidate.
    }
    return connectPanelView(
      status,
      {
        role: ctx.role,
        impersonating: Boolean(ctx.impersonator),
        testMode: testMode(),
      },
      { now: new Date() },
    );
  }, COPY);
}
