// P10 Stripe CdsBilling adapter against recorded requests (no network, no Stripe account).
import { describe, expect, it } from "vitest";
import type { BillingLine, ChangeItemsInput } from "@cds/core/payments";
import { stripeClient } from "./client";
import { stripeCdsBilling } from "./index";
import { mapInvoice, mapSubscription, minPeriodEnd } from "./billing";
import { createRecordingHttpClient, type Fixture } from "./recording-http";
import events from "./__fixtures__/events.json";
import objects from "./__fixtures__/objects.json";

const NOW = new Date("2026-10-09T12:00:00Z");

const noPayments = {
  object: "list",
  has_more: false,
  url: "/v1/invoice_payments",
  data: [],
};

function setup(fixtures: Record<string, Fixture>) {
  const http = createRecordingHttpClient(fixtures);
  const stripe = stripeClient("sk_test_x", {
    env: { CDS_ENV: "dev" },
    httpClient: http.httpClient,
  });
  const billing = stripeCdsBilling({
    stripe,
    now: () => NOW,
    webhookSecret: "whsec_test",
  });
  return { http, billing };
}

function only(http: ReturnType<typeof setup>["http"], route: string) {
  const hits = http.find(route);
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

const plan: BillingLine = {
  kind: "plan",
  key: "base",
  label: "Standard plan",
  interval: "month",
  unitCents: 9900,
  quantity: 1,
  priceRef: "price_test_plan",
};
const buildFee: BillingLine = {
  kind: "build_fee",
  key: "base",
  label: "Build fee",
  interval: "once",
  unitCents: 50000,
  quantity: 1,
  priceRef: null,
};
const addon: BillingLine = {
  kind: "addon",
  key: "events",
  label: "Events",
  interval: "month",
  unitCents: 1500,
  quantity: 1,
  priceRef: "price_test_addon_new",
};
const setupFee: BillingLine = {
  kind: "extra",
  key: "setup",
  label: "Setup",
  interval: "once",
  unitCents: 2500,
  quantity: 1,
  priceRef: "price_test_setup",
};

const change: ChangeItemsInput = {
  subscriptionId: "sub_test_1",
  add: [addon],
  remove: ["si_test_addon"],
  setQuantity: [{ itemId: "si_test_plan", quantity: 1 }],
  oneTime: [setupFee],
  proration: "always_invoice",
  chargeNow: true,
  idempotencyKey: "idem_change_1",
};

describe("ensureCustomer", () => {
  it("reuses a passed customer id without a request", async () => {
    const { http, billing } = setup({});
    const out = await billing.ensureCustomer({
      orgId: "org_test_1",
      customerId: "cus_existing",
      name: "Test",
      email: "a@b.test",
      idempotencyKey: "k",
    });
    expect(out.customerId).toBe("cus_existing");
    expect(http.requests).toHaveLength(0);
  });

  it("creates one with metadata[org] and the idempotency key", async () => {
    const { http, billing } = setup({ "POST /v1/customers": objects.customer });
    const out = await billing.ensureCustomer({
      orgId: "org_test_1",
      customerId: null,
      name: "Test Studio",
      email: "owner@example.test",
      idempotencyKey: "cust:org_test_1",
    });
    expect(out.customerId).toBe("cus_test_1");
    const req = only(http, "POST /v1/customers");
    expect(req.form.get("metadata[org]")).toBe("org_test_1");
    expect(req.idempotencyKey).toBe("cust:org_test_1");
  });
});

describe("createCheckout", () => {
  async function run() {
    const ctx = setup({
      "POST /v1/checkout/sessions": objects.checkout_session,
    });
    const out = await ctx.billing.createCheckout({
      orgId: "org_test_1",
      customerId: "cus_test_1",
      lines: [plan, buildFee],
      deferredMonthly: [{ ...addon, kind: "care_plan", key: "care" }],
      cadence: "monthly",
      successUrl: "https://cds.test/hub/checkout/return",
      cancelUrl: "https://cds.test/hub/checkout?cancelled=1",
      idempotencyKey: "checkout:org_test_1:abc",
    });
    return { ...ctx, out, req: only(ctx.http, "POST /v1/checkout/sessions") };
  }

  it("sends subscription mode with automatic_tax and the BILL-15 params", async () => {
    const { req, out } = await run();
    const f = req.form;
    expect(out).toEqual({
      sessionId: "cs_test_1",
      url: objects.checkout_session.url,
    });
    expect(f.get("mode")).toBe("subscription");
    expect(f.get("automatic_tax[enabled]")).toBe("true");
    expect(f.get("billing_address_collection")).toBe("required");
    expect(f.get("customer_update[address]")).toBe("auto");
    expect(f.get("customer_update[name]")).toBe("auto");
    expect(f.get("allow_promotion_codes")).toBe("true");
    expect(f.get("subscription_data[billing_mode][type]")).toBe("flexible");
    expect(f.get("subscription_data[metadata][org]")).toBe("org_test_1");
    expect(f.get("client_reference_id")).toBe("org_test_1");
    expect(f.get("customer")).toBe("cus_test_1");
    expect(f.get("success_url")).toContain("{CHECKOUT_SESSION_ID}");
    expect(req.idempotencyKey).toBe("checkout:org_test_1:abc");
  });

  it("never sends discounts and skips deferredMonthly lines", async () => {
    const { req } = await run();
    expect([...req.form.keys()].some((k) => k.startsWith("discounts"))).toBe(
      false,
    );
    expect(req.body).not.toContain("care");
    expect(req.form.get("line_items[0][price]")).toBe("price_test_plan");
    expect(req.form.get("line_items[1][price_data][unit_amount]")).toBe(
      "50000",
    );
    expect(req.form.get("line_items[1][price_data][recurring][interval]")).toBe(
      null,
    );
    expect(req.form.get("line_items[2][price]")).toBeNull();
  });
});

describe("expireCheckout (CR-E02)", () => {
  it("expires an open session", async () => {
    const { http, billing } = setup({
      "POST /v1/checkout/sessions/*/expire": objects.checkout_session_expired,
    });
    expect(await billing.expireCheckout("cs_test_3")).toBe("expired");
    expect(only(http, "POST /v1/checkout/sessions/*/expire").path).toBe(
      "/v1/checkout/sessions/cs_test_3/expire",
    );
  });

  it("reports a session that was already paid as complete", async () => {
    const { billing } = setup({
      "POST /v1/checkout/sessions/*/expire": {
        status: 400,
        body: {
          error: {
            type: "invalid_request_error",
            message:
              "Only Checkout Sessions with a status of open can be expired.",
          },
        },
      },
      "GET /v1/checkout/sessions/*": objects.checkout_session,
    });
    expect(await billing.expireCheckout("cs_test_1")).toBe("complete");
  });
});

describe("changeItems", () => {
  it("charges the saved card with pending_if_incomplete + always_invoice", async () => {
    const { http, billing } = setup({
      "POST /v1/subscriptions/*": {
        ...objects.subscription,
        latest_invoice: objects.invoice,
      },
    });
    const out = await billing.changeItems(change);
    expect(out.applied).toBe(true);
    if (out.applied) expect(out.invoice?.id).toBe("in_test_1");
    const req = only(http, "POST /v1/subscriptions/*");
    const f = req.form;
    expect(f.get("payment_behavior")).toBe("pending_if_incomplete");
    expect(f.get("proration_behavior")).toBe("always_invoice");
    expect(f.get("add_invoice_items[0][price]")).toBe("price_test_setup");
    expect(f.get("items[0][price]")).toBe("price_test_addon_new");
    expect(f.get("items[1][id]")).toBe("si_test_addon");
    expect(f.get("items[1][deleted]")).toBe("true");
    expect(f.get("items[2][quantity]")).toBe("1");
    expect(req.idempotencyKey).toBe("idem_change_1");
  });

  it("WR-E09: a saved-card charge sends no item metadata; a no-charge change does", async () => {
    const charge = setup({ "POST /v1/subscriptions/*": objects.subscription });
    await charge.billing.changeItems(change);
    const charged = only(charge.http, "POST /v1/subscriptions/*").form;
    expect(charged.get("payment_behavior")).toBe("pending_if_incomplete");
    expect([...charged.keys()].some((k) => k.includes("[metadata]"))).toBe(
      false,
    );

    const plain = setup({ "POST /v1/subscriptions/*": objects.subscription });
    await plain.billing.changeItems({
      ...change,
      oneTime: [],
      proration: "none",
      chargeNow: false,
    });
    const f = only(plain.http, "POST /v1/subscriptions/*").form;
    expect(f.get("items[0][metadata][kind]")).toBe("addon");
  });

  it("returns applied:false card_declined when Stripe leaves a pending update", async () => {
    const { billing } = setup({
      "POST /v1/subscriptions/*": objects.subscription_pending,
    });
    expect(await billing.changeItems(change)).toEqual({
      applied: false,
      reason: "card_declined",
    });
  });

  it("CR-C01: preview and charge prorate at the same instant (proration_date)", async () => {
    const at = "2026-10-31T23:59:00.000Z";
    const secs = String(Date.parse(at) / 1000);
    const { http, billing } = setup({
      "POST /v1/subscriptions/*": objects.subscription,
      "GET /v1/subscriptions/*": objects.subscription,
      "POST /v1/invoices/create_preview": objects.invoice_preview,
    });
    await billing.previewChange({ ...change, prorationDate: at });
    await billing.changeItems({ ...change, prorationDate: at });
    expect(
      only(http, "POST /v1/invoices/create_preview").form.get(
        "subscription_details[proration_date]",
      ),
    ).toBe(secs);
    expect(
      only(http, "POST /v1/subscriptions/*").form.get("proration_date"),
    ).toBe(secs);
  });

  it("omits payment_behavior when not charging now", async () => {
    const { http, billing } = setup({
      "POST /v1/subscriptions/*": objects.subscription,
    });
    const out = await billing.changeItems({
      ...change,
      oneTime: [],
      proration: "none",
      chargeNow: false,
    });
    expect(out).toEqual({ applied: true, invoice: null });
    const f = only(http, "POST /v1/subscriptions/*").form;
    expect(f.get("payment_behavior")).toBeNull();
    expect(f.get("proration_behavior")).toBe("none");
  });
});

describe("previewChange", () => {
  it("uses create_preview, never the removed upcoming endpoint", async () => {
    const { http, billing } = setup({
      "GET /v1/subscriptions/*": objects.subscription,
      "POST /v1/invoices/create_preview": objects.invoice_preview,
    });
    const input: Omit<ChangeItemsInput, "idempotencyKey"> = change;
    const out = await billing.previewChange(input);
    const req = only(http, "POST /v1/invoices/create_preview");
    expect(req.form.get("subscription")).toBe("sub_test_1");
    expect(req.form.get("subscription_details[proration_behavior]")).toBe(
      "always_invoice",
    );
    expect(http.requests.some((r) => r.path.includes("upcoming"))).toBe(false);
    expect(req.form.get("subscription_details[proration_date]")).toBeNull();
    // plan 9900 x1 stays, addon item removed, new addon 1500 added.
    expect(out).toEqual({
      todayCents: 1750,
      taxCents: 0,
      thenMonthlyCents: 9900 + 1500,
      periodEnd: new Date(1792800000 * 1000).toISOString(),
    });
  });
});

describe("cancel", () => {
  it("term sends cancel_at=max_period_end", async () => {
    const { http, billing } = setup({
      "POST /v1/subscriptions/*": objects.subscription_cancel_at,
    });
    const sub = await billing.cancel({
      subscriptionId: "sub_test_1",
      mode: "term",
      idempotencyKey: "cancel:1",
    });
    const req = only(http, "POST /v1/subscriptions/*");
    expect(req.form.get("cancel_at")).toBe("max_period_end");
    expect(req.idempotencyKey).toBe("cancel:1");
    expect(sub.cancelAt).toBe(new Date(1822536000 * 1000).toISOString());
  });

  it("now calls subscription cancel", async () => {
    const { http, billing } = setup({
      "DELETE /v1/subscriptions/*": objects.subscription_canceled,
    });
    const sub = await billing.cancel({
      subscriptionId: "sub_test_1",
      mode: "now",
      idempotencyKey: "cancel:2",
    });
    expect(only(http, "DELETE /v1/subscriptions/*").path).toBe(
      "/v1/subscriptions/sub_test_1",
    );
    expect(sub.status).toBe("canceled");
  });
});

describe("syncPrice", () => {
  it("creates a new price and archives the old one when the amount changes", async () => {
    const { http, billing } = setup({
      "GET /v1/prices/*": objects.price_old,
      "POST /v1/prices": objects.price_new,
      "POST /v1/prices/*": objects.price_archived,
    });
    const out = await billing.syncPrice({
      kind: "addon",
      key: "events",
      path: "standard",
      interval: "month",
      cents: 1900,
      productRef: "prod_test_new",
      previousPriceRef: "price_test_old",
    });
    expect(out).toEqual({
      priceRef: "price_test_new",
      productRef: "prod_test_new",
    });
    const create = only(http, "POST /v1/prices").form;
    expect(create.get("unit_amount")).toBe("1900");
    expect(create.get("metadata[kind]")).toBe("addon");
    expect(create.get("metadata[key]")).toBe("events");
    expect(create.get("metadata[path]")).toBe("standard");
    expect(create.get("recurring[interval]")).toBe("month");
    const archive = only(http, "POST /v1/prices/*");
    expect(archive.path).toBe("/v1/prices/price_test_old");
    expect(archive.form.get("active")).toBe("false");
    expect(archive.form.get("unit_amount")).toBeNull();
  });

  it("creates the product first when none exists", async () => {
    const { http, billing } = setup({
      "POST /v1/products": objects.product,
      "POST /v1/prices": objects.price_new,
    });
    const out = await billing.syncPrice({
      kind: "addon",
      key: "events",
      path: "standard",
      interval: "month",
      cents: 1900,
      productRef: null,
      previousPriceRef: null,
    });
    expect(out.productRef).toBe("prod_test_new");
    expect(only(http, "POST /v1/products").form.get("metadata[kind]")).toBe(
      "addon",
    );
    expect(http.find("POST /v1/prices/*")).toHaveLength(0);
  });

  it("keeps an unchanged price", async () => {
    const { http, billing } = setup({ "GET /v1/prices/*": objects.price_old });
    const out = await billing.syncPrice({
      kind: "addon",
      key: "events",
      path: "standard",
      interval: "month",
      cents: 1500,
      productRef: "prod_test_new",
      previousPriceRef: "price_test_old",
    });
    expect(out.priceRef).toBe("price_test_old");
    expect(http.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});

describe("refundAll", () => {
  it("lists charges by customer and refunds each refundable one with its own key", async () => {
    const { http, billing } = setup({
      "GET /v1/charges": objects.charges,
      "POST /v1/refunds": (req) => ({
        ...objects.refund,
        amount: req.form.get("charge") === "ch_test_1" ? 12900 : 2000,
      }),
    });
    const out = await billing.refundAll({
      customerId: "cus_test_1",
      idempotencyKey: "refund:org_test_1",
    });
    expect(out).toEqual({ refundedCents: 14900, count: 2 });
    expect(only(http, "GET /v1/charges").search.get("customer")).toBe(
      "cus_test_1",
    );
    const refunds = http.find("POST /v1/refunds");
    expect(refunds.map((r) => r.form.get("charge"))).toEqual([
      "ch_test_1",
      "ch_test_2",
    ]);
    expect(refunds.map((r) => r.idempotencyKey)).toEqual([
      "refund:org_test_1:ch_test_1",
      "refund:org_test_1:ch_test_2",
    ]);
    expect(http.requests.some((r) => r.path.startsWith("/v1/invoices"))).toBe(
      false,
    );
  });
});

describe("usage, portal, fetch", () => {
  it("reportUsage posts a billing meter event with identifier", async () => {
    const { http, billing } = setup({
      "POST /v1/billing/meter_events": objects.meter_event,
    });
    await billing.reportUsage({
      customerId: "cus_test_1",
      meter: "care_minutes",
      value: 30,
      identifier: "usage:org_test_1:2026-10",
    });
    const f = only(http, "POST /v1/billing/meter_events").form;
    expect(f.get("event_name")).toBe("care_minutes");
    expect(f.get("identifier")).toBe("usage:org_test_1:2026-10");
    expect(f.get("payload[stripe_customer_id]")).toBe("cus_test_1");
    expect(f.get("payload[value]")).toBe("30");
  });

  it("portalUrl deep-links to payment_method_update, falling back to the plain session", async () => {
    const ok = setup({
      "POST /v1/billing_portal/sessions": objects.portal_session,
    });
    expect(
      await ok.billing.portalUrl({
        customerId: "cus_test_1",
        returnUrl: "https://cds.test/hub/settings/billing",
      }),
    ).toBe(objects.portal_session.url);
    expect(
      only(ok.http, "POST /v1/billing_portal/sessions").form.get(
        "flow_data[type]",
      ),
    ).toBe("payment_method_update");

    const fallback = setup({
      "POST /v1/billing_portal/sessions": (req) =>
        req.form.get("flow_data[type]")
          ? {
              status: 400,
              body: {
                error: {
                  type: "invalid_request_error",
                  message: "flow not enabled",
                },
              },
            }
          : objects.portal_session,
    });
    expect(
      await fallback.billing.portalUrl({
        customerId: "cus_test_1",
        returnUrl: "https://cds.test/hub/settings/billing",
      }),
    ).toBe(objects.portal_session.url);
    expect(fallback.http.find("POST /v1/billing_portal/sessions")).toHaveLength(
      2,
    );
  });

  it("fetchSubscription maps items with their own period ends (min across items)", async () => {
    const { billing } = setup({
      "GET /v1/subscriptions/*": objects.subscription,
    });
    const sub = await billing.fetchSubscription("sub_test_1");
    expect(sub).toMatchObject({
      id: "sub_test_1",
      customerId: "cus_test_1",
      orgId: "org_test_1",
      status: "active",
      cancelAt: null,
      pendingUpdate: false,
    });
    expect(sub.items.map((i) => [i.kind, i.key, i.quantity])).toEqual([
      ["plan", "base", 1],
      ["addon", "events", 2],
    ]);
    // WR-D04: each item carries the amount it is billed at (its own price's unit_amount).
    expect(sub.items.every((i) => typeof i.unitCents === "number")).toBe(true);
    expect(minPeriodEnd(sub.items)).toBe(
      new Date(1792800000 * 1000).toISOString(),
    );
  });

  it("fetchInvoice maps tax, subscription (basil parent) and line kinds", async () => {
    const { http, billing } = setup({
      "GET /v1/invoices/*": objects.invoice,
      "GET /v1/invoice_payments": noPayments,
    });
    const inv = await billing.fetchInvoice("in_test_1");
    expect(inv).toMatchObject({
      id: "in_test_1",
      number: "CDS-0001",
      subscriptionId: "sub_test_1",
      orgId: "org_test_1",
      status: "paid",
      totalCents: 12900,
      taxCents: 900,
    });
    expect(inv.lines.map((l) => [l.kind, l.key, l.amountCents])).toEqual([
      ["plan", "base", 9900],
      ["extra", "logo", 3000],
    ]);
    expect(only(http, "GET /v1/invoices/*").search.getAll("expand[0]")).toEqual(
      ["lines.data.pricing.price_details.price"],
    );
  });

  it("fetchCheckoutSession maps org, status and ids", async () => {
    const { billing } = setup({
      "GET /v1/checkout/sessions/*": objects.checkout_session,
    });
    expect(await billing.fetchCheckoutSession("cs_test_1")).toEqual({
      id: "cs_test_1",
      orgId: "org_test_1",
      customerId: "cus_test_1",
      status: "complete",
      paymentStatus: "paid",
      subscriptionId: "sub_test_1",
      invoiceId: "in_test_1",
    });
  });
});

describe("createInvoice, listInvoices, reconcile", () => {
  it("createInvoice drafts, adds items with keys, then finalizes", async () => {
    const { http, billing } = setup({
      "POST /v1/invoices": objects.invoice_draft,
      "POST /v1/invoiceitems": objects.invoice_item,
      "POST /v1/invoices/*/finalize": {
        ...objects.invoice_draft,
        status: "open",
      },
    });
    const inv = await billing.createInvoice({
      orgId: "org_test_1",
      customerId: "cus_test_1",
      lines: [setupFee, { ...buildFee, label: "Two hours", unitCents: 7500 }],
      description: "Paid service",
      metadata: { kind: "service" },
      idempotencyKey: "inv:1",
    });
    expect(inv.status).toBe("open");
    const draft = only(http, "POST /v1/invoices").form;
    expect(draft.get("automatic_tax[enabled]")).toBe("true");
    expect(draft.get("metadata[org]")).toBe("org_test_1");
    expect(draft.get("pending_invoice_items_behavior")).toBe("exclude");
    const items = http.find("POST /v1/invoiceitems");
    expect(items.map((r) => r.idempotencyKey)).toEqual([
      "inv:1:item:0",
      "inv:1:item:1",
    ]);
    expect(items[0]?.form.get("pricing[price]")).toBe("price_test_setup");
    expect(items[1]?.form.get("amount")).toBe("7500");
    expect(only(http, "POST /v1/invoices/*/finalize").idempotencyKey).toBe(
      "inv:1:finalize",
    );
  });

  it("listInvoices filters by customer and created[gte]", async () => {
    const { http, billing } = setup({
      "GET /v1/invoices": {
        object: "list",
        has_more: false,
        url: "/v1/invoices",
        data: [objects.invoice],
      },
      "GET /v1/invoice_payments": noPayments,
    });
    const out = await billing.listInvoices({
      customerId: "cus_test_1",
      since: new Date(1790000000 * 1000),
    });
    expect(out.map((i) => i.id)).toEqual(["in_test_1"]);
    const s = only(http, "GET /v1/invoices").search;
    expect(s.get("customer")).toBe("cus_test_1");
    expect(s.get("created[gte]")).toBe("1790000000");
  });

  it("CR-E04: reconcile replays Stripe's event log with the real event ids", async () => {
    const { http, billing } = setup({
      // Newest first, as Stripe lists them.
      "GET /v1/events": {
        object: "list",
        has_more: false,
        url: "/v1/events",
        data: [
          events["customer.subscription.updated"],
          events["account.updated"],
          events["customer.created"],
          events["invoice.paid"],
          events["checkout.session.completed"],
        ],
      },
    });
    const out = await billing.reconcile({
      since: new Date(1790000000 * 1000),
    });
    // Connect and unhandled types are dropped; the rest run oldest first.
    expect(out.map((e) => [e.id, e.type])).toEqual([
      ["evt_test_1", "checkout.completed"],
      ["evt_test_4", "invoice.paid"],
      ["evt_test_6", "subscription.updated"],
    ]);
    const req = only(http, "GET /v1/events");
    // Changed since the window (event time), never "created since" on the object.
    expect(req.search.get("created[gte]")).toBe("1790000000");
    const types = [...req.search.entries()]
      .filter(([k]) => /^types\[\d*\]$/.test(k))
      .map(([, v]) => v);
    expect(types).toContain("customer.subscription.updated");
    expect(types).toContain("invoice.paid");
    expect(http.requests.some((r) => r.path === "/v1/subscriptions")).toBe(
      false,
    );
  });
});

// CR-E01: Stripe Checkout sets no subscription-item metadata, and a subscription invoice
// line carries the SUBSCRIPTION's metadata. Only the price says what the line is.
describe("CR-E01: installment identity from the price", () => {
  const legacyInstallmentPrice = {
    id: "price_test_build_month",
    object: "price",
    unit_amount: 25000,
    recurring: { interval: "month", interval_count: 1 },
    metadata: { kind: "build_fee", key: "base", path: "standard" },
  };

  it("a Checkout-created item on the build_fee monthly price is the installment", () => {
    const sub = mapSubscription({
      ...objects.subscription,
      items: {
        object: "list",
        data: [
          {
            id: "si_test_inst",
            object: "subscription_item",
            quantity: 1,
            current_period_end: 1793600000,
            metadata: {},
            price: legacyInstallmentPrice,
          },
          {
            id: "si_test_once_build",
            object: "subscription_item",
            quantity: 1,
            current_period_end: 1793600000,
            metadata: {},
            // An inline price: no price metadata, the kind sits on the expanded product.
            price: {
              id: "price_inline",
              object: "price",
              unit_amount: 9900,
              recurring: { interval: "month", interval_count: 1 },
              metadata: {},
              product: {
                id: "prod_inline",
                metadata: { kind: "care_plan", key: "care" },
              },
            },
          },
        ],
      },
    });
    expect(sub.items.map((i) => [i.kind, i.key])).toEqual([
      ["installment", "build-installment"],
      ["care_plan", "care"],
    ]);
  });

  it("a subscription invoice line ignores the subscription metadata and reads the price", () => {
    const inv = mapInvoice({
      ...objects.invoice,
      lines: {
        object: "list",
        data: [
          {
            id: "il_test_inst",
            object: "line_item",
            amount: 25000,
            description: "Website build payment",
            // What Stripe puts here for a subscription line: the subscription's metadata.
            metadata: { org: "org_test_1", cadence: "monthly", kind: "plan" },
            parent: {
              type: "subscription_item_details",
              subscription_item_details: { subscription_item: "si_test_inst" },
            },
            pricing: {
              type: "price_details",
              price_details: { price: legacyInstallmentPrice },
            },
          },
        ],
      },
    });
    expect(inv.lines.map((l) => [l.kind, l.key])).toEqual([
      ["installment", "build-installment"],
    ]);
  });

  it("fetchSubscription expands the price product", async () => {
    const { http, billing } = setup({
      "GET /v1/subscriptions/*": objects.subscription,
    });
    await billing.fetchSubscription("sub_test_1");
    expect(
      only(http, "GET /v1/subscriptions/*").search.getAll("expand[0]"),
    ).toEqual(["items.data.price.product"]);
  });
});

describe("WR-E03: the checkout's first invoice", () => {
  it("maps billing_reason and the subscription's latest invoice", () => {
    expect(
      mapInvoice({ ...objects.invoice, billing_reason: "subscription_create" })
        .billingReason,
    ).toBe("subscription_create");
    expect(
      mapSubscription({ ...objects.subscription, latest_invoice: "in_test_1" })
        .latestInvoiceId,
    ).toBe("in_test_1");
  });
});

describe("WR-E04: refunds made on the charge reach the invoice", () => {
  it("counts the refunds on the invoice's payment (no credit note)", async () => {
    const { http, billing } = setup({
      "GET /v1/invoices/*": objects.invoice,
      "GET /v1/invoice_payments": {
        object: "list",
        has_more: false,
        url: "/v1/invoice_payments",
        data: [
          {
            id: "inpay_test_1",
            object: "invoice_payment",
            invoice: "in_test_1",
            status: "paid",
            amount_paid: 12900,
            payment: { type: "payment_intent", payment_intent: "pi_test_1" },
          },
        ],
      },
      "GET /v1/refunds": {
        object: "list",
        has_more: false,
        url: "/v1/refunds",
        data: [
          { ...objects.refund, amount: 12900, status: "succeeded" },
          { ...objects.refund, id: "re_failed", amount: 500, status: "failed" },
        ],
      },
    });
    const inv = await billing.fetchInvoice("in_test_1");
    expect(inv.refundedCents).toBe(12900);
    expect(only(http, "GET /v1/invoice_payments").search.get("invoice")).toBe(
      "in_test_1",
    );
    expect(only(http, "GET /v1/refunds").search.get("payment_intent")).toBe(
      "pi_test_1",
    );
  });
});
