// 10-23: the fake adapter's test pages and their Server Actions (CONTEXT A1, UI-SPEC "Test
// pages", D-UI-P10-8, Pitfall 4; T-10-23-01..03). The session, the fake store helpers and the
// add-on deps registration are mocked; the real runAction maps refusals.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORIGIN = "http://localhost:3000";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  requireHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const deps = vi.hoisted(() => ({ ensurePaymentAddonDeps: vi.fn() }));
vi.mock("../lib/payment-deps", () => deps);

const db = vi.hoisted(() => ({
  readFakeObject: vi.fn(),
  fakeCompleteSession: vi.fn(),
  fakePayInvoice: vi.fn(),
  fakeUpdateCard: vi.fn(),
  fakeConnectOutcome: vi.fn(),
  testPayCustomerId: vi.fn(),
  testPayAccountId: vi.fn(),
  platformUrl: (p: string) => `http://localhost:3000${p}`,
}));
vi.mock("@cds/db", () => db);

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const actions = await import("../app/actions/test-pay");
const { default: Layout } = await import("../app/(platform)/test-pay/layout");
const { default: PayPage } =
  await import("../app/(platform)/test-pay/[id]/page");
const { default: PortalPage } =
  await import("../app/(platform)/test-pay/portal/page");
const { default: ConnectPage } =
  await import("../app/(platform)/test-pay/connect/page");

const CUSTOMER = "cus_fake_abcdefghij12345";
const PORTAL = "bps_fake_abcdefghij12345";
const ACCOUNT = "acct_fake_abcdefghij12345";

function portalObj(orgRef = "org1", customerId = CUSTOMER) {
  return {
    id: PORTAL,
    kind: "portal",
    orgRef,
    data: { customerId, returnUrl: `${ORIGIN}/hub/settings?tab=billing` },
  };
}

async function renderPortal(search: Record<string, string>) {
  return renderToStaticMarkup(
    await PortalPage({ searchParams: Promise.resolve(search) }),
  );
}

async function renderConnect(search: Record<string, string>) {
  return renderToStaticMarkup(
    await ConnectPage({ searchParams: Promise.resolve(search) }),
  );
}

const SESSION = "cs_fake_abcdefghij12345";
const INVOICE = "in_fake_abcdefghij12345";

function session(over: Record<string, unknown> = {}, orgRef = "org1") {
  return {
    id: SESSION,
    kind: "session",
    orgRef,
    data: {
      orgId: orgRef,
      customerId: "cus_fake_abcdefghij12345",
      account: null,
      lines: [
        {
          kind: "build",
          key: "standard",
          label: "Website build",
          interval: "once",
          unitCents: 150000,
          quantity: 1,
          priceRef: null,
        },
        {
          kind: "platform",
          key: "standard",
          label: "Platform fee",
          interval: "month",
          unitCents: 3900,
          quantity: 1,
          priceRef: null,
        },
      ],
      successUrl: `${ORIGIN}/hub/checkout/return?session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${ORIGIN}/hub/checkout`,
      status: "open",
      ...over,
    },
  };
}

function invoice(over: Record<string, unknown> = {}, orgRef = "org1") {
  return {
    id: INVOICE,
    kind: "invoice",
    orgRef,
    data: {
      orgId: orgRef,
      customerId: "cus_fake_abcdefghij12345",
      status: "open",
      lines: [
        {
          kind: "quote",
          key: "q1",
          amountCents: 25000,
          description: "Deposit",
        },
      ],
      totalCents: 25000,
      taxCents: 0,
      ...over,
    },
  };
}

async function renderPage(id: string, search: Record<string, string> = {}) {
  const el = await PayPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(search),
  });
  return renderToStaticMarkup(el);
}

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  const hub = {
    ctx: CTX,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  };
  sess.getHubSession.mockReset().mockResolvedValue(hub);
  sess.requireHubSession.mockReset().mockResolvedValue(hub);
  sess.agreementBlocks.mockReset().mockResolvedValue(false);
  deps.ensurePaymentAddonDeps.mockReset();
  db.readFakeObject.mockReset().mockResolvedValue(null);
  db.fakeCompleteSession.mockReset();
  db.fakePayInvoice.mockReset().mockResolvedValue({});
  db.fakeUpdateCard.mockReset().mockResolvedValue({ paidInvoices: 0 });
  db.fakeConnectOutcome.mockReset().mockResolvedValue(undefined);
  db.testPayCustomerId.mockReset().mockResolvedValue(null);
  db.testPayAccountId.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test-pay layout (Pitfall 4, D-UI-P10-8)", () => {
  it("404s when CDS_ENV=production", () => {
    vi.stubEnv("CDS_ENV", "production");
    expect(() => Layout({ children: null })).toThrow("NOT_FOUND");
  });

  it("puts the TestModeStrip first and the non-Support wordmark on the frame", () => {
    const html = renderToStaticMarkup(Layout({ children: <p>body</p> }));
    expect(html.indexOf('role="note"')).toBeGreaterThan(-1);
    expect(html.indexOf('role="note"')).toBeLessThan(html.indexOf("<main"));
    expect(html).toContain("Test payment page. No real money moves.");
    expect(html).toContain("Test payments");
    expect(html).toContain("max-w-[480px]");
  });

  it("is noindex", async () => {
    const mod = await import("../app/(platform)/test-pay/layout");
    expect(String(mod.metadata.robots)).toContain("noindex");
  });
});

describe("/test-pay/<id> page", () => {
  it("shows a session's lines, total, tax line and buttons in order", async () => {
    db.readFakeObject.mockResolvedValue(session());
    const html = await renderPage(SESSION);
    expect(html).toContain("Pay Connections Design Studios");
    expect(html).toContain("Website build");
    expect(html).toContain("$1,500.00");
    expect(html).toContain("Platform fee");
    expect(html).toContain("$39.00");
    expect(html).toContain("$1,539.00");
    expect(html).toContain("Tax calculated at payment: $0.00 in test mode.");
    const order = [
      "Pay $1,539.00 (test)",
      "Decline card",
      "Card fails later",
      "Back to the hub",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('href="/hub/checkout"');
    expect(html).toContain(`value="${SESSION}"`);
  });

  it("renders an open invoice with its stored total and no Card fails later", async () => {
    db.readFakeObject.mockResolvedValue(invoice());
    const html = await renderPage(INVOICE);
    expect(html).toContain("Deposit");
    expect(html).toContain("Pay $250.00 (test)");
    expect(html).toContain("Decline card");
    expect(html).not.toContain("Card fails later");
    expect(html).toContain('href="/hub/settings?tab=billing"');
  });

  it("another org's id shows the expired copy and no actions", async () => {
    db.readFakeObject.mockResolvedValue(session({}, "org2"));
    const html = await renderPage(SESSION);
    expect(html).toContain(
      "This test session has expired. Go back and start again.",
    );
    expect(html).toContain("Back to the hub");
    expect(html).not.toContain("Decline card");
  });

  it("unknown, malformed or settled ids show the expired copy", async () => {
    expect(await renderPage(SESSION)).toContain("has expired");
    expect(await renderPage("cs_fake_../../x")).toContain("has expired");
    db.readFakeObject.mockResolvedValue(session({ status: "complete" }));
    expect(await renderPage(SESSION)).toContain("has expired");
    db.readFakeObject.mockResolvedValue(invoice({ status: "paid" }));
    expect(await renderPage(INVOICE)).toContain("has expired");
    expect(db.readFakeObject).toHaveBeenCalledTimes(3);
  });

  it("shows the failure alert on error=1", async () => {
    db.readFakeObject.mockResolvedValue(session());
    expect(await renderPage(SESSION, { error: "1" })).toContain('role="alert"');
  });

  it("is noindex and 404s in production", async () => {
    const mod = await import("../app/(platform)/test-pay/[id]/page");
    expect(String(mod.metadata.robots)).toContain("noindex");
    vi.stubEnv("CDS_ENV", "production");
    await expect(renderPage(SESSION)).rejects.toThrow("NOT_FOUND");
  });
});

describe("payTestSession / payTestInvoice", () => {
  it("pay emits through the fake helper and returns the success path", async () => {
    db.readFakeObject.mockResolvedValue(session());
    db.fakeCompleteSession.mockResolvedValue({
      redirect: `${ORIGIN}/hub/checkout/return?session=${SESSION}`,
    });
    const r = await actions.payTestSession(SESSION, "pay");
    expect(r).toEqual({
      ok: true,
      data: { redirect: `/hub/checkout/return?session=${SESSION}` },
    });
    expect(db.fakeCompleteSession).toHaveBeenCalledWith(SESSION, "pay");
    expect(deps.ensurePaymentAddonDeps).toHaveBeenCalled();
  });

  it("decline returns the cancel path with payment=failed; fail_later passes through", async () => {
    db.readFakeObject.mockResolvedValue(session());
    db.fakeCompleteSession.mockResolvedValue({
      redirect: `${ORIGIN}/hub/checkout?payment=failed`,
    });
    const r = await actions.payTestSession(SESSION, "decline");
    expect(r.ok && r.data.redirect).toBe("/hub/checkout?payment=failed");
    await actions.payTestSession(SESSION, "fail_later");
    expect(db.fakeCompleteSession).toHaveBeenLastCalledWith(
      SESSION,
      "fail_later",
    );
  });

  it("an off-platform redirect falls back to /hub (T-10-23-03)", async () => {
    db.readFakeObject.mockResolvedValue(session());
    db.fakeCompleteSession.mockResolvedValue({
      redirect: "https://evil.example/steal",
    });
    const r = await actions.payTestSession(SESSION, "pay");
    expect(r.ok && r.data.redirect).toBe("/hub");
  });

  it("refuses another org's session, a bad id or a bad outcome", async () => {
    db.readFakeObject.mockResolvedValue(session({}, "org2"));
    expect((await actions.payTestSession(SESSION, "pay")).ok).toBe(false);
    expect((await actions.payTestSession("cs_fake_x", "pay")).ok).toBe(false);
    db.readFakeObject.mockResolvedValue(session());
    expect((await actions.payTestSession(SESSION, "steal" as "pay")).ok).toBe(
      false,
    );
    expect(db.fakeCompleteSession).not.toHaveBeenCalled();
  });

  it("only the owner pays a Support checkout", async () => {
    const admin = { ...CTX, role: "admin" };
    sess.getHubSession.mockResolvedValue({ ctx: admin });
    db.readFakeObject.mockResolvedValue(session());
    const r = await actions.payTestSession(SESSION, "pay");
    expect(r.ok).toBe(false);
    expect(db.fakeCompleteSession).not.toHaveBeenCalled();
  });

  it("signed out is refused", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const r = await actions.payTestSession(SESSION, "pay");
    expect(r).toMatchObject({ ok: false, code: "signed_out" });
  });

  it("invoices: pay and decline call fakePayInvoice and return Settings › Billing", async () => {
    db.readFakeObject.mockResolvedValue(invoice());
    const paid = await actions.payTestInvoice(INVOICE, "pay");
    expect(paid.ok && paid.data.redirect).toBe("/hub/settings?tab=billing");
    expect(db.fakePayInvoice).toHaveBeenCalledWith(INVOICE, "pay");
    const declined = await actions.payTestInvoice(INVOICE, "decline");
    expect(declined.ok && declined.data.redirect).toBe(
      "/hub/settings?tab=billing&payment=failed",
    );
  });

  it("invoices: another org's invoice is refused", async () => {
    db.readFakeObject.mockResolvedValue(invoice({}, "org2"));
    expect((await actions.payTestInvoice(INVOICE, "pay")).ok).toBe(false);
    expect(db.fakePayInvoice).not.toHaveBeenCalled();
  });

  it("refuses in production before touching the store", async () => {
    vi.stubEnv("CDS_ENV", "production");
    expect((await actions.payTestSession(SESSION, "pay")).ok).toBe(false);
    expect((await actions.payTestInvoice(INVOICE, "pay")).ok).toBe(false);
    expect(db.readFakeObject).not.toHaveBeenCalled();
  });
});

describe("submitTestPayment form handler", () => {
  it("redirects to the action's path", async () => {
    db.readFakeObject.mockResolvedValue(session());
    db.fakeCompleteSession.mockResolvedValue({
      redirect: `${ORIGIN}/hub/checkout/return?session=${SESSION}`,
    });
    await expect(
      actions.submitTestPayment(form({ id: SESSION, outcome: "pay" })),
    ).rejects.toThrow(`REDIRECT:/hub/checkout/return?session=${SESSION}`);
  });

  it("a failure comes back to the page with error=1", async () => {
    db.readFakeObject.mockResolvedValue(session({}, "org2"));
    await expect(
      actions.submitTestPayment(form({ id: SESSION, outcome: "pay" })),
    ).rejects.toThrow(`REDIRECT:/test-pay/${SESSION}?error=1`);
  });

  it("a malformed id goes to the hub", async () => {
    await expect(
      actions.submitTestPayment(form({ id: "nope", outcome: "pay" })),
    ).rejects.toThrow("REDIRECT:/hub");
  });
});

describe("/test-pay/portal", () => {
  it("shows the card and both buttons for the org's own portal link", async () => {
    db.testPayCustomerId.mockResolvedValue(CUSTOMER);
    db.readFakeObject.mockResolvedValue(portalObj());
    const html = await renderPortal({ session: PORTAL });
    expect(html).toContain("Update your test card");
    expect(html).toContain("Test card ending 4242");
    const order = [
      "Save test card",
      "Use a card that fails",
      "Back to the hub",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a link for another org or another customer shows the expired copy", async () => {
    db.testPayCustomerId.mockResolvedValue(CUSTOMER);
    db.readFakeObject.mockResolvedValue(portalObj("org2"));
    expect(await renderPortal({ session: PORTAL })).toContain("has expired");
    db.readFakeObject.mockResolvedValue(
      portalObj("org1", "cus_fake_zzzzzzzzzzzzzzz"),
    );
    expect(await renderPortal({ session: PORTAL })).toContain("has expired");
    expect(await renderPortal({ session: "bps_fake_bad" })).toContain(
      "has expired",
    );
  });

  it("a role without billing:write gets the expired copy, not a crash", async () => {
    db.testPayCustomerId.mockRejectedValue(new Error("forbidden"));
    expect(await renderPortal({ session: PORTAL })).toContain("has expired");
  });

  it("saveTestCard(false) updates the org's own customer and returns card=updated", async () => {
    db.testPayCustomerId.mockResolvedValue(CUSTOMER);
    const r = await actions.saveTestCard(false);
    expect(r.ok && r.data.redirect).toBe(
      "/hub/settings?tab=billing&card=updated",
    );
    expect(db.fakeUpdateCard).toHaveBeenCalledWith(CUSTOMER, false);
    expect(deps.ensurePaymentAddonDeps).toHaveBeenCalled();
  });

  it("saveTestCard(true) makes the card fail", async () => {
    db.testPayCustomerId.mockResolvedValue(CUSTOMER);
    const r = await actions.saveTestCard(true);
    expect(r.ok && r.data.redirect).toBe("/hub/settings?tab=billing");
    expect(db.fakeUpdateCard).toHaveBeenCalledWith(CUSTOMER, true);
  });

  it("no customer yet: refused", async () => {
    expect((await actions.saveTestCard(false)).ok).toBe(false);
    expect(db.fakeUpdateCard).not.toHaveBeenCalled();
  });

  it("form handler redirects on success and back with error=1 on failure", async () => {
    db.testPayCustomerId.mockResolvedValue(CUSTOMER);
    await expect(
      actions.submitTestCard(form({ session: PORTAL, outcome: "save" })),
    ).rejects.toThrow("REDIRECT:/hub/settings?tab=billing&card=updated");
    db.testPayCustomerId.mockResolvedValue(null);
    await expect(
      actions.submitTestCard(form({ session: PORTAL, outcome: "save" })),
    ).rejects.toThrow(`REDIRECT:/test-pay/portal?session=${PORTAL}&error=1`);
  });
});

describe("/test-pay/connect", () => {
  it("shows the three outcomes for the org's own account", async () => {
    db.testPayAccountId.mockResolvedValue(ACCOUNT);
    const html = await renderConnect({ account: ACCOUNT });
    expect(html).toContain("Connect a test Stripe account");
    expect(html).toContain("Pick how this pretend account should behave.");
    const order = [
      "Connect test account",
      "Connect with setup not finished",
      "Connect a restricted account",
      "Back to the hub",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("a mismatching or malformed account shows the expired copy", async () => {
    db.testPayAccountId.mockResolvedValue(ACCOUNT);
    expect(
      await renderConnect({ account: "acct_fake_zzzzzzzzzzzzzzz" }),
    ).toContain("has expired");
    expect(await renderConnect({ account: "acct_x" })).toContain("has expired");
    expect(await renderConnect({})).toContain("has expired");
  });

  it.each(["finished", "unfinished", "restricted"] as const)(
    "connectTestAccount(%s) settles the org's account and returns to Payments",
    async (kind) => {
      db.testPayAccountId.mockResolvedValue(ACCOUNT);
      const r = await actions.connectTestAccount(kind);
      expect(r.ok && r.data.redirect).toBe(
        "/hub/settings?tab=payments&connect=return",
      );
      expect(db.fakeConnectOutcome).toHaveBeenCalledWith(ACCOUNT, kind);
    },
  );

  it("refuses a bad kind or no account", async () => {
    db.testPayAccountId.mockResolvedValue(ACCOUNT);
    expect((await actions.connectTestAccount("live" as "finished")).ok).toBe(
      false,
    );
    db.testPayAccountId.mockResolvedValue(null);
    expect((await actions.connectTestAccount("finished")).ok).toBe(false);
    expect(db.fakeConnectOutcome).not.toHaveBeenCalled();
  });

  it("form handler redirects on success and back with error=1 on failure", async () => {
    db.testPayAccountId.mockResolvedValue(ACCOUNT);
    await expect(
      actions.submitTestConnect(form({ account: ACCOUNT, kind: "finished" })),
    ).rejects.toThrow("REDIRECT:/hub/settings?tab=payments&connect=return");
    db.testPayAccountId.mockResolvedValue(null);
    await expect(
      actions.submitTestConnect(form({ account: ACCOUNT, kind: "finished" })),
    ).rejects.toThrow(`REDIRECT:/test-pay/connect?account=${ACCOUNT}&error=1`);
  });

  it("portal and connect refuse and 404 in production", async () => {
    vi.stubEnv("CDS_ENV", "production");
    expect((await actions.saveTestCard(false)).ok).toBe(false);
    expect((await actions.connectTestAccount("finished")).ok).toBe(false);
    await expect(renderPortal({ session: PORTAL })).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(renderConnect({ account: ACCOUNT })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(db.testPayCustomerId).not.toHaveBeenCalled();
  });
});
