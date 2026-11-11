// P10 payments: the fake adapter (PAY-09, CONTEXT A1) — the keyless stand-in for Stripe.
//
// `fakeCdsBilling` / `fakePaymentGateway` are what the factory builds by default
// (CDS_PAYMENTS unset or `fake`). The `fake*` helpers are what the platform's "Test payment"
// pages (/test-pay/*) and e2e tests call to play the customer's side: pay, decline, card
// fails later, renewals, retries exhausted, card updates and Connect outcomes. Each one
// emits the same normalised events the Stripe adapter produces, through the `emit` the
// factory registered (the one processor), so purchase, lapse and refund paths run with no
// Stripe account.
//
// Every helper throws PaymentsUnavailable in CDS_ENV=production (Pitfall 4, T-10-45-01).
// GO-LIVE: replaced by CDS_PAYMENTS=stripe once keys exist.
import type {
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
  ProviderInvoice,
} from "@cds/core/payments";
import {
  customerFailing,
  createFakeCdsBilling,
  hostedInvoiceUrl,
  itemFromLine,
  storeInvoice,
} from "./billing";
import { createFakePaymentGateway } from "./gateway";
import {
  addInterval,
  checkoutInvoiceLine,
  earliestEnd,
  fakeEvent,
  mustGet,
  pricedIdentity,
  refuseInProduction,
  resolveEmit,
  toInvoice,
  type EmitEvent,
  type FakeAccount,
  type FakeCustomer,
  type FakeInvoice,
  type FakeSession,
  type FakeSubscription,
} from "./shared";
import {
  getFakeObject,
  listFakeObjects,
  putFakeObject,
  updateFakeObject,
  type FakeObject,
} from "./store";

export { fakeSettled } from "./shared";
export type { FakeObject, FakeKind } from "./store";

export type FakeHelperDeps = { emit?: EmitEvent };

/** The fake CdsBilling; `emit` feeds the one processor (the factory passes it). */
export function fakeCdsBilling(deps: {
  emit: EmitEvent;
  now?: () => Date;
}): CdsBilling {
  return createFakeCdsBilling(deps);
}

/** The fake PaymentGateway (tenant Connect accounts and tenant checkouts). */
export function fakePaymentGateway(deps: {
  emit: EmitEvent;
  now?: () => Date;
}): PaymentGateway {
  return createFakePaymentGateway(deps);
}

function withParam(url: string, name: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(name, value);
  return u.toString();
}

function successRedirect(s: FakeObject<FakeSession>): string {
  const url = s.data.successUrl;
  if (url.includes("{CHECKOUT_SESSION_ID}")) {
    return url.replace("{CHECKOUT_SESSION_ID}", s.id);
  }
  return withParam(url, "session_id", s.id);
}

async function setCard(
  customerId: string,
  orgId: string | null,
  failing: boolean,
): Promise<void> {
  const c = await getFakeObject<FakeCustomer>(customerId);
  if (c) {
    await updateFakeObject<FakeCustomer>(customerId, { cardFailing: failing });
    return;
  }
  // A customer id the fake never created (e.g. seeded): record it now.
  await putFakeObject<FakeCustomer>(
    "customer",
    { orgId: orgId ?? "", name: "", email: "", cardFailing: failing },
    orgId,
    { id: customerId },
  );
}

async function emitAll(
  emit: EmitEvent,
  events: readonly NormalisedEvent[],
): Promise<void> {
  for (const e of events) await emit(e);
}

/**
 * The "Test payment" page's buttons for a checkout session. `pay` creates the subscription
 * (recurring lines) and a paid first invoice (one-time lines + the first period, tax 0),
 * then emits `checkout.completed` and `invoice.paid`. `decline` emits nothing and returns
 * the cancel URL with `payment=failed`. `fail_later` pays now and marks the card failing,
 * so the next renewal fails (past due → paused in e2e).
 */
export async function fakeCompleteSession(
  sessionId: string,
  outcome: "pay" | "decline" | "fail_later",
  deps: FakeHelperDeps = {},
): Promise<{ redirect: string }> {
  refuseInProduction();
  const session = await mustGet<FakeSession>(sessionId, "session");
  if (session.data.status === "complete") {
    return { redirect: successRedirect(session) };
  }
  // An expired session cannot be paid (CR-E02: a newer checkout expired it).
  if (outcome === "decline" || session.data.status === "expired") {
    return {
      redirect: withParam(session.data.cancelUrl, "payment", "failed"),
    };
  }
  const emit = await resolveEmit(deps.emit);
  const orgId = session.data.orgId;

  if (session.data.account) {
    // Tenant-side checkout on the tenant's own account (D296): no CDS subscription.
    const done = await updateFakeObject<FakeSession>(session.id, {
      status: "complete",
      paymentStatus: "paid",
    });
    await emit(
      fakeEvent(
        orgId,
        { type: "checkout.completed", sessionId: session.id },
        session.data.account,
      ),
    );
    return { redirect: successRedirect(done) };
  }

  const customerId = session.data.customerId;
  await setCard(customerId, orgId, outcome === "fail_later");
  const now = new Date().toISOString();
  const recurring = session.data.lines.filter((l) => l.interval !== "once");
  let subscriptionId: string | null = null;
  if (recurring.length > 0) {
    const sub = await putFakeObject<FakeSubscription>(
      "subscription",
      {
        orgId,
        customerId,
        status: "active",
        // CR-E01: Checkout sets no item metadata; Stripe reads the kind from the price.
        items: await Promise.all(
          recurring.map(async (l) => ({
            ...itemFromLine(l, addInterval(now, l.interval)),
            ...(await pricedIdentity(l)),
          })),
        ),
        cancelAt: null,
        cadence: session.data.cadence,
        appliedKeys: [],
      },
      orgId,
    );
    subscriptionId = sub.id;
  }
  const invoice = await storeInvoice({
    orgId,
    customerId,
    subscriptionId,
    lines: await Promise.all(session.data.lines.map(checkoutInvoiceLine)),
    description: "Checkout",
    // As on Stripe (WR-E03): no session mark on the invoice; its reason says it opened
    // the subscription, and a subscription-mode session has no invoice of its own (the
    // first invoice is the subscription's latest).
    metadata: {},
    failing: false,
    billingReason: subscriptionId ? "subscription_create" : "manual",
  });
  if (subscriptionId) {
    await updateFakeObject<FakeSubscription>(subscriptionId, {
      latestInvoiceId: invoice.id,
    });
  }
  const done = await updateFakeObject<FakeSession>(session.id, {
    status: "complete",
    paymentStatus: "paid",
    subscriptionId,
    invoiceId: subscriptionId ? null : invoice.id,
  });
  await emitAll(emit, [
    fakeEvent(orgId, { type: "checkout.completed", sessionId: session.id }),
    fakeEvent(orgId, { type: "invoice.paid", invoiceId: invoice.id }),
  ]);
  return { redirect: successRedirect(done) };
}

/** The hosted-invoice "Test payment" page: pay or decline one open invoice. */
export async function fakePayInvoice(
  invoiceId: string,
  outcome: "pay" | "decline",
  deps: FakeHelperDeps = {},
): Promise<ProviderInvoice> {
  refuseInProduction();
  const inv = await mustGet<FakeInvoice>(invoiceId, "invoice");
  if (inv.data.status !== "open") {
    return toInvoice(inv, hostedInvoiceUrl(inv.id));
  }
  const emit = await resolveEmit(deps.emit);
  const saved =
    outcome === "pay"
      ? await updateFakeObject<FakeInvoice>(inv.id, { status: "paid" })
      : await updateFakeObject<FakeInvoice>(inv.id, {
          attempts: inv.data.attempts + 1,
        });
  await emit(
    fakeEvent(inv.data.orgId, {
      type: outcome === "pay" ? "invoice.paid" : "invoice.payment_failed",
      invoiceId: inv.id,
    }),
  );
  return toInvoice(saved, hostedInvoiceUrl(saved.id));
}

/**
 * Renew the items due first (the monthly ones on a mixed yearly subscription). A failing
 * card leaves an open invoice, sets `past_due` and emits `invoice.payment_failed` +
 * `subscription.updated`; a good card pays and emits `invoice.paid`.
 */
export async function fakeRenew(
  subscriptionId: string,
  deps: FakeHelperDeps = {},
): Promise<{ invoiceId: string; paid: boolean }> {
  refuseInProduction();
  const sub = await mustGet<FakeSubscription>(subscriptionId, "subscription");
  if (sub.data.status === "canceled") {
    throw new Error(`fake subscription ${subscriptionId} is canceled`);
  }
  const emit = await resolveEmit(deps.emit);
  const due = earliestEnd(sub.data.items);
  const renewing = sub.data.items.filter((i) => i.currentPeriodEnd === due);
  const items = sub.data.items.map((i) =>
    i.currentPeriodEnd === due
      ? { ...i, currentPeriodEnd: addInterval(i.currentPeriodEnd, i.interval) }
      : i,
  );
  const failing = await customerFailing(sub.data.customerId);
  const orgId = sub.data.orgId;
  const invoice = await storeInvoice({
    orgId,
    customerId: sub.data.customerId,
    subscriptionId: sub.id,
    lines: renewing.map((i) => ({
      kind: i.kind,
      key: i.key,
      amountCents: i.unitCents * i.quantity,
      description: i.label,
    })),
    description: "Renewal",
    metadata: {},
    failing,
    billingReason: "subscription_cycle",
  });
  await updateFakeObject<FakeSubscription>(sub.id, {
    latestInvoiceId: invoice.id,
    items,
    ...(failing ? { status: "past_due" as const } : {}),
  });
  await emitAll(
    emit,
    failing
      ? [
          fakeEvent(orgId, {
            type: "invoice.payment_failed",
            invoiceId: invoice.id,
          }),
          fakeEvent(orgId, {
            type: "subscription.updated",
            subscriptionId: sub.id,
          }),
        ]
      : [fakeEvent(orgId, { type: "invoice.paid", invoiceId: invoice.id })],
  );
  return { invoiceId: invoice.id, paid: !failing };
}

/** Smart Retries gave up: the subscription goes `unpaid` (lapse rules apply). */
export async function fakeExhaustRetries(
  subscriptionId: string,
  deps: FakeHelperDeps = {},
): Promise<void> {
  refuseInProduction();
  const sub = await mustGet<FakeSubscription>(subscriptionId, "subscription");
  const emit = await resolveEmit(deps.emit);
  await updateFakeObject<FakeSubscription>(sub.id, { status: "unpaid" });
  await emit(
    fakeEvent(sub.data.orgId, {
      type: "subscription.updated",
      subscriptionId: sub.id,
    }),
  );
}

/**
 * The portal page ("Save test card" / "Use a card that fails"). A good card pays every open
 * invoice of the customer and reactivates past-due or unpaid subscriptions.
 */
export async function fakeUpdateCard(
  customerId: string,
  failing: boolean,
  deps: FakeHelperDeps = {},
): Promise<{ paidInvoices: number }> {
  refuseInProduction();
  const customer = await mustGet<FakeCustomer>(customerId, "customer");
  await updateFakeObject<FakeCustomer>(customerId, { cardFailing: failing });
  if (failing) return { paidInvoices: 0 };
  const emit = await resolveEmit(deps.emit);
  const events: NormalisedEvent[] = [];
  const invoices = await listFakeObjects<FakeInvoice>({
    kind: "invoice",
    orgRef: customer.orgRef,
  });
  let paidInvoices = 0;
  for (const inv of invoices) {
    if (inv.data.customerId !== customerId || inv.data.status !== "open") {
      continue;
    }
    await updateFakeObject<FakeInvoice>(inv.id, { status: "paid" });
    events.push(
      fakeEvent(inv.data.orgId, { type: "invoice.paid", invoiceId: inv.id }),
    );
    paidInvoices += 1;
  }
  const subs = await listFakeObjects<FakeSubscription>({
    kind: "subscription",
    orgRef: customer.orgRef,
  });
  for (const sub of subs) {
    if (sub.data.customerId !== customerId) continue;
    if (sub.data.status !== "past_due" && sub.data.status !== "unpaid") {
      continue;
    }
    await updateFakeObject<FakeSubscription>(sub.id, { status: "active" });
    events.push(
      fakeEvent(sub.data.orgId, {
        type: "subscription.updated",
        subscriptionId: sub.id,
      }),
    );
  }
  await emitAll(emit, events);
  return { paidInvoices };
}

const CONNECT_OUTCOME = {
  finished: { chargesEnabled: true, detailsSubmitted: true },
  unfinished: { chargesEnabled: false, detailsSubmitted: false },
  restricted: { chargesEnabled: false, detailsSubmitted: true },
} as const;

/** The "Connect a test Stripe account" page: settle the account and emit account.updated. */
export async function fakeConnectOutcome(
  accountId: string,
  kind: "finished" | "unfinished" | "restricted",
  deps: FakeHelperDeps = {},
): Promise<void> {
  refuseInProduction();
  const account = await mustGet<FakeAccount>(accountId, "account");
  const emit = await resolveEmit(deps.emit);
  const flags = CONNECT_OUTCOME[kind];
  await updateFakeObject<FakeAccount>(accountId, {
    ...flags,
    displayName: account.data.displayName ?? "Test business",
    status: flags.chargesEnabled ? "connected" : "restricted",
  });
  await emit(
    fakeEvent(
      account.data.orgId,
      { type: "account.updated", accountId },
      accountId,
    ),
  );
}

/** The tenant disconnected CDS from their Stripe account. */
export async function fakeDeauthorize(
  accountId: string,
  deps: FakeHelperDeps = {},
): Promise<void> {
  refuseInProduction();
  const account = await mustGet<FakeAccount>(accountId, "account");
  const emit = await resolveEmit(deps.emit);
  await updateFakeObject<FakeAccount>(accountId, {
    chargesEnabled: false,
    status: "disconnected",
  });
  await emit(
    fakeEvent(
      account.data.orgId,
      { type: "account.deauthorized", accountId },
      accountId,
    ),
  );
}

/** One fake object for the test pages to render (lines, totals); null when unknown. */
export async function readFakeObject(id: string): Promise<FakeObject | null> {
  refuseInProduction();
  return getFakeObject(id);
}
