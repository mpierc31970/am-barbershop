// @cds/core/payments: the two payment ports (PAY-09, D66, D296, CONTEXT A1). Pure types only:
// no node:*, no stripe, no db package. Adapters (fake, stripe) live in the db package (packages/db/src/payments).
//
// Two money directions, two ports (D66):
// - CdsBilling: CDS as the seller. The tenant pays CDS (build, base plan, add-ons, Care Plan,
//   packs, paid services) on CDS's own Stripe account, one subscription per tenant (D263).
// - PaymentGateway: the tenant as the merchant. The tenant's customers pay the tenant on the
//   tenant's own Connect Standard account (D256). CDS is never a payment processor (D296).
//
// BILL-07, D52: there is deliberately no platform-cut field on any input. Adding one is a
// design change, not a code change; types.test.ts fails if one appears.
//
// Every amount is integer cents (pricing precedent): `number`, never a float.
import { CdsError } from "../errors";
import type { CatalogItemKind } from "../pricing/types";

export type PaymentProvider = "stripe" | "fake";

export type Interval = "month" | "year" | "once";

/** One line sent to a provider checkout, invoice or subscription change. */
export type BillingLine = {
  kind: CatalogItemKind | "installment" | "first_month";
  key: string;
  label: string;
  interval: Interval;
  /** Integer cents per unit. */
  unitCents: number;
  quantity: number;
  /** Provider price id (`price_…`), or null for an ad-hoc amount. */
  priceRef: string | null;
};

export type ProviderSubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired";

export type ProviderSubscriptionItem = {
  id: string;
  priceRef: string;
  kind: BillingLine["kind"];
  key: string;
  quantity: number;
  interval: Interval;
  /** ISO timestamp; basil+ keeps the period on items, not the subscription. */
  currentPeriodEnd: string;
  /**
   * Integer cents per unit per `interval` as billed (the item's own price, so a price lock
   * keeps the old amount). Absent when the provider did not say (WR-D04).
   */
  unitCents?: number;
};

export type ProviderSubscription = {
  id: string;
  customerId: string;
  orgId: string | null;
  status: ProviderSubscriptionStatus;
  items: readonly ProviderSubscriptionItem[];
  cancelAt: string | null;
  pendingUpdate: boolean;
  /**
   * WR-E03: the subscription's most recent invoice. A subscription-mode Checkout has no
   * invoice of its own; its first invoice is this one.
   */
  latestInvoiceId?: string | null;
};

export type ProviderInvoiceStatus =
  "draft" | "open" | "paid" | "uncollectible" | "void";

export type ProviderInvoiceLine = {
  kind: BillingLine["kind"];
  key: string;
  /** Integer cents. */
  amountCents: number;
  description: string;
};

export type ProviderInvoice = {
  id: string;
  number: string;
  customerId: string;
  subscriptionId: string | null;
  orgId: string | null;
  status: ProviderInvoiceStatus;
  /** Integer cents. */
  totalCents: number;
  /** Integer cents. */
  taxCents: number;
  /** Integer cents. */
  refundedCents: number;
  createdAt: string;
  description: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  lines: readonly ProviderInvoiceLine[];
  metadata: Readonly<Record<string, string>>;
  /**
   * Why the provider made it (Stripe `billing_reason`): `subscription_create` is the
   * checkout's first invoice (WR-E03), `subscription_cycle` a renewal.
   */
  billingReason?: string | null;
};

export type ProviderCheckoutSession = {
  id: string;
  orgId: string | null;
  customerId: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid";
  subscriptionId: string | null;
  invoiceId: string | null;
};

/** A tenant's Connect account. "Setup not finished" = detailsSubmitted false (10-01 choice 4). */
export type ProviderAccount = {
  accountId: string;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  displayName: string | null;
  status: "connected" | "restricted" | "disconnected";
};

type EventBase = {
  /** Provider event id (`evt_…`); the payment_events ledger key with provider. */
  id: string;
  provider: PaymentProvider;
  /** Connect account id for tenant-side events; null on CDS's own account. */
  account: string | null;
  orgId: string | null;
  createdAt: string;
};

/** Every provider webhook is normalised to one of these before any handler runs. */
export type NormalisedEvent = EventBase &
  (
    | { type: "checkout.completed" | "checkout.expired"; sessionId: string }
    | {
        type:
          | "invoice.paid"
          | "invoice.payment_failed"
          | "invoice.finalized"
          | "invoice.voided";
        invoiceId: string;
      }
    | {
        type:
          | "subscription.updated"
          | "subscription.deleted"
          | "subscription.pending_update_applied"
          | "subscription.pending_update_expired";
        subscriptionId: string;
      }
    | { type: "account.updated" | "account.deauthorized"; accountId: string }
    | { type: "charge.refunded"; customerId: string }
    | { type: "ignored"; originalType: string }
  );

export type NormalisedEventType = NormalisedEvent["type"];

export type CheckoutRedirect = { sessionId: string; url: string };

export type ChangeItemsInput = {
  subscriptionId: string;
  add: readonly BillingLine[];
  /** Subscription item ids to remove. */
  remove: readonly string[];
  setQuantity: readonly { itemId: string; quantity: number }[];
  /** One-time lines added to the proration invoice (e.g. the $25 setup line, D186). */
  oneTime: readonly BillingLine[];
  proration: "always_invoice" | "none";
  /** true: pending_if_incomplete; the change applies only once the invoice is paid. */
  chargeNow: boolean;
  /**
   * ISO instant the proration is computed at (Stripe `proration_date`). A confirm sends the
   * instant its preview used, so the charge is the figure the owner saw (CR-C01).
   */
  prorationDate?: string;
  idempotencyKey: string;
};

export type ChangeItemsResult =
  | { applied: true; invoice: ProviderInvoice | null }
  | { applied: false; reason: "card_declined" | "requires_action" };

export type ChangePreview = {
  /** Integer cents charged today (proration + one-time lines). */
  todayCents: number;
  /** Integer cents; null when the provider cannot say yet. */
  taxCents: number | null;
  /** Integer cents per month after the change. */
  thenMonthlyCents: number;
  periodEnd: string;
};

/** CDS as the seller (D66): the tenant pays CDS on CDS's own account. */
export type CdsBilling = {
  readonly provider: PaymentProvider;
  ensureCustomer(input: {
    orgId: string;
    customerId: string | null;
    name: string;
    email: string;
    idempotencyKey: string;
  }): Promise<{ customerId: string }>;
  createCheckout(input: {
    orgId: string;
    customerId: string;
    lines: readonly BillingLine[];
    /** Monthly-by-nature items added after a yearly Checkout completes (Pattern 4(a)). */
    deferredMonthly: readonly BillingLine[];
    cadence: "monthly" | "yearly";
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<CheckoutRedirect>;
  /**
   * CR-E02: expire an open hosted session so it can no longer be paid. Returns the
   * session's final state: "complete" when it was already paid (it cannot be expired).
   */
  expireCheckout(sessionId: string): Promise<"expired" | "complete">;
  changeItems(input: ChangeItemsInput): Promise<ChangeItemsResult>;
  previewChange(
    input: Omit<ChangeItemsInput, "idempotencyKey">,
  ): Promise<ChangePreview>;
  createInvoice(input: {
    orgId: string;
    customerId: string;
    lines: readonly BillingLine[];
    description: string;
    metadata: Readonly<Record<string, string>>;
    idempotencyKey: string;
  }): Promise<ProviderInvoice>;
  refundAll(input: {
    customerId: string;
    idempotencyKey: string;
  }): Promise<{ refundedCents: number; count: number }>;
  cancel(input: {
    subscriptionId: string;
    mode: "now" | "term";
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;
  listInvoices(input: {
    customerId: string;
    since: Date | null;
  }): Promise<readonly ProviderInvoice[]>;
  syncPrice(input: {
    kind: CatalogItemKind | string;
    key: string;
    path: string;
    interval: Interval;
    /** Integer cents. */
    cents: number;
    productRef: string | null;
    previousPriceRef: string | null;
  }): Promise<{ priceRef: string; productRef: string }>;
  reportUsage(input: {
    customerId: string;
    meter: string;
    value: number;
    identifier: string;
  }): Promise<void>;
  portalUrl(input: { customerId: string; returnUrl: string }): Promise<string>;
  fetchSubscription(id: string): Promise<ProviderSubscription>;
  fetchInvoice(id: string): Promise<ProviderInvoice>;
  fetchCheckoutSession(id: string): Promise<ProviderCheckoutSession>;
  /** Verifies the signature first; throws WebhookSignatureInvalid on a bad one. */
  normaliseWebhook(raw: string, signature: string): Promise<NormalisedEvent>;
  reconcile(input: { since: Date }): Promise<readonly NormalisedEvent[]>;
};

/** The tenant as the merchant (PAY-09): the tenant's customers pay the tenant (D296). */
export type PaymentGateway = {
  readonly provider: PaymentProvider;
  startConnect(input: {
    orgId: string;
    accountId: string | null;
    mode: "new" | "existing";
    returnUrl: string;
    refreshUrl: string;
    /**
     * Key for creating the account when `accountId` is null. WR-E02: a reconnect after a
     * disconnect passes a fresh key, or the provider hands back the old account.
     */
    idempotencyKey?: string;
  }): Promise<{ accountId: string; url: string }>;
  accountStatus(accountId: string): Promise<ProviderAccount>;
  createCheckout(input: {
    accountId: string;
    lines: readonly BillingLine[];
    successUrl: string;
    cancelUrl: string;
    customerEmail: string | null;
    idempotencyKey: string;
  }): Promise<CheckoutRedirect>;
  refund(input: {
    accountId: string;
    paymentRef: string;
    /** Integer cents; null refunds the full payment. */
    cents: number | null;
    idempotencyKey: string;
  }): Promise<{ refundedCents: number }>;
  normaliseWebhook(raw: string, signature: string): Promise<NormalisedEvent>;
  reconcile(input: {
    since: Date;
    accountIds: readonly string[];
  }): Promise<readonly NormalisedEvent[]>;
};

/** A webhook body whose signature does not verify. Routes answer 400, never process it. */
export class WebhookSignatureInvalid extends CdsError {
  override readonly code = "webhook_signature_invalid";
  constructor(message = "Webhook signature invalid") {
    super(message);
  }
}

/** The fake adapter refuses to take money in production (CONTEXT A1 stand-in rule). */
export class PaymentsUnavailable extends CdsError {
  override readonly code = "payments_unavailable";
  constructor(message = "Payments open soon") {
    super(message);
  }
}
