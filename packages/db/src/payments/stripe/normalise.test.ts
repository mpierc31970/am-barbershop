// P10 Stripe adapter: client key safety, recording http client, webhook normalisation.
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { WebhookSignatureInvalid } from "@cds/core/payments";
import { stripeClient, StripeKeyRefused } from "./client";
import { normaliseStripeEvent } from "./normalise";
import { createRecordingHttpClient } from "./recording-http";
import events from "./__fixtures__/events.json";
import objects from "./__fixtures__/objects.json";

const SECRET = "whsec_test_cds";

function signed(event: unknown, secret = SECRET) {
  const raw = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
  });
  return { raw, header };
}

type Fields = { getApiField(k: string): unknown; _enableTelemetry: boolean };

describe("stripeClient", () => {
  const dev = { CDS_ENV: "dev" };

  it("refuses a live key outside production-with-allow", () => {
    expect(() => stripeClient("sk_live_x", { env: dev })).toThrow(
      StripeKeyRefused,
    );
    expect(() =>
      stripeClient("sk_live_x", { env: { CDS_ENV: "production" } }),
    ).toThrow(StripeKeyRefused);
    expect(() =>
      stripeClient("sk_live_x", {
        env: { CDS_ENV: "dev", STRIPE_ALLOW_LIVE: "1" },
      }),
    ).toThrow(StripeKeyRefused);
    expect(() =>
      stripeClient("sk_live_x", {
        env: { CDS_ENV: "production", STRIPE_ALLOW_LIVE: "1" },
      }),
    ).not.toThrow();
  });

  it("refuses an empty or non-test key and never echoes it", () => {
    expect(() => stripeClient("", { env: dev })).toThrow(StripeKeyRefused);
    try {
      stripeClient("pk_test_secretish", { env: dev });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StripeKeyRefused);
      expect(String((e as Error).message)).not.toContain("secretish");
    }
  });

  it("pins retries 2, timeout 20s, telemetry off for a test key", () => {
    const client = stripeClient("sk_test_x", { env: dev }) as unknown as Fields;
    expect(client.getApiField("maxNetworkRetries")).toBe(2);
    expect(client.getApiField("timeout")).toBe(20_000);
    expect(client._enableTelemetry).toBe(false);
  });
});

describe("createRecordingHttpClient", () => {
  it("records method, path, form body and headers, and replays fixtures by route", async () => {
    const http = createRecordingHttpClient({
      "POST /v1/customers": objects.customer,
      "GET /v1/subscriptions/*": objects.subscription,
    });
    const stripe = stripeClient("sk_test_x", {
      env: { CDS_ENV: "dev" },
      httpClient: http.httpClient,
    });
    const c = await stripe.customers.create(
      { name: "Test Studio", metadata: { org: "org_test_1" } },
      { idempotencyKey: "idem_1" },
    );
    expect(c.id).toBe("cus_test_1");
    const s = await stripe.subscriptions.retrieve("sub_test_1");
    expect(s.id).toBe("sub_test_1");

    expect(http.requests).toHaveLength(2);
    const [post, get] = http.requests;
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/v1/customers");
    expect(post?.form.get("metadata[org]")).toBe("org_test_1");
    expect(post?.idempotencyKey).toBe("idem_1");
    expect(get?.method).toBe("GET");
    expect(get?.path).toBe("/v1/subscriptions/sub_test_1");
    expect(http.find("GET /v1/subscriptions/*")).toHaveLength(1);
  });

  it("answers 404 for a route without a fixture", async () => {
    const http = createRecordingHttpClient({});
    const stripe = stripeClient("sk_test_x", {
      env: { CDS_ENV: "dev" },
      httpClient: http.httpClient,
    });
    await expect(stripe.customers.retrieve("cus_missing")).rejects.toThrow(
      /No fixture/,
    );
  });
});

describe("normaliseStripeEvent", () => {
  const cases: [keyof typeof events, Record<string, unknown>][] = [
    [
      "checkout.session.completed",
      {
        type: "checkout.completed",
        sessionId: "cs_test_1",
        orgId: "org_test_1",
      },
    ],
    [
      "checkout.session.completed.ref_only",
      {
        type: "checkout.completed",
        sessionId: "cs_test_2",
        orgId: "org_test_2",
      },
    ],
    [
      "checkout.session.expired",
      { type: "checkout.expired", sessionId: "cs_test_3" },
    ],
    [
      "invoice.paid",
      { type: "invoice.paid", invoiceId: "in_test_1", orgId: "org_test_1" },
    ],
    [
      "invoice.payment_failed",
      { type: "invoice.payment_failed", invoiceId: "in_test_2" },
    ],
    [
      "customer.subscription.updated",
      { type: "subscription.updated", subscriptionId: "sub_test_1" },
    ],
    [
      "customer.subscription.deleted",
      { type: "subscription.deleted", subscriptionId: "sub_test_1" },
    ],
    [
      "customer.subscription.pending_update_applied",
      {
        type: "subscription.pending_update_applied",
        subscriptionId: "sub_test_1",
      },
    ],
    [
      "customer.subscription.pending_update_expired",
      {
        type: "subscription.pending_update_expired",
        subscriptionId: "sub_test_1",
      },
    ],
    [
      "account.updated",
      {
        type: "account.updated",
        accountId: "acct_test_1",
        account: "acct_test_1",
      },
    ],
    [
      "account.application.deauthorized",
      {
        type: "account.deauthorized",
        accountId: "acct_test_1",
        account: "acct_test_1",
      },
    ],
    ["charge.refunded", { type: "charge.refunded", customerId: "cus_test_1" }],
    ["customer.created", { type: "ignored", originalType: "customer.created" }],
  ];

  it.each(cases)("maps %s", (name, expected) => {
    const { raw, header } = signed(events[name]);
    const out = normaliseStripeEvent(raw, header, SECRET);
    expect(out).toMatchObject({
      provider: "stripe",
      id: events[name].id,
      createdAt: new Date(events[name].created * 1000).toISOString(),
      ...expected,
    });
  });

  it("returns ids only, never the payload", () => {
    const { raw, header } = signed(events["invoice.paid"]);
    const out = normaliseStripeEvent(raw, header, SECRET);
    expect(Object.keys(out).sort()).toEqual([
      "account",
      "createdAt",
      "id",
      "invoiceId",
      "orgId",
      "provider",
      "type",
    ]);
  });

  it("CDS-account events carry account null", () => {
    const { raw, header } = signed(events["invoice.paid"]);
    expect(normaliseStripeEvent(raw, header, SECRET).account).toBeNull();
  });

  it("throws WebhookSignatureInvalid on a tampered body", () => {
    const { raw, header } = signed(events["invoice.paid"]);
    const tampered = raw.replace("in_test_1", "in_test_X");
    expect(() => normaliseStripeEvent(tampered, header, SECRET)).toThrow(
      WebhookSignatureInvalid,
    );
  });

  it("throws WebhookSignatureInvalid on the wrong secret (CDS vs Connect endpoint)", () => {
    const { raw, header } = signed(events["account.updated"], "whsec_connect");
    expect(() => normaliseStripeEvent(raw, header, SECRET)).toThrow(
      WebhookSignatureInvalid,
    );
    expect(() => normaliseStripeEvent(raw, "", SECRET)).toThrow(
      WebhookSignatureInvalid,
    );
    expect(() => normaliseStripeEvent(raw, header, "")).toThrow(
      WebhookSignatureInvalid,
    );
  });

  it("throws WebhookSignatureInvalid (not a parse error) on a non-JSON body", () => {
    const raw = "not json";
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: SECRET,
    });
    expect(() => normaliseStripeEvent(raw, header, SECRET)).toThrow(
      WebhookSignatureInvalid,
    );
  });
});
