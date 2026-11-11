// 10-12: payment events become platform state (BILL-01, BILL-08, BILL-11, BILL-16; CONTEXT
// A2, A4; T-10-12-01..05). The fake adapter plays the customer's side; every event goes
// through the one processor with a captured mail transport and real add-on deps.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type {
  BillingLine,
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standInBillingGate } from "../src/addons/billing";
import type { AddonDeps } from "../src/addons/types";
import { superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { isAgreementDocument, listDocuments } from "../src/legal/signatures";
import {
  INSTALLMENT_KEY,
  INSTALLMENT_REMAINDER_KEY,
  readBillingAccount,
  type CheckoutDraft,
} from "../src/payments/accounts";
import { storeInvoice } from "../src/payments/fake/billing";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakePaymentGateway,
  fakeRenew,
  readFakeObject,
} from "../src/payments/fake/index";
import { fakeEvent, fakeSettled } from "../src/payments/fake/shared";
import type { FakeSubscription } from "../src/payments/fake/shared";
import { listFakeObjects, putFakeObject } from "../src/payments/fake/store";
import { listBillingInvoices } from "../src/payments/invoices";
import { processNormalisedEvent } from "../src/payments/process";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let storageDir: string;
let store: ObjectStore;
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

/** Every emitted event, in order, so a test can replay them. */
const emitted: NormalisedEvent[] = [];
let billing: CdsBilling;
let gateway: PaymentGateway;

const deps = () => ({
  billing,
  gateway,
  transport: mail,
  addons: addonDeps(),
});

const emit = async (e: NormalisedEvent): Promise<void> => {
  emitted.push(e);
  await processNormalisedEvent(e, deps());
};

const tag = () => randomBytes(4).toString("hex");

type Org = { id: string; owner: string; email: string };

async function newOrg(path: "standard" | "studio"): Promise<Org> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Billing ${t}`,
    slug: `billing-${t}`,
    status: "active",
    path,
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
  return { id: org.id, owner: user.id, email };
}

async function account(
  orgId: string,
  draft: CheckoutDraft,
): Promise<{ customerId: string; accountId: string }> {
  const c = await putFakeObject(
    "customer",
    { orgId, name: "Owner", email: "o@example.test", cardFailing: false },
    orgId,
  );
  const row = await pb.collection("billing_accounts").create({
    organization: orgId,
    provider: "fake",
    customer_id: c.id,
    status: "none",
    installments_paid: 0,
    checkout_draft: draft,
  });
  return { customerId: c.id, accountId: row.id };
}

const line = (over: Partial<BillingLine>): BillingLine => ({
  kind: "plan",
  key: "standard",
  label: "Standard plan",
  interval: "month",
  unitCents: 3900,
  quantity: 1,
  priceRef: "price_fake_plan",
  ...over,
});

async function checkout(
  orgId: string,
  customerId: string,
  cadence: "monthly" | "yearly",
  lines: BillingLine[],
  deferredMonthly: BillingLine[] = [],
): Promise<{ sessionId: string; events: NormalisedEvent[] }> {
  const { sessionId } = await billing.createCheckout({
    orgId,
    customerId,
    lines,
    deferredMonthly,
    cadence,
    successUrl: "https://cds.test/hub/billing/done",
    cancelUrl: "https://cds.test/hub/billing",
    idempotencyKey: `checkout-${tag()}`,
  });
  const from = emitted.length;
  await fakeCompleteSession(sessionId, "pay", { emit });
  await fakeSettled();
  return { sessionId, events: emitted.slice(from) };
}

async function accountRow(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

async function invoiceRows(orgId: string) {
  return pb.collection("billing_invoices").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "issued_at,id",
  });
}

async function addonRows(orgId: string) {
  return pb.collection("org_addons").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "addon",
  });
}

const receiptsTo = (to: string) =>
  mail.sent.filter((m) => m.type === "billing.receipt" && m.to === to);

const ctxOf = (o: Org, role: "owner" | "admin"): OrgContext =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
  });

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-billing-handlers-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  billing = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
});

afterAll(async () => {
  await fakeSettled();
  await booted?.inst.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("checkout.completed (BILL-01, BILL-16; CONTEXT A2)", () => {
  let org: Org;
  let replayEvents: NormalisedEvent[] = [];

  it("activates the account, installs the order's add-ons and mirrors the paid invoice", async (t) => {
    if (!booted) return t.skip();
    org = await newOrg("standard");
    const { customerId } = await account(org.id, {
      addons: ["testimonials"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "installments",
    });
    const { events } = await checkout(org.id, customerId, "monthly", [
      line({}),
      line({
        kind: "installment",
        key: INSTALLMENT_KEY,
        label: "Website build, payment 1 of 6",
        unitCents: 25000,
        priceRef: "price_fake_inst",
      }),
      line({
        kind: "addon",
        key: "testimonials",
        label: "Testimonials",
        unitCents: 0,
        priceRef: "price_fake_testimonials",
      }),
    ]);
    replayEvents = events;
    expect(events.map((e) => e.type)).toEqual([
      "checkout.completed",
      "invoice.paid",
    ]);

    const acc = await accountRow(org.id);
    expect(acc.status).toBe("active");
    expect(acc.paid_at).not.toBe("");
    expect(acc.build_plan).toBe("installments");
    expect(acc.cadence).toBe("monthly");
    expect(acc.care_plan).toBe(false);
    expect(acc.installments_paid).toBe(1);
    expect(acc.subscription_id).toMatch(/^sub_fake_/);
    // Founding lock: platform_meta cut-off unset -> paid_at + 2 years (D161).
    const paid = new Date(String(acc.paid_at));
    const locked = new Date(String(acc.price_locked_until));
    expect(locked.getUTCFullYear()).toBe(paid.getUTCFullYear() + 2);

    const orgRow = await pb.collection("organizations").getOne(org.id);
    expect(orgRow.billing_status).toBe("active");
    // 10-28: paying does not mean build work started (that ends the decline window).
    expect(orgRow.build_started_at).toBe("");

    const addons = await addonRows(org.id);
    expect(addons.map((r) => [r.addon, r.status, r.source])).toEqual([
      ["testimonials", "active", "billing"],
    ]);

    const invoices = await invoiceRows(org.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.status).toBe("paid");
    expect(invoices[0]!.kind).toBe("checkout");
    expect(invoices[0]!.has_installment).toBe(true);
    expect(invoices[0]!.amount_cents).toBe(28900);
    // No card data in the mirror (T-10-12-05).
    expect(Object.keys(invoices[0]!).join(",")).not.toMatch(/card|last4/);

    expect(receiptsTo(org.email)).toHaveLength(1);

    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o}", { o: org.id }),
    });
    const actions = audits.map((a) => String(a.action));
    expect(actions).toContain("billing.checkout_completed");
    expect(actions).toContain("billing.invoice_mirrored");
    expect(actions).toContain("addon.install");
    const install = audits.find((a) => a.action === "addon.install")!;
    expect((install.meta as { job?: string }).job).toBe("billing");
  });

  it("replaying both events (same ids, then reconcile-style ids) changes nothing", async (t) => {
    if (!booted || replayEvents.length === 0) return t.skip();
    const before = {
      acc: await accountRow(org.id),
      invoices: await invoiceRows(org.id),
      addons: await addonRows(org.id),
      org: await pb.collection("organizations").getOne(org.id),
      mail: mail.sent.length,
    };
    for (const e of replayEvents) {
      const r = await processNormalisedEvent(e, deps());
      expect(r.outcome).toBe("duplicate");
    }
    for (const e of replayEvents) {
      const r = await processNormalisedEvent(
        { ...e, id: `reconcile:${e.id}` },
        deps(),
      );
      expect(r.outcome).toBe("applied");
    }
    await fakeSettled();
    expect(await accountRow(org.id)).toEqual(before.acc);
    expect(await invoiceRows(org.id)).toEqual(before.invoices);
    expect(await addonRows(org.id)).toEqual(before.addons);
    expect(await pb.collection("organizations").getOne(org.id)).toEqual(
      before.org,
    );
    expect(mail.sent.length).toBe(before.mail);
  });

  it("readBillingAccount: owner gets no provider ids; admin is refused", async (t) => {
    if (!booted || !org) return t.skip();
    const view = await readBillingAccount(ctxOf(org, "owner"));
    expect(view?.status).toBe("active");
    expect(view?.installmentsPaid).toBe(1);
    const keys = Object.keys(view ?? {});
    for (const k of [
      "customerId",
      "subscriptionId",
      "checkoutSessionId",
      "checkoutDraft",
    ]) {
      expect(keys).not.toContain(k);
    }
    expect(JSON.stringify(view)).not.toMatch(/cus_fake_|sub_fake_|cs_fake_/);
    await expect(readBillingAccount(ctxOf(org, "admin"))).rejects.toThrow(
      Forbidden,
    );
  });

  it("invoices list for the owner only, scoped to the org, and join listDocuments", async (t) => {
    if (!booted || !org) return t.skip();
    const other = await newOrg("standard");
    const mine = await listBillingInvoices(ctxOf(org, "owner"));
    expect(mine).toHaveLength(1);
    // The hosted link is the owner's to open (CONTEXT A4); the bare provider id is not.
    expect(Object.keys(mine[0]!)).not.toContain("providerInvoiceId");
    expect(Object.keys(mine[0]!)).not.toContain("provider");
    expect(await listBillingInvoices(ctxOf(other, "owner"))).toEqual([]);
    await expect(listBillingInvoices(ctxOf(org, "admin"))).rejects.toThrow(
      Forbidden,
    );

    const docs = await listDocuments(ctxOf(org, "owner"));
    const inv = docs.filter((d) => d.kind === "invoice");
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({
      kind: "invoice",
      id: mine[0]!.id,
      label: `Invoice ${mine[0]!.number}`,
      date: mine[0]!.issuedAt,
      href: mine[0]!.hostedUrl,
    });
    const adminDocs = await listDocuments(ctxOf(org, "admin"));
    expect(adminDocs.every(isAgreementDocument)).toBe(true);
  });
});

describe("installments (BILL-11, D181, Pitfall 6)", () => {
  it("six payments: remainder before the 6th, item removed after, no proration invoice", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg("studio");
    const { customerId } = await account(org.id, {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "installments",
      buildCents: 350000,
    });
    const { sessionId } = await checkout(org.id, customerId, "monthly", [
      line({ key: "studio", label: "Studio plan", unitCents: 4900 }),
      line({
        kind: "installment",
        key: INSTALLMENT_KEY,
        label: "Website build, monthly payment",
        unitCents: 58333,
        priceRef: "price_fake_inst_studio",
      }),
    ]);
    const session = await readFakeObject(sessionId);
    const subId = (session!.data as { subscriptionId: string }).subscriptionId;
    const items = async () =>
      ((await readFakeObject(subId))!.data as FakeSubscription).items;

    for (let n = 2; n <= 6; n++) {
      if (n === 6) {
        const remainder = (await items()).find(
          (i) => i.key === INSTALLMENT_REMAINDER_KEY,
        );
        expect(remainder?.unitCents).toBe(2);
        expect(remainder?.kind).toBe("installment");
      } else {
        expect(
          (await items()).some((i) => i.key === INSTALLMENT_REMAINDER_KEY),
        ).toBe(false);
      }
      const { paid } = await fakeRenew(subId, { emit });
      await fakeSettled();
      expect(paid).toBe(true);
      expect((await accountRow(org.id)).installments_paid).toBe(n);
    }

    expect((await items()).filter((i) => i.kind === "installment")).toEqual([]);
    const fakeInvoices = await listFakeObjects<{
      description: string;
      totalCents: number;
      lines: { kind: string; amountCents: number }[];
    }>({ kind: "invoice", orgRef: org.id });
    expect(fakeInvoices).toHaveLength(6);
    expect(
      fakeInvoices.some((i) => i.data.description === "Subscription update"),
    ).toBe(false);
    const installmentCents = fakeInvoices
      .flatMap((i) => i.data.lines)
      .filter((l) => l.kind === "installment")
      .reduce((s, l) => s + l.amountCents, 0);
    expect(installmentCents).toBe(350000);

    // A further renewal no longer carries an installment and the count stays at 6.
    await fakeRenew(subId, { emit });
    await fakeSettled();
    expect((await accountRow(org.id)).installments_paid).toBe(6);
    const mirrors = await invoiceRows(org.id);
    expect(mirrors).toHaveLength(7);
    expect(mirrors.filter((m) => m.has_installment)).toHaveLength(6);
  });

  // CR-E01: Checkout sets no item metadata, so Stripe (and now the fake) reads the item's
  // kind from the synced catalog price. Prices synced before the fix say build_fee/base.
  async function sixPaymentsEndTheInstallment(
    org: Org,
    subId: string,
  ): Promise<void> {
    const items = async () =>
      ((await readFakeObject(subId))!.data as FakeSubscription).items;
    expect((await items()).some((i) => i.kind === "installment")).toBe(true);
    for (let n = 2; n <= 6; n++) {
      const { paid } = await fakeRenew(subId, { emit });
      await fakeSettled();
      expect(paid).toBe(true);
      expect((await accountRow(org.id)).installments_paid).toBe(n);
    }
    expect((await items()).filter((i) => i.kind === "installment")).toEqual([]);
  }

  it("CR-E01: a Checkout item on the legacy build_fee monthly price is the installment", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg("standard");
    const { customerId } = await account(org.id, {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "installments",
      buildCents: 150000,
    });
    const legacy = await billing.syncPrice({
      kind: "build_fee",
      key: "base",
      path: "standard",
      interval: "month",
      cents: 25000,
      productRef: null,
      previousPriceRef: null,
    });
    const { sessionId } = await checkout(org.id, customerId, "monthly", [
      line({}),
      line({
        kind: "installment",
        key: INSTALLMENT_KEY,
        label: "Website build payment",
        unitCents: 25000,
        priceRef: legacy.priceRef,
      }),
    ]);
    expect((await accountRow(org.id)).installments_paid).toBe(1);
    const session = await readFakeObject(sessionId);
    const subId = (session!.data as { subscriptionId: string }).subscriptionId;
    await sixPaymentsEndTheInstallment(org, subId);
  });

  it("CR-E01: yearly counts the inline first payment and ends the deferred item after 6", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg("standard");
    const synced = await billing.syncPrice({
      kind: "installment",
      key: INSTALLMENT_KEY,
      path: "standard",
      interval: "month",
      cents: 25000,
      productRef: null,
      previousPriceRef: null,
    });
    const installment = line({
      kind: "installment",
      key: INSTALLMENT_KEY,
      label: "Website build payment",
      unitCents: 25000,
      priceRef: synced.priceRef,
    });
    const { customerId } = await account(org.id, {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "yearly",
      buildPlan: "installments",
      buildCents: 150000,
      deferredMonthly: [installment],
    });
    const { sessionId } = await checkout(
      org.id,
      customerId,
      "yearly",
      [
        line({ interval: "year", unitCents: 39000 }),
        line({
          kind: "first_month",
          key: INSTALLMENT_KEY,
          label: "Build payment 1",
          interval: "once",
          unitCents: 25000,
          priceRef: null,
        }),
      ],
      [installment],
    );
    // The inline first payment reads "extra" on the invoice, as on Stripe; the checkout
    // invoice still counts as payment 1.
    const [mirror] = await invoiceRows(org.id);
    expect(mirror!.kind).toBe("checkout");
    expect(mirror!.has_installment).toBe(true);
    expect((await accountRow(org.id)).installments_paid).toBe(1);
    const session = await readFakeObject(sessionId);
    const subId = (session!.data as { subscriptionId: string }).subscriptionId;
    await sixPaymentsEndTheInstallment(org, subId);
  });
});

describe("yearly cadence (D263, D314, Pattern 4)", () => {
  it("adds the Care Plan monthly item after completion, with no extra invoice", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg("standard");
    const care = line({
      kind: "care_plan",
      key: "care-plan",
      label: "Care Plan",
      unitCents: 9900,
      priceRef: "price_fake_care",
    });
    const { customerId } = await account(org.id, {
      addons: [],
      extras: [],
      carePlan: true,
      cadence: "yearly",
      buildPlan: "full",
      deferredMonthly: [care],
    });
    const { sessionId } = await checkout(
      org.id,
      customerId,
      "yearly",
      [
        line({ interval: "year", unitCents: 39000 }),
        line({
          kind: "build_fee",
          key: "base",
          label: "Website build",
          interval: "once",
          unitCents: 150000,
          priceRef: null,
        }),
        line({
          kind: "first_month",
          key: "care-plan",
          label: "Care Plan, first month",
          interval: "once",
          unitCents: 9900,
          priceRef: null,
        }),
      ],
      [care],
    );
    const session = await readFakeObject(sessionId);
    const subId = (session!.data as { subscriptionId: string }).subscriptionId;
    const sub = (await readFakeObject(subId))!.data as FakeSubscription;
    const careItems = sub.items.filter((i) => i.kind === "care_plan");
    expect(careItems).toHaveLength(1);
    expect(careItems[0]!.interval).toBe("month");
    expect(sub.items.some((i) => i.interval === "year")).toBe(true);

    expect(
      await listFakeObjects({ kind: "invoice", orgRef: org.id }),
    ).toHaveLength(1);
    const acc = await accountRow(org.id);
    expect(acc.cadence).toBe("yearly");
    expect(acc.care_plan).toBe(true);
    expect(acc.build_plan).toBe("full");
    expect(acc.installments_paid).toBe(0);
  });
});

describe("guards and refunds (T-10-12-01, BILL-08)", () => {
  it("ignores an invoice whose customer belongs to another org", async (t) => {
    if (!booted) return t.skip();
    const a = await newOrg("standard");
    const b = await newOrg("standard");
    const draft: CheckoutDraft = {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "full",
    };
    await account(a.id, draft);
    const { customerId: customerB } = await account(b.id, draft);
    const inv = await storeInvoice({
      orgId: a.id,
      customerId: customerB,
      subscriptionId: null,
      lines: [
        {
          kind: "extra",
          key: "logo",
          amountCents: 5000,
          description: "Logo",
        },
      ],
      description: "Spoofed",
      metadata: {},
      failing: false,
    });
    const before = mail.sent.length;
    const r = await processNormalisedEvent(
      fakeEvent(a.id, { type: "invoice.paid", invoiceId: inv.id }),
      deps(),
    );
    expect(r.outcome).toBe("ignored");
    expect(await invoiceRows(a.id)).toEqual([]);
    expect(await invoiceRows(b.id)).toEqual([]);
    expect(mail.sent.length).toBe(before);
  });

  it("charge.refunded re-reads the customer's invoices and marks them refunded", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg("standard");
    const { customerId } = await account(org.id, {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
      buildPlan: "full",
    });
    await checkout(org.id, customerId, "monthly", [
      line({}),
      line({
        kind: "build_fee",
        key: "base",
        label: "Website build",
        interval: "once",
        unitCents: 150000,
        priceRef: null,
      }),
    ]);
    const mailBefore = receiptsTo(org.email).length;
    expect(mailBefore).toBe(1);
    const res = await billing.refundAll({
      customerId,
      idempotencyKey: `refund-${tag()}`,
    });
    expect(res.refundedCents).toBe(153900);
    await fakeSettled();
    const rows = await invoiceRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("refunded");
    expect(rows[0]!.refunded_cents).toBe(153900);
    expect(receiptsTo(org.email)).toHaveLength(mailBefore);
  });
});
