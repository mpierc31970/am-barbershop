// 10-16 (ROADMAP P10 criterion 1; BILL-01, BILL-02, BILL-11, BILL-19; CONTEXT A2): a full
// purchase completes end to end on the fake adapter, with no spy: a signed owner starts the
// checkout, the "Test payment" page pays it, the events run through the one processor with
// real add-on deps, and the site is paid, its add-ons installed with source billing, the
// invoice mirrored and the receipt sent. A declined payment changes nothing.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type {
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standInBillingGate } from "../src/addons/billing";
import { installAddon } from "../src/addons/installer";
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { platformUrl } from "../src/email/env";
import { captureTransport } from "../src/email/transport";
import {
  isAgreementDocument,
  listDocuments,
  signAgreement,
} from "../src/legal";
import {
  activeConsentVersion,
  activePolicies,
} from "../src/legal/policy-versions";
import {
  AlreadyPaid,
  checkoutReturnStatus,
  PriceChanged,
  startCheckout,
  type CheckoutChoices,
} from "../src/payments/checkout";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakePaymentGateway,
  readFakeObject,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import { processNormalisedEvent } from "../src/payments/process";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let store: ObjectStore;
let signStore: LocalDiskStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const mail = captureTransport();
const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

function addonDeps(): AddonDeps {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons: ADDON_REGISTRY,
    billing: standInBillingGate(),
  };
}

let billing: CdsBilling;
let gateway: PaymentGateway;

const emit = async (e: NormalisedEvent): Promise<void> => {
  await processNormalisedEvent(e, {
    billing,
    gateway,
    transport: mail,
    addons: addonDeps(),
  });
};

type Org = { id: string; owner: string; email: string; ctx: OrgContext };

async function signedOrg(): Promise<Org> {
  const t = randomBytes(4).toString("hex");
  const org = await pb.collection("organizations").create({
    name: `Purchase ${t}`,
    slug: `purchase-${t}`,
    status: "active",
    path: "standard",
    stage: "ready_for_build",
  });
  const email = `owner-${t}@cds.test`;
  const password = `P-${randomBytes(12).toString("hex")}`;
  const user = await pb.collection("users").create({
    email,
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
      addons: ["testimonials"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    },
  });
  const ctx = mintOrgContext({
    orgId: org.id,
    actor: user.id,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
  const c = await activeConsentVersion();
  await signAgreement(
    ctx,
    {
      policies: (await activePolicies()).map((p) => ({
        key: p.key,
        version: p.version,
        sha256: p.sha256,
      })),
      consent: { version: c.version, sha256: c.sha256 },
      signerName: "Ana Rivera",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 vitest",
      authMethod: "otp",
    },
    { store: signStore, transport: mail },
  );
  return { id: org.id, owner: user.id, email, ctx };
}

/** Monthly, 6 payments, Care Plan on, Testimonials ($9). */
const ORDER: CheckoutChoices = {
  addons: ["testimonials"],
  extras: [],
  carePlan: true,
  cadence: "monthly",
  buildPlan: "installments",
};
const DUE = 25000 + 3900 + 900 + 9900;

const deps = () => ({ registry: ADDON_REGISTRY, billing, transport: mail });

async function account(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

async function addonRows(orgId: string) {
  return pb.collection("org_addons").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
}

function sessionIdOf(url: string): string {
  const path = new URL(url).pathname;
  expect(path).toMatch(/^\/test-pay\/[^/]+$/);
  return path.split("/")[2]!;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-billing-purchase-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  signStore = new LocalDiskStore(join(storageDir, "sign"));
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  billing = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
  // Testimonials is seeded unpriced (D264); price it $9 the way prices:set would.
  const row = await pb
    .collection("price_catalog")
    .getFirstListItem(
      "item_kind = 'addon' && item_key = 'testimonials' && path = 'standard'",
    );
  await pb
    .collection("price_catalog")
    .update(row.id, { priced: true, monthly_cents: 900 });
});

afterAll(async () => {
  await fakeSettled();
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("a full purchase on the fake adapter (ROADMAP P10 criterion 1)", () => {
  it("checkout -> test pay -> events -> paid, installed, mirrored, receipted", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const { url } = await startCheckout(
      o.ctx,
      ORDER,
      { expectedDueTodayCents: DUE },
      deps(),
    );
    const sessionId = sessionIdOf(url);

    const { redirect } = await fakeCompleteSession(sessionId, "pay", { emit });
    await fakeSettled();
    expect(redirect).toBe(
      platformUrl(`/hub/checkout/return?session=${sessionId}`),
    );

    const acc = await account(o.id);
    expect(acc.paid_at).not.toBe("");
    expect(acc.status).toBe("active");
    expect(acc.care_plan).toBe(true);
    expect(acc.build_plan).toBe("installments");
    expect(acc.checkout_session_id).toBe(sessionId);

    const org = await pb.collection("organizations").getOne(o.id);
    expect(org.billing_status).toBe("active");

    const rows = await addonRows(o.id);
    const testimonials = rows.find((r) => r.addon === "testimonials");
    expect(testimonials?.status).toBe("active");
    expect(testimonials?.source).toBe("billing");

    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.status).toBe("paid");
    expect(invoices[0]!.amount_cents).toBe(DUE);
    expect(invoices[0]!.has_installment).toBe(true);
    // WR-E03: the first invoice is the checkout's (Stripe sets no session on it).
    expect(invoices[0]!.kind).toBe("checkout");
    expect(await checkoutReturnStatus(o.ctx, sessionId, deps())).toMatchObject({
      state: "received",
      paidCents: DUE,
    });

    const receipts = mail.sent.filter(
      (m) => m.type === "billing.receipt" && m.to === o.email,
    );
    expect(receipts).toHaveLength(1);

    const docs = await listDocuments(o.ctx);
    expect(docs.some((d) => !isAgreementDocument(d))).toBe(true);

    await expect(
      startCheckout(o.ctx, ORDER, { expectedDueTodayCents: DUE }, deps()),
    ).rejects.toThrow(AlreadyPaid);
  });

  /** Paid in full, no Care Plan: a different order from ORDER. */
  const ORDER_B: CheckoutChoices = {
    ...ORDER,
    carePlan: false,
    buildPlan: "full",
  };

  async function dueFor(o: Org, choices: CheckoutChoices): Promise<number> {
    try {
      await startCheckout(
        o.ctx,
        choices,
        { expectedDueTodayCents: -1 },
        deps(),
      );
    } catch (e) {
      if (e instanceof PriceChanged) return e.dueTodayCents;
      throw e;
    }
    throw new Error("expected PriceChanged");
  }

  it("CR-E02: a newer checkout expires the older session; paying the old tab changes nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const a = sessionIdOf(
      (
        await startCheckout(
          o.ctx,
          ORDER,
          { expectedDueTodayCents: DUE },
          deps(),
        )
      ).url,
    );
    const dueB = await dueFor(o, ORDER_B);
    const b = sessionIdOf(
      (
        await startCheckout(
          o.ctx,
          ORDER_B,
          { expectedDueTodayCents: dueB },
          deps(),
        )
      ).url,
    );
    expect(b).not.toBe(a);

    // The old tab: the session is expired, so the test page cannot pay it.
    const old = await fakeCompleteSession(a, "pay", { emit });
    await fakeSettled();
    expect(old.redirect).toContain("payment=failed");
    expect((await account(o.id)).paid_at).toBe("");

    await fakeCompleteSession(b, "pay", { emit });
    await fakeSettled();
    const acc = await account(o.id);
    expect(acc.paid_at).not.toBe("");
    expect(acc.checkout_session_id).toBe(b);
    expect(acc.build_plan).toBe("full");
    expect(acc.care_plan).toBe(false);
    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices.map((i) => i.amount_cents)).toEqual([dueB]);
  });

  it("CR-E02: an old session already paid (webhook pending) refuses a new checkout", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const a = sessionIdOf(
      (
        await startCheckout(
          o.ctx,
          ORDER,
          { expectedDueTodayCents: DUE },
          deps(),
        )
      ).url,
    );
    const dueB = await dueFor(o, ORDER_B);
    // Paid on the provider; the webhook has not arrived.
    await fakeCompleteSession(a, "pay", { emit: () => Promise.resolve() });
    await expect(
      startCheckout(o.ctx, ORDER_B, { expectedDueTodayCents: dueB }, deps()),
    ).rejects.toThrow(AlreadyPaid);
  });

  it("CR-E02: a second paid session never replaces the subscription; it is cancelled and staff alerted", async (t) => {
    if (!inst) return t.skip();
    const savedAlert = process.env.CDS_STAFF_ALERT_EMAIL;
    process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
    try {
      const o = await signedOrg();
      const first = sessionIdOf(
        (
          await startCheckout(
            o.ctx,
            ORDER,
            { expectedDueTodayCents: DUE },
            deps(),
          )
        ).url,
      );
      await fakeCompleteSession(first, "pay", { emit });
      await fakeSettled();
      const before = await account(o.id);
      expect(before.paid_at).not.toBe("");

      // A stray second session for the same customer (e.g. a second tab before the fix).
      const stray = await billing.createCheckout({
        orgId: o.id,
        customerId: String(before.customer_id),
        lines: [
          {
            kind: "plan",
            key: "standard",
            label: "Standard plan",
            interval: "month",
            unitCents: 3900,
            quantity: 1,
            priceRef: null,
          },
        ],
        deferredMonthly: [],
        cadence: "monthly",
        successUrl: platformUrl("/hub/checkout/return"),
        cancelUrl: platformUrl("/hub/checkout"),
        idempotencyKey: `stray-${randomBytes(4).toString("hex")}`,
      });
      const alertsBefore = mail.sent.filter(
        (m) => m.type === "billing.staff_alert",
      ).length;
      await fakeCompleteSession(stray.sessionId, "pay", { emit });
      await fakeSettled();

      const after = await account(o.id);
      expect(after.subscription_id).toBe(before.subscription_id);
      expect(after.checkout_session_id).toBe(first);
      const strayRow = await readFakeObject(stray.sessionId);
      const straySub = (strayRow!.data as { subscriptionId: string })
        .subscriptionId;
      expect(
        ((await readFakeObject(straySub))!.data as { status: string }).status,
      ).toBe("canceled");
      const alerts = mail.sent.filter((m) => m.type === "billing.staff_alert");
      expect(alerts.length).toBe(alertsBefore + 1);
      expect(alerts[alerts.length - 1]!.text).toContain("duplicate_checkout");
    } finally {
      if (savedAlert === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
      else process.env.CDS_STAFF_ALERT_EMAIL = savedAlert;
    }
  });

  it("CR-E03: an add-on installed before checkout and taken off the order is turned off on payment", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    // Free before checkout (D186): the hub install goes straight on.
    await installAddon(o.ctx, addonDeps(), "testimonials");
    expect(
      (await addonRows(o.id)).find((r) => r.addon === "testimonials")?.status,
    ).toBe("active");

    const without: CheckoutChoices = { ...ORDER, addons: [] };
    const due = await dueFor(o, without);
    const { url } = await startCheckout(
      o.ctx,
      without,
      { expectedDueTodayCents: due },
      deps(),
    );
    await fakeCompleteSession(sessionIdOf(url), "pay", { emit });
    await fakeSettled();

    expect((await account(o.id)).paid_at).not.toBe("");
    const row = (await addonRows(o.id)).find((r) => r.addon === "testimonials");
    expect(row?.status).toBe("disabled");
    expect(row?.disabled_reason).toBe("uninstalled");
  });

  it("WR-E03: invoice.paid before checkout.completed still mirrors the checkout invoice", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const { url } = await startCheckout(
      o.ctx,
      ORDER,
      { expectedDueTodayCents: DUE },
      deps(),
    );
    const sessionId = sessionIdOf(url);
    const held: NormalisedEvent[] = [];
    await fakeCompleteSession(sessionId, "pay", {
      emit: (e) => {
        held.push(e);
        return Promise.resolve();
      },
    });
    // Stripe does not order its webhooks: deliver the invoice first.
    for (const e of [...held].reverse()) await emit(e);
    await fakeSettled();
    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices.map((i) => [i.kind, i.amount_cents])).toEqual([
      ["checkout", DUE],
    ]);
    expect(await checkoutReturnStatus(o.ctx, sessionId, deps())).toMatchObject({
      state: "received",
      paidCents: DUE,
    });
  });

  it("a declined payment leaves the site unpaid with nothing installed", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const { url } = await startCheckout(
      o.ctx,
      ORDER,
      { expectedDueTodayCents: DUE },
      deps(),
    );
    const sessionId = sessionIdOf(url);
    const { redirect } = await fakeCompleteSession(sessionId, "decline", {
      emit,
    });
    await fakeSettled();
    expect(redirect).toContain("payment=failed");

    const acc = await account(o.id);
    expect(acc.paid_at).toBe("");
    expect(acc.status).toBe("none");
    expect(await addonRows(o.id)).toHaveLength(0);
    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices).toHaveLength(0);
  });
});
