// P10 payments: verify a Stripe webhook, then reduce it to a NormalisedEvent (ids only).
//
// T-10-06-01: the raw body goes straight to the SDK's signature check; nothing parses it
// first. T-10-06-02 (choice 5): payloads are never trusted. The result carries ids and an
// org hint only, and handlers re-fetch the object with the SDK's pinned API version
// (RESEARCH Pitfall 3).
import Stripe from "stripe";
import {
  WebhookSignatureInvalid,
  type NormalisedEvent,
} from "@cds/core/payments";

type Obj = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function rec(v: unknown): Obj | null {
  return typeof v === "object" && v !== null ? (v as Obj) : null;
}

function idOf(v: unknown): string | null {
  return str(v) ?? str(rec(v)?.id);
}

/** metadata.org on the object, or on the invoice's subscription snapshot (basil `parent`). */
function orgOf(object: Obj): string | null {
  const own = str(rec(object.metadata)?.org);
  if (own) return own;
  const sub = rec(rec(object.parent)?.subscription_details);
  return str(rec(sub?.metadata)?.org);
}

/** Verifies the signature (throws WebhookSignatureInvalid), then maps the event. */
export function normaliseStripeEvent(
  raw: string,
  signature: string,
  secret: string,
): NormalisedEvent {
  if (!secret || !signature) throw new WebhookSignatureInvalid();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    throw new WebhookSignatureInvalid();
  }
  return mapStripeEvent(event);
}

/** Maps an already-verified event. Exported for reconcile tests; never call on raw input. */
export function mapStripeEvent(event: Stripe.Event): NormalisedEvent {
  const object = (rec(event.data.object) ?? {}) as Obj;
  const objectId = str(object.id) ?? "";
  const base = {
    id: event.id,
    provider: "stripe" as const,
    account: str(event.account),
    orgId: orgOf(object),
    createdAt: new Date(event.created * 1000).toISOString(),
  };
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.expired":
      return {
        ...base,
        orgId: base.orgId ?? str(object.client_reference_id),
        type:
          event.type === "checkout.session.completed"
            ? "checkout.completed"
            : "checkout.expired",
        sessionId: objectId,
      };
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
    case "invoice.voided":
      return { ...base, type: event.type, invoiceId: objectId };
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired":
      return {
        ...base,
        type: event.type.replace("customer.", "") as
          | "subscription.updated"
          | "subscription.deleted"
          | "subscription.pending_update_applied"
          | "subscription.pending_update_expired",
        subscriptionId: objectId,
      };
    case "account.updated":
      return {
        ...base,
        type: "account.updated",
        accountId: base.account ?? objectId,
      };
    case "account.application.deauthorized":
      // data.object is the Application, not the account: event.account names the tenant.
      return {
        ...base,
        orgId: null,
        type: "account.deauthorized",
        accountId: base.account ?? "",
      };
    case "charge.refunded": {
      const customerId = idOf(object.customer);
      if (!customerId) {
        return { ...base, type: "ignored", originalType: event.type };
      }
      return { ...base, type: "charge.refunded", customerId };
    }
    default:
      return { ...base, type: "ignored", originalType: event.type };
  }
}
