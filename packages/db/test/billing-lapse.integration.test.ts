// 10-15: entitlements follow the subscription (BILL-03, BILL-11, BILL-16; CONTEXT A2, A3;
// D27, D181, D310; RESEARCH Pattern 6, Pitfall 5; invariant 9). The fake adapter plays the
// customer's side; every event runs through the one processor with real add-on deps.
// CONTEXT A3's proof: a lapse with Testimonials records leaves them byte-identical, and
// paying again brings back exactly what was paused.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
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
import { pausedAddons } from "../src/addons/entitlements";
import { uninstallAddon } from "../src/addons/installer";
import type { AddonDeps } from "../src/addons/types";
import { superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import type { CheckoutDraft } from "../src/payments/accounts";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakeExhaustRetries,
  fakePaymentGateway,
  fakeRenew,
  fakeUpdateCard,
} from "../src/payments/fake/index";
import { fakeEvent, fakeSettled } from "../src/payments/fake/shared";
import type { FakeInvoice } from "../src/payments/fake/shared";
import { listFakeObjects, putFakeObject } from "../src/payments/fake/store";
import {
  REMAINING_INSTALLMENTS_META,
  remainingInstallmentLines,
} from "../src/payments/lapse";
import { billingNeedsYou, billingTabCounts } from "../src/payments/needs-you";
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

type Org = {
  id: string;
  owner: string;
  email: string;
  customerId: string;
  subscriptionId: string;
};

async function newOrg(
  path: "standard" | "studio",
): Promise<Omit<Org, "customerId" | "subscriptionId">> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Lapse ${t}`,
    slug: `lapse-${t}`,
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

const addonLine = (slug: string, cents: number): BillingLine =>
  line({
    kind: "addon",
    key: slug,
    label: slug,
    unitCents: cents,
    priceRef: `price_fake_${slug}`,
  });

/** A paid org: account + draft, a completed fake checkout, add-ons installed by billing. */
async function paidOrg(
  path: "standard" | "studio",
  draft: CheckoutDraft,
  lines: BillingLine[],
): Promise<Org> {
  const o = await newOrg(path);
  const c = await putFakeObject(
    "customer",
    { orgId: o.id, name: "Owner", email: o.email, cardFailing: false },
    o.id,
  );
  await pb.collection("billing_accounts").create({
    organization: o.id,
    provider: "fake",
    customer_id: c.id,
    status: "none",
    installments_paid: 0,
    checkout_draft: draft,
  });
  const { sessionId } = await billing.createCheckout({
    orgId: o.id,
    customerId: c.id,
    lines,
    deferredMonthly: [],
    cadence: "monthly",
    successUrl: "https://cds.test/hub/billing/done",
    cancelUrl: "https://cds.test/hub/billing",
    idempotencyKey: `checkout-${tag()}`,
  });
  await fakeCompleteSession(sessionId, "pay", { emit });
  await fakeSettled();
  const acc = await accountRow(o.id);
  return {
    ...o,
    customerId: c.id,
    subscriptionId: String(acc.subscription_id),
  };
}

async function accountRow(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

async function addonRows(orgId: string) {
  return pb.collection("org_addons").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "addon",
  });
}

async function addonState(orgId: string) {
  return (await addonRows(orgId)).map((r) => [
    r.addon,
    r.status,
    r.disabled_reason,
  ]);
}

async function testimonialRows(orgId: string) {
  return pb.collection("testimonials").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "id",
  });
}

const sentTo = (to: string, type: string) =>
  mail.sent.filter((m) => m.type === type && m.to === to);

const ctxOf = (
  o: { id: string; owner: string },
  role: "owner" | "admin" | "editor" | "viewer",
  impersonator?: string,
): OrgContext =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
    ...(impersonator ? { impersonator } : {}),
  });

/** Replay every subscription event so far for this subscription under fresh ids. */
async function replaySubscriptionEvents(o: Org): Promise<void> {
  const events = emitted.filter(
    (e) => "subscriptionId" in e && e.subscriptionId === o.subscriptionId,
  );
  for (const e of events) {
    await processNormalisedEvent(
      { ...e, id: `replay:${tag()}:${e.id}` },
      deps(),
    );
  }
  await fakeSettled();
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-billing-lapse-"));
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

describe("remainingInstallmentLines (Pitfall 6)", () => {
  it("Studio with 2 paid: 3 x 58,333 + 58,335", () => {
    const lines = remainingInstallmentLines(350000, 2);
    expect(lines.map((l) => [l.unitCents, l.quantity])).toEqual([
      [58333, 3],
      [58335, 1],
    ]);
  });
  it("5 paid leaves only the last; 6 paid leaves nothing", () => {
    expect(
      remainingInstallmentLines(350000, 5).map((l) => l.unitCents),
    ).toEqual([58335]);
    expect(remainingInstallmentLines(350000, 6)).toEqual([]);
  });
});

describe("lapse and restore (BILL-03; CONTEXT A3; D27, D310)", () => {
  let org: Org;
  let before: unknown[] = [];

  it("past_due keeps every add-on on, sets past_due and sends one card-failed email", async (t) => {
    if (!booted) return t.skip();
    org = await paidOrg(
      "standard",
      {
        addons: ["testimonials", "credentials"],
        extras: [],
        carePlan: false,
        cadence: "monthly",
        buildPlan: "full",
      },
      [
        line({}),
        addonLine("testimonials", 1000),
        addonLine("credentials", 1000),
      ],
    );
    expect(await addonState(org.id)).toEqual([
      ["credentials", "active", ""],
      ["testimonials", "active", ""],
    ]);
    // A pre-billing row (assembly) that is not on the subscription.
    await pb.collection("org_addons").create({
      organization: org.id,
      addon: "events",
      status: "active",
      disabled_reason: "",
      source: "assembly",
      installed_version: "1.0.0",
      seeded: {},
      installed_at: new Date().toISOString(),
    });
    for (const [i, name] of ["Ann", "Ben", "Cy"].entries()) {
      await pb.collection("testimonials").create({
        organization: org.id,
        quote: `Lovely work, number ${i + 1}.`,
        author_name: name,
        is_published: true,
        sort_order: i + 1,
      });
    }
    before = await testimonialRows(org.id);
    expect(before).toHaveLength(3);

    await fakeUpdateCard(org.customerId, true, { emit });
    await fakeRenew(org.subscriptionId, { emit });
    await fakeSettled();

    const acc = await accountRow(org.id);
    expect(acc.status).toBe("past_due");
    expect(acc.amount_due_cents).toBe(5900);
    const orgRow = await pb.collection("organizations").getOne(org.id);
    expect(orgRow.billing_status).toBe("past_due");
    expect(await addonState(org.id)).toEqual([
      ["credentials", "active", ""],
      ["events", "active", ""],
      ["testimonials", "active", ""],
    ]);
    expect(sentTo(org.email, "billing.card_failed")).toHaveLength(1);
    // 11-21: one urgent bell alert for the Owner, keyed to the Needs-you item.
    const bell = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && type = {:type}", {
        org: org.id,
        type: "billing.card_failed",
      }),
    });
    expect(bell.map((r) => [r.user, r.source_key, r.href])).toEqual([
      [org.owner, "billing:fix_card", "/hub/settings?tab=billing"],
    ]);
  });

  it("ended retries pause paid add-ons only, delete nothing and send one paused email", async (t) => {
    if (!booted || !org) return t.skip();
    await fakeExhaustRetries(org.subscriptionId, { emit });
    await fakeSettled();

    const acc = await accountRow(org.id);
    expect(acc.status).toBe("lapsed");
    expect(acc.lapsed_at).not.toBe("");
    expect(
      (await pb.collection("organizations").getOne(org.id)).billing_status,
    ).toBe("lapsed");
    expect(await addonState(org.id)).toEqual([
      ["credentials", "disabled", "billing_lapse"],
      ["events", "active", ""],
      ["testimonials", "disabled", "billing_lapse"],
    ]);
    const paused = sentTo(org.email, "billing.lapsed");
    expect(paused).toHaveLength(1);
    expect(paused[0]!.text).toContain("Testimonials");
    expect(paused[0]!.text).toContain("Credentials");
    // Invariant 9: every Testimonials record is byte-identical.
    expect(await testimonialRows(org.id)).toEqual(before);

    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'addon.billing_lapse'",
        {
          o: org.id,
        },
      ),
    });
    expect(audits).toHaveLength(2);
    // 10-32: any member reads the paused slugs (tab alert, builder badge); own org only.
    expect(await pausedAddons(ctxOf(org, "viewer"))).toEqual([
      "credentials",
      "testimonials",
    ]);
    const other = await newOrg("standard");
    expect(await pausedAddons(ctxOf(other, "owner"))).toEqual([]);
  });

  it("replaying the events sends nothing and changes nothing", async (t) => {
    if (!booted || !org) return t.skip();
    const snap = {
      acc: await accountRow(org.id),
      addons: await addonRows(org.id),
      mail: mail.sent.length,
    };
    await replaySubscriptionEvents(org);
    expect(await accountRow(org.id)).toEqual(snap.acc);
    expect(await addonRows(org.id)).toEqual(snap.addons);
    expect(mail.sent.length).toBe(snap.mail);
  });

  it("removing an add-on while paused rewrites its reason to uninstalled", async (t) => {
    if (!booted || !org) return t.skip();
    const res = await uninstallAddon(
      ctxOf(org, "owner"),
      addonDeps(),
      "credentials",
    );
    expect(res.outcome).toBe("removed");
    expect(await addonState(org.id)).toEqual([
      ["credentials", "disabled", "uninstalled"],
      ["events", "active", ""],
      ["testimonials", "disabled", "billing_lapse"],
    ]);
  });

  it("paying again re-enables only lapse rows, records unchanged, one restored email", async (t) => {
    if (!booted || !org) return t.skip();
    await fakeUpdateCard(org.customerId, false, { emit });
    await fakeSettled();

    const acc = await accountRow(org.id);
    expect(acc.status).toBe("active");
    expect(acc.lapsed_at).toBe("");
    expect(acc.restored_at).not.toBe("");
    expect(acc.amount_due_cents).toBe(0);
    expect(
      (await pb.collection("organizations").getOne(org.id)).billing_status,
    ).toBe("active");
    expect(await addonState(org.id)).toEqual([
      ["credentials", "disabled", "uninstalled"],
      ["events", "active", ""],
      ["testimonials", "active", ""],
    ]);
    expect(await testimonialRows(org.id)).toEqual(before);
    const restored = sentTo(org.email, "billing.restored");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.text).toContain("Testimonials is back on");
    expect(restored[0]!.text).not.toContain("Credentials");

    // Replays after the restore: nothing moves, nothing is sent.
    const snap = {
      acc: await accountRow(org.id),
      addons: await addonRows(org.id),
      mail: mail.sent.length,
    };
    await replaySubscriptionEvents(org);
    expect(await accountRow(org.id)).toEqual(snap.acc);
    expect(await addonRows(org.id)).toEqual(snap.addons);
    expect(mail.sent.length).toBe(snap.mail);
  });

  it("a subscription naming this org but another customer is ignored", async (t) => {
    if (!booted || !org) return t.skip();
    const before = await accountRow(org.id);
    const forged = await putFakeObject(
      "subscription",
      {
        orgId: org.id,
        customerId: `cus_fake_other_${tag()}`,
        status: "unpaid",
        items: [],
        cancelAt: null,
        cadence: "monthly",
        appliedKeys: [],
      },
      org.id,
    );
    const r = await processNormalisedEvent(
      fakeEvent(org.id, {
        type: "subscription.updated",
        subscriptionId: forged.id,
      }),
      deps(),
    );
    expect(r.outcome).toBe("ignored");
    expect(await accountRow(org.id)).toEqual(before);
  });
});

describe("Studio cancel: included add-ons stay, remaining installments invoiced (BILL-11, D181)", () => {
  const studioDraft = (): CheckoutDraft => ({
    addons: ["testimonials", "builder-pro"],
    extras: [],
    carePlan: true,
    cadence: "monthly",
    buildPlan: "installments",
    buildCents: 350000,
  });
  const studioLines = () => [
    line({ key: "studio", label: "Studio plan", unitCents: 7900 }),
    line({
      kind: "care_plan",
      key: "care",
      label: "Care Plan",
      unitCents: 4900,
    }),
    line({
      kind: "pack",
      key: "media-5gb",
      label: "Media 5 GB",
      unitCents: 500,
      quantity: 2,
    }),
    line({
      kind: "installment",
      key: "build-installment",
      label: "Website build, payment 1 of 6",
      unitCents: 58333,
    }),
    addonLine("testimonials", 1000),
    addonLine("builder-pro", 0),
  ];

  async function remainingInvoices(orgId: string) {
    const all = await listFakeObjects<FakeInvoice>({
      kind: "invoice",
      orgRef: orgId,
    });
    return all.filter((i) => i.data.metadata[REMAINING_INSTALLMENTS_META]);
  }

  it("syncs items, keeps $0 and pre-billing rows on and invoices 4 installments once", async (t) => {
    if (!booted) return t.skip();
    const org = await paidOrg("studio", studioDraft(), studioLines());
    await pb.collection("org_addons").create({
      organization: org.id,
      addon: "events",
      status: "active",
      disabled_reason: "",
      source: "assembly",
      installed_version: "1.0.0",
      seeded: {},
      installed_at: new Date().toISOString(),
    });
    const acc0 = await accountRow(org.id);
    await pb
      .collection("billing_accounts")
      .update(acc0.id, { installments_paid: 2 });

    await billing.cancel({
      subscriptionId: org.subscriptionId,
      mode: "now",
      idempotencyKey: `cancel-${tag()}`,
    });
    await fakeSettled();

    const acc = await accountRow(org.id);
    expect(acc.status).toBe("lapsed");
    expect(acc.care_plan).toBe(true);
    expect(acc.media_5gb_qty).toBe(2);
    expect(acc.current_period_end).not.toBe("");
    expect(await addonState(org.id)).toEqual([
      ["builder-pro", "active", ""],
      ["events", "active", ""],
      ["testimonials", "disabled", "billing_lapse"],
    ]);
    const invoices = await remainingInvoices(org.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.data.totalCents).toBe(3 * 58333 + 58335);
    expect(invoices[0]!.data.lines.map((l) => l.amountCents)).toEqual([
      3 * 58333,
      58335,
    ]);

    await replaySubscriptionEvents(org);
    expect(await remainingInvoices(org.id)).toHaveLength(1);
    expect(sentTo(org.email, "billing.lapsed")).toHaveLength(1);
  });

  it("a declined site's cancel creates no remaining-installments invoice", async (t) => {
    if (!booted) return t.skip();
    const org = await paidOrg("studio", studioDraft(), studioLines());
    const acc0 = await accountRow(org.id);
    await pb.collection("billing_accounts").update(acc0.id, {
      installments_paid: 2,
      declined_at: new Date().toISOString(),
    });
    await billing.cancel({
      subscriptionId: org.subscriptionId,
      mode: "now",
      idempotencyKey: `cancel-${tag()}`,
    });
    await fakeSettled();
    expect((await accountRow(org.id)).status).toBe("lapsed");
    expect(await remainingInvoices(org.id)).toHaveLength(0);
  });
});

describe("billing Needs-you items and tab counts (UI-SPEC; T-10-15-04)", () => {
  it("owner gets fix-card, finish-Stripe and one item per sent quote; others get []", async (t) => {
    if (!booted) return t.skip();
    const o = await newOrg("standard");
    const owner = ctxOf(o, "owner");
    expect(await billingNeedsYou(owner)).toEqual([]);
    expect(await billingTabCounts(owner)).toEqual({ payments: 0, billing: 0 });

    await pb.collection("billing_accounts").create({
      organization: o.id,
      provider: "fake",
      customer_id: `cus_ny_${tag()}`,
      status: "past_due",
      installments_paid: 0,
    });
    await pb.collection("gateway_accounts").create({
      organization: o.id,
      provider: "fake",
      account_id: `acct_ny_${tag()}`,
      charges_enabled: false,
      details_submitted: true,
      status: "restricted",
      alerted_status: "restricted",
      checked_at: new Date().toISOString(),
    });
    const wo = await pb.collection("work_orders").create({
      organization: o.id,
      kind: "polish",
      title: "<b>Polish</b> & tidy",
      total_cents: 20000,
      status: "sent",
      sent_at: new Date().toISOString(),
      created_by: "staff@cds.test",
    });
    await pb.collection("work_orders").create({
      organization: o.id,
      kind: "polish",
      title: "Draft quote",
      total_cents: 10000,
      status: "draft",
      created_by: "staff@cds.test",
    });

    expect(await billingNeedsYou(owner)).toEqual([
      {
        kind: "fix_card",
        title: "Fix your card",
        actionLabel: "Update card",
        href: "/hub/settings?tab=billing",
      },
      {
        kind: "finish_stripe",
        title: "Finish Stripe setup",
        actionLabel: "Finish Stripe setup",
        href: "/hub/settings?tab=payments",
      },
      {
        kind: "quote",
        title: "Quote from CDS: <b>Polish</b> & tidy",
        actionLabel: "Review quote",
        href: `/hub/settings/quotes/${wo.id}`,
      },
    ]);
    expect(await billingTabCounts(owner)).toEqual({ payments: 1, billing: 2 });

    for (const role of ["admin", "editor", "viewer"] as const) {
      expect(await billingNeedsYou(ctxOf(o, role))).toEqual([]);
    }
    expect(await billingNeedsYou(ctxOf(o, "owner", "staff-1"))).toEqual([]);
    // Admin sees the Payments tab count only; Editor and Viewer see none.
    expect(await billingTabCounts(ctxOf(o, "admin"))).toEqual({
      payments: 1,
      billing: 0,
    });
    expect(await billingTabCounts(ctxOf(o, "viewer"))).toEqual({
      payments: 0,
      billing: 0,
    });

    // Another org's quotes and account never show here.
    const other = await newOrg("standard");
    expect(await billingNeedsYou(ctxOf(other, "owner"))).toEqual([]);
  });

  it("an onboarding never finished is not a Stripe stop", async (t) => {
    if (!booted) return t.skip();
    const o = await newOrg("standard");
    await pb.collection("gateway_accounts").create({
      organization: o.id,
      provider: "fake",
      account_id: `acct_ny_${tag()}`,
      charges_enabled: false,
      details_submitted: false,
      status: "restricted",
      alerted_status: "",
      checked_at: new Date().toISOString(),
    });
    expect(await billingNeedsYou(ctxOf(o, "owner"))).toEqual([]);
    expect(await billingTabCounts(ctxOf(o, "owner"))).toEqual({
      payments: 0,
      billing: 0,
    });
  });
});
