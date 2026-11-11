// The payment event ledger, adapter factory and billing spy against a real PocketBase
// (PAY-01, PAY-09, CONTEXT A1; T-10-09-01..04). A claim is keyed on (provider, event_id);
// a failure leaves processed_at empty so the event is retried, never skipped.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import {
  CLAIM_LEASE_MS,
  claimEvent,
  completeEvent,
  eventBacklog,
  failedEvents,
  ledgerRow,
} from "../src/payments/ledger";
import {
  getCdsBilling,
  getPaymentGateway,
  paymentsMode,
  paymentsOpen,
  resetPaymentsForTests,
  setPaymentsForTests,
} from "../src/payments/factory";
import {
  processCdsWebhook,
  processConnectWebhook,
  processNormalisedEvent,
  retryFailedEvents,
} from "../src/payments/process";
import type { HandlerMap } from "../src/payments/handlers/index";
import {
  WebhookSignatureInvalid,
  type NormalisedEvent,
  type PaymentGateway,
} from "@cds/core/payments";
import { createBillingSpy } from "./fake-billing-spy";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
const evt = () => `evt_${randomBytes(6).toString("hex")}`;

const ENV_KEYS = [
  "CDS_PAYMENTS",
  "CDS_ENV",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

describe("payment adapter factory", () => {
  afterEach(() => {
    restoreEnv();
    resetPaymentsForTests();
  });

  it("defaults to fake and refuses an unknown mode", () => {
    delete process.env.CDS_PAYMENTS;
    expect(paymentsMode()).toBe("fake");
    process.env.CDS_PAYMENTS = "stripe";
    expect(paymentsMode()).toBe("stripe");
    process.env.CDS_PAYMENTS = "paypal";
    expect(() => paymentsMode()).toThrow(/CDS_PAYMENTS/);
  });

  it("is closed only for production on the fake", () => {
    delete process.env.CDS_PAYMENTS;
    process.env.CDS_ENV = "production";
    expect(paymentsOpen()).toBe(false);
    process.env.CDS_PAYMENTS = "stripe";
    expect(paymentsOpen()).toBe(true);
    process.env.CDS_ENV = "dev";
    delete process.env.CDS_PAYMENTS;
    expect(paymentsOpen()).toBe(true);
  });

  it("stripe mode without a key is a clear config error", () => {
    process.env.CDS_PAYMENTS = "stripe";
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getCdsBilling()).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => getPaymentGateway()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("stripe mode with a test key builds the Stripe adapter", () => {
    process.env.CDS_PAYMENTS = "stripe";
    process.env.STRIPE_SECRET_KEY = "sk_test_factory";
    expect(getCdsBilling().provider).toBe("stripe");
    expect(getPaymentGateway().provider).toBe("stripe");
    expect(getCdsBilling()).toBe(getCdsBilling());
  });

  it("fake mode (the default) builds the fake adapter", () => {
    delete process.env.CDS_PAYMENTS;
    expect(getCdsBilling().provider).toBe("fake");
    expect(getPaymentGateway().provider).toBe("fake");
    expect(getCdsBilling()).toBe(getCdsBilling());
  });

  it("setPaymentsForTests overrides and resetPaymentsForTests clears", () => {
    delete process.env.CDS_PAYMENTS;
    const spy = createBillingSpy();
    setPaymentsForTests({ billing: spy });
    expect(getCdsBilling()).toBe(spy);
    resetPaymentsForTests();
    expect(getCdsBilling()).not.toBe(spy);
    expect(getCdsBilling().provider).toBe("fake");
  });
});

describe("billing spy", () => {
  it("records nothing when untouched and every call when used", async () => {
    const spy = createBillingSpy({ portalUrl: "https://portal.invalid/x" });
    expect(spy.calls.length).toBe(0);
    await spy.ensureCustomer({
      orgId: "o1",
      customerId: null,
      name: "N",
      email: "n@example.test",
      idempotencyKey: "k",
    });
    expect(
      await spy.portalUrl({ customerId: "cus_1", returnUrl: "https://x.test" }),
    ).toBe("https://portal.invalid/x");
    await expect(spy.fetchInvoice("in_1")).rejects.toThrow(/no canned/);
    expect(spy.calls.map((c) => c.method)).toEqual([
      "ensureCustomer",
      "portalUrl",
      "fetchInvoice",
    ]);
    expect(spy.callsTo("portalUrl")[0]?.args[0]).toEqual({
      customerId: "cus_1",
      returnUrl: "https://x.test",
    });
  });
});

describe("payment event ledger (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("claims an event once per (provider, event_id)", async (ctx) => {
    if (!booted) return ctx.skip();
    const eventId = evt();
    const input = {
      provider: "stripe" as const,
      eventId,
      type: "invoice.paid" as const,
      account: null,
      orgRef: "org123",
      objectRef: "in_123",
    };
    const first = await claimEvent(input);
    expect(first).toEqual({
      id: first.id,
      processed: false,
      attempts: 0,
      inProgress: false,
    });
    // WR-E07: the first claim is fresh, so a second claimer (another process) waits.
    const again = await claimEvent(input);
    expect(again.id).toBe(first.id);
    expect(again.processed).toBe(false);
    expect(again.inProgress).toBe(true);

    await completeEvent(first.id, "applied");
    const third = await claimEvent(input);
    expect(third).toEqual({
      id: first.id,
      processed: true,
      attempts: 0,
      inProgress: false,
    });
    const row = await ledgerRow(first.id);
    expect(row.processedAt).not.toBeNull();
    expect(row.outcome).toBe("applied");
    expect(row.objectRef).toBe("in_123");

    const fake = await claimEvent({ ...input, provider: "fake" });
    expect(fake.id).not.toBe(first.id);
  });

  it("a failure keeps processed_at empty, counts and caps the error", async (ctx) => {
    if (!booted) return ctx.skip();
    const claim = await claimEvent({
      provider: "fake",
      eventId: evt(),
      type: "checkout.completed",
      account: null,
      orgRef: null,
      objectRef: "cs_1",
    });
    const err = new TypeError("x".repeat(500));
    await completeEvent(claim.id, "failed", err);
    await completeEvent(claim.id, "failed", err);
    const row = await ledgerRow(claim.id);
    expect(row.processedAt).toBeNull();
    expect(row.outcome).toBe("failed");
    expect(row.attempts).toBe(2);
    expect(row.error.length).toBe(300);
    expect(row.error.startsWith("TypeError: xxx")).toBe(true);

    const failed = await failedEvents(200);
    expect(failed.map((r) => r.id)).toContain(claim.id);
    expect(await eventBacklog(0)).toBeGreaterThanOrEqual(1);
    expect(await eventBacklog(60)).toBe(0);

    const reclaim = await claimEvent({
      provider: "fake",
      eventId: row.eventId,
      type: "checkout.completed",
      account: null,
      orgRef: null,
    });
    // A failure releases the claim: the retry takes it at once.
    expect(reclaim).toEqual({
      id: claim.id,
      processed: false,
      attempts: 2,
      inProgress: false,
    });
  });

  it("WR-E07: a claim crashed with no outcome is swept once its lease is stale", async (ctx) => {
    if (!booted) return ctx.skip();
    const claim = await claimEvent({
      provider: "fake",
      eventId: evt(),
      type: "invoice.paid",
      account: null,
      orgRef: null,
      objectRef: "in_crash",
    });
    // The process died here: no completeEvent. While the lease holds, nobody runs it.
    expect((await failedEvents(200)).map((r) => r.id)).not.toContain(claim.id);
    const pb = await superuser();
    await pb.collection("payment_events").update(claim.id, {
      claimed_at: new Date(Date.now() - CLAIM_LEASE_MS - 60_000).toISOString(),
    });
    expect((await failedEvents(200)).map((r) => r.id)).toContain(claim.id);
    const row = await ledgerRow(claim.id);
    const taken = await claimEvent({
      provider: "fake",
      eventId: row.eventId,
      type: "invoice.paid",
      account: null,
      orgRef: null,
    });
    expect(taken).toMatchObject({ processed: false, inProgress: false });
  });

  // ---- processor (Task 2) ----

  const gateway = { provider: "fake" } as unknown as PaymentGateway;
  const paid = (id = evt()): NormalisedEvent => ({
    id,
    provider: "fake",
    account: null,
    orgId: "org123",
    createdAt: new Date().toISOString(),
    type: "invoice.paid",
    invoiceId: "in_proc",
  });
  async function rowFor(eventId: string) {
    const failed = await failedEvents(200);
    return failed.find((r) => r.eventId === eventId);
  }

  it("processes an event once; a replay is a 200 duplicate", async (ctx) => {
    if (!booted) return ctx.skip();
    let calls = 0;
    const handlers: HandlerMap = {
      "invoice.paid": () => {
        calls += 1;
        return Promise.resolve("applied");
      },
    };
    const billing = createBillingSpy();
    const e = paid();
    const deps = { billing, gateway, handlers };
    expect(await processNormalisedEvent(e, deps)).toEqual({
      status: 200,
      outcome: "applied",
    });
    expect(await processNormalisedEvent(e, deps)).toEqual({
      status: 200,
      outcome: "duplicate",
    });
    // Concurrent replays are serialised in-process: still one dispatch.
    const both = await Promise.all([
      processNormalisedEvent(e, deps),
      processNormalisedEvent(e, deps),
    ]);
    expect(both.map((r) => r.outcome)).toEqual(["duplicate", "duplicate"]);
    expect(calls).toBe(1);
    const claim = await claimEvent({
      provider: "fake",
      eventId: e.id,
      type: e.type,
      account: null,
      orgRef: null,
    });
    expect(claim.processed).toBe(true);
    expect(billing.calls.length).toBe(0);
  });

  it("a throwing handler fails (500), then the retry sweep applies it", async (ctx) => {
    if (!booted) return ctx.skip();
    let calls = 0;
    const handlers: HandlerMap = {
      "invoice.paid": (ev) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("boom"));
        expect(ev.type === "invoice.paid" && ev.invoiceId).toBe("in_proc");
        return Promise.resolve("applied");
      },
    };
    const e = paid();
    const deps = { billing: createBillingSpy(), gateway, handlers };
    expect(await processNormalisedEvent(e, deps)).toEqual({
      status: 500,
      outcome: "failed",
    });
    const failedRow = await rowFor(e.id);
    expect(failedRow?.processedAt).toBeNull();
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.error).toBe("Error: boom");

    const sweep = await retryFailedEvents(deps);
    expect(sweep.retried).toBeGreaterThanOrEqual(1);
    expect(calls).toBe(2);
    expect(await rowFor(e.id)).toBeUndefined();
    const claim = await claimEvent({
      provider: "fake",
      eventId: e.id,
      type: e.type,
      account: null,
      orgRef: null,
    });
    const row = await ledgerRow(claim.id);
    expect(row.outcome).toBe("applied");
    expect(row.processedAt).not.toBeNull();
  });

  it("WR-E07: an event another process holds answers 500 in_progress and runs nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    let calls = 0;
    const handlers: HandlerMap = {
      "invoice.paid": () => {
        calls += 1;
        return Promise.resolve("applied");
      },
    };
    const e = paid();
    // Another process (the billing:reconcile CLI beside the app) claimed it just now.
    await claimEvent({
      provider: "fake",
      eventId: e.id,
      type: e.type,
      account: null,
      orgRef: null,
      objectRef: "in_proc",
    });
    const deps = { billing: createBillingSpy(), gateway, handlers };
    expect(await processNormalisedEvent(e, deps)).toEqual({
      status: 500,
      outcome: "in_progress",
    });
    expect(calls).toBe(0);
    const sweep = await retryFailedEvents(deps);
    expect(calls).toBe(0);
    expect(sweep.applied).toBe(0);
  });

  it("an event with no handler is recorded ignored", async (ctx) => {
    if (!booted) return ctx.skip();
    const e: NormalisedEvent = {
      ...paid(),
      type: "ignored",
      originalType: "customer.created",
    };
    expect(await processNormalisedEvent(e, { gateway, handlers: {} })).toEqual({
      status: 200,
      outcome: "ignored",
    });
    const claim = await claimEvent({
      provider: "fake",
      eventId: e.id,
      type: e.type,
      account: null,
      orgRef: null,
    });
    expect(claim.processed).toBe(true);
    expect((await ledgerRow(claim.id)).outcome).toBe("ignored");
  });

  it("webhooks: bad signature 400 with no row, unexpected error 500, valid 200", async (ctx) => {
    if (!booted) return ctx.skip();
    const before = await eventBacklog(0);
    const bad = createBillingSpy({
      normaliseWebhook: () => Promise.reject(new WebhookSignatureInvalid()),
    });
    expect(await processCdsWebhook("{}", "sig", { billing: bad })).toEqual({
      status: 400,
      orgId: null,
    });
    const broken = createBillingSpy({
      normaliseWebhook: () => Promise.reject(new Error("socket")),
    });
    expect(await processCdsWebhook("{}", "sig", { billing: broken })).toEqual({
      status: 500,
      orgId: null,
    });
    expect(await eventBacklog(0)).toBe(before);

    const e = paid();
    const ok = createBillingSpy({ normaliseWebhook: e });
    expect(
      await processCdsWebhook("{}", "sig", {
        billing: ok,
        gateway,
        handlers: {},
      }),
    ).toEqual({ status: 200, orgId: null });
    expect(ok.callsTo("normaliseWebhook")[0]?.args).toEqual(["{}", "sig"]);

    // 10-24 choice 2: an applied event names its org so the route can revalidate it.
    const applied = createBillingSpy({ normaliseWebhook: paid() });
    expect(
      await processCdsWebhook("{}", "sig", {
        billing: applied,
        gateway,
        handlers: { "invoice.paid": () => Promise.resolve("applied") },
      }),
    ).toEqual({ status: 200, orgId: "org123" });

    const connect = {
      provider: "fake",
      normaliseWebhook: () => Promise.reject(new WebhookSignatureInvalid()),
    } as unknown as PaymentGateway;
    expect(
      await processConnectWebhook("{}", "sig", { gateway: connect }),
    ).toEqual({ status: 400, orgId: null });
  });
});
