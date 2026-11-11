// 10-16 (AGR-02, ROADMAP P10 criterion 2; CONTEXT A2; T-10-16-01..06): no one but a signed
// owner of a confirmed, unpaid site can start a checkout. Every refusal is proven with a
// billing spy that records zero calls: AgreementRequired, Forbidden, ImpersonationDenied,
// the stage gate, PaymentsUnavailable, CheckoutBlocked and PriceChanged.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  AgreementRequired,
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
} from "@cds/core";
import { composeAddonRegistry } from "@cds/core/addons";
import type { PolicySet } from "@cds/core/legal";
import { POLICY_SET } from "@cds/core/legal";
import { PaymentsUnavailable } from "@cds/core/payments";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_STUDIO_BOOKING } from "../../core/src/onboarding/__fixtures__/path-addons";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { platformUrl } from "../src/email/env";
import { captureTransport } from "../src/email/transport";
import { signAgreement, type SignInput } from "../src/legal";
import {
  __setPolicySetForTests,
  activeConsentVersion,
  activePolicies,
} from "../src/legal/policy-versions";
import {
  AlreadyPaid,
  checkoutOrderFor,
  checkoutReturnStatus,
  HELD_CHECKOUT_COPY,
  NOT_SENT_COPY,
  PriceChanged,
  readCheckoutDraft,
  readCheckoutState,
  saveCheckoutDraft,
  startCheckout,
  type CheckoutChoices,
} from "../src/payments/checkout";
import { CheckoutBlocked } from "../src/payments/checkout-lines";
import { ProviderIdConflict } from "../src/payments/staff-alert";
import { LocalDiskStore } from "../src/storage/local-disk";
import { createBillingSpy, type BillingSpy } from "./fake-billing-spy";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let dir = "";
let store: LocalDiskStore;
const mail = captureTransport();
const savedEnv = process.env.CDS_ENV;
const savedStaff = process.env.CDS_STAFF_ALERT_EMAIL;

const registry = composeAddonRegistry(
  [...ADDON_REGISTRY.list(), FIXTURE_STUDIO_BOOKING],
  { fileExists: () => true },
);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tag = () => randomBytes(4).toString("hex");

/** POLICY_SET plus a terms-of-service v2: an org signed on v1 becomes outdated. */
function withTosV2(): PolicySet {
  const v1 = POLICY_SET.policies.find((p) => p.key === "terms-of-service")!;
  const bodyMd = `${v1.bodyMd}\n\nVersion 2 adds one sentence.\n`;
  return {
    policies: [
      ...POLICY_SET.policies,
      {
        ...v1,
        version: 2,
        changes: "Adds one sentence.",
        bodyMd,
        sha256: sha(bodyMd),
      },
    ],
    consents: POLICY_SET.consents,
  };
}

type Org = { id: string; owner: string };

async function newOrg(
  stage: string,
  selections: { addons?: string[]; extras?: string[] } = {},
  path: "standard" | "studio" = "standard",
): Promise<Org> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Gate ${t}`,
    slug: `gate-${t}`,
    status: "active",
    path,
    stage,
  });
  const password = `P-${randomBytes(12).toString("hex")}`;
  const user = await pb.collection("users").create({
    email: `owner-${t}@cds.test`,
    password,
    passwordConfirm: password,
    name: "Ana Rivera",
  });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: org.id, role: "owner" });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: {
      addons: selections.addons ?? [],
      extras: selections.extras ?? [],
      carePlan: false,
      cadence: "monthly",
    },
  });
  return { id: org.id, owner: user.id };
}

function ctxOf(
  o: Org,
  role: "owner" | "admin" = "owner",
  extra: { impersonator?: string } = {},
): OrgContext {
  return mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
    ...extra,
  });
}

async function sign(o: Org): Promise<void> {
  const policies = (await activePolicies()).map((p) => ({
    key: p.key,
    version: p.version,
    sha256: p.sha256,
  }));
  const c = await activeConsentVersion();
  const input: SignInput = {
    policies,
    consent: { version: c.version, sha256: c.sha256 },
    signerName: "Ana Rivera",
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 vitest",
    authMethod: "otp",
  };
  await signAgreement(ctxOf(o), input, { store, transport: mail });
}

const PLAIN: CheckoutChoices = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "full",
};
/** Standard, paid in full, nothing else: $1,500 + $39. */
const PLAIN_DUE = 153900;

const alerts = (event: string) =>
  mail.sent.filter(
    (m) => m.type === "billing.staff_alert" && m.text.includes(event),
  );

async function accountOf(orgId: string) {
  const res = await pb.collection("billing_accounts").getList(1, 1, {
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
  return res.items[0] ?? null;
}

let spy: BillingSpy;
const deps = () => ({ registry, billing: spy, transport: mail });

beforeAll(async () => {
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  dir = await mkdtemp(join(tmpdir(), "cds-checkout-gate-"));
  store = new LocalDiskStore(dir);
});

afterEach(() => {
  __setPolicySetForTests(null);
  if (savedEnv === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = savedEnv;
});

afterAll(async () => {
  __setPolicySetForTests(null);
  if (savedStaff === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
  else process.env.CDS_STAFF_ALERT_EMAIL = savedStaff;
  await inst?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("AGR-02: the agreement gate makes no billing call", () => {
  it("an unsigned owner is refused with AgreementRequired and zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const o = await newOrg("ready_for_build");
    await expect(
      startCheckout(
        ctxOf(o),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(AgreementRequired);
    expect(spy.calls.length).toBe(0);
    expect(await accountOf(o.id)).toBeNull();
  });

  it("an owner signed on an older policy version is refused with zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const o = await newOrg("ready_for_build");
    await sign(o);
    __setPolicySetForTests(withTosV2());
    await expect(
      startCheckout(
        ctxOf(o),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(AgreementRequired);
    expect(spy.calls.length).toBe(0);
  });

  it("an Admin is Forbidden and an impersonating owner is denied, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const o = await newOrg("ready_for_build");
    await sign(o);
    await expect(
      startCheckout(
        ctxOf(o, "admin"),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(Forbidden);
    await expect(
      startCheckout(
        ctxOf(o, "owner", { impersonator: o.owner }),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(ImpersonationDenied);
    expect(spy.calls).toHaveLength(0);
  });
});

describe("stage, payments open, prices", () => {
  let o: Org;

  it("a signed owner at intake, fit_review, closed or paid is refused, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    o = await newOrg("intake", {
      addons: ["testimonials"],
      extras: ["copywriting", "logo-design"],
    });
    await sign(o);
    const run = () =>
      startCheckout(
        ctxOf(o),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      );

    await expect(run()).rejects.toThrow(NOT_SENT_COPY);
    await pb.collection("organizations").update(o.id, { stage: "fit_review" });
    await expect(run()).rejects.toThrow(HELD_CHECKOUT_COPY);

    await pb.collection("organizations").update(o.id, {
      stage: "ready_for_build",
      closed_at: new Date().toISOString(),
      closed_reason: "declined",
    });
    await expect(run()).rejects.toThrow(InvalidInput);
    await pb
      .collection("organizations")
      .update(o.id, { closed_at: "", closed_reason: "" });

    const acc = await pb.collection("billing_accounts").create({
      organization: o.id,
      provider: "fake",
      status: "active",
      installments_paid: 0,
      paid_at: new Date().toISOString(),
    });
    await expect(run()).rejects.toThrow(AlreadyPaid);
    await pb.collection("billing_accounts").delete(acc.id);
    expect(spy.calls).toHaveLength(0);
  });

  it("production on the fake adapter refuses with PaymentsUnavailable and one staff alert", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const before = alerts("payments_unavailable").length;
    process.env.CDS_ENV = "production";
    await expect(
      startCheckout(
        ctxOf(o),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(PaymentsUnavailable);
    expect(spy.calls.length).toBe(0);
    expect(alerts("payments_unavailable").length).toBe(before + 1);
  });

  it("an unpriced add-on blocks checkout with a staff alert, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const before = alerts("unpriced_item").length;
    const err = await startCheckout(
      ctxOf(o),
      { ...PLAIN, addons: ["testimonials"] },
      { expectedDueTodayCents: PLAIN_DUE },
      deps(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckoutBlocked);
    expect((err as CheckoutBlocked).unpriced).toEqual(["testimonials"]);
    expect(spy.calls).toHaveLength(0);
    expect(alerts("unpriced_item").length).toBe(before + 1);
  });

  it("an unpriced extra kept in the draft blocks checkout, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const before = alerts("unpriced_item").length;
    const err = await startCheckout(
      ctxOf(o),
      { ...PLAIN, extras: ["logo-design"] },
      { expectedDueTodayCents: PLAIN_DUE },
      deps(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckoutBlocked);
    expect((err as CheckoutBlocked).unpriced).toEqual(["logo-design"]);
    expect(spy.calls).toHaveLength(0);
    expect(alerts("unpriced_item").length).toBe(before + 1);
  });

  it("a figure different from the re-priced one refuses with PriceChanged, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const err = await startCheckout(
      ctxOf(o),
      PLAIN,
      { expectedDueTodayCents: PLAIN_DUE - 100 },
      deps(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PriceChanged);
    expect((err as PriceChanged).dueTodayCents).toBe(PLAIN_DUE);
    expect(spy.calls.length).toBe(0);
  });

  it("WR-E05: on Stripe, a recurring line with no synced price blocks checkout, zero calls", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    // The seeded catalog has no provider refs (prices:set --sync-all never ran).
    Object.assign(spy, { provider: "stripe" });
    const before = alerts("unpriced_item").length;
    await expect(
      startCheckout(
        ctxOf(o),
        { ...PLAIN, buildPlan: "installments" },
        { expectedDueTodayCents: 25000 + 3900 },
        deps(),
      ),
    ).rejects.toThrow(CheckoutBlocked);
    expect(spy.calls).toEqual([]);
    expect(alerts("unpriced_item").length).toBe(before + 1);
    expect(alerts("unpriced_item").at(-1)!.text).toContain("--sync-all");
  });

  it("a signed, ready owner: ensureCustomer then createCheckout; the account holds the order", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy();
    const { url } = await startCheckout(
      ctxOf(o),
      { ...PLAIN, buildPlan: "installments" },
      { expectedDueTodayCents: 25000 + 3900 },
      deps(),
    );
    expect(url).toBe("https://billing-spy.invalid/checkout");
    expect(spy.calls.map((c) => c.method)).toEqual([
      "ensureCustomer",
      "createCheckout",
    ]);
    const input = spy.calls[1]!.args[0] as {
      customerId: string;
      lines: { kind: string; unitCents: number }[];
      successUrl: string;
      cancelUrl: string;
      cadence: string;
      idempotencyKey: string;
    };
    expect(input.customerId).toBe("cus_spy");
    expect(input.lines.map((l) => [l.kind, l.unitCents])).toEqual([
      ["installment", 25000],
      ["plan", 3900],
    ]);
    expect(input.successUrl).toBe(
      platformUrl("/hub/checkout/return?session={CHECKOUT_SESSION_ID}"),
    );
    expect(input.cancelUrl).toBe(platformUrl("/hub/checkout?cancelled=1"));
    expect(input.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);

    const acc = await accountOf(o.id);
    expect(acc?.customer_id).toBe("cus_spy");
    expect(acc?.checkout_session_id).toBe("cs_spy");
    expect(acc?.checkout_draft).toMatchObject({
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "installments",
      buildCents: 150000,
    });
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'billing.checkout_started'",
        {
          o: o.id,
        },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ dueTodayCents: 28900 });
  });
});

describe("checkout draft: only removals (D-UI-P10-5)", () => {
  it("defaults come from the intake; extras and add-ons can be removed, never added", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build", {
      addons: ["testimonials"],
      extras: ["copywriting", "rush-launch"],
    });
    const d = await readCheckoutDraft(ctxOf(o), registry);
    expect(d).toEqual({
      addons: ["testimonials"],
      extras: ["copywriting", "rush-launch"],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "full",
      pagePacks: 0,
    });

    // Removing an intake extra and the add-on is accepted.
    const saved = await saveCheckoutDraft(
      ctxOf(o),
      { ...d, addons: [], extras: ["copywriting"], carePlan: true },
      registry,
    );
    expect(saved.extras).toEqual(["copywriting"]);
    expect(await readCheckoutDraft(ctxOf(o), registry)).toMatchObject({
      addons: [],
      extras: ["copywriting"],
      carePlan: true,
    });

    // An add-on outside the intake and not active, an extra not chosen at /start.
    await expect(
      saveCheckoutDraft(ctxOf(o), { ...d, addons: ["credentials"] }, registry),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveCheckoutDraft(ctxOf(o), { ...d, extras: ["logo-design"] }, registry),
    ).rejects.toThrow(InvalidInput);
    // The last good save is unchanged.
    expect((await readCheckoutDraft(ctxOf(o), registry)).extras).toEqual([
      "copywriting",
    ]);
  });

  it("an add-on active on the site joins the order", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build");
    await pb.collection("org_addons").create({
      organization: o.id,
      addon: "credentials",
      status: "active",
      source: "hub",
    });
    const saved = await saveCheckoutDraft(
      ctxOf(o),
      { ...PLAIN, addons: ["credentials"] },
      registry,
    );
    expect(saved.addons).toEqual(["credentials"]);
  });

  it("a Studio-only add-on on a Standard org is refused and nothing is saved", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build", {
      addons: [FIXTURE_STUDIO_BOOKING.slug],
    });
    await expect(
      saveCheckoutDraft(
        ctxOf(o),
        { ...PLAIN, addons: [FIXTURE_STUDIO_BOOKING.slug] },
        registry,
      ),
    ).rejects.toThrow(InvalidInput);
    expect(await accountOf(o.id)).toBeNull();
    // The default order never carries it either.
    expect((await readCheckoutDraft(ctxOf(o), registry)).addons).toEqual([]);
  });

  it("an Admin and an impersonating owner cannot save the order", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build");
    await expect(
      saveCheckoutDraft(ctxOf(o, "admin"), PLAIN, registry),
    ).rejects.toThrow(Forbidden);
    await expect(
      saveCheckoutDraft(
        ctxOf(o, "owner", { impersonator: o.owner }),
        PLAIN,
        registry,
      ),
    ).rejects.toThrow(ImpersonationDenied);
  });
});

describe("10-22: checkout page readers", () => {
  it("readCheckoutState: stage, closed and paid for Owner and Admin, no ids", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build");
    const st = await readCheckoutState(ctxOf(o, "admin"));
    expect(st).toMatchObject({
      stage: "ready_for_build",
      path: "standard",
      closed: false,
      paidAt: null,
    });
    expect(Object.keys(st).sort()).toEqual([
      "closed",
      "paidAt",
      "path",
      "paymentsOpen",
      "stage",
      "testMode",
    ]);
  });

  it("checkoutOrderFor prices the draft; an unpriced extra gives no summary", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("ready_for_build", { extras: ["copywriting"] });
    const order = await checkoutOrderFor(ctxOf(o, "admin"), null, deps());
    expect(order.choices.extras).toEqual(["copywriting"]);
    expect(order.totals.unpriced).toEqual(["copywriting"]);
    expect(order.summary).toBeNull();
    const plain = await checkoutOrderFor(ctxOf(o), PLAIN, deps());
    expect(plain.summary?.dueTodayCents).toBe(PLAIN_DUE);
    expect(plain.totals.plan.monthlyCents).toBe(3900);
    // A choice outside the offer is refused, never priced.
    await expect(
      checkoutOrderFor(ctxOf(o), { ...PLAIN, extras: ["rush-launch"] }, deps()),
    ).rejects.toThrow(InvalidInput);
  });

  it("WR-A01: a customer id another org holds is refused with a staff alert; nothing saved", async (t) => {
    if (!inst) return t.skip();
    const holder = await newOrg("ready_for_build");
    const taken = `cus_taken_${holder.id}`;
    await pb.collection("billing_accounts").create({
      organization: holder.id,
      provider: "fake",
      status: "none",
      customer_id: taken,
    });
    // The provider hands org B a customer id org A already holds.
    spy = createBillingSpy({ ensureCustomer: { customerId: taken } });
    const b = await newOrg("ready_for_build");
    await sign(b);
    const before = alerts("provider_id_conflict").length;
    await expect(
      startCheckout(
        ctxOf(b),
        PLAIN,
        { expectedDueTodayCents: PLAIN_DUE },
        deps(),
      ),
    ).rejects.toThrow(ProviderIdConflict);
    expect(spy.callsTo("createCheckout")).toHaveLength(0);
    expect(alerts("provider_id_conflict").length).toBe(before + 1);
    expect((await accountOf(b.id))?.customer_id ?? "").toBe("");
  });

  it("WR-A01: the database refuses a second org with the same provider ids", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg("ready_for_build");
    const b = await newOrg("ready_for_build");
    const ids = {
      customer_id: `cus_dup_${a.id}`,
      subscription_id: `sub_dup_${a.id}`,
    };
    await pb.collection("billing_accounts").create({
      organization: a.id,
      provider: "fake",
      status: "active",
      ...ids,
    });
    for (const dup of [
      { customer_id: ids.customer_id },
      { subscription_id: ids.subscription_id },
    ]) {
      await expect(
        pb.collection("billing_accounts").create({
          organization: b.id,
          provider: "fake",
          status: "active",
          ...dup,
        }),
      ).rejects.toThrow();
    }
    // Empty ids ("none yet") never collide.
    await pb
      .collection("billing_accounts")
      .create({ organization: b.id, provider: "fake", status: "none" });
    const acct = `acct_dup_${a.id}`;
    await pb.collection("gateway_accounts").create({
      organization: a.id,
      provider: "fake",
      account_id: acct,
      status: "restricted",
    });
    await expect(
      pb.collection("gateway_accounts").create({
        organization: b.id,
        provider: "fake",
        account_id: acct,
        status: "restricted",
      }),
    ).rejects.toThrow();
  });

  it("checkoutReturnStatus answers only for the org's own session id (IDOR)", async (t) => {
    if (!inst) return t.skip();
    spy = createBillingSpy({
      // WR-A01: a customer id belongs to one org only (cus_spy is org o's above).
      ensureCustomer: (input) =>
        Promise.resolve({ customerId: `cus_spy_${input.orgId}` }),
      fetchCheckoutSession: {
        id: "cs_spy",
        orgId: null,
        customerId: "cus_spy",
        status: "open",
        paymentStatus: "unpaid",
        subscriptionId: null,
        invoiceId: null,
      },
    });
    const a = await newOrg("ready_for_build");
    const b = await newOrg("ready_for_build");
    await sign(a);
    await startCheckout(
      ctxOf(a),
      PLAIN,
      { expectedDueTodayCents: PLAIN_DUE },
      deps(),
    );
    // Org B asking about org A's session learns nothing, and no provider call is made.
    const before = spy.calls.length;
    expect(await checkoutReturnStatus(ctxOf(b), "cs_spy", deps())).toEqual({
      state: "unknown",
    });
    expect(await checkoutReturnStatus(ctxOf(a), "cs_other", deps())).toEqual({
      state: "unknown",
    });
    expect(spy.calls.length).toBe(before);
    expect(await checkoutReturnStatus(ctxOf(a), "cs_spy", deps())).toEqual({
      state: "confirming",
    });
    await expect(
      checkoutReturnStatus(ctxOf(a, "admin"), "cs_spy", deps()),
    ).rejects.toThrow(Forbidden);
  });
});
