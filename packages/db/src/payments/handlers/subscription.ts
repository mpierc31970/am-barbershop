// P10 payments: subscription handlers (PAY-01, BILL-03, BILL-16; 10-15; RESEARCH Pattern 6).
//
// Each handler re-fetches the subscription first (T-10-15-05) and hands it to lapse.ts, which
// takes `billing:<org>` and re-fetches again under the lock. updated / deleted apply the
// lapse state machine; pending_update_applied / _expired only re-sync the item-derived
// account fields (10-20 handles charge results synchronously). Tenant-side (Connect)
// subscription events are not CDS billing and are ignored (D296).
import type { NormalisedEvent } from "@cds/core/payments";
import { syncSubscriptionItems, syncSubscriptionState } from "../lapse";
import type { HandlerContext, HandlerMap } from "./types";

type SubscriptionEvent = Extract<NormalisedEvent, { subscriptionId: string }>;

async function refetch(e: NormalisedEvent, h: HandlerContext) {
  if (!("subscriptionId" in e) || e.account) return null;
  const ev = e as SubscriptionEvent;
  const sub = await h.billing.fetchSubscription(ev.subscriptionId);
  const orgId = sub.orgId ?? ev.orgId;
  if (!orgId) {
    console.warn(`[payments] ${ev.id} ignored: subscription names no org`);
    return null;
  }
  return { sub, orgId };
}

async function onStateChange(
  e: NormalisedEvent,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  const got = await refetch(e, h);
  if (!got) return "ignored";
  return syncSubscriptionState(got.orgId, got.sub, h);
}

async function onPendingUpdate(
  e: NormalisedEvent,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  const got = await refetch(e, h);
  if (!got) return "ignored";
  return syncSubscriptionItems(got.orgId, got.sub, h);
}

export const subscriptionHandlers: HandlerMap = {
  "subscription.updated": onStateChange,
  "subscription.deleted": onStateChange,
  "subscription.pending_update_applied": onPendingUpdate,
  "subscription.pending_update_expired": onPendingUpdate,
};
