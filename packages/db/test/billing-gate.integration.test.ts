// 10-20: the real BillingGate and the saved-card charges (BILL-12, BILL-13, BILL-16, BILL-19;
// CONTEXT A3, A4; D186, D225, D263, D285, D299). The fake adapter plays Stripe; every event
// runs through the one processor; the installer is the real one.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { ImpersonationDenied } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type {
  BillingLine,
  CdsBilling,
  ChangeItemsInput,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBillingGate, standInBillingGate } from "../src/addons/billing";
import {
  installAddon,
  installAddonAsStaff,
  lapseAddons,
  uninstallAddon,
  uninstallAddonAsStaff,
} from "../src/addons/installer";
import type { AddonDeps } from "../src/addons/types";
import { superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { captureTransport } from "../src/email/transport";
import {
  billingOrgContext,
  type CheckoutDraft,
} from "../src/payments/accounts";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakePaymentGateway,
  fakeUpdateCard,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import { putFakeObject } from "../src/payments/fake/store";
import {
  billingGate,
  CARD_DECLINED_COPY,
  CHARGE_PRICE_CHANGED_COPY,
  PAUSED_NO_ADD_COPY,
  previewAddonCharge,
  UNPRICED_ADDON_COPY,
} from "../src/payments/gate";
import {
  billingPortalLink,
  buyPack,
  previewCarePlan,
  previewPack,
  removePack,
  setCarePlan,
} from "../src/payments/charges";
import { hasEntitlement } from "../src/payments/entitlements";
import { mediaAllowance } from "../src/media/cdn/allowance";
import { platformUrl } from "../src/email/env";
import { processNormalisedEvent } from "../src/payments/process";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let storageDir: string;
let store: ObjectStore;
let superAdmin: PlatformContext;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const mail = captureTransport();
const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
let fake: CdsBilling;
let gateway: PaymentGateway;

/** The fake adapter with every call recorded (the gate under test talks to this). */
function tracked(inner: () => CdsBilling): CdsBilling {
  return new Proxy({} as CdsBilling, {
    get(_t, prop: string) {
      const v = (inner() as unknown as Record<string, unknown>)[prop];
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return (v as (...a: unknown[]) => unknown).apply(inner(), args);
      };
    },
  });
}
const billing = tracked(() => fake);

function addonDeps(over: Partial<AddonDeps> = {}): AddonDeps {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons: ADDON_REGISTRY,
    billing: billingGate({ billing, registry: ADDON_REGISTRY }),
    ...over,
  };
}

const emit = async (e: NormalisedEvent): Promise<void> => {
  await processNormalisedEvent(e, {
    billing: fake,
    gateway,
    transport: mail,
    addons: addonDeps(),
  });
};

const tag = () => randomBytes(4).toString("hex");

type Org = {
  id: string;
  owner: string;
  email: string;
  customerId: string;
  subscriptionId: string;
};

async function newOrg(path: "standard" | "studio") {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Gate ${t}`,
    slug: `gate-${t}`,
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

const DRAFT: CheckoutDraft = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "full",
};

const planLine: BillingLine = {
  kind: "plan",
  key: "base",
  label: "Standard plan",
  interval: "month",
  unitCents: 3900,
  quantity: 1,
  priceRef: null,
};

/** A paid org: a completed fake checkout with the plan only and a good saved card. */
async function paidOrg(path: "standard" | "studio" = "standard"): Promise<Org> {
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
    checkout_draft: DRAFT,
    card_brand: "visa",
    card_last4: "4242",
  });
  const { sessionId } = await fake.createCheckout({
    orgId: o.id,
    customerId: c.id,
    lines: [planLine],
    deferredMonthly: [],
    cadence: "monthly",
    successUrl: "https://cds.test/hub/checkout/return",
    cancelUrl: "https://cds.test/hub/checkout",
    idempotencyKey: `checkout-${tag()}`,
  });
  await fakeCompleteSession(sessionId, "pay", { emit });
  await fakeSettled();
  const acc = await accountRow(o.id);
  expect(acc.paid_at).not.toBe("");
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

async function addonRow(orgId: string, slug: string) {
  const res = await pb.collection("org_addons").getList(1, 1, {
    filter: pb.filter("organization = {:o} && addon = {:s}", {
      o: orgId,
      s: slug,
    }),
  });
  return res.items[0] ?? null;
}

async function itemKeys(o: Org): Promise<string[]> {
  const sub = await fake.fetchSubscription(o.subscriptionId);
  return sub.items.map((i) => `${i.kind}:${i.key}:${i.quantity}`).sort();
}

const ownerCtx = (o: { id: string; owner: string }, impersonator?: string) =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
    ...(impersonator ? { impersonator } : {}),
  });

const adminCtx = (o: { id: string; owner: string }): OrgContext =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role: "admin",
    grants: [],
    ip: "127.0.0.1",
  });

function since(mark: number, method?: string): Call[] {
  return calls.slice(mark).filter((c) => !method || c.method === method);
}

function changeArgs(c: Call): ChangeItemsInput {
  return c.args[0] as ChangeItemsInput;
}

/** CR-C01: a paid hub install confirms with the preview's token, as the Add dialog does. */
async function addPaid(
  o: { id: string; owner: string },
  slug: string,
  deps: AddonDeps = addonDeps(),
) {
  const p = await previewAddonCharge(ownerCtx(o), slug, { billing });
  return installAddon(ownerCtx(o), deps, slug, { chargeToken: p.token });
}

/** CR-C01: buy a pack the way the dialog does: preview, then confirm with its token. */
async function buy(
  o: { id: string; owner: string },
  size: "5gb" | "25gb",
  deps: Parameters<typeof buyPack>[2] = { billing },
) {
  const p = await previewPack(ownerCtx(o), size, { billing });
  return buyPack(ownerCtx(o), size, deps, p.token);
}

async function careOn(o: { id: string; owner: string }) {
  const p = await previewCarePlan(ownerCtx(o), { billing });
  return setCarePlan(ownerCtx(o), true, { billing }, p.token);
}

async function catalogRow(kind: string, key: string) {
  return pb.collection("price_catalog").getFirstListItem(
    pb.filter("item_kind = {:k} && item_key = {:i} && path = 'standard'", {
      k: kind,
      i: key,
    }),
  );
}

async function launch(orgId: string): Promise<void> {
  await pb
    .collection("organizations")
    .update(orgId, { launched_at: new Date().toISOString() });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-billing-gate-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  fake = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
  superAdmin = await staffContext(
    booted.inst,
    `gate-admin-${tag()}@cds.test`,
    "super_admin",
  );
  // Testimonials is seeded unpriced (D264); price it $9 the way prices:set would.
  // Credentials stays unpriced for the UNPRICED-ADDON case.
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
  await booted?.inst.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("getBillingGate (BILL-12, CONTEXT A3)", () => {
  it("returns the billing-backed gate, not the P5 stand-in", () => {
    const g = getBillingGate();
    expect(typeof g.release).toBe("function");
    expect(g.approve.toString()).not.toContain("billing-standin");
    expect(standInBillingGate().approve.toString()).toContain(
      "billing-standin",
    );
  });
});

describe("the real BillingGate on hub installs (D186)", () => {
  it("before checkout: installs free with no billing call (joins the order)", async (t) => {
    if (!booted) return t.skip();
    const o = await newOrg("standard");
    const mark = calls.length;
    const res = await installAddon(ownerCtx(o), addonDeps(), "testimonials");
    expect(res.outcome).toBe("installed");
    expect((await addonRow(o.id, "testimonials"))?.status).toBe("active");
    expect(since(mark)).toHaveLength(0);
    const p = await previewAddonCharge(ownerCtx(o), "testimonials", {
      billing,
    });
    expect(p).toMatchObject({
      todayCents: 0,
      setupCents: 0,
      thenCents: 900,
      beforeCheckout: true,
      beforeLaunch: true,
    });
    // An unpriced add-on also joins the order; checkout blocks on it (10-16 UNPRICED).
    await installAddon(ownerCtx(o), addonDeps(), "credentials");
    expect((await addonRow(o.id, "credentials"))?.status).toBe("active");
    expect(since(mark, "changeItems")).toHaveLength(0);
  });

  it("paid, before launch: one prorated item change, no setup fee, then active", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const preview = await previewAddonCharge(ownerCtx(o), "testimonials", {
      billing,
    });
    expect(preview.setupCents).toBe(0);
    expect(preview.thenCents).toBe(900);
    expect(preview.interval).toBe("month");
    expect(preview.todayCents).toBeGreaterThan(0);
    expect(preview.todayCents).toBeLessThanOrEqual(900);
    expect(preview.prorationCents).toBe(preview.todayCents);
    expect(preview.cardLine).toBe("Visa ending 4242");
    expect(preview.beforeLaunch).toBe(true);
    expect(preview.periodEndLabel).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);

    const mark = calls.length;
    await installAddon(ownerCtx(o), addonDeps(), "testimonials", {
      chargeToken: preview.token,
    });
    await fakeSettled();
    const changes = since(mark, "changeItems");
    expect(changes).toHaveLength(1);
    const input = changeArgs(changes[0]!);
    expect(input.proration).toBe("always_invoice");
    expect(input.chargeNow).toBe(true);
    expect(input.oneTime).toEqual([]);
    expect(input.add).toHaveLength(1);
    expect(input.add[0]).toMatchObject({
      kind: "addon",
      key: "testimonials",
      interval: "month",
      unitCents: 900,
    });
    expect(input.idempotencyKey).toMatch(
      new RegExp(`^addon:${o.id}:testimonials:`),
    );
    expect((await addonRow(o.id, "testimonials"))?.status).toBe("active");
    expect(await itemKeys(o)).toContain("addon:testimonials:1");
    // The proration invoice is mirrored by the events.
    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices.length).toBeGreaterThanOrEqual(2);
  });

  it("paid, after launch: also the $25 setup line; the preview shows it", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await launch(o.id);
    const preview = await previewAddonCharge(ownerCtx(o), "testimonials", {
      billing,
    });
    expect(preview.setupCents).toBe(2500);
    expect(preview.beforeLaunch).toBe(false);
    expect(preview.todayCents).toBe(2500 + preview.prorationCents);
    expect(preview.prorationCents).toBeGreaterThan(0);
    expect(preview.thenCents).toBe(900);

    const mark = calls.length;
    await installAddon(ownerCtx(o), addonDeps(), "testimonials", {
      chargeToken: preview.token,
    });
    await fakeSettled();
    const input = changeArgs(since(mark, "changeItems")[0]!);
    expect(input.oneTime).toHaveLength(1);
    expect(input.oneTime[0]).toMatchObject({
      kind: "setup_fee",
      key: "addon",
      interval: "once",
      unitCents: 2500,
    });
    expect((await addonRow(o.id, "testimonials"))?.status).toBe("active");
  });

  it("a declined card refuses with ERR-CARD; nothing installed, no item", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await fakeUpdateCard(o.customerId, true);
    await expect(addPaid(o, "testimonials")).rejects.toThrow(
      CARD_DECLINED_COPY,
    );
    expect(await addonRow(o.id, "testimonials")).toBeNull();
    expect(await itemKeys(o)).not.toContain("addon:testimonials:1");
  });

  it("lapsed refuses PAUSED-NO-ADD; unpriced refuses UNPRICED-ADDON", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const acc = await accountRow(o.id);
    await expect(
      installAddon(ownerCtx(o), addonDeps(), "credentials"),
    ).rejects.toThrow(UNPRICED_ADDON_COPY);
    await expect(
      previewAddonCharge(ownerCtx(o), "credentials", { billing }),
    ).rejects.toThrow(UNPRICED_ADDON_COPY);
    await pb
      .collection("billing_accounts")
      .update(acc.id, { status: "lapsed" });
    const mark = calls.length;
    await expect(
      installAddon(ownerCtx(o), addonDeps(), "testimonials"),
    ).rejects.toThrow(PAUSED_NO_ADD_COPY);
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect(await addonRow(o.id, "testimonials")).toBeNull();
  });

  it("Studio builder-pro ($0) installs with no billing change", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg("studio");
    const mark = calls.length;
    await installAddon(ownerCtx(o), addonDeps(), "builder-pro");
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect((await addonRow(o.id, "builder-pro"))?.status).toBe("active");
  });

  it("owner uninstall releases the item; reinstall in the same period charges again", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await addPaid(o, "testimonials");
    await fakeSettled();
    const mark = calls.length;
    await uninstallAddon(ownerCtx(o), addonDeps(), "testimonials");
    await fakeSettled();
    const changes = since(mark, "changeItems");
    expect(changes).toHaveLength(1);
    const input = changeArgs(changes[0]!);
    expect(input.remove).toHaveLength(1);
    expect(input.proration).toBe("always_invoice");
    expect(input.chargeNow).toBe(false);
    expect(await itemKeys(o)).not.toContain("addon:testimonials:1");
    expect((await addonRow(o.id, "testimonials"))?.status).toBe("disabled");

    await addPaid(o, "testimonials");
    await fakeSettled();
    expect(await itemKeys(o)).toContain("addon:testimonials:1");
    expect((await addonRow(o.id, "testimonials"))?.status).toBe("active");
  });

  it("a lapse disable and a staff uninstall never call release", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await addPaid(o, "testimonials");
    await fakeSettled();
    let released = 0;
    const real = billingGate({ billing });
    const counting = addonDeps({
      billing: {
        approve: (i) => real.approve(i),
        release: async (i) => {
          released += 1;
          await real.release!(i);
        },
      },
    });
    await lapseAddons(billingOrgContext(o.id, o.owner), counting, [
      "testimonials",
    ]);
    expect((await addonRow(o.id, "testimonials"))?.disabled_reason).toBe(
      "billing_lapse",
    );
    expect(released).toBe(0);

    const o2 = await paidOrg();
    await addPaid(o2, "testimonials");
    await fakeSettled();
    await uninstallAddonAsStaff(superAdmin, counting, {
      orgId: o2.id,
      slug: "testimonials",
      reason: "goodwill removal",
    });
    expect(released).toBe(0);
    expect(await itemKeys(o2)).toContain("addon:testimonials:1");
  });

  it("staff / assembly / billing sources approve with no billing call", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const gate = billingGate({ billing });
    const mark = calls.length;
    for (const source of ["staff", "assembly", "billing"] as const) {
      expect(
        await gate.approve({
          orgId: o.id,
          slug: "testimonials",
          actor: o.owner,
          source,
        }),
      ).toEqual({ approved: true, chargeCents: 0 });
    }
    expect(since(mark)).toHaveLength(0);
    await installAddonAsStaff(superAdmin, addonDeps(), {
      orgId: o.id,
      slug: "credentials",
      reason: "quote Q-12",
    });
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect((await addonRow(o.id, "credentials"))?.status).toBe("active");
  });

  it("an impersonating owner is refused before the gate", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const mark = calls.length;
    await expect(
      installAddon(ownerCtx(o, "staff-1"), addonDeps(), "testimonials"),
    ).rejects.toThrow(ImpersonationDenied);
    expect(since(mark)).toHaveLength(0);
    await expect(
      previewAddonCharge(adminCtx(o), "testimonials", { billing }),
    ).rejects.toThrow();
  });
});

const GIB = 1024 ** 3;

async function useMedia(orgId: string, bytes: number): Promise<string> {
  const rec = await pb.collection("media_assets").create({
    organization: orgId,
    kind: "library",
    bytes,
    status: "ready",
    source: "library",
    original_ext: "webp",
    storage_dir: `tenants/${orgId}/media/u${Math.random().toString(36).slice(2, 8)}`,
    sort_order: 1,
  });
  return rec.id;
}

describe("media packs, Care Plan and the card link (BILL-13, BILL-19, D225, D299)", () => {
  it("packs stack as quantity; preview first; allowance follows", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const inv = recordingInvalidator();
    const p = await previewPack(ownerCtx(o), "5gb", { billing });
    expect(p.thenCents).toBe(500);
    expect(p.interval).toBe("month");
    expect(p.setupCents).toBe(0);
    expect(p.todayCents).toBeGreaterThan(0);
    expect(p.todayCents).toBeLessThanOrEqual(500);

    const first = await buyPack(
      ownerCtx(o),
      "5gb",
      { billing, invalidator: inv },
      p.token,
    );
    expect(first.ok).toBe(true);
    const second = await buy(o, "5gb", { billing, invalidator: inv });
    expect(second.ok).toBe(true);
    await fakeSettled();
    expect(await itemKeys(o)).toContain("pack:media-5gb:2");
    expect((await accountRow(o.id)).media_5gb_qty).toBe(2);
    // WR-D04: the account mirrors what each item is billed at (the Billing tab reads it).
    expect((await accountRow(o.id)).item_prices).toEqual(
      expect.arrayContaining([
        {
          kind: "pack",
          key: "media-5gb",
          interval: "month",
          unitCents: 500,
          quantity: 2,
        },
        {
          kind: "plan",
          key: "base",
          interval: "month",
          unitCents: 3900,
          quantity: 1,
        },
      ]),
    );
    expect(await mediaAllowance(ownerCtx(o))).toBe(12 * GIB);
    expect(inv.tags).toContain(`org:${o.id}:addons`);
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'billing.pack_added'",
        {
          o: o.id,
        },
      ),
    });
    expect(audits).toHaveLength(2);
  });

  it("removing a pack is refused while the media would overfill what is left", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await buy(o, "5gb");
    await buy(o, "5gb");
    await fakeSettled();
    await useMedia(o.id, Math.round(6.2 * GIB));

    // 12 GB -> 7 GB, 6.2 GB in use: fine.
    const ok = await removePack(ownerCtx(o), "5gb", { billing });
    expect(ok.ok).toBe(true);
    await fakeSettled();
    expect(await itemKeys(o)).toContain("pack:media-5gb:1");
    expect((await accountRow(o.id)).media_5gb_qty).toBe(1);

    // 7 GB -> 2 GB, 6.2 GB in use: refused with both figures, nothing changes.
    const mark = calls.length;
    const refused = await removePack(ownerCtx(o), "5gb", { billing });
    expect(refused).toEqual({
      ok: false,
      reason: "refused",
      message:
        "You're using 6.2 GB, more than the 2 GB you'd have left. Delete 4.2 GB of media first, then remove the pack.",
    });
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect(await itemKeys(o)).toContain("pack:media-5gb:1");
  });

  it("Care Plan on (prorated) and off (credit) any time", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const p = await previewCarePlan(ownerCtx(o), { billing });
    expect(p.thenCents).toBe(9900);
    expect(p.todayCents).toBeGreaterThan(0);

    const mark = calls.length;
    const on = await setCarePlan(ownerCtx(o), true, { billing }, p.token);
    expect(on.ok).toBe(true);
    await fakeSettled();
    const add = changeArgs(since(mark, "changeItems")[0]!);
    expect(add.proration).toBe("always_invoice");
    expect(add.chargeNow).toBe(true);
    expect(add.add[0]).toMatchObject({
      kind: "care_plan",
      key: "care",
      interval: "month",
      unitCents: 9900,
    });
    expect((await accountRow(o.id)).care_plan).toBe(true);
    expect(await hasEntitlement(ownerCtx(o), "care-plan")).toBe(true);

    // Already on: no second charge (the same confirm again is recognised as done).
    const again = await setCarePlan(ownerCtx(o), true, { billing }, p.token);
    expect(again).toEqual({
      ok: true,
      invoiceTotalCents: 0,
      alreadyApplied: true,
    });

    const mark2 = calls.length;
    const off = await setCarePlan(ownerCtx(o), false, { billing });
    expect(off.ok).toBe(true);
    await fakeSettled();
    const rm = changeArgs(since(mark2, "changeItems")[0]!);
    expect(rm.remove).toHaveLength(1);
    expect(rm.chargeNow).toBe(false);
    expect((await accountRow(o.id)).care_plan).toBe(false);
    expect(await hasEntitlement(ownerCtx(o), "care-plan")).toBe(false);
  });

  it("a declined card changes nothing", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await fakeUpdateCard(o.customerId, true);
    const pack = await buy(o, "25gb");
    expect(pack).toEqual({
      ok: false,
      reason: "card_declined",
      message: CARD_DECLINED_COPY,
    });
    const care = await careOn(o);
    expect(care.ok).toBe(false);
    expect(await itemKeys(o)).toEqual(["plan:base:1"]);
    const acc = await accountRow(o.id);
    expect(acc.media_25gb_qty).toBe(0);
    expect(acc.care_plan).toBe(false);
  });

  it("Admin and impersonating owner are refused; lapsed is paused but the card link works", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const mark = calls.length;
    await expect(buyPack(adminCtx(o), "5gb", { billing })).rejects.toThrow();
    await expect(
      buyPack(ownerCtx(o, "staff-1"), "5gb", { billing }),
    ).rejects.toThrow(ImpersonationDenied);
    await expect(
      setCarePlan(ownerCtx(o, "staff-1"), true, { billing }),
    ).rejects.toThrow(ImpersonationDenied);
    await expect(
      billingPortalLink(ownerCtx(o, "staff-1"), { billing }),
    ).rejects.toThrow(ImpersonationDenied);
    expect(since(mark)).toHaveLength(0);

    const acc = await accountRow(o.id);
    await pb
      .collection("billing_accounts")
      .update(acc.id, { status: "lapsed" });
    expect(await buyPack(ownerCtx(o), "5gb", { billing })).toEqual({
      ok: false,
      reason: "paused",
      message: PAUSED_NO_ADD_COPY,
    });
    expect((await setCarePlan(ownerCtx(o), true, { billing })).ok).toBe(false);

    const link = await billingPortalLink(ownerCtx(o), { billing });
    expect(link.url).toMatch(/\/test-pay\/portal\?session=/);
    const portalCall = since(mark, "portalUrl").at(-1)!;
    expect(portalCall.args[0]).toEqual({
      customerId: o.customerId,
      returnUrl: platformUrl("/hub/settings?tab=billing&card=updated"),
    });
  });
});

describe("a charge is the confirmed figure, once (CR-C01, WR-D03)", () => {
  it("a pack confirm without a token, or with another item's, charges nothing", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const other = await previewPack(ownerCtx(o), "25gb", { billing });
    const mark = calls.length;
    for (const token of [undefined, "junk", other.token]) {
      expect(await buyPack(ownerCtx(o), "5gb", { billing }, token)).toEqual({
        ok: false,
        reason: "price_changed",
        message: CHARGE_PRICE_CHANGED_COPY,
      });
    }
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect(await itemKeys(o)).toEqual(["plan:base:1"]);
  });

  it("a retry of the same confirm (lost response, double click) never buys a second pack", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const p = await previewPack(ownerCtx(o), "5gb", { billing });
    const mark = calls.length;
    const first = await buyPack(ownerCtx(o), "5gb", { billing }, p.token);
    expect(first.ok).toBe(true);
    const retry = await buyPack(ownerCtx(o), "5gb", { billing }, p.token);
    expect(retry).toEqual({
      ok: true,
      invoiceTotalCents: 0,
      alreadyApplied: true,
    });
    // Two tabs: both previewed from 0 packs; only one pack goes on.
    const second = await buyPack(ownerCtx(o), "5gb", { billing }, p.token);
    expect(second.ok && second.alreadyApplied).toBe(true);
    await fakeSettled();
    expect(since(mark, "changeItems")).toHaveLength(1);
    const key = changeArgs(since(mark, "changeItems")[0]!).idempotencyKey;
    expect(key).toMatch(new RegExp(`^pack:${o.id}:media-5gb:1:[0-9a-f-]{36}$`));
    expect(await itemKeys(o)).toContain("pack:media-5gb:1");
  });

  it("a price changed since the preview is refused, not charged", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const p = await previewPack(ownerCtx(o), "5gb", { billing });
    const row = await catalogRow("pack", "media-5gb");
    const was = row.monthly_cents as number;
    await pb
      .collection("price_catalog")
      .update(row.id, { monthly_cents: was + 200 });
    try {
      const mark = calls.length;
      expect(await buyPack(ownerCtx(o), "5gb", { billing }, p.token)).toEqual({
        ok: false,
        reason: "price_changed",
        message: CHARGE_PRICE_CHANGED_COPY,
      });
      expect(since(mark, "changeItems")).toHaveLength(0);
      // A fresh preview shows the new price and confirms fine.
      const fresh = await previewPack(ownerCtx(o), "5gb", { billing });
      expect(fresh.thenCents).toBe(was + 200);
      expect(
        (await buyPack(ownerCtx(o), "5gb", { billing }, fresh.token)).ok,
      ).toBe(true);
    } finally {
      await pb
        .collection("price_catalog")
        .update(row.id, { monthly_cents: was });
    }
  });

  it("the charge prorates at the previewed instant, even across midnight", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const sub = await fake.fetchSubscription(o.subscriptionId);
    const end = new Date(sub.items[0]!.currentPeriodEnd).getTime();
    const DAY = 24 * 60 * 60 * 1000;
    // Previewed a minute before a day boundary, confirmed two minutes later.
    const seen = new Date(end - DAY - 60 * 1000);
    const confirmed = new Date(end - DAY + 60 * 1000);
    const p = await previewPack(ownerCtx(o), "25gb", {
      billing,
      now: () => seen,
    });
    const res = await buyPack(
      ownerCtx(o),
      "25gb",
      { billing, now: () => confirmed },
      p.token,
    );
    expect(res).toEqual({ ok: true, invoiceTotalCents: p.todayCents });
  });

  it("after a decline the same confirm replays the decline (as Stripe); a new preview pays", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    await fakeUpdateCard(o.customerId, true);
    const p = await previewCarePlan(ownerCtx(o), { billing });
    const declined = await setCarePlan(ownerCtx(o), true, { billing }, p.token);
    expect(declined.ok).toBe(false);
    await fakeUpdateCard(o.customerId, false);
    const replay = await setCarePlan(ownerCtx(o), true, { billing }, p.token);
    expect(replay).toEqual({
      ok: false,
      reason: "card_declined",
      message: CARD_DECLINED_COPY,
    });
    expect((await accountRow(o.id)).care_plan).toBe(false);
    const fresh = await careOn(o);
    expect(fresh.ok).toBe(true);
    expect((await accountRow(o.id)).care_plan).toBe(true);
  });

  it("an add-on install needs the confirm token and refuses a moved price", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const mark = calls.length;
    await expect(
      installAddon(ownerCtx(o), addonDeps(), "testimonials"),
    ).rejects.toThrow(CHARGE_PRICE_CHANGED_COPY);
    const p = await previewAddonCharge(ownerCtx(o), "testimonials", {
      billing,
    });
    const row = await catalogRow("addon", "testimonials");
    await pb
      .collection("price_catalog")
      .update(row.id, { monthly_cents: 1100 });
    try {
      await expect(
        installAddon(ownerCtx(o), addonDeps(), "testimonials", {
          chargeToken: p.token,
        }),
      ).rejects.toThrow(CHARGE_PRICE_CHANGED_COPY);
    } finally {
      await pb
        .collection("price_catalog")
        .update(row.id, { monthly_cents: 900 });
    }
    expect(since(mark, "changeItems")).toHaveLength(0);
    expect(await addonRow(o.id, "testimonials")).toBeNull();
    // The same token is good again once the price is back: one charge.
    await installAddon(ownerCtx(o), addonDeps(), "testimonials", {
      chargeToken: p.token,
    });
    const changes = since(mark, "changeItems");
    expect(changes).toHaveLength(1);
    expect(changeArgs(changes[0]!).idempotencyKey).toMatch(
      new RegExp(`^addon:${o.id}:testimonials:.+:[0-9a-f-]{36}$`),
    );
    expect(changeArgs(changes[0]!).prorationDate).toBeTruthy();
  });
});
