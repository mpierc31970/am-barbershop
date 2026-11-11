// P10 Stripe PaymentGateway (Connect Standard) against recorded requests (BILL-06, PAY-10).
import { describe, expect, it } from "vitest";
import { stripeClient } from "./client";
import { stripePaymentGateway } from "./index";
import { createRecordingHttpClient, type Fixture } from "./recording-http";
import objects from "./__fixtures__/objects.json";

const NOW = new Date("2026-10-09T12:00:00Z");

function setup(fixtures: Record<string, Fixture>) {
  const http = createRecordingHttpClient(fixtures);
  const stripe = stripeClient("sk_test_x", {
    env: { CDS_ENV: "dev" },
    httpClient: http.httpClient,
  });
  const gateway = stripePaymentGateway({
    stripe,
    now: () => NOW,
    webhookSecret: "whsec_connect",
  });
  return { http, gateway };
}

const urls = {
  returnUrl: "https://cds.test/hub/settings/payments?connect=return",
  refreshUrl: "https://cds.test/hub/settings/payments/connect/refresh",
};

const revoked: Fixture = { status: 403, body: objects.account_revoked_error };

describe("startConnect", () => {
  it("new: creates a Standard-controller account with metadata[org], then an onboarding link", async () => {
    const { http, gateway } = setup({
      "POST /v1/accounts": objects.account,
      "POST /v1/account_links": objects.account_link,
    });
    const out = await gateway.startConnect({
      orgId: "org_test_1",
      accountId: null,
      mode: "new",
      ...urls,
    });
    expect(out).toEqual({
      accountId: "acct_test_1",
      url: objects.account_link.url,
    });
    const [create, link] = http.requests;
    expect(create?.path).toBe("/v1/accounts");
    const f = create!.form;
    expect(f.get("controller[stripe_dashboard][type]")).toBe("full");
    expect(f.get("controller[fees][payer]")).toBe("account");
    expect(f.get("controller[losses][payments]")).toBe("stripe");
    expect(f.get("controller[requirement_collection]")).toBe("stripe");
    expect(f.get("type")).toBeNull();
    expect(f.get("metadata[org]")).toBe("org_test_1");
    expect(create?.idempotencyKey).toBe("connect:org_test_1:account");
    expect(link?.path).toBe("/v1/account_links");
    expect(link?.form.get("account")).toBe("acct_test_1");
    expect(link?.form.get("type")).toBe("account_onboarding");
    expect(link?.form.get("refresh_url")).toBe(urls.refreshUrl);
    expect(link?.form.get("return_url")).toBe(urls.returnUrl);
  });

  it("with an existing account id only mints a new link", async () => {
    const { http, gateway } = setup({
      "POST /v1/account_links": objects.account_link,
    });
    const out = await gateway.startConnect({
      orgId: "org_test_1",
      accountId: "acct_test_1",
      mode: "new",
      ...urls,
    });
    expect(out.accountId).toBe("acct_test_1");
    expect(http.requests.map((r) => r.path)).toEqual(["/v1/account_links"]);
  });

  it("WR-E02: a reconnect creates the account under the key it is given", async () => {
    const { http, gateway } = setup({
      "POST /v1/accounts": objects.account,
      "POST /v1/account_links": objects.account_link,
    });
    await gateway.startConnect({
      orgId: "org_test_1",
      accountId: null,
      mode: "new",
      ...urls,
      idempotencyKey: "connect:org_test_1:account:after:acct_old",
    });
    expect(http.requests[0]?.idempotencyKey).toBe(
      "connect:org_test_1:account:after:acct_old",
    );
  });

  it("mode existing uses the same Account Link flow; nothing goes to OAuth", async () => {
    const run = async (mode: "new" | "existing") => {
      const ctx = setup({
        "POST /v1/accounts": objects.account,
        "POST /v1/account_links": objects.account_link,
      });
      await ctx.gateway.startConnect({
        orgId: "org_test_1",
        accountId: null,
        mode,
        ...urls,
      });
      return ctx.http.requests.map((r) => `${r.method} ${r.path} ${r.body}`);
    };
    const existing = await run("existing");
    expect(existing).toEqual(await run("new"));
    expect(existing.join("\n")).not.toMatch(/oauth/i);
  });
});

describe("accountStatus", () => {
  it("charges on -> connected", async () => {
    const { gateway } = setup({ "GET /v1/accounts/*": objects.account });
    expect(await gateway.accountStatus("acct_test_1")).toEqual({
      accountId: "acct_test_1",
      chargesEnabled: true,
      detailsSubmitted: true,
      displayName: "Test Studio",
      status: "connected",
    });
  });

  it("charges off -> restricted (setup not finished)", async () => {
    const { gateway } = setup({
      "GET /v1/accounts/*": objects.account_restricted,
    });
    expect(await gateway.accountStatus("acct_test_2")).toEqual({
      accountId: "acct_test_2",
      chargesEnabled: false,
      detailsSubmitted: false,
      displayName: "New Studio",
      status: "restricted",
    });
  });

  it("WR-E01: CDS's own key failing (401) or a bare 404 throws, never disconnects", async () => {
    for (const reply of [
      {
        status: 401,
        body: {
          error: {
            type: "invalid_request_error",
            message: "Invalid API Key provided: sk_test_****",
          },
        },
      },
      {
        status: 404,
        body: {
          error: {
            type: "invalid_request_error",
            code: "resource_missing",
            message: "No such account",
          },
        },
      },
    ]) {
      const { gateway } = setup({ "GET /v1/accounts/*": reply });
      await expect(gateway.accountStatus("acct_test_1")).rejects.toThrow();
      await expect(
        gateway.reconcile({
          since: new Date(1790000000 * 1000),
          accountIds: ["acct_test_1"],
        }),
      ).rejects.toThrow();
    }
  });

  it("a revoked account -> disconnected", async () => {
    const { gateway } = setup({ "GET /v1/accounts/*": revoked });
    expect((await gateway.accountStatus("acct_test_9")).status).toBe(
      "disconnected",
    );
  });

  it("other errors propagate", async () => {
    const { gateway } = setup({
      "GET /v1/accounts/*": {
        status: 400,
        body: { error: { type: "invalid_request_error", message: "bad" } },
      },
    });
    await expect(gateway.accountStatus("acct_test_1")).rejects.toThrow("bad");
  });
});

describe("createCheckout (direct charge)", () => {
  it("sends Stripe-Account and no fee params", async () => {
    const { http, gateway } = setup({
      "POST /v1/checkout/sessions": objects.tenant_checkout_session,
    });
    const out = await gateway.createCheckout({
      accountId: "acct_test_1",
      lines: [
        {
          kind: "addon",
          key: "store",
          label: "Candle",
          interval: "once",
          unitCents: 4500,
          quantity: 2,
          priceRef: null,
        },
      ],
      successUrl: "https://tenant.test/thanks",
      cancelUrl: "https://tenant.test/cart",
      customerEmail: "buyer@example.test",
      idempotencyKey: "tenant:order_1",
    });
    expect(out.sessionId).toBe("cs_test_tenant_1");
    const req = http.requests[0]!;
    expect(req.stripeAccount).toBe("acct_test_1");
    expect(req.idempotencyKey).toBe("tenant:order_1");
    expect(req.form.get("mode")).toBe("payment");
    expect(req.form.get("customer_email")).toBe("buyer@example.test");
    expect(req.body.toLowerCase()).not.toContain("application_fee");
    expect(req.body).not.toContain("transfer_data");
    expect(req.body).not.toContain("on_behalf_of");
  });
});

describe("refund and reconcile", () => {
  it("refunds on the connected account", async () => {
    const { http, gateway } = setup({
      "POST /v1/refunds": objects.tenant_refund,
    });
    const out = await gateway.refund({
      accountId: "acct_test_1",
      paymentRef: "pi_test_1",
      cents: 4500,
      idempotencyKey: "tenant-refund:1",
    });
    expect(out.refundedCents).toBe(4500);
    const req = http.requests[0]!;
    expect(req.stripeAccount).toBe("acct_test_1");
    expect(req.form.get("payment_intent")).toBe("pi_test_1");
    expect(req.form.get("amount")).toBe("4500");
  });

  it("reconcile re-reads each account", async () => {
    const { http, gateway } = setup({
      "GET /v1/accounts/acct_test_1": objects.account,
      "GET /v1/accounts/acct_test_9": revoked,
    });
    const events = await gateway.reconcile({
      since: NOW,
      accountIds: ["acct_test_1", "acct_test_9"],
    });
    expect(events.map((e) => [e.id, e.type, e.account])).toEqual([
      ["reconcile:acct_test_1:connected", "account.updated", "acct_test_1"],
      [
        "reconcile:acct_test_9:disconnected",
        "account.deauthorized",
        "acct_test_9",
      ],
    ]);
    expect(http.requests).toHaveLength(2);
  });
});
