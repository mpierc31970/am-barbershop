// P10 payments: what the fake CdsBilling, the fake gateway and the fake helpers share
// (PAY-09, CONTEXT A1): object shapes, the production refusal, event building, the emit
// registry and the mappers to the port types.
//
// Emit, not import (10-45 choice 1): the factory hands each fake an `emit(event)` callback
// that reaches the one processor; this folder never imports process.ts.
//
// Adapter methods emit *after* they return (deferred, in order), as Stripe's webhooks do.
// Callers such as event handlers hold the non-reentrant `billing:<org>` lock while calling
// the adapter; an awaited in-call emit would wait on that same lock forever. The test-page
// helpers (fakeCompleteSession …) run outside any lock and await their emits directly.
// `fakeSettled()` waits for the deferred queue (tests).
import { randomBytes } from "node:crypto";
import {
  PaymentsUnavailable,
  type BillingLine,
  type Interval,
  type NormalisedEvent,
  type ProviderAccount,
  type ProviderCheckoutSession,
  type ProviderInvoice,
  type ProviderInvoiceLine,
  type ProviderInvoiceStatus,
  type ProviderSubscription,
  type ProviderSubscriptionItem,
  type ProviderSubscriptionStatus,
} from "@cds/core/payments";
import type { EmitEvent } from "../factory";
import { priceIdentity, type LineIdentity } from "../line-identity";
import { getFakeObject, type FakeObject } from "./store";

export type { EmitEvent };

// ---------- object shapes (the `data` json of payment_fake_objects) ----------

export type FakeCustomer = {
  orgId: string;
  name: string;
  email: string;
  /** The saved test card fails every charge ("Card fails later" / "Use a card that fails"). */
  cardFailing: boolean;
};

export type FakeSession = {
  orgId: string | null;
  /** CDS-side sessions have a customer; tenant-side (gateway) sessions have an account. */
  customerId: string;
  account: string | null;
  customerEmail: string | null;
  lines: BillingLine[];
  deferredMonthly: BillingLine[];
  cadence: "monthly" | "yearly" | null;
  successUrl: string;
  cancelUrl: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid";
  subscriptionId: string | null;
  invoiceId: string | null;
  /** Integer cents refunded on a tenant-side payment. */
  refundedCents: number;
};

export type FakeItem = ProviderSubscriptionItem & {
  /** Integer cents per unit. */
  unitCents: number;
  label: string;
};

export type FakeSubscription = {
  orgId: string | null;
  customerId: string;
  status: ProviderSubscriptionStatus;
  items: FakeItem[];
  cancelAt: string | null;
  cadence: "monthly" | "yearly" | null;
  /** Idempotency keys of applied changeItems calls (latest 50). */
  appliedKeys: string[];
  /**
   * CR-C01, as on Stripe: a changeItems call left pending by an unpaid invoice is a cached
   * response too, so the same key replays the decline (latest 50).
   */
  declinedKeys?: string[];
  /** WR-E03: the most recent invoice, as Stripe's `latest_invoice`. */
  latestInvoiceId?: string | null;
};

export type FakeInvoice = {
  orgId: string | null;
  customerId: string;
  subscriptionId: string | null;
  status: ProviderInvoiceStatus;
  number: string;
  lines: ProviderInvoiceLine[];
  /** Integer cents. */
  totalCents: number;
  taxCents: number;
  refundedCents: number;
  createdAt: string;
  description: string;
  metadata: Record<string, string>;
  /** Failed payment attempts. */
  attempts: number;
  /** Stripe `billing_reason` (subscription_create, subscription_cycle, ...). */
  billingReason?: string | null;
};

export type FakeAccount = {
  orgId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  displayName: string | null;
  status: ProviderAccount["status"];
};

export type FakePrice = {
  kind: string;
  key: string;
  path: string;
  interval: Interval;
  cents: number;
  productRef: string;
  active: boolean;
};

export type FakeRefund = {
  customerId: string | null;
  account: string | null;
  target: string;
  /** Integer cents. */
  cents: number;
};

export type FakePortal = { customerId: string; returnUrl: string };

// ---------- production refusal (Pitfall 4, T-10-45-01) ----------

/** The stand-in never takes, or pretends to take, money in production. */
export function refuseInProduction(): void {
  if (process.env.CDS_ENV === "production") throw new PaymentsUnavailable();
}

// ---------- emit registry and deferred queue ----------

let registered: EmitEvent | null = null;
let queue: Promise<void> = Promise.resolve();

/** The latest fake adapter construction registers its emit for the helpers. */
export function registerEmit(emit: EmitEvent): void {
  registered = emit;
}

export async function resolveEmit(explicit?: EmitEvent): Promise<EmitEvent> {
  if (explicit) return explicit;
  if (!registered) {
    // Lazy: constructs the default fake through the factory, which registers its emit.
    const { getCdsBilling } = await import("../factory");
    getCdsBilling();
  }
  if (!registered) {
    throw new Error("fake payments: no emit registered (CDS_PAYMENTS=stripe?)");
  }
  return registered;
}

/** Queue an event to emit after the current call returns (in order). */
export function emitLater(emit: EmitEvent, e: NormalisedEvent): void {
  queue = queue
    .then(() => new Promise<void>((resolve) => setImmediate(resolve)))
    .then(() => emit(e))
    .catch((err: unknown) => {
      console.warn(
        `[payments] fake emit ${e.id} ${e.type} failed: ${err instanceof Error ? err.name : "Error"}`,
      );
    });
}

/** Tests: wait until every deferred fake event has been emitted. */
export async function fakeSettled(): Promise<void> {
  let seen: Promise<void> | null = null;
  while (seen !== queue) {
    seen = queue;
    await seen;
  }
}

// ---------- events ----------

type EventBody = NormalisedEvent extends infer E
  ? E extends NormalisedEvent
    ? Omit<E, "id" | "provider" | "account" | "orgId" | "createdAt">
    : never
  : never;

export function fakeEvent(
  orgId: string | null,
  body: EventBody,
  account: string | null = null,
): NormalisedEvent {
  return {
    id: `evt_fake_${randomBytes(8).toString("hex")}`,
    provider: "fake",
    account,
    orgId,
    createdAt: new Date().toISOString(),
    ...body,
  } as NormalisedEvent;
}

// ---------- dates and money ----------

const DAY_MS = 86_400_000;

export function addInterval(fromIso: string, interval: Interval): string {
  const d = new Date(fromIso);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

export function subtractInterval(fromIso: string, interval: Interval): string {
  const d = new Date(fromIso);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() - 1);
  else if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString();
}

/** Mirrors the Stripe adapter: yearly cents / 12, one-time 0. */
export function monthlyCents(interval: Interval, cents: number): number {
  if (interval === "month") return cents;
  if (interval === "year") return Math.round(cents / 12);
  return 0;
}

/**
 * Fake proration (10-45 choice 2): monthly cents × remaining days ÷ days in the current
 * period, rounded half up. Stripe computes the real figure.
 */
export function prorate(
  monthly: number,
  periodEndIso: string,
  now: Date,
): number {
  const end = new Date(periodEndIso).getTime();
  const start = new Date(subtractInterval(periodEndIso, "month")).getTime();
  const days = Math.max(1, Math.round((end - start) / DAY_MS));
  const remaining = Math.min(
    days,
    Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)),
  );
  return Math.floor((monthly * remaining) / days + 0.5);
}

export function earliestEnd(items: readonly FakeItem[]): string | null {
  const ends = items
    .map((i) => i.currentPeriodEnd)
    .filter((e) => e.length > 0)
    .sort();
  return ends[0] ?? null;
}

export function latestEnd(items: readonly FakeItem[]): string | null {
  const ends = items
    .map((i) => i.currentPeriodEnd)
    .filter((e) => e.length > 0)
    .sort();
  return ends[ends.length - 1] ?? null;
}

export function lineCents(line: BillingLine): number {
  return line.unitCents * line.quantity;
}

export function invoiceLine(line: BillingLine): ProviderInvoiceLine {
  return {
    kind: line.kind,
    key: line.key,
    amountCents: lineCents(line),
    description: line.label,
  };
}

/**
 * CR-E01, as Stripe reads it: an item created from a catalog price (no item metadata, e.g.
 * by Checkout) is what the PRICE says it is. A line with no fake price keeps its own identity
 * (Stripe keeps an inline price's kind on its product, read when expanded).
 */
export async function pricedIdentity(line: BillingLine): Promise<LineIdentity> {
  if (line.priceRef) {
    const p = await getFakeObject<FakePrice>(line.priceRef);
    if (p && p.kind === "price") {
      return priceIdentity(p.data.kind, p.data.key, p.data.interval);
    }
  }
  return { kind: line.kind, key: line.key };
}

/**
 * A Checkout invoice line as Stripe reports it: priced lines carry the price's identity; an
 * inline (`price_data`) line has no metadata the invoice can show, so it reads "extra".
 */
export async function checkoutInvoiceLine(
  line: BillingLine,
): Promise<ProviderInvoiceLine> {
  const own = invoiceLine(line);
  if (line.priceRef) {
    const p = await getFakeObject<FakePrice>(line.priceRef);
    if (p && p.kind === "price") {
      return {
        ...own,
        ...priceIdentity(p.data.kind, p.data.key, p.data.interval),
      };
    }
    return own;
  }
  return { ...own, kind: "extra", key: "" };
}

export function invoiceNumber(id: string): string {
  return `FAKE-${id.slice(-6).toUpperCase()}`;
}

// ---------- mappers ----------

export function toSubscription(
  o: FakeObject<FakeSubscription>,
): ProviderSubscription {
  return {
    id: o.id,
    customerId: o.data.customerId,
    orgId: o.data.orgId,
    status: o.data.status,
    items: o.data.items.map((i) => ({
      id: i.id,
      priceRef: i.priceRef,
      kind: i.kind,
      key: i.key,
      quantity: i.quantity,
      interval: i.interval,
      currentPeriodEnd: i.currentPeriodEnd,
      unitCents: i.unitCents,
    })),
    cancelAt: o.data.cancelAt,
    pendingUpdate: false,
    latestInvoiceId: o.data.latestInvoiceId ?? null,
  };
}

export function toInvoice(
  o: FakeObject<FakeInvoice>,
  hostedUrl: string | null,
): ProviderInvoice {
  const d = o.data;
  return {
    id: o.id,
    number: d.number,
    customerId: d.customerId,
    subscriptionId: d.subscriptionId,
    orgId: d.orgId,
    status: d.status,
    totalCents: d.totalCents,
    taxCents: d.taxCents,
    refundedCents: d.refundedCents,
    createdAt: d.createdAt,
    description: d.description,
    hostedUrl,
    pdfUrl: null,
    lines: d.lines,
    metadata: { ...d.metadata, ...(d.orgId ? { org: d.orgId } : {}) },
    billingReason: d.billingReason ?? null,
  };
}

export function toSession(o: FakeObject<FakeSession>): ProviderCheckoutSession {
  return {
    id: o.id,
    orgId: o.data.orgId,
    customerId: o.data.customerId,
    status: o.data.status,
    paymentStatus: o.data.paymentStatus,
    subscriptionId: o.data.subscriptionId,
    invoiceId: o.data.invoiceId,
  };
}

export function toAccount(id: string, a: FakeAccount | null): ProviderAccount {
  if (!a || a.status === "disconnected") {
    return {
      accountId: id,
      chargesEnabled: false,
      detailsSubmitted: false,
      displayName: null,
      status: "disconnected",
    };
  }
  return {
    accountId: id,
    chargesEnabled: a.chargesEnabled,
    detailsSubmitted: a.detailsSubmitted,
    displayName: a.displayName,
    status: a.chargesEnabled ? "connected" : "restricted",
  };
}

export async function mustGet<T>(
  id: string,
  kind: FakeObject["kind"],
): Promise<FakeObject<T>> {
  const o = await getFakeObject<T>(id);
  if (!o || o.kind !== kind) throw new Error(`fake ${kind} ${id} not found`);
  return o;
}
