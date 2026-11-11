// 10-22 Task 1: the checkout Server Actions (AGR-02, BILL-01; CONTEXT A2; T-10-22-01..05).
// The session and @cds/db are mocked; the real runAction maps refusals to UI copy.
import { AgreementRequired, InvalidInput } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = vi.hoisted(() => ({
  requireCurrentSignature: vi.fn(),
  startCheckout: vi.fn(),
  saveCheckoutDraft: vi.fn(),
  checkoutOrderFor: vi.fn(),
  checkoutReturnStatus: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { startCheckoutAction, previewCheckoutAction, checkoutStatusAction } =
  await import("../app/actions/checkout");

function withCode(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new InvalidInput("x"), { code, ...extra });
}

const CHOICES = {
  addons: ["testimonials"],
  extras: ["copywriting", "logo-design"],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "full",
};

function session(ctx: Record<string, unknown> = OWNER) {
  sess.getHubSession.mockResolvedValue({
    ctx,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.agreementBlocks.mockReset().mockResolvedValue(false);
  session();
  db.requireCurrentSignature.mockResolvedValue(undefined);
  db.startCheckout.mockResolvedValue({ url: "https://pay.example/s1" });
});

describe("startCheckoutAction", () => {
  it("unsigned owner: redirects to the agreement and never calls startCheckout (AGR-02)", async () => {
    db.requireCurrentSignature.mockRejectedValue(new AgreementRequired());
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 153900,
    });
    expect(res).toEqual({
      ok: true,
      data: { redirect: "/hub/agreement?next=/hub/checkout" },
    });
    expect(db.startCheckout).not.toHaveBeenCalled();
    expect(db.saveCheckoutDraft).not.toHaveBeenCalled();
  });

  it("outdated owner (runAction re-accept gate): redirects, no billing call", async () => {
    sess.agreementBlocks.mockResolvedValue(true);
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 1,
    });
    expect(res).toEqual({
      ok: true,
      data: { redirect: "/hub/agreement?next=/hub/checkout" },
    });
    expect(db.startCheckout).toHaveBeenCalledTimes(0);
  });

  it("Admin gets NOT-OWNER-PAY and no call", async () => {
    session({ ...OWNER, role: "admin" });
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/^Only the site owner can pay\./);
    expect(db.requireCurrentSignature).not.toHaveBeenCalled();
    expect(db.startCheckout).not.toHaveBeenCalled();
  });

  it("impersonating staff gets IMPERSONATING-PAY and no call", async () => {
    session({ ...OWNER, impersonator: "staff1" });
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 1,
    });
    expect(res).toMatchObject({
      ok: false,
      message:
        "You're viewing as CDS staff, so payment is turned off. Only the owner can pay.",
    });
    expect(db.startCheckout).not.toHaveBeenCalled();
  });

  it("valid input: one startCheckout call with the session ctx and extras unchanged", async () => {
    const res = await startCheckoutAction({
      choices: { ...CHOICES, organization: "org2", priceCents: 1 },
      expectedDueTodayCents: 153900,
    });
    expect(res).toEqual({ ok: true, data: { url: "https://pay.example/s1" } });
    expect(db.startCheckout).toHaveBeenCalledTimes(1);
    const [ctx, choices, opts, deps] = db.startCheckout.mock.calls[0]!;
    expect(ctx).toBe(OWNER);
    expect(choices).toEqual(CHOICES);
    expect(opts).toEqual({ expectedDueTodayCents: 153900 });
    expect(deps.registry).toBeDefined();
    // The signature check runs before the billing call.
    expect(
      db.requireCurrentSignature.mock.invocationCallOrder[0]!,
    ).toBeLessThan(db.startCheckout.mock.invocationCallOrder[0]!);
  });

  it.each([
    [withCode("price_changed"), { error: "price_changed" }],
    [
      withCode("checkout_blocked", { unpriced: ["copywriting"] }),
      { error: "unpriced", unpriced: ["copywriting"] },
    ],
    [withCode("payments_unavailable"), { error: "open_soon" }],
    [
      withCode("already_paid"),
      { redirect: "/hub/settings?tab=billing&notice=already-paid" },
    ],
  ])("maps %s", async (err, data) => {
    db.startCheckout.mockRejectedValue(err);
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 1,
    });
    expect(res).toEqual({ ok: true, data });
  });

  it("any other error is failed, logging only the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.startCheckout.mockRejectedValue(new Error("boom"));
    const res = await startCheckoutAction({
      choices: CHOICES,
      expectedDueTodayCents: 1,
    });
    expect(res).toEqual({ ok: true, data: { error: "failed" } });
    expect(spy).toHaveBeenCalledWith("[checkout] start failed", "boom");
    spy.mockRestore();
  });

  it.each([
    ["not an object", "x"],
    ["no choices", { expectedDueTodayCents: 1 }],
    ["bad cadence", { choices: { ...CHOICES, cadence: "weekly" } }],
    ["add-ons not an array", { choices: { ...CHOICES, addons: "a" } }],
    ["extras not an array", { choices: { ...CHOICES, extras: { a: 1 } } }],
    ["bad extra slug", { choices: { ...CHOICES, extras: ["__proto__"] } }],
    ["care plan not boolean", { choices: { ...CHOICES, carePlan: "yes" } }],
    ["bad build plan", { choices: { ...CHOICES, buildPlan: "half" } }],
    ["negative cents", { choices: CHOICES, expectedDueTodayCents: -1 }],
    ["string cents", { choices: CHOICES, expectedDueTodayCents: "1" }],
  ])("malformed input (%s) is refused without a db call", async (_n, input) => {
    const res = await startCheckoutAction(input);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.requireCurrentSignature).not.toHaveBeenCalled();
    expect(db.startCheckout).not.toHaveBeenCalled();
  });
});

describe("previewCheckoutAction", () => {
  it("saves the draft (extras unchanged) and returns the server view", async () => {
    db.saveCheckoutDraft.mockImplementation(async (_c, d) => d);
    db.checkoutOrderFor.mockImplementation(async (_c, choices) => ({
      choices,
      path: "standard",
      totals: {
        path: "standard",
        cadence: "monthly",
        build: {
          cents: 150000,
          installments: 6,
          eachCents: 25000,
          lastCents: 25000,
        },
        plan: {
          kind: "plan",
          key: "base",
          monthlyCents: 3900,
          oneTimeCents: null,
        },
        addons: [],
        extras: [],
        carePlan: null,
        monthlyCents: 3900,
        recurringFirstChargeCents: 3900,
        dueAtCheckoutCents: 153900,
        dueAtCheckoutWithInstallmentsCents: 28900,
        firstYearCents: 0,
        unpricedCount: 0,
        unpriced: [],
      },
      summary: {
        pathLabel: "Standard",
        today: [],
        dueTodayCents: 153900,
        then: [{ text: "$39 a month from 8 Nov" }],
        testMode: true,
      },
      carePlanMonthlyCents: 9900,
    }));
    const res = await previewCheckoutAction(CHOICES);
    expect(db.saveCheckoutDraft).toHaveBeenCalledTimes(1);
    expect(db.saveCheckoutDraft.mock.calls[0]![1]).toEqual(CHOICES);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.liveText).toBe(
        "Due today now $1,539. Then $39 a month from 8 Nov.",
      );
      expect(res.data.draft.extras).toEqual(["copywriting", "logo-design"]);
    }
  });

  it("refuses malformed input without saving", async () => {
    const res = await previewCheckoutAction({ ...CHOICES, addons: [1] });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveCheckoutDraft).not.toHaveBeenCalled();
  });
});

describe("checkoutStatusAction", () => {
  it("another org's (unknown) session is failed with no data", async () => {
    db.checkoutReturnStatus.mockResolvedValue({ state: "unknown" });
    const res = await checkoutStatusAction("cs_other");
    expect(res).toEqual({ ok: true, data: { state: "failed" } });
    expect(db.checkoutReturnStatus.mock.calls[0]![0]).toBe(OWNER);
  });

  it("a malformed id never reaches the db", async () => {
    const res = await checkoutStatusAction("../../x");
    expect(res).toEqual({ ok: true, data: { state: "failed" } });
    expect(db.checkoutReturnStatus).not.toHaveBeenCalled();
  });

  it("received returns the paid lines", async () => {
    db.checkoutReturnStatus.mockResolvedValue({
      state: "received",
      paidCents: 153900,
      taxCents: 0,
      nextBill: "$39 a month from 8 Nov",
      receiptEmail: "ana@example.com",
    });
    const res = await checkoutStatusAction("cs_1");
    expect(res).toEqual({
      ok: true,
      data: {
        state: "received",
        paid: {
          paidLabel: "$1,539.00 plus $0.00 tax",
          nextBillLabel: "$39 a month from 8 Nov",
          receiptLine: "Emailed to ana@example.com",
        },
      },
    });
  });
});
