// BILL-07 (D52, D296, T-10-06-03): CDS never takes a cut of a tenant's money. Every
// CdsBilling and PaymentGateway method is driven through the recording client, and no
// recorded request (path, query or body) contains application_fee, transfer_data or
// on_behalf_of. A new port method fails this test until it is driven here too.
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { BillingLine } from "@cds/core/payments";
import { stripeClient } from "./client";
import { stripeCdsBilling, stripePaymentGateway } from "./index";
import { createRecordingHttpClient, type Fixture } from "./recording-http";
import events from "./__fixtures__/events.json";
import objects from "./__fixtures__/objects.json";

const listOf = (data: unknown[]) => ({
  object: "list",
  has_more: false,
  url: "/v1/x",
  data,
});

const FIXTURES: Record<string, Fixture> = {
  "POST /v1/customers": objects.customer,
  "POST /v1/checkout/sessions": objects.checkout_session,
  "GET /v1/checkout/sessions": listOf([objects.checkout_session]),
  "GET /v1/checkout/sessions/*": objects.checkout_session,
  "POST /v1/checkout/sessions/*/expire": objects.checkout_session_expired,
  "GET /v1/subscriptions": listOf([objects.subscription]),
  "GET /v1/events": listOf([events["invoice.paid"]]),
  "GET /v1/subscriptions/*": objects.subscription,
  "POST /v1/subscriptions/*": objects.subscription,
  "DELETE /v1/subscriptions/*": objects.subscription_canceled,
  "POST /v1/invoices/create_preview": objects.invoice_preview,
  "POST /v1/invoices": objects.invoice_draft,
  "POST /v1/invoiceitems": objects.invoice_item,
  "POST /v1/invoices/*/finalize": objects.invoice,
  "GET /v1/invoices": listOf([objects.invoice]),
  "GET /v1/invoices/*": objects.invoice,
  "GET /v1/charges": objects.charges,
  "GET /v1/invoice_payments": listOf([]),
  "POST /v1/refunds": objects.refund,
  "GET /v1/prices/*": objects.price_old,
  "POST /v1/prices": objects.price_new,
  "POST /v1/prices/*": objects.price_archived,
  "POST /v1/products": objects.product,
  "POST /v1/billing/meter_events": objects.meter_event,
  "POST /v1/billing_portal/sessions": objects.portal_session,
  "POST /v1/accounts": objects.account,
  "GET /v1/accounts/*": objects.account,
  "POST /v1/account_links": objects.account_link,
};

const recurring: BillingLine = {
  kind: "addon",
  key: "events",
  label: "Events",
  interval: "month",
  unitCents: 1500,
  quantity: 1,
  priceRef: "price_test_addon",
};
const adHoc: BillingLine = {
  kind: "extra",
  key: "logo",
  label: "Logo",
  interval: "once",
  unitCents: 3000,
  quantity: 1,
  priceRef: null,
};
const oneTime: BillingLine = { ...adHoc, priceRef: "price_test_setup" };

function signed(event: unknown, secret: string) {
  const raw = JSON.stringify(event);
  return {
    raw,
    sig: Stripe.webhooks.generateTestHeaderString({ payload: raw, secret }),
  };
}

const FORBIDDEN = [/application_fee/i, /transfer_data/i, /on_behalf_of/i];

describe("BILL-07: no application fee on any Stripe request", () => {
  it("drives every CdsBilling and PaymentGateway method and finds no fee params", async () => {
    const http = createRecordingHttpClient(FIXTURES);
    const stripe = stripeClient("sk_test_x", {
      env: { CDS_ENV: "dev" },
      httpClient: http.httpClient,
    });
    const billing = stripeCdsBilling({ stripe, webhookSecret: "whsec_cds" });
    const gateway = stripePaymentGateway({
      stripe,
      webhookSecret: "whsec_connect",
    });
    const since = new Date(1790000000 * 1000);
    const change = {
      subscriptionId: "sub_test_1",
      add: [recurring],
      remove: ["si_test_addon"],
      setQuantity: [{ itemId: "si_test_plan", quantity: 2 }],
      oneTime: [oneTime],
      proration: "always_invoice" as const,
      chargeNow: true,
    };
    const cdsHook = signed(events["invoice.paid"], "whsec_cds");
    const connectHook = signed(events["account.updated"], "whsec_connect");

    const billingCalls: Record<string, () => Promise<unknown>> = {
      ensureCustomer: () =>
        billing.ensureCustomer({
          orgId: "org_test_1",
          customerId: null,
          name: "T",
          email: "t@example.test",
          idempotencyKey: "k1",
        }),
      createCheckout: () =>
        billing.createCheckout({
          orgId: "org_test_1",
          customerId: "cus_test_1",
          lines: [recurring, adHoc],
          deferredMonthly: [recurring],
          cadence: "yearly",
          successUrl: "https://cds.test/ok",
          cancelUrl: "https://cds.test/no",
          idempotencyKey: "k2",
        }),
      expireCheckout: () => billing.expireCheckout("cs_test_3"),
      changeItems: () =>
        billing.changeItems({ ...change, idempotencyKey: "k3" }),
      previewChange: () => billing.previewChange(change),
      createInvoice: () =>
        billing.createInvoice({
          orgId: "org_test_1",
          customerId: "cus_test_1",
          lines: [oneTime, adHoc],
          description: "Service",
          metadata: { kind: "service" },
          idempotencyKey: "k4",
        }),
      refundAll: () =>
        billing.refundAll({ customerId: "cus_test_1", idempotencyKey: "k5" }),
      cancel: async () => {
        await billing.cancel({
          subscriptionId: "sub_test_1",
          mode: "term",
          idempotencyKey: "k6",
        });
        return billing.cancel({
          subscriptionId: "sub_test_1",
          mode: "now",
          idempotencyKey: "k7",
        });
      },
      listInvoices: () =>
        billing.listInvoices({ customerId: "cus_test_1", since }),
      syncPrice: () =>
        billing.syncPrice({
          kind: "addon",
          key: "events",
          path: "standard",
          interval: "month",
          cents: 1900,
          productRef: null,
          previousPriceRef: "price_test_old",
        }),
      reportUsage: () =>
        billing.reportUsage({
          customerId: "cus_test_1",
          meter: "care_minutes",
          value: 1,
          identifier: "u1",
        }),
      portalUrl: () =>
        billing.portalUrl({
          customerId: "cus_test_1",
          returnUrl: "https://cds.test/billing",
        }),
      fetchSubscription: () => billing.fetchSubscription("sub_test_1"),
      fetchInvoice: () => billing.fetchInvoice("in_test_1"),
      fetchCheckoutSession: () => billing.fetchCheckoutSession("cs_test_1"),
      normaliseWebhook: () =>
        billing.normaliseWebhook(cdsHook.raw, cdsHook.sig),
      reconcile: () => billing.reconcile({ since }),
    };

    const gatewayCalls: Record<string, () => Promise<unknown>> = {
      startConnect: () =>
        gateway.startConnect({
          orgId: "org_test_1",
          accountId: null,
          mode: "existing",
          returnUrl: "https://cds.test/r",
          refreshUrl: "https://cds.test/f",
        }),
      accountStatus: () => gateway.accountStatus("acct_test_1"),
      createCheckout: () =>
        gateway.createCheckout({
          accountId: "acct_test_1",
          lines: [adHoc, oneTime],
          successUrl: "https://tenant.test/ok",
          cancelUrl: "https://tenant.test/no",
          customerEmail: null,
          idempotencyKey: "g1",
        }),
      refund: () =>
        gateway.refund({
          accountId: "acct_test_1",
          paymentRef: "ch_test_1",
          cents: null,
          idempotencyKey: "g2",
        }),
      normaliseWebhook: () =>
        gateway.normaliseWebhook(connectHook.raw, connectHook.sig),
      reconcile: () =>
        gateway.reconcile({ since, accountIds: ["acct_test_1"] }),
    };

    const methods = (o: object) =>
      Object.entries(o)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k)
        .sort();
    expect(Object.keys(billingCalls).sort()).toEqual(methods(billing));
    expect(Object.keys(gatewayCalls).sort()).toEqual(methods(gateway));

    for (const call of [
      ...Object.values(billingCalls),
      ...Object.values(gatewayCalls),
    ]) {
      await call();
    }

    // Every route above was exercised, so the scan below covers real traffic.
    expect(http.requests.length).toBeGreaterThan(25);
    for (const r of http.requests) {
      const wire = decodeURIComponent(`${r.path}?${r.query}&${r.body}`);
      for (const bad of FORBIDDEN) expect(wire).not.toMatch(bad);
    }
    // Tenant-side charges are direct charges on the tenant's own account (PAY-10).
    const tenantCheckout = http
      .find("POST /v1/checkout/sessions")
      .filter((r) => r.stripeAccount === "acct_test_1");
    expect(tenantCheckout).toHaveLength(1);
  });
});
