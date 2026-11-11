// 10-28: decline a paid customer within 5 business days (BILL-09, D214; CONTEXT A4
// "Decline-after-payment refund, money half"). The fake adapter plays CDS's provider; every
// event runs through the one processor with real add-on deps. Proves the guards, the
// refund-cancel-close order, the rollback on a refund failure, the hub notice read and the
// audited build-started setter.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { CLOSED_ORG_DELETE_DAYS } from "@cds/core/legal";
import {
  addBusinessDays,
  type BillingLine,
  type CdsBilling,
  type NormalisedEvent,
  type PaymentGateway,
} from "@cds/core/payments";
import { formatCentsExact } from "@cds/core/pricing";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standInBillingGate } from "../src/addons/billing";
import {
  declinedMemberContext,
  listMemberOrganizations,
  signInMember,
} from "../src/auth";
import type { AddonDeps } from "../src/addons/types";
import { superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { captureTransport } from "../src/email/transport";
import type { CheckoutDraft } from "../src/payments/accounts";
import {
  declineCase,
  declineDay,
  DeclineIncomplete,
  declinePaidOrg,
  markBuildStarted,
  readDeclinedNotice,
} from "../src/payments/decline";
import {
  fakeCdsBilling,
  fakeCompleteSession,
  fakePaymentGateway,
} from "../src/payments/fake/index";
import { fakeSettled, type FakeInvoice } from "../src/payments/fake/shared";
import { listFakeObjects, putFakeObject } from "../src/payments/fake/store";
import {
  PAYMENT_RECORD_RETENTION_YEARS,
  runRetentionJob,
  type RetentionJobDeps,
} from "../src/jobs/retention";
import { REMAINING_INSTALLMENTS_META } from "../src/payments/lapse";
import { processNormalisedEvent } from "../src/payments/process";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { createBillingSpy } from "./fake-billing-spy";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let storageDir: string;
let store: ObjectStore;
let superAdmin: PlatformContext;
let supportAgent: PlatformContext;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const DAY = 86_400_000;
const SHA = "a".repeat(64);
/** Monday 5 Oct 2026, 15:00 UTC: the fixed paid_at every window case is measured from. */
const PAID_AT = new Date("2026-10-05T15:00:00.000Z");

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

const tag = () => randomBytes(4).toString("hex");

type Org = {
  id: string;
  owner: string;
  email: string;
  customerId: string;
  subscriptionId: string;
};

async function newOrg(): Promise<Omit<Org, "customerId" | "subscriptionId">> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Decline ${t}`,
    slug: `decline-${t}`,
    status: "active",
    path: "standard",
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

const draft = (): CheckoutDraft => ({
  addons: ["testimonials"],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "installments",
  buildCents: 150000,
});

const lines = (): BillingLine[] => [
  line({}),
  line({
    kind: "installment",
    key: "build-installment",
    label: "Website build, payment 1 of 6",
    unitCents: 25000,
  }),
  line({
    kind: "addon",
    key: "testimonials",
    label: "Testimonials",
    unitCents: 1000,
    priceRef: "price_fake_testimonials",
  }),
];

async function accountRow(orgId: string) {
  return pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
}

/** A paid org (installments, Testimonials), paid_at moved to PAID_AT, card on file, signed. */
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
    checkout_draft: draft(),
  });
  const { sessionId } = await billing.createCheckout({
    orgId: o.id,
    customerId: c.id,
    lines: lines(),
    deferredMonthly: [],
    cadence: "monthly",
    successUrl: "https://cds.test/hub/checkout/return",
    cancelUrl: "https://cds.test/hub/checkout",
    idempotencyKey: `checkout-${tag()}`,
  });
  await fakeCompleteSession(sessionId, "pay", { emit });
  await fakeSettled();
  const acc = await accountRow(o.id);
  await pb.collection("billing_accounts").update(acc.id, {
    paid_at: PAID_AT.toISOString(),
    card_brand: "visa",
    card_last4: "4242",
    card_exp: "12/2030",
  });
  await seedSignature(o.id);
  return {
    ...o,
    customerId: c.id,
    subscriptionId: String(acc.subscription_id),
  };
}

async function seedSignature(org: string): Promise<string> {
  const id = randomBytes(8).toString("hex").slice(0, 15).padEnd(15, "0");
  await pb.collection("agreement_signatures").create({
    id,
    organization: org,
    signer: id,
    signer_email: `signer-${id}@cds.test`,
    signer_name: "Ana Rivera",
    org_name: "Org",
    policies: [{ key: "terms-of-service", version: 1, sha256: SHA }],
    consent: { version: 1, sha256: SHA },
    ip: "203.0.113.9",
    user_agent: "test",
    auth_method: "password",
    signed_at: PAID_AT.toISOString(),
    document_key: `tenants/${org}/agreements/${id}.html`,
    document_sha256: SHA,
    evidence_sha256: SHA,
    retain_until: new Date(PAID_AT.getTime() + 7 * 366 * DAY).toISOString(),
    kind: "signup",
  });
  return id;
}

const ctxOf = (
  o: { id: string; owner: string },
  role: "owner" | "admin" | "editor" | "viewer",
): OrgContext =>
  mintOrgContext({
    orgId: o.id,
    actor: o.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
  });

const rowsOf = (collection: string, orgId: string) =>
  pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "id",
  });

const auditsOf = (orgId: string, action: string) =>
  pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action = {:a}", {
      o: orgId,
      a: action,
    }),
  });

const sentTo = (to: string, type: string) =>
  mail.sent.filter((m) => m.type === type && m.to === to);

/** Nothing about the org changed: still open, not declined, no decline email. */
async function expectUntouched(o: Org): Promise<void> {
  const acc = await accountRow(o.id);
  expect(acc.declined_at).toBe("");
  expect(acc.status).toBe("active");
  const org = await pb.collection("organizations").getOne(o.id);
  expect(org.closed_reason).toBe("");
  expect(org.status).toBe("active");
  expect(sentTo(o.email, "org.declined")).toHaveLength(0);
  expect(await auditsOf(o.id, "billing.decline")).toHaveLength(0);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-decline-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  billing = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
  superAdmin = await staffContext(
    booted.inst,
    "decline-admin@cds.test",
    "super_admin",
  );
  supportAgent = await staffContext(
    booted.inst,
    "decline-agent@cds.test",
    "support_agent",
  );
});

afterAll(async () => {
  await fakeSettled();
  await booted?.inst.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("declinePaidOrg (BILL-09, D214)", () => {
  let org: Org;
  const NOW = addBusinessDays(PAID_AT, 2);

  it("refunds every charge, cancels with no remaining-installments invoice, closes, emails and audits", async (t) => {
    if (!booted) return t.skip();
    org = await paidOrg();
    await pb.collection("testimonials").create({
      organization: org.id,
      quote: "Lovely work.",
      author_name: "Ann",
      is_published: true,
      sort_order: 1,
    });
    const before = await rowsOf("billing_invoices", org.id);
    expect(before.length).toBeGreaterThan(0);
    const paidTotal = before
      .filter((r) => r.status === "paid")
      .reduce((n, r) => n + Number(r.amount_cents), 0);
    expect(paidTotal).toBeGreaterThan(0);

    const c = await declineCase(superAdmin, org.id, { now: () => NOW });
    expect(c).toMatchObject({
      orgId: org.id,
      businessDaysSince: 2,
      buildStartedAt: null,
      refundableCents: paidTotal,
      refusal: null,
    });
    expect(c.paidAt).toBe(PAID_AT.toISOString());

    const res = await declinePaidOrg(
      superAdmin,
      org.id,
      { reasonCategory: "capacity", note: null },
      { billing, now: () => NOW, transport: mail },
    );
    await fakeSettled();
    expect(res.refundedCents).toBe(paidTotal);
    expect(res.emailed).toBe(true);
    expect(res.deleteOn).toBe(
      declineDay(new Date(NOW.getTime() + CLOSED_ORG_DELETE_DAYS * DAY)),
    );

    // Every paid invoice refunded (mirror rows), the rows themselves kept.
    const after = await rowsOf("billing_invoices", org.id);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    for (const r of after.filter((x) => Number(x.amount_cents) > 0)) {
      expect(r.status).toBe("refunded");
    }
    // Subscription canceled, no remaining-installments invoice (declined_at first).
    expect((await billing.fetchSubscription(org.subscriptionId)).status).toBe(
      "canceled",
    );
    const remaining = (
      await listFakeObjects<FakeInvoice>({ kind: "invoice", orgRef: org.id })
    ).filter((i) => i.data.metadata[REMAINING_INSTALLMENTS_META]);
    expect(remaining).toHaveLength(0);

    const acc = await accountRow(org.id);
    expect(acc.declined_at).not.toBe("");
    const row = await pb.collection("organizations").getOne(org.id);
    expect(row.closed_reason).toBe("declined");
    expect(row.status).toBe("disabled");

    const declined = sentTo(org.email, "org.declined");
    expect(declined).toHaveLength(1);
    expect(declined[0]!.text).toContain(formatCentsExact(paidTotal));
    expect(declined[0]!.text).toContain(
      "We can't take on your build right now",
    );
    // The cancel's lapse sends no "add-ons paused" email to a declined site.
    expect(sentTo(org.email, "billing.lapsed")).toHaveLength(0);

    const audits = await auditsOf(org.id, "billing.decline");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({
      category: "capacity",
      note: null,
      refundedCents: paidTotal,
    });
    expect(await auditsOf(org.id, "organization.close")).toHaveLength(1);
    expect(await rowsOf("agreement_signatures", org.id)).toHaveLength(1);
    expect(await rowsOf("testimonials", org.id)).toHaveLength(1);
  });

  it("refuses an already declined site", async (t) => {
    if (!booted || !org) return t.skip();
    const spy = createBillingSpy();
    await expect(
      declinePaidOrg(
        superAdmin,
        org.id,
        { reasonCategory: "fit", note: null },
        { billing: spy, now: () => NOW, transport: mail },
      ),
    ).rejects.toThrow(/^Refused: this site was already declined/);
    expect(spy.calls).toHaveLength(0);
    expect(await auditsOf(org.id, "billing.decline")).toHaveLength(1);
  });

  it("the hub notice: refund and deletion lines for members, null for an open org, own org only", async (t) => {
    if (!booted || !org) return t.skip();
    const n = await readDeclinedNotice(ctxOf(org, "owner"));
    expect(n).not.toBeNull();
    const audits = await auditsOf(org.id, "billing.decline");
    const cents = Number(
      (audits[0]!.meta as { refundedCents: number }).refundedCents,
    );
    expect(n!.refundedLabel).toBe(
      `${formatCentsExact(cents)} to Visa ending 4242 on ${declineDay(NOW)}`,
    );
    expect(n!.deleteOnLabel).toBe(
      declineDay(new Date(NOW.getTime() + CLOSED_ORG_DELETE_DAYS * DAY)),
    );
    expect(n!.reasonSentence).toBe(
      "We can't take on your build right now and didn't want to keep you waiting.",
    );
    expect(n!.agreementHref).toMatch(/^\/hub\/agreement\/download\//);
    expect(n!.invoices.length).toBeGreaterThan(0);

    // Editor: same lines, no agreement link, no invoices.
    const e = await readDeclinedNotice(ctxOf(org, "editor"));
    expect(e).toMatchObject({
      refundedLabel: n!.refundedLabel,
      agreementHref: null,
      invoices: [],
    });

    // An open org reads null, and never another org's notice.
    const open = await newOrg();
    expect(await readDeclinedNotice(ctxOf(open, "owner"))).toBeNull();
  });

  it("10-32: declinedMemberContext gives a declined org's member a context; open orgs and staff get none", async (t) => {
    if (!booted || !org) return t.skip();
    const member = async (orgId: string, role: string) => {
      const email = `member-${tag()}@cds.test`;
      const password = `P-${randomBytes(12).toString("hex")}`;
      const user = await pb.collection("users").create({
        email,
        password,
        passwordConfirm: password,
        name: "Sam",
      });
      await pb
        .collection("memberships")
        .create({ user: user.id, organization: orgId, role });
      return (await signInMember(email, password)).token;
    };
    const token = await member(org.id, "editor");
    // The hub session refuses the closed org...
    expect((await listMemberOrganizations(token)).organizations).toEqual([]);
    // ...and the declined lookup answers with that org only.
    const d = await declinedMemberContext(token, "203.0.113.9");
    expect(d).not.toBeNull();
    expect(d!.ctx.orgId).toBe(org.id);
    expect(d!.ctx.role).toBe("editor");
    expect(d!.org.id).toBe(org.id);
    const notice = await readDeclinedNotice(d!.ctx);
    expect(notice?.refundedAmount).toMatch(/^\$[0-9,]+\.[0-9]{2}$/);
    expect(notice?.refundedLabel.startsWith(notice!.refundedAmount)).toBe(true);

    const open = await newOrg();
    const openToken = await member(open.id, "owner");
    expect(await declinedMemberContext(openToken, "")).toBeNull();
  });

  it("refuses 6 business days after paying, with the exact line, and changes nothing", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const spy = createBillingSpy();
    const late = new Date(addBusinessDays(PAID_AT, 6).getTime() + 3_600_000);
    const c = await declineCase(superAdmin, o.id, { now: () => late });
    expect(c.refusal).toBe("Refused: paid 6 business days ago (limit 5).");
    await expect(
      declinePaidOrg(
        superAdmin,
        o.id,
        { reasonCategory: "fit", note: null },
        { billing: spy, now: () => late, transport: mail },
      ),
    ).rejects.toThrow("Refused: paid 6 business days ago (limit 5).");
    expect(spy.calls).toHaveLength(0);
    await expectUntouched(o);
  });

  it("markBuildStarted sets the field once, audited; a started build is refused", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const at = new Date("2026-10-07T16:00:00.000Z");
    expect(await markBuildStarted(superAdmin, o.id, at)).toEqual({
      buildStartedAt: at.toISOString(),
    });
    // A second call keeps the first value and writes no second audit row.
    await markBuildStarted(supportAgent, o.id, new Date());
    expect(
      new Date(
        String(
          (await pb.collection("organizations").getOne(o.id)).build_started_at,
        ).replace(" ", "T"),
      ).toISOString(),
    ).toBe(at.toISOString());
    expect(await auditsOf(o.id, "organization.build_started")).toHaveLength(1);

    const spy = createBillingSpy();
    await expect(
      declinePaidOrg(
        superAdmin,
        o.id,
        { reasonCategory: "scope", note: null },
        { billing: spy, now: () => addBusinessDays(PAID_AT, 3) },
      ),
    ).rejects.toThrow("Refused: build work started on 7 Oct.");
    expect(spy.calls).toHaveLength(0);
    await expectUntouched(o);
  });

  it("refuses an unpaid site, a support agent and an other-without-note", async (t) => {
    if (!booted) return t.skip();
    const o = await newOrg();
    await pb.collection("billing_accounts").create({
      organization: o.id,
      provider: "fake",
      customer_id: `cus_unpaid_${tag()}`,
      status: "none",
      installments_paid: 0,
    });
    const spy = createBillingSpy();
    await expect(
      declinePaidOrg(
        superAdmin,
        o.id,
        { reasonCategory: "fit", note: null },
        { billing: spy, now: () => PAID_AT },
      ),
    ).rejects.toThrow("Refused: this site hasn't paid yet.");

    const paid = await paidOrg();
    await expect(
      declinePaidOrg(
        supportAgent,
        paid.id,
        { reasonCategory: "fit", note: null },
        { billing: spy, now: () => PAID_AT },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(declineCase(supportAgent, paid.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      declinePaidOrg(
        superAdmin,
        paid.id,
        { reasonCategory: "other", note: "  " },
        { billing: spy, now: () => PAID_AT },
      ),
    ).rejects.toThrow(/needs a note/);
    expect(spy.calls).toHaveLength(0);
    await expectUntouched(paid);
  });

  it("WR-E08: a refund failure keeps the decline open to resume; nothing is closed or sent", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const spy = createBillingSpy({
      refundAll: () => Promise.reject(new Error("provider down")),
    });
    const input = {
      reasonCategory: "other" as const,
      note: "We double-booked this month.",
    };
    await expect(
      declinePaidOrg(superAdmin, o.id, input, {
        billing: spy,
        now: () => addBusinessDays(PAID_AT, 1),
        transport: mail,
      }),
    ).rejects.toThrow(DeclineIncomplete);
    expect(spy.callsTo("refundAll")).toHaveLength(1);
    expect(spy.callsTo("cancel")).toHaveLength(0);
    const org = await pb.collection("organizations").getOne(o.id);
    expect(org.closed_reason).toBe("");
    expect((await accountRow(o.id)).declined_at).not.toBe("");
    expect(sentTo(o.email, "org.declined")).toHaveLength(0);
    expect(await auditsOf(o.id, "billing.decline_failed")).toHaveLength(1);

    // Days later (past the window), the same decline resumes and finishes.
    const later = addBusinessDays(PAID_AT, 9);
    expect(
      await declineCase(superAdmin, o.id, { now: () => later }),
    ).toMatchObject({ refusal: null, resuming: true });
    const res = await declinePaidOrg(superAdmin, o.id, input, {
      billing,
      now: () => later,
      transport: mail,
    });
    expect(res.refundedCents).toBeGreaterThan(0);
    expect(
      (await pb.collection("organizations").getOne(o.id)).closed_reason,
    ).toBe("declined");
    expect(sentTo(o.email, "org.declined")).toHaveLength(1);
  });

  it("WR-E08: refunded but cancel failed: never rolled back, resumes without refunding twice", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const input = { reasonCategory: "capacity" as const, note: null };
    const failingCancel: CdsBilling = {
      ...billing,
      cancel: () => Promise.reject(new Error("provider down")),
    };
    await expect(
      declinePaidOrg(superAdmin, o.id, input, {
        billing: failingCancel,
        now: () => addBusinessDays(PAID_AT, 1),
        transport: mail,
      }),
    ).rejects.toThrow(/cancel step/);
    await fakeSettled();
    const acc = await accountRow(o.id);
    expect(acc.declined_at).not.toBe("");
    const partial = await auditsOf(o.id, "billing.decline_partial");
    expect(partial).toHaveLength(1);
    const refundedFirst = (partial[0]!.meta as { refundedCents: number })
      .refundedCents;
    expect(refundedFirst).toBeGreaterThan(0);
    // The subscription is still live and the org still open.
    expect(
      (await billing.fetchSubscription(String(acc.subscription_id))).status,
    ).not.toBe("canceled");

    const res = await declinePaidOrg(superAdmin, o.id, input, {
      billing,
      now: () => addBusinessDays(PAID_AT, 2),
      transport: mail,
    });
    await fakeSettled();
    // The full amount is reported once; nothing was refunded twice.
    expect(res.refundedCents).toBe(refundedFirst);
    expect(
      (await billing.fetchSubscription(String(acc.subscription_id))).status,
    ).toBe("canceled");
    expect(
      (await pb.collection("organizations").getOne(o.id)).closed_reason,
    ).toBe("declined");
    expect(sentTo(o.email, "org.declined")).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ org:decline CLI (Task 2)

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const SCRIPT = join(PKG_DIR, "scripts", "org-decline.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  pathToFileURL(join(PKG_DIR, "scripts", "register-ts.mjs")).href,
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CDS_ENV;
  delete env.CDS_PAYMENTS;
  return env as NodeJS.ProcessEnv;
}

function runQuick(args: string[]) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: childEnv(),
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function latestOtp(userId: string, after: number): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users ${userId} \\w+ (\\d{6})`, "g");
  for (let i = 0; i < 200; i++) {
    const all = [...booted!.inst.stdout().slice(after).matchAll(re)];
    if (all.length > 0) return all[all.length - 1]![1]!;
    await sleep(50);
  }
  throw new Error("no OTP_STANDIN line");
}

type Staff = { id: string; email: string; password: string };

async function seedCliStaff(): Promise<Staff> {
  const email = `decline-cli-${tag()}@cds.test`;
  const password = `pw-${randomBytes(12).toString("hex")}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: "super_admin",
  });
  return { id: rec.id, email, password };
}

async function runCli(
  who: Staff,
  args: string[],
  answer: string | null = null,
): Promise<{ status: number | null; output: string; code: string }> {
  const mark = booted!.inst.stdout().length;
  const child = spawn(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  const exited = new Promise<number | null>((done) =>
    child.once("close", (code) => done(code)),
  );
  child.stdin.write(`${who.email}\n${who.password}\n`);
  let code = "";
  for (let i = 0; i < 1200; i++) {
    if (output.includes("Enter it below") || child.exitCode !== null) break;
    await sleep(50);
  }
  if (output.includes("Enter it below")) {
    code = await latestOtp(who.id, mark);
    child.stdin.write(`${code}\n`);
    if (answer !== null) {
      for (let i = 0; i < 1200; i++) {
        if (output.includes("[y/N]") || child.exitCode !== null) break;
        await sleep(50);
      }
      child.stdin.write(`${answer}\n`);
    }
  }
  child.stdin.end();
  return { status: await exited, output, code };
}

/** A paid org whose paid_at is now (the child process runs on the real clock). */
async function paidNow(): Promise<Org> {
  const o = await paidOrg();
  const acc = await accountRow(o.id);
  await pb
    .collection("billing_accounts")
    .update(acc.id, { paid_at: new Date().toISOString() });
  return o;
}

describe("org:decline CLI", () => {
  it("--help exits 0; missing or bad arguments exit 1 before any sign-in", (t) => {
    if (!booted) return t.skip();
    const help = runQuick(["--help"]);
    expect(help.status).toBe(0);
    expect(help.output).toContain("org:decline");
    const org = "abcdefghijklmno";
    const cases: [string[], string][] = [
      [["--reason-category", "fit"], "--org <org-id> is required"],
      [
        ["--org", org],
        "--reason-category <fit|capacity|scope|other> is required",
      ],
      [
        ["--org", org, "--reason-category", "rude"],
        "--reason-category must be fit, capacity, scope or other",
      ],
      [["--org", org, "--reason-category", "other"], "needs --note"],
      [
        ["--org", org, "--reason-category", "fit", "--note", "x".repeat(201)],
        "--note must be at most 200 characters",
      ],
    ];
    for (const [args, msg] of cases) {
      const r = runQuick(args);
      expect(r.status).toBe(1);
      expect(r.output).toContain(msg);
      expect(r.output).not.toContain("Staff email");
    }
  });

  it("dry run prints the case; no changes nothing; yes declines with the UI-SPEC line", async (t) => {
    if (!booted) return t.skip();
    const who = await seedCliStaff();
    const o = await paidNow();
    const c = await declineCase(superAdmin, o.id);
    const amount = formatCentsExact(c.refundableCents);

    const dry = await runCli(who, [
      "--org",
      o.id,
      "--reason-category",
      "other",
      "--note",
      "We double-booked this month.",
      "--dry-run",
    ]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain(`Org:            ${c.orgName} (${o.id})`);
    expect(dry.output).toContain("Build started:  no");
    expect(dry.output).toContain(`To refund:      ${c.invoices} charge`);
    expect(dry.output).toContain(
      "Reason:         other: We double-booked this month.",
    );
    expect(dry.output).toContain(
      `DRY RUN would decline org ${o.id} and refund ${amount}; nothing changed`,
    );
    expect(dry.output).not.toContain(who.password);
    if (dry.code) expect(dry.output).not.toContain(dry.code);
    await expectUntouched(o);

    const no = await runCli(
      who,
      ["--org", o.id, "--reason-category", "fit"],
      "n",
    );
    expect(no.status).toBe(0);
    expect(no.output).toContain(`Decline and refund ${amount}? [y/N]`);
    expect(no.output).toContain("Nothing changed.");
    await expectUntouched(o);

    const yes = await runCli(who, [
      "--org",
      o.id,
      "--reason-category",
      "scope",
      "--yes",
    ]);
    expect(yes.status).toBe(0);
    expect(yes.output).toMatch(
      /Declined and refunded \$[0-9,.]+\. Owner emailed\. Site data deletes on \d{1,2} [A-Z][a-z]{2} \d{4}\./,
    );
    const row = await pb.collection("organizations").getOne(o.id);
    expect(row.closed_reason).toBe("declined");
    expect(await auditsOf(o.id, "billing.decline")).toHaveLength(1);
  });

  it("a refusal prints the exact Refused line and exits 1", async (t) => {
    if (!booted) return t.skip();
    const who = await seedCliStaff();
    const o = await paidNow();
    await markBuildStarted(superAdmin, o.id, new Date("2026-10-09T15:00:00Z"));
    const r = await runCli(who, [
      "--org",
      o.id,
      "--reason-category",
      "fit",
      "--yes",
    ]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Build started:  yes, 9 Oct 2026");
    expect(r.output).toContain("Refused: build work started on 9 Oct.");
    await expectUntouched(o);
  });
});

// ------------------------------------------------- retention keeps payment records (Task 3)

describe("retention keeps a declined org's payment records 7 years (BILL-09, D214)", () => {
  const NOW = addBusinessDays(PAID_AT, 2);
  const T31 = new Date(NOW.getTime() + 31 * DAY);
  const until = (d: Date) => {
    const out = new Date(d.getTime());
    out.setUTCFullYear(out.getUTCFullYear() + PAYMENT_RECORD_RETENTION_YEARS);
    return out;
  };
  const iso = (v: unknown) =>
    v ? new Date(String(v).replace(" ", "T")).toISOString() : "";
  let dir = "";
  const deps = (): RetentionJobDeps => {
    const s = new LocalDiskStore(join(dir, "private"));
    return {
      privateStore: s,
      publicStore: new LocalDiskStore(join(dir, "public")),
      agreementStore: s,
    };
  };
  const paymentIds = async (orgId: string) => [
    ...(await rowsOf("billing_invoices", orgId)).map((r) => r.id),
    ...(await rowsOf("work_orders", orgId)).map((r) => r.id),
  ];

  let o: Org;
  let live: Org;
  let liveStale = "";
  let keptIds: string[] = [];

  beforeAll(async () => {
    if (!booted) return;
    dir = mkdtempSync(join(tmpdir(), "cds-decline-retention-"));
    o = await paidOrg();
    await pb.collection("work_orders").create({
      organization: o.id,
      kind: "polish",
      title: "Polish",
      total_cents: 36000,
      status: "sent",
      created_by: "staff@cds.test",
    });
    await pb.collection("care_plan_time").create({
      organization: o.id,
      minutes: 15,
      note: "Care",
      staff: "staff@cds.test",
      logged_at: NOW.toISOString(),
    });
    await declinePaidOrg(
      superAdmin,
      o.id,
      { reasonCategory: "fit", note: null },
      { billing, now: () => NOW, transport: mail },
    );
    await fakeSettled();
    live = await paidOrg();
    // A live org's row with a past retain_until is still never expired.
    liveStale = (await rowsOf("billing_invoices", live.id))[0]!.id;
    await pb
      .collection("billing_invoices")
      .update(liveStale, { retain_until: PAID_AT.toISOString() });
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("a dry run at day 31 deletes nothing and stamps nothing", async (t) => {
    if (!booted) return t.skip();
    const r = await runRetentionJob({ now: T31, dryRun: true, deps: deps() });
    expect(r.deletedOrgs.map((d) => d.id)).toContain(o.id);
    expect(r.paymentRecordsExpired).toBe(0);
    expect((await pb.collection("organizations").getOne(o.id)).id).toBe(o.id);
    for (const name of ["billing_invoices", "work_orders"]) {
      for (const row of await rowsOf(name, o.id)) {
        expect(row.retain_until, name).toBe("");
      }
    }
  });

  it("day 31 deletes the org and its account rows, keeps and stamps invoices and work orders", async (t) => {
    if (!booted) return t.skip();
    const due = await runRetentionJob({ now: T31, dryRun: true, deps: deps() });
    let expected = 0;
    for (const d of due.deletedOrgs)
      expected += (await paymentIds(d.id)).length;
    keptIds = await paymentIds(o.id);
    expect(keptIds.length).toBeGreaterThanOrEqual(2);

    const r = await runRetentionJob({ now: T31, deps: deps() });
    expect(r.deletedOrgs.map((d) => d.id)).toContain(o.id);
    expect(r.keptPaymentRecordsForDeletedOrgs).toBe(expected);
    expect(
      await pb.collection("organizations").getList(1, 1, {
        filter: pb.filter("id = {:id}", { id: o.id }),
      }),
    ).toMatchObject({ totalItems: 0 });
    expect(await rowsOf("billing_accounts", o.id)).toHaveLength(0);
    expect(await rowsOf("care_plan_time", o.id)).toHaveLength(0);
    expect(await paymentIds(o.id)).toEqual(keptIds);
    for (const name of ["billing_invoices", "work_orders"]) {
      for (const row of await rowsOf(name, o.id)) {
        expect(row.organization).toBe(o.id);
        expect(iso(row.retain_until), name).toBe(until(T31).toISOString());
      }
    }
    expect(await rowsOf("agreement_signatures", o.id)).toHaveLength(1);
    const del = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'organization.delete' && target_id = {:id}", {
        id: o.id,
      }),
    });
    expect(del).toHaveLength(1);
    expect(del[0]!.meta).toMatchObject({ keptPaymentRecords: keptIds.length });
    // The live org's rows are untouched.
    expect(
      iso(
        (await pb.collection("billing_invoices").getOne(liveStale))
          .retain_until,
      ),
    ).toBe(PAID_AT.toISOString());
  });

  it("expires the kept rows only once retain_until has passed; a live org's rows never", async (t) => {
    if (!booted || keptIds.length === 0) return t.skip();
    const before = await runRetentionJob({
      now: new Date(until(T31).getTime() - DAY),
      deps: deps(),
    });
    expect(before.paymentRecordsExpired).toBe(0);
    expect(await paymentIds(o.id)).toEqual(keptIds);

    const after = await runRetentionJob({
      now: new Date(until(T31).getTime() + DAY),
      deps: deps(),
    });
    expect(after.paymentRecordsExpired).toBeGreaterThanOrEqual(keptIds.length);
    expect(after.failedSteps).not.toContain("expired-payment-records");
    expect(await paymentIds(o.id)).toEqual([]);
    expect((await pb.collection("billing_invoices").getOne(liveStale)).id).toBe(
      liveStale,
    );
  });
});
