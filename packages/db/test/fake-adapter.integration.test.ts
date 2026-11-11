// The fake payment adapter against a real PocketBase (PAY-09, CONTEXT A1; T-10-45-01..03).
// State lives in payment_fake_objects; events go out through the injected `emit` (captured
// here), the same normalised events the Stripe adapter produces.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PaymentsUnavailable,
  WebhookSignatureInvalid,
  type BillingLine,
  type NormalisedEvent,
} from "@cds/core/payments";
import { platformUrl } from "../src/email/env";
import { superuser } from "../src/client";
import { createFakeCdsBilling } from "../src/payments/fake/billing";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakeConnectOutcome,
  fakeDeauthorize,
  fakeExhaustRetries,
  fakePayInvoice,
  fakePaymentGateway,
  fakeRenew,
  fakeUpdateCard,
  readFakeObject,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import {
  getCdsBilling,
  getPaymentGateway,
  resetPaymentsForTests,
} from "../src/payments/factory";
import { ledgerRow } from "../src/payments/ledger";
import {
  getFakeObject,
  putFakeObject,
  updateFakeObject,
} from "../src/payments/fake/store";
import type {
  FakeCustomer,
  FakeSession,
  FakeSubscription,
} from "../src/payments/fake/shared";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
const savedEnv = {
  CDS_ENV: process.env.CDS_ENV,
  CDS_PAYMENTS: process.env.CDS_PAYMENTS,
};

function capture() {
  const events: NormalisedEvent[] = [];
  const emit = (e: NormalisedEvent) => {
    events.push(e);
    return Promise.resolve();
  };
  return { events, emit };
}

const org = () => `org${randomBytes(5).toString("hex")}`;
const key = () => `k_${randomBytes(6).toString("hex")}`;

const line = (over: Partial<BillingLine> = {}): BillingLine => ({
  kind: "addon",
  key: "events",
  label: "Events",
  interval: "month",
  unitCents: 3000,
  quantity: 1,
  priceRef: "price_fake_events",
  ...over,
});

async function customer(orgId: string, cardFailing = false) {
  return putFakeObject<FakeCustomer>(
    "customer",
    { orgId, name: "Owner", email: "o@example.test", cardFailing },
    orgId,
  );
}

async function subscription(orgId: string, customerId: string) {
  const end = new Date(Date.now() + 15 * 86_400_000).toISOString();
  const yearEnd = new Date(Date.now() + 200 * 86_400_000).toISOString();
  return putFakeObject<FakeSubscription>(
    "subscription",
    {
      orgId,
      customerId,
      status: "active",
      cadence: "monthly",
      cancelAt: null,
      appliedKeys: [],
      items: [
        {
          id: "si_fake_base",
          priceRef: "price_fake_base",
          kind: "plan",
          key: "standard",
          quantity: 1,
          interval: "month",
          currentPeriodEnd: end,
          unitCents: 5000,
          label: "Base plan",
        },
        {
          id: "si_fake_year",
          priceRef: "price_fake_year",
          kind: "addon",
          key: "newsletter",
          quantity: 1,
          interval: "year",
          currentPeriodEnd: yearEnd,
          unitCents: 12000,
          label: "Newsletter",
        },
      ],
    },
    orgId,
  );
}

beforeAll(async () => {
  booted = await bootSeededPb();
});
afterAll(async () => {
  await booted?.inst.stop();
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPaymentsForTests();
});

/** payment_events rows for one org (test-only read through the superuser client). */
async function ledgerRowsFor(orgId: string) {
  const pb = await superuser();
  const recs = await pb.collection("payment_events").getFullList({
    filter: pb.filter("org_ref = {:o}", { o: orgId }),
  });
  return Promise.all(recs.map((r) => ledgerRow(r.id)));
}

describe("fake CdsBilling (throwaway PocketBase)", () => {
  it("createCheckout stores the session and points at the test payment page", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const k = key();
    const input = {
      orgId,
      customerId: "cus_fake_x",
      lines: [
        line(),
        line({ kind: "build_fee", key: "base", interval: "once" }),
      ],
      deferredMonthly: [line({ kind: "care_plan", key: "care" })],
      cadence: "yearly" as const,
      successUrl: "https://cds.test/ok",
      cancelUrl: "https://cds.test/back",
      idempotencyKey: k,
    };
    const r = await billing.createCheckout(input);
    expect(r.sessionId).toMatch(/^cs_fake_[0-9a-z]{15}$/);
    expect(r.url).toBe(platformUrl(`/test-pay/${r.sessionId}`));
    const stored = await getFakeObject<FakeSession>(r.sessionId);
    expect(stored?.orgRef).toBe(orgId);
    expect(stored?.data.lines.length).toBe(2);
    expect(stored?.data.deferredMonthly[0]?.key).toBe("care");
    expect(stored?.data.cadence).toBe("yearly");
    expect(stored?.data.status).toBe("open");
    // Idempotent: the same key returns the same session.
    expect((await billing.createCheckout(input)).sessionId).toBe(r.sessionId);
    const s = await billing.fetchCheckoutSession(r.sessionId);
    expect(s).toMatchObject({ status: "open", paymentStatus: "unpaid", orgId });
    await fakeSettled();
    expect(events.length).toBe(0);
  });

  it("changeItems: a failing card with chargeNow changes nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId, true);
    const sub = await subscription(orgId, c.id);
    const r = await billing.changeItems({
      subscriptionId: sub.id,
      add: [line()],
      remove: [],
      setQuantity: [],
      oneTime: [
        line({
          kind: "extra",
          key: "setup",
          interval: "once",
          unitCents: 2500,
        }),
      ],
      proration: "always_invoice",
      chargeNow: true,
      idempotencyKey: key(),
    });
    expect(r).toEqual({ applied: false, reason: "card_declined" });
    const after = await billing.fetchSubscription(sub.id);
    expect(after.items.length).toBe(2);
    await fakeSettled();
    expect(events.length).toBe(0);
  });

  it("changeItems: a good card applies, invoices and emits invoice.paid", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const sub = await subscription(orgId, c.id);
    const change = {
      subscriptionId: sub.id,
      add: [line()],
      remove: [],
      setQuantity: [],
      oneTime: [
        line({
          kind: "extra",
          key: "setup",
          interval: "once",
          unitCents: 2500,
        }),
      ],
      proration: "always_invoice" as const,
      chargeNow: true,
    };
    const preview = await billing.previewChange(change);
    expect(preview.taxCents).toBe(0);
    expect(preview.thenMonthlyCents).toBe(5000 + 1000 + 3000);
    expect(preview.todayCents).toBeGreaterThan(2500);
    expect(preview.todayCents).toBeLessThan(2500 + 3000);

    const k = key();
    const r = await billing.changeItems({ ...change, idempotencyKey: k });
    expect(r.applied).toBe(true);
    if (!r.applied) return;
    expect(r.invoice?.status).toBe("paid");
    expect(r.invoice?.totalCents).toBe(preview.todayCents);
    expect(r.invoice?.taxCents).toBe(0);
    expect(r.invoice?.orgId).toBe(orgId);
    const after = await billing.fetchSubscription(sub.id);
    expect(after.items.map((i) => i.key)).toContain("events");
    await fakeSettled();
    expect(events.map((e) => e.type)).toContain("invoice.paid");
    expect(
      events.every((e) => e.provider === "fake" && e.orgId === orgId),
    ).toBe(true);
    expect(events.every((e) => e.id.startsWith("evt_fake_"))).toBe(true);

    // A retry with the same key does not apply twice.
    const again = await billing.changeItems({ ...change, idempotencyKey: k });
    expect(again.applied && again.invoice?.id).toBe(r.invoice?.id);
    expect((await billing.fetchSubscription(sub.id)).items.length).toBe(3);
  });

  it("changeItems: proration none creates no invoice", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const sub = await subscription(orgId, c.id);
    const r = await billing.changeItems({
      subscriptionId: sub.id,
      add: [line({ kind: "care_plan", key: "care", unitCents: 9900 })],
      remove: ["si_fake_year"],
      setQuantity: [],
      oneTime: [],
      proration: "none",
      chargeNow: false,
      idempotencyKey: key(),
    });
    expect(r).toEqual({ applied: true, invoice: null });
    const after = await billing.fetchSubscription(sub.id);
    expect(after.items.map((i) => i.key).sort()).toEqual(["care", "standard"]);
    await fakeSettled();
  });

  it("refundAll refunds every paid invoice and emits charge.refunded", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const mk = (cents: number) =>
      billing.createInvoice({
        orgId,
        customerId: c.id,
        lines: [
          line({ kind: "extra", key: "x", interval: "once", unitCents: cents }),
        ],
        description: "Extra",
        metadata: { work: "w1" },
        idempotencyKey: key(),
      });
    const a = await mk(1000);
    const b = await mk(2500);
    expect(a.status).toBe("paid");
    expect(a.metadata).toMatchObject({ work: "w1", org: orgId });
    expect(a.hostedUrl).toBe(platformUrl(`/test-pay/${a.id}`));

    const r = await billing.refundAll({
      customerId: c.id,
      idempotencyKey: key(),
    });
    expect(r).toEqual({ refundedCents: 3500, count: 2 });
    expect((await billing.fetchInvoice(a.id)).refundedCents).toBe(1000);
    expect((await billing.fetchInvoice(b.id)).refundedCents).toBe(2500);
    // Nothing left to refund.
    expect(
      await billing.refundAll({ customerId: c.id, idempotencyKey: key() }),
    ).toEqual({ refundedCents: 0, count: 0 });
    await fakeSettled();
    const refunded = events.filter((e) => e.type === "charge.refunded");
    expect(refunded.length).toBe(1);
    expect(refunded[0]).toMatchObject({ customerId: c.id, orgId });
    const listed = await billing.listInvoices({
      customerId: c.id,
      since: null,
    });
    expect(listed.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("cancel term runs to the period end; cancel now deletes", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = createFakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const sub = await subscription(orgId, c.id);
    const term = await billing.cancel({
      subscriptionId: sub.id,
      mode: "term",
      idempotencyKey: key(),
    });
    const yearEnd = sub.data.items.find(
      (i) => i.interval === "year",
    )?.currentPeriodEnd;
    expect(term.cancelAt).toBe(yearEnd);
    expect(term.status).toBe("active");
    const now = await billing.cancel({
      subscriptionId: sub.id,
      mode: "now",
      idempotencyKey: key(),
    });
    expect(now.status).toBe("canceled");
    await fakeSettled();
    expect(events.map((e) => e.type)).toEqual([
      "subscription.updated",
      "subscription.deleted",
    ]);
  });

  it("reconcile synthesises events from objects updated since", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit } = capture();
    const billing = createFakeCdsBilling({ emit });
    const since = new Date(Date.now() - 1000);
    const orgId = org();
    const c = await customer(orgId);
    const sub = await subscription(orgId, c.id);
    const inv = await billing.createInvoice({
      orgId,
      customerId: c.id,
      lines: [line({ interval: "once" })],
      description: "x",
      metadata: {},
      idempotencyKey: key(),
    });
    const events = await billing.reconcile({ since });
    const byObj = new Map(
      events.map((e) => [
        "subscriptionId" in e
          ? e.subscriptionId
          : "invoiceId" in e
            ? e.invoiceId
            : "",
        e,
      ]),
    );
    expect(byObj.get(sub.id)?.type).toBe("subscription.updated");
    expect(byObj.get(inv.id)?.type).toBe("invoice.paid");
    const first = byObj.get(sub.id)!.id;
    expect(first).toMatch(new RegExp(`^reconcile:${sub.id}:active:`));
    // CR-E04: an unchanged object keeps its id (the ledger dedups it) ...
    const again = await billing.reconcile({ since });
    expect(
      again.find((e) => "subscriptionId" in e && e.subscriptionId === sub.id)
        ?.id,
    ).toBe(first);
    // ... while the same status reached again (active -> unpaid -> active) is a new event.
    await updateFakeObject(sub.id, { status: "unpaid" });
    await new Promise((r) => setTimeout(r, 5));
    await updateFakeObject(sub.id, { status: "active" });
    const cycled = await billing.reconcile({ since });
    const next = cycled.find(
      (e) => "subscriptionId" in e && e.subscriptionId === sub.id,
    )!.id;
    expect(next).toMatch(new RegExp(`^reconcile:${sub.id}:active:`));
    expect(next).not.toBe(first);
    const later = await billing.reconcile({
      since: new Date(Date.now() + 60_000),
    });
    expect(later.some((e) => "invoiceId" in e && e.invoiceId === inv.id)).toBe(
      false,
    );
    await fakeSettled();
  });

  it("refuses money calls in production and never accepts webhooks", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit } = capture();
    const billing = createFakeCdsBilling({ emit });
    await expect(billing.normaliseWebhook("{}", "sig")).rejects.toBeInstanceOf(
      WebhookSignatureInvalid,
    );
    process.env.CDS_ENV = "production";
    await expect(
      billing.createCheckout({
        orgId: "o",
        customerId: "cus_fake_x",
        lines: [line()],
        deferredMonthly: [],
        cadence: "monthly",
        successUrl: "https://x.test",
        cancelUrl: "https://x.test",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PaymentsUnavailable);
    await expect(
      billing.changeItems({
        subscriptionId: "sub_fake_x",
        add: [],
        remove: [],
        setQuantity: [],
        oneTime: [],
        proration: "none",
        chargeNow: false,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow("Payments open soon");
    await expect(
      billing.createInvoice({
        orgId: "o",
        customerId: "cus_fake_x",
        lines: [],
        description: "x",
        metadata: {},
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PaymentsUnavailable);
  });
});

describe("fake helpers, fake gateway and the factory default", () => {
  async function checkout(
    billing: ReturnType<typeof fakeCdsBilling>,
    orgId: string,
    customerId: string,
  ) {
    return billing.createCheckout({
      orgId,
      customerId,
      lines: [
        line({ kind: "plan", key: "base", unitCents: 5000 }),
        line({
          kind: "build_fee",
          key: "base",
          interval: "once",
          unitCents: 20000,
        }),
      ],
      deferredMonthly: [],
      cadence: "monthly",
      successUrl: "https://cds.test/done?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://cds.test/checkout",
      idempotencyKey: key(),
    });
  }

  it("pay: subscription + paid first invoice, checkout.completed then invoice.paid", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = fakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const s = await checkout(billing, orgId, c.id);
    const r = await fakeCompleteSession(s.sessionId, "pay", { emit });
    expect(r.redirect).toBe(`https://cds.test/done?session_id=${s.sessionId}`);
    expect(events.map((e) => e.type)).toEqual([
      "checkout.completed",
      "invoice.paid",
    ]);
    const session = await billing.fetchCheckoutSession(s.sessionId);
    expect(session).toMatchObject({
      status: "complete",
      paymentStatus: "paid",
    });
    const sub = await billing.fetchSubscription(session.subscriptionId ?? "");
    expect(sub.status).toBe("active");
    expect(sub.items.map((i) => i.kind)).toEqual(["plan"]);
    // As on Stripe (WR-E03): a subscription-mode session has no invoice of its own; the
    // first invoice is the subscription's latest, marked subscription_create.
    expect(session.invoiceId).toBeNull();
    const inv = await billing.fetchInvoice(sub.latestInvoiceId ?? "");
    expect(inv).toMatchObject({
      status: "paid",
      totalCents: 25000,
      taxCents: 0,
      billingReason: "subscription_create",
    });
    expect(inv.metadata.session).toBeUndefined();
    expect((await readFakeObject(s.sessionId))?.kind).toBe("session");
    // A second press is a no-op redirect.
    await fakeCompleteSession(s.sessionId, "pay", { emit });
    expect(events.length).toBe(2);
  });

  it("decline emits nothing and returns to the cancel URL with payment=failed", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = fakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const s = await checkout(billing, orgId, c.id);
    const r = await fakeCompleteSession(s.sessionId, "decline", { emit });
    expect(r.redirect).toBe("https://cds.test/checkout?payment=failed");
    expect(events.length).toBe(0);
    expect((await billing.fetchCheckoutSession(s.sessionId)).status).toBe(
      "open",
    );
  });

  it("card fails later: past due, then unpaid, then a new card recovers", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = fakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId);
    const s = await checkout(billing, orgId, c.id);
    await fakeCompleteSession(s.sessionId, "fail_later", { emit });
    const subId =
      (await billing.fetchCheckoutSession(s.sessionId)).subscriptionId ?? "";
    events.length = 0;

    const renewal = await fakeRenew(subId, { emit });
    expect(renewal.paid).toBe(false);
    expect(events.map((e) => e.type)).toEqual([
      "invoice.payment_failed",
      "subscription.updated",
    ]);
    expect((await billing.fetchSubscription(subId)).status).toBe("past_due");
    expect((await billing.fetchInvoice(renewal.invoiceId)).status).toBe("open");

    events.length = 0;
    await fakeExhaustRetries(subId, { emit });
    expect(events.map((e) => e.type)).toEqual(["subscription.updated"]);
    expect((await billing.fetchSubscription(subId)).status).toBe("unpaid");

    events.length = 0;
    expect(await fakeUpdateCard(c.id, false, { emit })).toEqual({
      paidInvoices: 1,
    });
    expect(events.map((e) => e.type)).toEqual([
      "invoice.paid",
      "subscription.updated",
    ]);
    expect((await billing.fetchSubscription(subId)).status).toBe("active");
    expect((await billing.fetchInvoice(renewal.invoiceId)).status).toBe("paid");

    events.length = 0;
    const good = await fakeRenew(subId, { emit });
    expect(good.paid).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["invoice.paid"]);
  });

  it("pays or declines a hosted invoice", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const billing = fakeCdsBilling({ emit });
    const orgId = org();
    const c = await customer(orgId, true);
    const inv = await billing.createInvoice({
      orgId,
      customerId: c.id,
      lines: [line({ kind: "extra", key: "x", interval: "once" })],
      description: "Extra",
      metadata: {},
      idempotencyKey: key(),
    });
    expect(inv.status).toBe("open");
    await fakeSettled();
    events.length = 0;
    await fakePayInvoice(inv.id, "decline", { emit });
    expect((await fakePayInvoice(inv.id, "pay", { emit })).status).toBe("paid");
    expect(events.map((e) => e.type)).toEqual([
      "invoice.payment_failed",
      "invoice.paid",
    ]);
  });

  it("gateway: connect outcomes, tenant checkout, refund and deauthorize", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit, events } = capture();
    const gateway = fakePaymentGateway({ emit });
    const orgId = org();
    const started = await gateway.startConnect({
      orgId,
      accountId: null,
      mode: "new",
      returnUrl: "https://cds.test/r",
      refreshUrl: "https://cds.test/f",
    });
    expect(started.accountId).toMatch(/^acct_fake_/);
    expect(started.url).toBe(
      platformUrl(`/test-pay/connect?account=${started.accountId}`),
    );
    expect(
      (await gateway.accountStatus(started.accountId)).detailsSubmitted,
    ).toBe(false);

    await fakeConnectOutcome(started.accountId, "restricted", { emit });
    expect(await gateway.accountStatus(started.accountId)).toMatchObject({
      chargesEnabled: false,
      detailsSubmitted: true,
      status: "restricted",
    });
    expect(events[0]).toMatchObject({
      type: "account.updated",
      account: started.accountId,
      orgId,
    });

    await fakeConnectOutcome(started.accountId, "finished", { emit });
    const co = await gateway.createCheckout({
      accountId: started.accountId,
      lines: [
        line({
          kind: "extra",
          key: "ticket",
          interval: "once",
          unitCents: 4000,
        }),
      ],
      successUrl: "https://tenant.test/thanks",
      cancelUrl: "https://tenant.test/cart",
      customerEmail: "buyer@example.test",
      idempotencyKey: key(),
    });
    const done = await fakeCompleteSession(co.sessionId, "pay", { emit });
    expect(done.redirect).toBe(
      `https://tenant.test/thanks?session_id=${co.sessionId}`,
    );
    expect(events.at(-1)).toMatchObject({
      type: "checkout.completed",
      account: started.accountId,
    });
    const paymentRef = co.sessionId.replace("cs_fake_", "pi_fake_");
    const accountId = started.accountId;
    const k = key();
    const refund = (cents: number | null, idempotencyKey: string) =>
      gateway.refund({ accountId, paymentRef, cents, idempotencyKey });
    expect(await refund(1500, k)).toEqual({ refundedCents: 1500 });
    // Same key: the same refund, not a second one.
    expect(await refund(1500, k)).toEqual({ refundedCents: 1500 });
    expect(await refund(null, key())).toEqual({ refundedCents: 2500 });

    await fakeDeauthorize(accountId, { emit });
    expect(events.at(-1)?.type).toBe("account.deauthorized");
    expect((await gateway.accountStatus(accountId)).status).toBe(
      "disconnected",
    );
    const rec = await gateway.reconcile({
      since: new Date(0),
      accountIds: [accountId],
    });
    expect(rec[0]?.type).toBe("account.deauthorized");
    await expect(gateway.normaliseWebhook("{}", "s")).rejects.toBeInstanceOf(
      WebhookSignatureInvalid,
    );
  });

  it("the factory default is the fake, and its events reach the one processor", async (ctx) => {
    if (!booted) return ctx.skip();
    delete process.env.CDS_PAYMENTS;
    resetPaymentsForTests();
    const billing = getCdsBilling();
    expect(billing.provider).toBe("fake");
    expect(getPaymentGateway().provider).toBe("fake");
    const orgId = org();
    const c = await customer(orgId);
    const s = await billing.createCheckout({
      orgId,
      customerId: c.id,
      lines: [line({ kind: "plan", key: "base" })],
      deferredMonthly: [],
      cadence: "monthly",
      successUrl: "https://cds.test/done",
      cancelUrl: "https://cds.test/back",
      idempotencyKey: key(),
    });
    // No emit passed: the helper uses the one the factory registered (emitToProcessor).
    await fakeCompleteSession(s.sessionId, "pay");
    expect((await billing.fetchCheckoutSession(s.sessionId)).status).toBe(
      "complete",
    );
    const rows = await ledgerRowsFor(orgId);
    expect(rows.map((r) => r.type).sort()).toEqual([
      "checkout.completed",
      "invoice.paid",
    ]);
    expect(rows.every((r) => r.provider === "fake")).toBe(true);
    expect(rows.every((r) => r.processedAt !== null)).toBe(true);
    const completed = rows.find((r) => r.type === "checkout.completed");
    expect(completed?.objectRef).toBe(s.sessionId);
  });

  it("every fake helper refuses in production", async (ctx) => {
    if (!booted) return ctx.skip();
    const { emit } = capture();
    const gateway = fakePaymentGateway({ emit });
    process.env.CDS_ENV = "production";
    const calls: Array<() => Promise<unknown>> = [
      () => fakeCompleteSession("cs_fake_x", "pay", { emit }),
      () => fakePayInvoice("in_fake_x", "pay", { emit }),
      () => fakeRenew("sub_fake_x", { emit }),
      () => fakeExhaustRetries("sub_fake_x", { emit }),
      () => fakeUpdateCard("cus_fake_x", false, { emit }),
      () => fakeConnectOutcome("acct_fake_x", "finished", { emit }),
      () => fakeDeauthorize("acct_fake_x", { emit }),
      () => readFakeObject("cs_fake_x"),
      () =>
        gateway.startConnect({
          orgId: "o",
          accountId: null,
          mode: "new",
          returnUrl: "https://x.test",
          refreshUrl: "https://x.test",
        }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(PaymentsUnavailable);
    }
  });
});
