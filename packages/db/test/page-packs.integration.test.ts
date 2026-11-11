// 11-27 (DASH-08; D185, D66; invariant 9): the "Add 5 more pages" pack on the P10 billing
// path, on the fake adapter and the real PocketBase 0.39.11 binary. After checkout a pages
// pack is one more item quantity on the one subscription (confirm token, idempotency,
// proration), mirrored to billing_accounts.pages_5_qty and exposed as entitlements.pagePacks.
// Removal is refused while the counted pages exceed what would be left (PAGES-PACK-REFUSED).
// A lapse pauses the packs (allowance back to 10) and deletes nothing.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type {
  BillingLine,
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
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { pagesUsage } from "../src/content/allowance";
import { withOrgLock } from "../src/content/lock";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { signAgreement } from "../src/legal";
import {
  activeConsentVersion,
  activePolicies,
} from "../src/legal/policy-versions";
import type { CheckoutDraft } from "../src/payments/accounts";
import {
  buyPack,
  pagesPackRemoveRefusedCopy,
  previewPack,
  removePack,
} from "../src/payments/charges";
import {
  checkoutOrderFor,
  readCheckoutDraft,
  saveCheckoutDraft,
  startCheckout,
} from "../src/payments/checkout";
import { NOT_PAID_COPY } from "../src/payments/charge-shared";
import { entitlements } from "../src/payments/entitlements";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakePaymentGateway,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import { putFakeObject } from "../src/payments/fake/store";
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

let billing: CdsBilling;
let gateway: PaymentGateway;

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

const emit = async (e: NormalisedEvent): Promise<void> => {
  await processNormalisedEvent(e, {
    billing,
    gateway,
    transport: mail,
    addons: addonDeps(),
  });
};

const tag = () => randomBytes(4).toString("hex");

type Org = { id: string; owner: string; email: string };

async function newOrg(over: Record<string, unknown> = {}): Promise<Org> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Pages ${t}`,
    slug: `pages-${t}`,
    status: "active",
    path: "standard",
    ...over,
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

const ownerCtx = (o: Org): OrgContext =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });

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
async function paidOrg(): Promise<Org> {
  const o = await newOrg();
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
  const { sessionId } = await billing.createCheckout({
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
  return o;
}

async function accountRow(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

async function subItems(orgId: string): Promise<string[]> {
  const acc = await accountRow(orgId);
  const sub = await billing.fetchSubscription(String(acc.subscription_id));
  return sub.items.map((i) => `${i.kind}:${i.key}:${i.quantity}`).sort();
}

/** Raw builder page rows (the count is what the rules read). */
async function rawPages(org: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await pb.collection("pages").create({
      organization: org,
      title: `P ${i}`,
      slug: `p-${i}-${tag()}`,
      seo: {},
      status: "draft",
      kind: "builder",
      has_unpublished_changes: true,
      previous_slugs: [],
      password_protected: false,
    });
    ids.push(row.id);
  }
  return ids;
}

/** Preview, then confirm with its token, as the dialog does. */
async function buyPages(o: Org) {
  const p = await previewPack(ownerCtx(o), "pages-5", {
    billing,
    registry: ADDON_REGISTRY,
  });
  return {
    preview: p,
    result: await buyPack(
      ownerCtx(o),
      "pages-5",
      { billing, registry: ADDON_REGISTRY },
      p.token,
    ),
  };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-page-packs-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  signStore = new LocalDiskStore(join(storageDir, "sign"));
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  billing = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
});

afterAll(async () => {
  await fakeSettled();
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("pages packs after checkout (DASH-08, D185)", () => {
  it("preview -> buy adds pages_5_qty 1 and raises the allowance to 15; a replayed token is ALREADY", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    const { preview, result } = await buyPages(o);
    expect(preview.beforeCheckout).toBe(false);
    expect(preview.thenCents).toBe(1000);
    expect(preview.interval).toBe("month");
    expect(typeof preview.token).toBe("string");
    expect(result.ok).toBe(true);

    expect((await accountRow(o.id)).pages_5_qty).toBe(1);
    expect(await subItems(o.id)).toContain("pack:pages-5:1");
    expect((await entitlements(ownerCtx(o))).pagePacks).toBe(1);
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(15);

    const replay = await buyPack(
      ownerCtx(o),
      "pages-5",
      { billing, registry: ADDON_REGISTRY },
      preview.token,
    );
    expect(replay).toEqual({
      ok: true,
      invoiceTotalCents: 0,
      alreadyApplied: true,
    });
    expect((await accountRow(o.id)).pages_5_qty).toBe(1);
    expect(await subItems(o.id)).toContain("pack:pages-5:1");

    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'billing.pack_added'",
        { o: o.id },
      ),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ kind: "pages-5", quantity: 1 });
  });

  it("removal is refused while the pages exceed what is left, allowed once they fit", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    expect((await buyPages(o)).result.ok).toBe(true);
    const ids = await rawPages(o.id, 13);

    const refused = await removePack(ownerCtx(o), "pages-5", { billing });
    expect(refused).toEqual({
      ok: false,
      reason: "refused",
      message: pagesPackRemoveRefusedCopy(13, 10),
    });
    expect(pagesPackRemoveRefusedCopy(13, 10)).toBe(
      "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack.",
    );
    expect((await accountRow(o.id)).pages_5_qty).toBe(1);

    for (const id of ids.slice(0, 4)) await pb.collection("pages").delete(id);
    const ok = await removePack(ownerCtx(o), "pages-5", { billing });
    expect(ok.ok).toBe(true);
    expect((await accountRow(o.id)).pages_5_qty).toBe(0);
    expect(await subItems(o.id)).not.toContain("pack:pages-5:1");
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(10);
  });

  it("WR-B03: removal waits for the content lock, so a page added meanwhile is counted", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    expect((await buyPages(o)).result.ok).toBe(true);
    await rawPages(o.id, 10);

    let removal: Promise<Awaited<ReturnType<typeof removePack>>> | null = null;
    let settledEarly = false;
    await withOrgLock(o.id, async () => {
      // createPage holds this lock while it counts and writes; the removal must wait.
      removal = removePack(ownerCtx(o), "pages-5", { billing });
      settledEarly = await Promise.race([
        removal.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
      ]);
      await rawPages(o.id, 1);
    });
    expect(settledEarly).toBe(false);
    expect(await removal!).toEqual({
      ok: false,
      reason: "refused",
      message: pagesPackRemoveRefusedCopy(11, 10),
    });
    expect((await accountRow(o.id)).pages_5_qty).toBe(1);
  });

  it("a lapsed account: pagePacks 0, allowance 10, pages untouched", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    expect((await buyPages(o)).result.ok).toBe(true);
    await rawPages(o.id, 12);
    const acc = await accountRow(o.id);
    await pb.collection("billing_accounts").update(acc.id, {
      status: "lapsed",
    });
    expect((await entitlements(ownerCtx(o))).pagePacks).toBe(0);
    expect(await pagesUsage(ownerCtx(o))).toEqual({
      used: 12,
      allowance: 10,
    });
    // The stored quantity stays (invariant 9): paying again restores it.
    expect((await accountRow(o.id)).pages_5_qty).toBe(1);
    await pb.collection("billing_accounts").update(acc.id, {
      status: "active",
    });
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(15);
  });
});

/** Before checkout: sent, confirmed and signed, so startCheckout runs (no add-ons). */
async function signedOrg(): Promise<Org> {
  const o = await newOrg({ stage: "ready_for_build" });
  await pb.collection("org_intake").create({
    organization: o.id,
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
  });
  const c = await activeConsentVersion();
  await signAgreement(
    ownerCtx(o),
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
  return o;
}

const checkoutDeps = () => ({
  registry: ADDON_REGISTRY,
  billing,
  transport: mail,
});

describe("pages packs before checkout join the order (11-27 choice 2)", () => {
  it("buy adds 1 to the draft, raises the allowance at once and says it joins the order", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const { preview, result } = await buyPages(o);
    expect(preview.beforeCheckout).toBe(true);
    expect(preview.todayCents).toBe(0);
    expect(preview.thenCents).toBe(1000);
    expect(result).toEqual({ ok: true, invoiceTotalCents: 0 });

    const draft = await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY);
    expect(draft.pagePacks).toBe(1);
    expect(draft.cadence).toBe("monthly");
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(15);

    // A retried confirm adds nothing.
    const replay = await buyPack(
      ownerCtx(o),
      "pages-5",
      { billing, registry: ADDON_REGISTRY },
      preview.token,
    );
    expect(replay).toMatchObject({ ok: true, alreadyApplied: true });
    expect(
      (await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY)).pagePacks,
    ).toBe(1);

    // Media packs keep the P10 refusal before checkout.
    expect(
      await buyPack(ownerCtx(o), "5gb", { billing }, preview.token),
    ).toEqual({ ok: false, reason: "refused", message: NOT_PAID_COPY });
  });

  it("a checkout save cannot lower the packs (only removePack can, 11-50)", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    expect((await buyPages(o)).result.ok).toBe(true);
    const draft = await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY);
    const saved = await saveCheckoutDraft(
      ownerCtx(o),
      { ...draft, pagePacks: 0 },
      ADDON_REGISTRY,
    );
    expect(saved.pagePacks).toBe(1);
    expect(
      (await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY)).pagePacks,
    ).toBe(1);
  });

  it("checkout lines carry pack:pages-5 x 1 at $10/mo; after payment pages_5_qty is 1", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    expect((await buyPages(o)).result.ok).toBe(true);

    const order = await checkoutOrderFor(ownerCtx(o), null, checkoutDeps());
    expect(order.choices.pagePacks).toBe(1);
    expect(order.summary!.today).toContainEqual({
      label: "5 more pages, first month",
      cents: 1000,
    });
    const { url } = await startCheckout(
      ownerCtx(o),
      order.choices,
      { expectedDueTodayCents: order.summary!.dueTodayCents },
      checkoutDeps(),
    );
    const sessionId = new URL(url).pathname.split("/")[2]!;
    const session = await billing.fetchCheckoutSession(sessionId);
    expect(session.status).not.toBe("complete");
    await fakeCompleteSession(sessionId, "pay", { emit });
    await fakeSettled();

    const acc = await accountRow(o.id);
    expect(acc.status).toBe("active");
    expect(acc.pages_5_qty).toBe(1);
    expect(await subItems(o.id)).toContain("pack:pages-5:1");
    const invoices = await pb.collection("billing_invoices").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    expect(invoices[0]!.amount_cents).toBe(order.summary!.dueTodayCents);
    // The draft no longer adds packs once paid: the subscription is the truth.
    expect((await entitlements(ownerCtx(o))).pagePacks).toBe(1);
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(15);
  });

  it("removePack before payment takes one off the draft, refused at 0 or when pages do not fit", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    expect((await buyPages(o)).result.ok).toBe(true);
    expect((await buyPages(o)).result.ok).toBe(true);
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(20);
    const deps = { billing, registry: ADDON_REGISTRY };

    await rawPages(o.id, 16);
    expect(await removePack(ownerCtx(o), "pages-5", deps)).toEqual({
      ok: false,
      reason: "refused",
      message: pagesPackRemoveRefusedCopy(16, 15),
    });

    const pages = await pb.collection("pages").getFullList({
      filter: pb.filter("organization = {:o}", { o: o.id }),
    });
    for (const p of pages.slice(0, 7))
      await pb.collection("pages").delete(p.id);
    expect((await removePack(ownerCtx(o), "pages-5", deps)).ok).toBe(true);
    expect(
      (await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY)).pagePacks,
    ).toBe(1);
    expect((await removePack(ownerCtx(o), "pages-5", deps)).ok).toBe(true);
    expect(
      (await readCheckoutDraft(ownerCtx(o), ADDON_REGISTRY)).pagePacks,
    ).toBe(0);
    expect((await pagesUsage(ownerCtx(o))).allowance).toBe(10);
    expect(await removePack(ownerCtx(o), "pages-5", deps)).toMatchObject({
      ok: false,
      reason: "refused",
    });
  });
});
