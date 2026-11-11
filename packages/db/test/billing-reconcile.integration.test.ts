// 10-21: the billing reconcile job (PAY-01, PAY-02, PAY-03, D244; CONTEXT A1; RESEARCH
// Pitfalls 1-2). The fake adapter plays Stripe with its emit switched off, so the events a
// purchase or a Connect change would deliver are "missed"; the job must find them by
// re-reading the provider and apply them through the one processor.
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
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import {
  BILLING_COUNTS_KEY,
  BILLING_HEARTBEAT_KEY,
  billingStatus,
  parseBillingSince,
  runBillingJob,
  type BillingJobDeps,
} from "../src/jobs/billing";
import { signAgreement } from "../src/legal";
import {
  activeConsentVersion,
  activePolicies,
} from "../src/legal/policy-versions";
import { startCheckout, type CheckoutChoices } from "../src/payments/checkout";
import { startStripeConnect } from "../src/payments/connect";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakeConnectOutcome,
  fakePaymentGateway,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import type { HandlerMap } from "../src/payments/handlers/types";
import { processNormalisedEvent } from "../src/payments/process";
import { readPlatformMeta } from "../src/platform-meta";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let store: ObjectStore;
let signStore: LocalDiskStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
const STAFF = "staff-alerts@cds.test";
const savedStaff = process.env.CDS_STAFF_ALERT_EMAIL;

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

/** The webhooks that never arrived. */
const missed = async (): Promise<void> => {};
/** Delivered and processed (used to connect an account first). */
const delivered = async (e: NormalisedEvent): Promise<void> => {
  await processNormalisedEvent(e, {
    billing,
    gateway,
    transport: mail,
    addons: addonDeps(),
  });
};

const jobDeps = (): BillingJobDeps => ({
  billing,
  gateway,
  transport: mail,
  addons: addonDeps(),
});

type Org = { id: string; ctx: OrgContext };

async function signedOrg(): Promise<Org> {
  const t = randomBytes(4).toString("hex");
  const org = await pb.collection("organizations").create({
    name: `Reconcile ${t}`,
    slug: `reconcile-${t}`,
    status: "active",
    path: "standard",
    stage: "ready_for_build",
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
  return { id: org.id, ctx };
}

const ORDER: CheckoutChoices = {
  addons: ["testimonials"],
  extras: [],
  carePlan: true,
  cadence: "monthly",
  buildPlan: "installments",
};
const DUE = 25000 + 3900 + 900 + 9900;

/** A purchase paid on the fake whose events go to `emit` (missed by default). */
async function paidOrg(
  emit: (e: NormalisedEvent) => Promise<void> = missed,
): Promise<Org> {
  const o = await signedOrg();
  const { url } = await startCheckout(
    o.ctx,
    ORDER,
    { expectedDueTodayCents: DUE },
    { registry: ADDON_REGISTRY, billing, transport: mail },
  );
  const sessionId = new URL(url).pathname.split("/")[2]!;
  await fakeCompleteSession(sessionId, "pay", { emit });
  await fakeSettled();
  return o;
}

async function account(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

async function invoices(orgId: string) {
  return pb.collection("billing_invoices").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
}

async function testimonials(orgId: string) {
  const rows = await pb.collection("org_addons").getFullList({
    filter: pb.filter("organization = {:o} && addon = 'testimonials'", {
      o: orgId,
    }),
  });
  return rows[0] ?? null;
}

async function ledgerCount(): Promise<number> {
  return (await pb.collection("payment_events").getList(1, 1)).totalItems;
}

const staffAlerts = () =>
  mail.sent.filter((m) => m.type === "billing.staff_alert" && m.to === STAFF);

beforeAll(async () => {
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF;
  storageDir = mkdtempSync(join(tmpdir(), "cds-billing-reconcile-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  signStore = new LocalDiskStore(join(storageDir, "sign"));
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  billing = fakeCdsBilling({ emit: missed });
  gateway = fakePaymentGateway({ emit: missed });
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
  if (savedStaff === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
  else process.env.CDS_STAFF_ALERT_EMAIL = savedStaff;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("parseBillingSince (the CLI's --since)", () => {
  it("reads 24h, 2d and an ISO date; rejects anything else", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(parseBillingSince("24h", now)?.toISOString()).toBe(
      "2026-10-09T12:00:00.000Z",
    );
    expect(parseBillingSince("2d", now)?.toISOString()).toBe(
      "2026-10-08T12:00:00.000Z",
    );
    expect(parseBillingSince("2026-10-01T00:00:00Z", now)?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(parseBillingSince("yesterday", now)).toBeNull();
    expect(parseBillingSince("12", now)).toBeNull();
  });
});

describe("runBillingJob (PAY-02, D244)", () => {
  it("a dry run lists the missed events and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    const rowsBefore = await ledgerCount();
    const mailBefore = mail.sent.length;

    const r = await runBillingJob({ dryRun: true }, jobDeps());
    expect(r.dryRun).toBe(true);
    expect(r.failedSteps).toEqual([]);
    expect(r.planned.map((p) => p.type)).toEqual(
      expect.arrayContaining(["checkout.completed", "invoice.paid"]),
    );
    expect(r.applied).toBe(0);

    expect((await account(o.id)).paid_at).toBe("");
    expect(await ledgerCount()).toBe(rowsBefore);
    expect(mail.sent.length).toBe(mailBefore);
    expect(await readPlatformMeta(BILLING_HEARTBEAT_KEY)).toBeNull();
    expect(await readPlatformMeta(BILLING_COUNTS_KEY)).toBeNull();
  });

  it("records a purchase whose webhooks were missed, then a rerun changes nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await paidOrg();
    expect((await account(o.id)).paid_at).toBe("");

    const now = new Date();
    const first = await runBillingJob({ now }, jobDeps());
    expect(first.failedSteps).toEqual([]);
    expect(first.applied).toBeGreaterThanOrEqual(2);

    const acc = await account(o.id);
    expect(acc.paid_at).not.toBe("");
    expect(acc.status).toBe("active");
    expect((await testimonials(o.id))?.status).toBe("active");
    const inv = await invoices(o.id);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.status).toBe("paid");

    expect(await readPlatformMeta(BILLING_HEARTBEAT_KEY)).toBe(
      now.toISOString(),
    );
    const counts = await readPlatformMeta(BILLING_COUNTS_KEY);
    expect(counts).not.toBeNull();
    expect(counts).not.toContain(o.id);
    expect(JSON.parse(counts!)).not.toHaveProperty("planned");

    // Rerun: same window (overlap), same reconcile ids -> duplicates; state unchanged.
    const second = await runBillingJob({}, jobDeps());
    expect(second.failedSteps).toEqual([]);
    expect(second.applied).toBe(0);
    expect(second.duplicates).toBeGreaterThanOrEqual(2);
    const again = await account(o.id);
    expect(again.paid_at).toBe(acc.paid_at);
    expect(again.updated).toBe(acc.updated);
    expect(await invoices(o.id)).toHaveLength(1);
  });

  it("retries ledger rows whose outcome is failed (Pitfall 1)", async (t) => {
    if (!inst) return t.skip();
    const boom = () => Promise.reject(new Error("handler crashed"));
    const crashing: HandlerMap = {
      "checkout.completed": boom,
      "invoice.paid": boom,
    };
    const o = await paidOrg(async (e) => {
      await processNormalisedEvent(e, {
        billing,
        gateway,
        transport: mail,
        handlers: crashing,
      });
    });
    expect((await account(o.id)).paid_at).toBe("");
    const failedRows = await pb.collection("payment_events").getFullList({
      filter: pb.filter("org_ref = {:o} && outcome = 'failed'", { o: o.id }),
    });
    expect(failedRows.length).toBe(2);

    // A window in the future isolates the retry sweep from the provider re-read.
    const r = await runBillingJob(
      { since: new Date(Date.now() + 60 * 60 * 1000) },
      jobDeps(),
    );
    expect(r.failedSteps).toEqual([]);
    expect(r.retried).toBeGreaterThanOrEqual(2);
    expect((await account(o.id)).paid_at).not.toBe("");
    expect((await testimonials(o.id))?.status).toBe("active");
    const left = await pb.collection("payment_events").getFullList({
      filter: pb.filter("org_ref = {:o} && processed_at = ''", { o: o.id }),
    });
    expect(left).toHaveLength(0);
  });

  it("catches a Connect account restricted with no event: one staff alert (PAY-03)", async (t) => {
    if (!inst) return t.skip();
    const o = await signedOrg();
    const connectGw = fakePaymentGateway({ emit: delivered });
    await startStripeConnect(o.ctx, { gateway: connectGw });
    const row = await pb
      .collection("gateway_accounts")
      .getFirstListItem(pb.filter("organization = {:o}", { o: o.id }));
    const accountId = String(row.account_id);
    await fakeConnectOutcome(accountId, "finished", { emit: delivered });
    expect(
      (await pb.collection("gateway_accounts").getOne(row.id)).status,
    ).toBe("connected");

    await fakeConnectOutcome(accountId, "restricted", { emit: missed });
    const alertsBefore = staffAlerts().length;

    const r = await runBillingJob({}, jobDeps());
    expect(r.failedSteps).toEqual([]);
    expect(r.accountsChecked).toBeGreaterThanOrEqual(1);
    expect(r.restricted).toBeGreaterThanOrEqual(1);
    expect(
      (await pb.collection("gateway_accounts").getOne(row.id)).status,
    ).toBe("restricted");
    expect(staffAlerts().length).toBe(alertsBefore + 1);

    // A rerun sees no change: no ledger row, no second alert.
    const rows = await ledgerCount();
    await runBillingJob({}, jobDeps());
    expect(staffAlerts().length).toBe(alertsBefore + 1);
    expect(await ledgerCount()).toBe(rows);

    // Fixed, then restricted again (no events at all): caught a second time.
    await fakeConnectOutcome(accountId, "finished", { emit: missed });
    await runBillingJob({}, jobDeps());
    expect(
      (await pb.collection("gateway_accounts").getOne(row.id)).status,
    ).toBe("connected");
    await fakeConnectOutcome(accountId, "restricted", { emit: missed });
    await runBillingJob({}, jobDeps());
    expect(
      (await pb.collection("gateway_accounts").getOne(row.id)).status,
    ).toBe("restricted");
    expect(staffAlerts().length).toBe(alertsBefore + 2);
  });

  it("a throwing step lands in failedSteps: counts written, heartbeat not", async (t) => {
    if (!inst) return t.skip();
    const before = await readPlatformMeta(BILLING_HEARTBEAT_KEY);
    const broken: CdsBilling = {
      ...billing,
      reconcile: () => Promise.reject(new Error("provider down")),
    };
    const now = new Date(Date.now() + 1000);
    const r = await runBillingJob({ now }, { ...jobDeps(), billing: broken });
    expect(r.failedSteps).toEqual(["cds-objects"]);
    expect(await readPlatformMeta(BILLING_HEARTBEAT_KEY)).toBe(before);
    const counts = JSON.parse(
      (await readPlatformMeta(BILLING_COUNTS_KEY)) ?? "{}",
    ) as { failedSteps?: string[] };
    expect(counts.failedSteps).toEqual(["cds-objects"]);
  });
});

describe("billingStatus (monitor check 27)", () => {
  it("returns counts only", async (t) => {
    if (!inst) return t.skip();
    const s = await billingStatus();
    expect(Object.keys(s).sort()).toEqual([
      "backlog",
      "failed_events",
      "last_success",
      "payments_mode",
      "restricted_accounts",
    ]);
    expect(typeof s.last_success).toBe("string");
    expect(typeof s.backlog).toBe("number");
    expect(typeof s.failed_events).toBe("number");
    expect(s.restricted_accounts).toBeGreaterThanOrEqual(1);
    expect(s.payments_mode).toBe("fake");
    const orgs = await pb.collection("organizations").getFullList({
      fields: "id,name",
    });
    const json = JSON.stringify(s);
    for (const org of orgs) {
      expect(json).not.toContain(org.id);
      expect(json).not.toContain(String(org.name));
    }
  });
});
