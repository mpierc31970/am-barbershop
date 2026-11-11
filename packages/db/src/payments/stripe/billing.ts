// P10 payments: CdsBilling on Stripe (CDS as the seller, D66). PAY-09: the first adapter
// behind the port; only this folder imports the SDK.
//
// - Checkout: hosted, subscription mode, automatic tax, billing address required, customer
//   address/name auto-update, promotion codes on (never `discounts`, Pitfall 9), flexible
//   billing mode, idempotency key (BILL-15, D262, RESEARCH Pattern 3).
// - Yearly cadence is Pattern 4(a): `deferredMonthly` lines are not sent to Checkout; the
//   completion handler (10-12) adds them with proration none.
// - Saved-card changes: pending_if_incomplete + always_invoice; a pending update means the
//   card failed and nothing is installed (Pattern 5).
// - Annual cancel runs to term with cancel_at=max_period_end (BILL-16).
// - Usage goes to Billing Meters; prices are immutable, so syncPrice creates a new price
//   and archives the old one (D161, D263).
// - basil+ removals respected: no upcoming-invoice endpoint (create_preview instead), no
//   invoice-level charge/payment fields (refunds list charges by customer), period end
//   lives on subscription items.
// - BILL-07 / D52: no request ever carries a platform fee (no-fee.test.ts proves it).
import Stripe from "stripe";
import type {
  BillingLine,
  CdsBilling,
  ChangeItemsInput,
  Interval,
  NormalisedEvent,
  ProviderCheckoutSession,
  ProviderInvoice,
  ProviderInvoiceStatus,
  ProviderSubscription,
  ProviderSubscriptionItem,
  ProviderSubscriptionStatus,
} from "@cds/core/payments";
import { priceIdentity } from "../line-identity";
import { mapStripeEvent, normaliseStripeEvent } from "./normalise";

type Obj = Record<string, unknown>;

const CURRENCY = "usd";

// ---------- loose readers (the SDK types are wide; mapping reads only what it needs) ----

function rec(v: unknown): Obj {
  return typeof v === "object" && v !== null ? (v as Obj) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function idOf(v: unknown): string | null {
  return str(v) ?? str(rec(v).id);
}
function iso(seconds: unknown): string | null {
  return typeof seconds === "number"
    ? new Date(seconds * 1000).toISOString()
    : null;
}
function metadata(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec(v))) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}
function list(v: unknown): Obj[] {
  const data = rec(v).data;
  return Array.isArray(data) ? data.map(rec) : [];
}

function keyOf(fallback: string, ...sources: unknown[]): string {
  for (const s of sources) {
    const k = str(rec(s).key);
    if (k) return k;
  }
  return fallback;
}

function intervalOf(price: Obj): Interval {
  const i = rec(price.recurring).interval;
  return i === "month" || i === "year" ? i : "once";
}

// ---------- mappers ----------

const SUB_STATUS: Record<string, ProviderSubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "unpaid",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "incomplete_expired",
  // A paused subscription takes no payment; treat it like unpaid (lapse rules apply).
  paused: "unpaid",
};

/**
 * CR-E01: what a price-backed item or line is. Item metadata first (set by changeItems), then
 * the synced price's metadata read through priceIdentity (a monthly build_fee price is the
 * installment), then the product's (an inline `price_data` line keeps its kind there, when
 * the product is expanded). "extra" when nothing says.
 */
function identityOf(
  own: unknown,
  price: Obj,
  fallbackKey: string,
): { kind: BillingLine["kind"]; key: string } {
  const ownKind = str(rec(own).kind);
  if (ownKind) {
    return { kind: ownKind as BillingLine["kind"], key: keyOf("", own) };
  }
  const priceKind = str(rec(price.metadata).kind);
  if (priceKind) {
    return priceIdentity(
      priceKind,
      keyOf("", price.metadata),
      intervalOf(price),
    );
  }
  const product = rec(price.product);
  const productKind = str(rec(product.metadata).kind);
  if (productKind) {
    return priceIdentity(
      productKind,
      keyOf("", product.metadata),
      intervalOf(price),
    );
  }
  return { kind: "extra", key: fallbackKey };
}

function mapItem(item: Obj): ProviderSubscriptionItem {
  const price = rec(item.price);
  const identity = identityOf(item.metadata, price, "");
  return {
    id: str(item.id) ?? "",
    priceRef: str(price.id) ?? "",
    kind: identity.kind,
    key: identity.key,
    quantity: typeof item.quantity === "number" ? item.quantity : 1,
    interval: intervalOf(price),
    currentPeriodEnd: iso(item.current_period_end) ?? "",
    // WR-D04: what this item is billed at (its own price; a lock keeps the old amount).
    ...(typeof price.unit_amount === "number"
      ? { unitCents: price.unit_amount }
      : {}),
  };
}

export function mapSubscription(raw: unknown): ProviderSubscription {
  const s = rec(raw);
  return {
    id: str(s.id) ?? "",
    customerId: idOf(s.customer) ?? "",
    orgId: str(rec(s.metadata).org),
    status: SUB_STATUS[str(s.status) ?? ""] ?? "incomplete",
    items: list(s.items).map(mapItem),
    cancelAt: iso(s.cancel_at),
    pendingUpdate: s.pending_update != null,
    latestInvoiceId: idOf(s.latest_invoice),
  };
}

/** basil+: the period lives on items; the subscription's period end is the earliest. */
export function minPeriodEnd(
  items: readonly ProviderSubscriptionItem[],
): string | null {
  const ends = items
    .map((i) => i.currentPeriodEnd)
    .filter((e) => e.length > 0)
    .sort();
  return ends[0] ?? null;
}

const INVOICE_STATUS: readonly ProviderInvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
];

export function mapInvoice(raw: unknown): ProviderInvoice {
  const inv = rec(raw);
  const parentSub = rec(rec(inv.parent).subscription_details);
  const md = metadata(inv.metadata);
  const status = str(inv.status) as ProviderInvoiceStatus | null;
  const taxes = Array.isArray(inv.total_taxes) ? inv.total_taxes : [];
  return {
    id: str(inv.id) ?? "",
    number: str(inv.number) ?? "",
    customerId: idOf(inv.customer) ?? "",
    subscriptionId: idOf(parentSub.subscription),
    orgId: md.org ?? str(rec(parentSub.metadata).org),
    status: status && INVOICE_STATUS.includes(status) ? status : "draft",
    totalCents: num(inv.total),
    taxCents: taxes.reduce<number>((sum, t) => sum + num(rec(t).amount), 0),
    // Credit notes issued after payment. Refunds made on the charge (decline, dashboard)
    // make no credit note: the adapter adds those from the invoice's payments (WR-E04).
    refundedCents: num(inv.post_payment_credit_notes_amount),
    createdAt: iso(inv.created) ?? "",
    description: str(inv.description) ?? "",
    hostedUrl: str(inv.hosted_invoice_url),
    pdfUrl: str(inv.invoice_pdf),
    lines: list(inv.lines).map((line) => {
      const price = rec(rec(rec(line.pricing).price_details).price);
      // CR-E01: a subscription line's metadata is the subscription's (org, cadence), never
      // the item's, so only the price says what it is.
      const parent = rec(line.parent);
      const subscriptionLine =
        parent.type === "subscription_item_details" ||
        parent.subscription_item_details != null;
      const identity = identityOf(
        subscriptionLine ? null : line.metadata,
        price,
        str(price.id) ?? "",
      );
      return {
        kind: identity.kind,
        key: identity.key,
        amountCents: num(line.amount),
        description: str(line.description) ?? "",
      };
    }),
    metadata: md,
    billingReason: str(inv.billing_reason),
  };
}

export function mapCheckoutSession(raw: unknown): ProviderCheckoutSession {
  const s = rec(raw);
  const status = str(s.status);
  return {
    id: str(s.id) ?? "",
    orgId: str(rec(s.metadata).org) ?? str(s.client_reference_id),
    customerId: idOf(s.customer) ?? "",
    status: status === "complete" || status === "expired" ? status : "open",
    paymentStatus:
      s.payment_status === "paid" || s.payment_status === "no_payment_required"
        ? "paid"
        : "unpaid",
    subscriptionId: idOf(s.subscription),
    invoiceId: idOf(s.invoice),
  };
}

// ---------- request builders ----------

function lineMetadata(line: BillingLine): Record<string, string> {
  return { kind: line.kind, key: line.key };
}

/** A Checkout line: catalog price by id, or an ad-hoc price (tax exclusive). */
export function checkoutLineItem(
  line: BillingLine,
): Stripe.Checkout.SessionCreateParams.LineItem {
  if (line.priceRef) return { price: line.priceRef, quantity: line.quantity };
  return {
    quantity: line.quantity,
    price_data: {
      currency: CURRENCY,
      unit_amount: line.unitCents,
      tax_behavior: "exclusive",
      product_data: { name: line.label, metadata: lineMetadata(line) },
      ...(line.interval === "once"
        ? {}
        : { recurring: { interval: line.interval } }),
    },
  };
}

function requirePriceRef(line: BillingLine, where: string): string {
  if (!line.priceRef) {
    throw new Error(
      `${where}: line ${line.kind}:${line.key} needs a synced price (priceRef)`,
    );
  }
  return line.priceRef;
}

/**
 * WR-E09: with `payment_behavior: pending_if_incomplete` (chargeNow) Stripe accepts only a
 * restricted parameter set, and item metadata may not be in it. The kind and key then come
 * from the synced price's metadata (mapItem reads it), so items carry none. The preview
 * never needs metadata.
 */
function subscriptionItems(
  input: Omit<ChangeItemsInput, "idempotencyKey">,
  withMetadata: boolean,
): Stripe.SubscriptionUpdateParams.Item[] {
  return [
    ...input.add.map((line) => ({
      price: requirePriceRef(line, "changeItems"),
      quantity: line.quantity,
      ...(withMetadata ? { metadata: lineMetadata(line) } : {}),
    })),
    ...input.remove.map((id) => ({ id, deleted: true })),
    ...input.setQuantity.map((q) => ({ id: q.itemId, quantity: q.quantity })),
  ];
}

/** CR-C01: prorate at the previewed instant (unix seconds), so the charge matches the preview. */
function prorationDate(input: { prorationDate?: string }): {
  proration_date?: number;
} {
  if (!input.prorationDate) return {};
  const ms = Date.parse(input.prorationDate);
  return Number.isNaN(ms) ? {} : { proration_date: Math.floor(ms / 1000) };
}

function withSessionPlaceholder(url: string): string {
  if (url.includes("{CHECKOUT_SESSION_ID}")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}

function monthlyCents(interval: Interval, cents: number): number {
  if (interval === "month") return cents;
  if (interval === "year") return Math.round(cents / 12);
  return 0;
}

/** The CDS-side event types reconcile replays (the ones the webhook endpoint takes). */
const RECONCILE_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.finalized",
  "invoice.voided",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "charge.refunded",
] as const;

// ---------- adapter ----------

export type StripeCdsBillingDeps = {
  stripe: Stripe;
  /** CDS endpoint secret (STRIPE_WEBHOOK_SECRET). */
  webhookSecret: string;
  now?: () => Date;
};

export function createStripeCdsBilling(deps: StripeCdsBillingDeps): CdsBilling {
  const { stripe } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * WR-E04: cents refunded on the invoice's own payments. A refund on the charge (refundAll,
   * the dashboard) leaves the invoice unchanged, so it is read from the payment's refunds.
   */
  async function paymentRefundsOf(invoiceId: string): Promise<number> {
    let total = 0;
    for await (const ip of stripe.invoicePayments.list({
      invoice: invoiceId,
      status: "paid",
      limit: 100,
    })) {
      const payment = rec(rec(ip).payment);
      const paymentIntent = idOf(payment.payment_intent);
      const charge = idOf(payment.charge);
      if (!paymentIntent && !charge) continue;
      for await (const r of stripe.refunds.list(
        paymentIntent
          ? { payment_intent: paymentIntent, limit: 100 }
          : { charge: charge!, limit: 100 },
      )) {
        if (r.status === "succeeded" || r.status === "pending") {
          total += r.amount;
        }
      }
    }
    return total;
  }

  /** A paid invoice with its charge-level refunds counted (credit notes already are). */
  async function withRefunds(inv: ProviderInvoice): Promise<ProviderInvoice> {
    if (inv.status !== "paid" || inv.id === "") return inv;
    const refunded = Math.min(await paymentRefundsOf(inv.id), inv.totalCents);
    return refunded > inv.refundedCents
      ? { ...inv, refundedCents: refunded }
      : inv;
  }

  async function fetchSubscription(id: string): Promise<ProviderSubscription> {
    // CR-E01 / WR-E05: the product too, so an inline-priced item keeps its kind.
    return mapSubscription(
      await stripe.subscriptions.retrieve(id, {
        expand: ["items.data.price.product"],
      }),
    );
  }

  const billing: CdsBilling = {
    provider: "stripe",

    async ensureCustomer(input) {
      if (input.customerId) return { customerId: input.customerId };
      const c = await stripe.customers.create(
        {
          name: input.name,
          email: input.email,
          metadata: { org: input.orgId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { customerId: c.id };
    },

    async createCheckout(input) {
      // deferredMonthly is deliberately not sent (Pattern 4(a)); 10-12 adds those items.
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: input.customerId,
          customer_update: { address: "auto", name: "auto" },
          billing_address_collection: "required",
          automatic_tax: { enabled: true },
          allow_promotion_codes: true,
          client_reference_id: input.orgId,
          line_items: input.lines.map(checkoutLineItem),
          subscription_data: {
            billing_mode: { type: "flexible" },
            metadata: { org: input.orgId, cadence: input.cadence },
          },
          metadata: { org: input.orgId, cadence: input.cadence },
          success_url: withSessionPlaceholder(input.successUrl),
          cancel_url: input.cancelUrl,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) throw new Error("Stripe Checkout returned no URL");
      return { sessionId: session.id, url: session.url };
    },

    async expireCheckout(sessionId) {
      try {
        const s = await stripe.checkout.sessions.expire(sessionId);
        return s.status === "complete" ? "complete" : "expired";
      } catch (e) {
        // Only an open session can be expired: read what it became instead.
        if (!(e instanceof Stripe.errors.StripeInvalidRequestError)) throw e;
        let s: Stripe.Checkout.Session;
        try {
          s = await stripe.checkout.sessions.retrieve(sessionId);
        } catch (missing) {
          // No such session (e.g. one from test mode): nothing is payable.
          if (missing instanceof Stripe.errors.StripeInvalidRequestError) {
            return "expired";
          }
          throw missing;
        }
        if (s.status === "complete") return "complete";
        if (s.status === "expired") return "expired";
        throw e;
      }
    },

    async changeItems(input) {
      const sub = await stripe.subscriptions.update(
        input.subscriptionId,
        {
          items: subscriptionItems(input, !input.chargeNow),
          ...(input.oneTime.length > 0
            ? {
                add_invoice_items: input.oneTime.map((line) => ({
                  price: requirePriceRef(line, "changeItems one-time"),
                  quantity: line.quantity,
                })),
              }
            : {}),
          proration_behavior: input.proration,
          ...prorationDate(input),
          ...(input.chargeNow
            ? { payment_behavior: "pending_if_incomplete" as const }
            : {}),
          expand: ["latest_invoice"],
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (sub.pending_update) {
        // The invoice was not paid: the change waits (and expires) on Stripe's side.
        return { applied: false, reason: "card_declined" };
      }
      const invoiced =
        input.proration === "always_invoice" || input.oneTime.length > 0;
      const latest = rec(sub.latest_invoice);
      return {
        applied: true,
        invoice: invoiced && str(latest.id) ? mapInvoice(latest) : null,
      };
    },

    async previewChange(input) {
      const sub = await stripe.subscriptions.retrieve(input.subscriptionId);
      const current = mapSubscription(sub);
      const removed = new Set(input.remove);
      const qty = new Map(input.setQuantity.map((q) => [q.itemId, q.quantity]));
      let thenMonthlyCents = 0;
      for (const item of list(sub.items)) {
        const id = str(item.id) ?? "";
        if (removed.has(id)) continue;
        const price = rec(item.price);
        const quantity = qty.get(id) ?? num(item.quantity);
        thenMonthlyCents += monthlyCents(
          intervalOf(price),
          num(price.unit_amount) * quantity,
        );
      }
      for (const line of input.add) {
        thenMonthlyCents += monthlyCents(
          line.interval,
          line.unitCents * line.quantity,
        );
      }
      const preview = await stripe.invoices.createPreview({
        subscription: input.subscriptionId,
        subscription_details: {
          items: subscriptionItems(input, false),
          proration_behavior: input.proration,
          ...prorationDate(input),
        },
        ...(input.oneTime.length > 0
          ? {
              invoice_items: input.oneTime.map((line) => ({
                price: requirePriceRef(line, "previewChange one-time"),
                quantity: line.quantity,
              })),
            }
          : {}),
      });
      const p = rec(preview);
      const taxes = Array.isArray(p.total_taxes) ? p.total_taxes : null;
      return {
        todayCents:
          input.proration === "always_invoice" ? num(p.amount_due) : 0,
        taxCents: taxes
          ? taxes.reduce<number>((sum, t) => sum + num(rec(t).amount), 0)
          : null,
        thenMonthlyCents,
        periodEnd: minPeriodEnd(current.items) ?? now().toISOString(),
      };
    },

    async createInvoice(input) {
      const key = input.idempotencyKey;
      const draft = await stripe.invoices.create(
        {
          customer: input.customerId,
          collection_method: "charge_automatically",
          auto_advance: true,
          automatic_tax: { enabled: true },
          pending_invoice_items_behavior: "exclude",
          description: input.description,
          metadata: { ...input.metadata, org: input.orgId },
        },
        { idempotencyKey: `${key}:invoice` },
      );
      const invoiceId = draft.id;
      if (!invoiceId) throw new Error("Stripe returned an invoice without id");
      for (const [i, line] of input.lines.entries()) {
        await stripe.invoiceItems.create(
          line.priceRef
            ? {
                customer: input.customerId,
                invoice: invoiceId,
                pricing: { price: line.priceRef },
                quantity: line.quantity,
                metadata: lineMetadata(line),
              }
            : {
                customer: input.customerId,
                invoice: invoiceId,
                currency: CURRENCY,
                amount: line.unitCents * line.quantity,
                description: line.label,
                metadata: lineMetadata(line),
              },
          { idempotencyKey: `${key}:item:${i}` },
        );
      }
      const finalized = await stripe.invoices.finalizeInvoice(
        invoiceId,
        { auto_advance: true },
        { idempotencyKey: `${key}:finalize` },
      );
      return mapInvoice(finalized);
    },

    async refundAll(input) {
      let refundedCents = 0;
      let count = 0;
      for await (const charge of stripe.charges.list({
        customer: input.customerId,
        limit: 100,
      })) {
        const remaining = charge.amount - charge.amount_refunded;
        if (
          !charge.paid ||
          charge.status !== "succeeded" ||
          charge.refunded ||
          remaining <= 0
        ) {
          continue;
        }
        const refund = await stripe.refunds.create(
          { charge: charge.id },
          { idempotencyKey: `${input.idempotencyKey}:${charge.id}` },
        );
        refundedCents += refund.amount;
        count += 1;
      }
      return { refundedCents, count };
    },

    async cancel(input) {
      const options = { idempotencyKey: input.idempotencyKey };
      if (input.mode === "now") {
        return mapSubscription(
          await stripe.subscriptions.cancel(input.subscriptionId, {}, options),
        );
      }
      // Runs to the end of the longest item period (annual to term, BILL-16).
      return mapSubscription(
        await stripe.subscriptions.update(
          input.subscriptionId,
          { cancel_at: "max_period_end" },
          options,
        ),
      );
    },

    async listInvoices(input) {
      const out: ProviderInvoice[] = [];
      for await (const inv of stripe.invoices.list({
        customer: input.customerId,
        limit: 100,
        ...(input.since
          ? { created: { gte: Math.floor(input.since.getTime() / 1000) } }
          : {}),
      })) {
        out.push(await withRefunds(mapInvoice(inv)));
      }
      return out;
    },

    async syncPrice(input) {
      const md = { kind: input.kind, key: input.key, path: input.path };
      if (input.previousPriceRef) {
        const prev = await stripe.prices.retrieve(input.previousPriceRef);
        const sameInterval = intervalOf(rec(prev)) === input.interval;
        if (
          prev.active &&
          prev.unit_amount === input.cents &&
          sameInterval &&
          input.productRef
        ) {
          return { priceRef: prev.id, productRef: input.productRef };
        }
      }
      const productRef =
        input.productRef ??
        (
          await stripe.products.create(
            { name: `${input.key} (${input.path})`, metadata: md },
            {
              idempotencyKey: `product:${input.kind}:${input.key}:${input.path}`,
            },
          )
        ).id;
      // Prices are immutable (D161): a new amount is a new price; subscriptions on the old
      // price keep it.
      const price = await stripe.prices.create(
        {
          product: productRef,
          currency: CURRENCY,
          unit_amount: input.cents,
          tax_behavior: "exclusive",
          metadata: md,
          ...(input.interval === "once"
            ? {}
            : { recurring: { interval: input.interval } }),
        },
        {
          idempotencyKey: `price:${productRef}:${input.previousPriceRef ?? "none"}:${input.interval}:${input.cents}`,
        },
      );
      if (input.previousPriceRef && input.previousPriceRef !== price.id) {
        await stripe.prices.update(
          input.previousPriceRef,
          { active: false },
          { idempotencyKey: `archive:${input.previousPriceRef}:${price.id}` },
        );
      }
      return { priceRef: price.id, productRef };
    },

    async reportUsage(input) {
      await stripe.billing.meterEvents.create(
        {
          event_name: input.meter,
          identifier: input.identifier,
          payload: {
            stripe_customer_id: input.customerId,
            value: String(input.value),
          },
        },
        { idempotencyKey: `meter:${input.identifier}` },
      );
    },

    async portalUrl(input) {
      try {
        const s = await stripe.billingPortal.sessions.create({
          customer: input.customerId,
          return_url: input.returnUrl,
          flow_data: { type: "payment_method_update" },
        });
        return s.url;
      } catch (e) {
        // A6 fallback: the deep link is refused (e.g. portal not configured for it).
        if (!(e instanceof Stripe.errors.StripeInvalidRequestError)) throw e;
        const s = await stripe.billingPortal.sessions.create({
          customer: input.customerId,
          return_url: input.returnUrl,
        });
        return s.url;
      }
    },

    fetchSubscription,

    async fetchInvoice(id) {
      return withRefunds(
        mapInvoice(
          await stripe.invoices.retrieve(id, {
            expand: ["lines.data.pricing.price_details.price"],
          }),
        ),
      );
    },

    async fetchCheckoutSession(id) {
      return mapCheckoutSession(await stripe.checkout.sessions.retrieve(id));
    },

    normaliseWebhook(raw, signature) {
      return Promise.resolve(
        normaliseStripeEvent(raw, signature, deps.webhookSecret),
      );
    },

    async reconcile(input) {
      // CR-E04 (PAY-02, D244): replay Stripe's own event log for the window, with the REAL
      // event ids, so a missed webhook is recovered whenever the object changed (not only
      // when it was created) and the ledger dedups it against the webhook delivery. A
      // status that repeats (active -> unpaid -> active) is a new event with a new id.
      // Stripe keeps 30 days of events.
      const gte = Math.floor(input.since.getTime() / 1000);
      const events: NormalisedEvent[] = [];
      for await (const raw of stripe.events.list({
        created: { gte },
        types: [...RECONCILE_EVENT_TYPES],
        limit: 100,
      })) {
        const e = mapStripeEvent(raw);
        if (e.type === "ignored" || e.account) continue;
        events.push(e);
      }
      // The list is newest first; apply in the order things happened.
      events.reverse();
      return events;
    },
  };
  return billing;
}
