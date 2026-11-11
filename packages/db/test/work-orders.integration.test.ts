// 10-26: one-off quotes and invoices for paid work (BILL-20, BILL-19, BILL-16; CONTEXT A4;
// D263, D297, D299). The fake adapter plays Stripe; every invoice event runs through the one
// processor, so acceptance -> invoice -> paid is the real path. Org B attacks org A's quotes.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type {
  BillingLine,
  CdsBilling,
  ChangeItemsInput,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  fakeCdsBilling,
  fakeCompleteSession,
  fakePayInvoice,
  fakePaymentGateway,
  fakeUpdateCard,
} from "../src/payments/fake/index";
import { fakeSettled } from "../src/payments/fake/shared";
import { listFakeObjects, putFakeObject } from "../src/payments/fake/store";
import { billingGate } from "../src/payments/gate";
import { processNormalisedEvent } from "../src/payments/process";
import {
  acceptWorkOrder,
  createWorkOrder,
  declineWorkOrder,
  deliverCase,
  deliverWorkOrder,
  listWorkOrders,
  previewWorkOrder,
  readWorkOrder,
  sendWorkOrder,
  WORK_ORDER_ANSWERED_COPY,
  WORK_ORDER_EXPIRED_COPY,
  WORK_ORDER_NOT_ACCEPTED_COPY,
  type CreateWorkOrderInput,
} from "../src/payments/work-orders";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { fileTicket, paidPanelFor, staffMarkPaidService } from "../src/support";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let storageDir: string;
let store: ObjectStore;
let superAdmin: PlatformContext;
let support: PlatformContext;
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

function addonDeps(): AddonDeps {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons: ADDON_REGISTRY,
    billing: billingGate({ billing, registry: ADDON_REGISTRY }),
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
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Work ${t}`,
    slug: `work-${t}`,
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
  const c = await putFakeObject(
    "customer",
    { orgId: org.id, name: "Owner", email, cardFailing: false },
    org.id,
  );
  await pb.collection("billing_accounts").create({
    organization: org.id,
    provider: "fake",
    customer_id: c.id,
    status: "none",
    installments_paid: 0,
    checkout_draft: DRAFT,
  });
  const { sessionId } = await fake.createCheckout({
    orgId: org.id,
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
  const acc = await pb
    .collection("billing_accounts")
    .getFirstListItem(pb.filter("organization = {:o}", { o: org.id }));
  return {
    id: org.id,
    owner: user.id,
    email,
    customerId: c.id,
    subscriptionId: String(acc.subscription_id),
  };
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

const SCOPE =
  '<h2>What we will do</h2><p>Tighten the home page.</p><script>alert(1)</script><p onclick="x()">Then the footer.</p>';

const polish = (orgId: string): CreateWorkOrderInput => ({
  orgId,
  kind: "polish",
  title: "Home page polish",
  scope: SCOPE,
  blocks: 1,
  rateCents: 12000,
});

const privateAddon = (orgId: string): CreateWorkOrderInput => ({
  orgId,
  kind: "private_addon",
  title: "Rivera orders",
  scope: "<p>An order form for wholesale customers.</p>",
  totalCents: 400000,
  maintenanceCents: 5000,
  addonSlug: "testimonials",
});

async function row(id: string) {
  return pb.collection("work_orders").getOne(id);
}

async function auditCount(id: string, action: string): Promise<number> {
  const res = await pb.collection("audit_log").getList(1, 50, {
    filter: pb.filter("target_id = {:id} && action = {:a}", { id, a: action }),
  });
  return res.totalItems;
}

/** Create + send; returns the id. */
async function sentQuote(
  input: CreateWorkOrderInput,
  now?: () => Date,
): Promise<string> {
  const { id } = await createWorkOrder(superAdmin, input);
  await sendWorkOrder(superAdmin, id, {
    transport: mail,
    ...(now ? { now } : {}),
  });
  return id;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-work-orders-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  fake = fakeCdsBilling({ emit });
  gateway = fakePaymentGateway({ emit });
  superAdmin = await staffContext(
    booted.inst,
    `work-admin-${tag()}@cds.test`,
    "super_admin",
  );
  support = await staffContext(
    booted.inst,
    `work-support-${tag()}@cds.test`,
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

describe("createWorkOrder pricing (D297, choices 1-2)", () => {
  it("polish: 1 block × 3 h × $120 = $360; scope is sanitised before storage", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const { id, preview } = await createWorkOrder(support, polish(o.id));
    expect(preview.totalCents).toBe(36000);
    expect(preview.payNowCents).toBe(36000);
    expect(preview.priceRows).toEqual([
      {
        label: "Design polish, 3-hour block · 3 h × $120",
        amountLabel: "$360",
      },
    ]);
    const r = await row(id);
    expect(r.status).toBe("draft");
    expect(r.total_cents).toBe(36000);
    expect(r.scope).not.toContain("<script");
    expect(r.scope).not.toContain("onclick");
    expect(r.scope).toContain("Tighten the home page.");
    expect(await auditCount(id, "work_order.create")).toBe(1);
  });

  it("private add-on: 50% deposit, balance and maintenance (cents exact)", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const p = await previewWorkOrder(superAdmin, privateAddon(o.id));
    expect(p).toMatchObject({
      totalCents: 400000,
      depositCents: 200000,
      balanceCents: 200000,
      maintenanceCents: 5000,
      payNowCents: 200000,
    });
    expect(p.priceRows.map((r) => r.label)).toEqual([
      "Build price",
      "Deposit today (50%)",
      "Balance when delivered",
      "Maintenance after delivery",
    ]);
    expect(p.priceRows[3]!.amountLabel).toBe("$50/mo on your monthly bill");
    const odd = await previewWorkOrder(superAdmin, {
      ...privateAddon(o.id),
      totalCents: 100001,
    });
    expect(odd.depositCents + odd.balanceCents).toBe(100001);
  });

  it("out-of-range maintenance, rate, blocks and long titles are refused", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const bad: CreateWorkOrderInput[] = [
      { ...privateAddon(o.id), maintenanceCents: 1000 },
      { ...privateAddon(o.id), kind: "premium_addon", maintenanceCents: 5000 },
      { ...polish(o.id), rateCents: 9000 },
      { ...polish(o.id), rateCents: 14000 },
      { ...polish(o.id), blocks: 11 },
      { ...polish(o.id), blocks: 0 },
      { ...polish(o.id), rateCents: undefined },
      { ...polish(o.id), title: "x".repeat(121) },
      { ...polish(o.id), scope: "<script>only</script>" },
      { ...privateAddon(o.id), addonSlug: undefined },
      { ...privateAddon(o.id), totalCents: 12.5 },
    ];
    for (const input of bad) {
      await expect(createWorkOrder(superAdmin, input)).rejects.toBeInstanceOf(
        InvalidInput,
      );
    }
    await expect(
      createWorkOrder(superAdmin, { ...polish("aaaaaaaaaaaaaaa") }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("send, accept and pay (BILL-20, D299)", () => {
  it("send: status sent, valid 30 days, one quote email", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const { id } = await createWorkOrder(superAdmin, polish(o.id));
    const before = mail.sent.length;
    const now = new Date("2026-10-08T15:00:00Z");
    const res = await sendWorkOrder(superAdmin, id, {
      transport: mail,
      now: () => now,
    });
    expect(res.emailed).toBe(true);
    const r = await row(id);
    expect(r.status).toBe("sent");
    expect(new Date(String(r.valid_until).replace(" ", "T")).getTime()).toBe(
      now.getTime() + 30 * 86_400_000,
    );
    const sent = mail.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("billing.quote_sent");
    expect(sent[0]!.to).toBe(o.email);
    expect(sent[0]!.text).toContain(`/hub/settings/quotes/${id}`);
    await expect(
      sendWorkOrder(superAdmin, id, { transport: mail }),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect(await auditCount(id, "work_order.send")).toBe(1);
  });

  it("owner accepts polish: one $360 invoice with metadata work_order; paying moves it to paid once", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(polish(o.id));
    // The owner pays on the hosted page: keep the auto-charge from paying it first.
    await fakeUpdateCard(o.customerId, true);
    const mark = calls.length;
    const { payUrl } = await acceptWorkOrder(ownerCtx(o), id, { billing });
    const created = calls
      .slice(mark)
      .filter((c) => c.method === "createInvoice");
    expect(created).toHaveLength(1);
    const arg = created[0]!.args[0] as {
      lines: BillingLine[];
      metadata: Record<string, string>;
    };
    expect(arg.lines.reduce((s, l) => s + l.unitCents * l.quantity, 0)).toBe(
      36000,
    );
    expect(arg.metadata.work_order).toBe(id);
    await fakeSettled();
    const r = await row(id);
    expect(r.status).toBe("accepted");
    expect(r.accepted_by).toBe(o.owner);
    expect(payUrl).toContain(`/test-pay/${String(r.deposit_invoice_id)}`);
    expect(await auditCount(id, "work_order.accept")).toBe(1);

    const view = await readWorkOrder(ownerCtx(o), id);
    expect(view.status).toBe("accepted");
    expect(view.payHref).toContain("/test-pay/");
    expect(view.payNowCents).toBe(36000);
    // The hosted URL carries the invoice id by design; no other field does.
    expect(JSON.stringify({ ...view, payHref: null })).not.toContain(
      String(r.deposit_invoice_id),
    );

    await fakePayInvoice(String(r.deposit_invoice_id), "pay", { emit });
    await fakeSettled();
    const paid = await row(id);
    expect(paid.status).toBe("paid");
    expect(paid.paid_at).not.toBe("");
    const mirror = await pb
      .collection("billing_invoices")
      .getFirstListItem(
        pb.filter("provider_invoice_id = {:i}", { i: r.deposit_invoice_id }),
      );
    expect(mirror.kind).toBe("work_order");
    expect(mirror.work_order).toBe(id);

    // Replay: a second paid event for the same invoice changes nothing.
    await emit({
      id: `evt_replay_${tag()}`,
      provider: "fake",
      account: null,
      orgId: o.id,
      createdAt: new Date().toISOString(),
      type: "invoice.paid",
      invoiceId: String(r.deposit_invoice_id),
    });
    expect((await row(id)).status).toBe("paid");
    expect(await auditCount(id, "work_order.paid")).toBe(1);

    await expect(acceptWorkOrder(ownerCtx(o), id, { billing })).rejects.toThrow(
      WORK_ORDER_ANSWERED_COPY,
    );
  });

  it("Admin is Forbidden, impersonating staff is denied, nothing is invoiced", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(polish(o.id));
    const mark = calls.length;
    await expect(
      acceptWorkOrder(adminCtx(o), id, { billing }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      acceptWorkOrder(ownerCtx(o, superAdmin.actor), id, { billing }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await expect(
      declineWorkOrder(ownerCtx(o, superAdmin.actor), id),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await expect(listWorkOrders(adminCtx(o))).rejects.toBeInstanceOf(Forbidden);
    // Impersonating staff may read (read-only view).
    const view = await readWorkOrder(ownerCtx(o, superAdmin.actor), id);
    expect(view.canAct).toBe(false);
    expect(view.impersonating).toBe(true);
    expect(calls.slice(mark)).toHaveLength(0);
    expect((await row(id)).status).toBe("sent");
  });

  it("expired quotes are refused and persisted expired on first read", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const past = new Date(Date.now() - 31 * 86_400_000);
    const id = await sentQuote(polish(o.id), () => past);
    await expect(acceptWorkOrder(ownerCtx(o), id, { billing })).rejects.toThrow(
      WORK_ORDER_EXPIRED_COPY,
    );
    expect((await row(id)).status).toBe("expired");
    const view = await readWorkOrder(ownerCtx(o), id);
    expect(view.status).toBe("expired");
    expect(view.statusDateLabel).not.toBeNull();
  });

  it("decline: sent -> declined; a second answer is refused", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(polish(o.id));
    const before = mail.sent.length;
    const savedStaff = process.env.CDS_STAFF_ALERT_EMAIL;
    process.env.CDS_STAFF_ALERT_EMAIL = "staff-quotes@cds.test";
    try {
      await declineWorkOrder(ownerCtx(o), id, { transport: mail });
    } finally {
      if (savedStaff === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
      else process.env.CDS_STAFF_ALERT_EMAIL = savedStaff;
    }
    // CDS is told (10-30): one staff alert naming the org and the quote.
    const alerts = mail.sent
      .slice(before)
      .filter((m) => m.type === "billing.staff_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.to).toBe("staff-quotes@cds.test");
    expect(alerts[0]!.text).toContain("quote_declined");
    expect(alerts[0]!.text).toContain(id);
    const r = await row(id);
    expect(r.status).toBe("declined");
    expect(r.declined_at).not.toBe("");
    expect(await auditCount(id, "work_order.decline")).toBe(1);
    await expect(acceptWorkOrder(ownerCtx(o), id, { billing })).rejects.toThrow(
      WORK_ORDER_ANSWERED_COPY,
    );
  });
});

describe("deliver (BILL-16, D263)", () => {
  it("deposit, deliver, balance: maintenance added with no proration, add-on installed by staff", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(privateAddon(o.id));

    // No paid work before acceptance.
    await expect(
      deliverWorkOrder(superAdmin, id, { billing, addons: addonDeps() }),
    ).rejects.toThrow(WORK_ORDER_NOT_ACCEPTED_COPY);

    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    const deposit = await row(id);
    expect(deposit.status).toBe("deposit_paid");
    const depInv = await fake.fetchInvoice(String(deposit.deposit_invoice_id));
    expect(depInv.totalCents).toBe(200000);

    await expect(
      deliverWorkOrder(support, id, { billing, addons: addonDeps() }),
    ).rejects.toBeInstanceOf(Forbidden);

    await fakeUpdateCard(o.customerId, true);
    const mark = calls.length;
    const res = await deliverWorkOrder(superAdmin, id, {
      billing,
      addons: addonDeps(),
    });
    expect(res.balanceCents).toBe(200000);
    expect(res.balanceInvoiceUrl).toContain("/test-pay/");
    expect(res.installed).toBe("testimonials");
    expect(res.maintenanceFrom).not.toBeNull();

    const change = calls
      .slice(mark)
      .filter((c) => c.method === "changeItems")
      .map((c) => c.args[0] as ChangeItemsInput);
    expect(change).toHaveLength(1);
    expect(change[0]!.proration).toBe("none");
    expect(change[0]!.chargeNow).toBe(false);
    expect(change[0]!.add[0]).toMatchObject({
      kind: "service",
      key: `maintenance-${id}`,
      interval: "month",
      unitCents: 5000,
    });
    const sub = await fake.fetchSubscription(o.subscriptionId);
    expect(sub.items.some((i) => i.key === `maintenance-${id}`)).toBe(true);

    const addon = await pb
      .collection("org_addons")
      .getFirstListItem(
        pb.filter("organization = {:o} && addon = 'testimonials'", { o: o.id }),
      );
    expect(addon.status).toBe("active");
    expect(addon.source).toBe("staff");

    await fakeSettled();
    const delivered = await row(id);
    expect(delivered.status).toBe("delivered");
    const view = await readWorkOrder(ownerCtx(o), id);
    expect(view.payNowCents).toBe(200000);
    expect(view.payHref).toContain("/test-pay/");

    await expect(
      deliverWorkOrder(superAdmin, id, { billing, addons: addonDeps() }),
    ).rejects.toBeInstanceOf(InvalidInput);

    await fakePayInvoice(String(delivered.balance_invoice_id), "pay", { emit });
    await fakeSettled();
    expect((await row(id)).status).toBe("paid");
    expect(await auditCount(id, "work_order.deliver")).toBe(1);
    expect(await auditCount(id, "work_order.paid")).toBe(2);
  });

  /** Stripe forgets an idempotency key after 24 h: the retry sends a new one. */
  const dayLater: CdsBilling = new Proxy({} as CdsBilling, {
    get(_t, prop: string) {
      const v = (billing as unknown as Record<string, unknown>)[prop];
      if (prop !== "createInvoice" || typeof v !== "function") return v;
      return (input: { idempotencyKey: string }) =>
        (v as (i: unknown) => unknown)({
          ...input,
          idempotencyKey: `${input.idempotencyKey}:day2`,
        });
    },
  });

  async function invoicesFor(orgId: string, part: string) {
    const all = await listFakeObjects<{ metadata: Record<string, string> }>({
      kind: "invoice",
      orgRef: orgId,
    });
    return all.filter((i) => i.data.metadata.work_order_part === part);
  }

  it("WR-E06: a deliver that fails after the balance invoice never invoices it twice", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(privateAddon(o.id));
    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    expect((await row(id)).status).toBe("deposit_paid");

    // The maintenance step fails after the balance invoice was made.
    const failing: CdsBilling = new Proxy({} as CdsBilling, {
      get(_t, prop: string) {
        if (prop === "changeItems") {
          return () => Promise.reject(new Error("provider down"));
        }
        return (billing as unknown as Record<string, unknown>)[prop];
      },
    });
    await expect(
      deliverWorkOrder(superAdmin, id, {
        billing: failing,
        addons: addonDeps(),
      }),
    ).rejects.toThrow("provider down");
    const half = await row(id);
    expect(half.status).toBe("deposit_paid");
    expect(half.balance_invoice_id).not.toBe("");
    await fakeSettled();

    // Retried the next day: the stored invoice is reused, nothing new is billed.
    const res = await deliverWorkOrder(superAdmin, id, {
      billing: dayLater,
      addons: addonDeps(),
    });
    expect(res.balanceCents).toBe(200000);
    expect(await invoicesFor(o.id, "balance")).toHaveLength(1);
    expect((await row(id)).balance_invoice_id).toBe(half.balance_invoice_id);
    // The balance was charged to the saved card during the failed run: paid now.
    expect((await row(id)).status).toBe("paid");
  });

  it("WR-E06: an acceptance whose save was lost is reused on retry and its payment still counts", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(privateAddon(o.id));
    await fakeUpdateCard(o.customerId, true);
    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    const first = String((await row(id)).deposit_invoice_id);
    expect(first).not.toBe("");

    // The write after createInvoice was lost: the order still reads sent.
    await pb
      .collection("work_orders")
      .update(id, { status: "sent", deposit_invoice_id: "", accepted_at: "" });
    await acceptWorkOrder(ownerCtx(o), id, { billing: dayLater });
    await fakeSettled();
    expect(await invoicesFor(o.id, "deposit")).toHaveLength(1);
    expect((await row(id)).deposit_invoice_id).toBe(first);

    // Lost again, then the owner pays: the order moves anyway.
    await pb
      .collection("work_orders")
      .update(id, { status: "sent", deposit_invoice_id: "", accepted_at: "" });
    await fakePayInvoice(first, "pay", { emit });
    await fakeSettled();
    const paid = await row(id);
    expect(paid.status).toBe("deposit_paid");
    expect(paid.deposit_invoice_id).toBe(first);
  });

  it("deliverCase prints the case and the refusal without writing (review WR-A04)", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(privateAddon(o.id));
    const sent = await deliverCase(superAdmin, id);
    expect(sent).toMatchObject({
      id,
      orgId: o.id,
      kind: "private_addon",
      status: "sent",
      balanceCents: 200000,
      balanceInvoiced: false,
      maintenanceCents: 5000,
      addonSlug: "testimonials",
      refusal: WORK_ORDER_NOT_ACCEPTED_COPY,
    });
    // Past valid_until it reads as expired but is not persisted.
    const late = await deliverCase(superAdmin, id, {
      now: () => new Date(Date.now() + 40 * 86_400_000),
    });
    expect(late.status).toBe("expired");
    expect((await row(id)).status).toBe("sent");
    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    expect((await deliverCase(superAdmin, id)).refusal).toBeNull();
    await expect(deliverCase(support, id)).rejects.toBeInstanceOf(Forbidden);
    await expect(
      deliverCase(superAdmin, "zzzzzzzzzzzzzzz"),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await auditCount(id, "work_order.deliver")).toBe(0);
  });

  it("polish paid in full: deliver only stamps the date", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(polish(o.id));
    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    expect((await row(id)).status).toBe("paid");
    const res = await deliverWorkOrder(superAdmin, id, { billing });
    expect(res).toMatchObject({
      balanceInvoiceUrl: null,
      maintenanceFrom: null,
      installed: null,
    });
    const r = await row(id);
    expect(r.status).toBe("paid");
    expect(r.delivered_at).not.toBe("");
  });
});

describe("listing and isolation (T-10-26-02)", () => {
  it("lists sent first, never drafts or provider ids", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const declined = await sentQuote(polish(o.id));
    await declineWorkOrder(ownerCtx(o), declined);
    const waiting = await sentQuote({
      ...polish(o.id),
      title: "Footer polish",
    });
    await createWorkOrder(superAdmin, { ...polish(o.id), title: "Draft only" });
    const list = await listWorkOrders(ownerCtx(o));
    expect(list.map((w) => w.id)).toEqual([waiting, declined]);
    expect(list[0]).toMatchObject({
      status: "sent",
      totalCents: 36000,
      href: `/hub/settings/quotes/${waiting}`,
    });
    const json = JSON.stringify(list);
    expect(json).not.toContain("in_fake_");
    expect(json).not.toContain("invoice");
  });

  it("org B can never read, accept or decline org A's work order", async (t) => {
    if (!booted) return t.skip();
    const a = await paidOrg();
    const b = await paidOrg();
    const id = await sentQuote(polish(a.id));
    const draft = (await createWorkOrder(superAdmin, polish(a.id))).id;
    await expect(readWorkOrder(ownerCtx(b), id)).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      acceptWorkOrder(ownerCtx(b), id, { billing }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(declineWorkOrder(ownerCtx(b), id)).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(await listWorkOrders(ownerCtx(b))).toEqual([]);
    // Drafts are not the owner's either.
    await expect(readWorkOrder(ownerCtx(a), draft)).rejects.toBeInstanceOf(
      NotFound,
    );
    expect((await row(id)).status).toBe("sent");
  });
});

describe("linked to a support ticket (12-23, SUPPORT-03)", () => {
  it("a quote for a paid ticket: foreign tickets refused, send shows View quote, accept starts the work", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const b = await paidOrg();
    const { number } = await fileTicket(ownerCtx(o), {
      type: "change",
      subject: "A new events page",
      body: "Could CDS build an events page for us?",
    });
    await staffMarkPaidService(
      superAdmin,
      { number, category: "page_building" },
      { transport: mail },
    );
    const input: CreateWorkOrderInput = {
      orgId: o.id,
      kind: "custom_block",
      title: "Events page",
      scope: "<p>Build the events page.</p>",
      totalCents: 30000,
    };
    // Another org's quote can never link to this ticket (T-12-23-03).
    await expect(
      createWorkOrder(superAdmin, { ...input, orgId: b.id, ticket: number }),
    ).rejects.toBeInstanceOf(InvalidInput);

    const { id } = await createWorkOrder(superAdmin, {
      ...input,
      ticket: number,
    });
    expect((await row(id)).ticket).toBe(number);
    await sendWorkOrder(superAdmin, id, { transport: mail });
    expect(await paidPanelFor(ownerCtx(o), number)).toMatchObject({
      state: "quote_sent",
      quoteId: id,
      amountCents: 30000,
    });

    await fakeUpdateCard(o.customerId, true);
    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    const thread = await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("number = {:n}", { n: number }));
    expect(thread.status).toBe("in_progress");
    expect(await paidPanelFor(ownerCtx(o), number)).toMatchObject({
      state: "accepted",
      accepted: true,
    });
    const lines = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t} && author_kind = 'system'", {
        t: thread.id,
      }),
      sort: "created,id",
    });
    expect(
      lines.map((m) => (m.event as { label?: string } | null)?.label),
    ).toEqual([
      "This is a paid service",
      "CDS changed the status to Waiting on you",
      "CDS sent a quote",
      "Quote accepted",
      "CDS changed the status to In progress",
    ]);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.paid_quote_accepted' && target_id = {:t}",
        { t: thread.id },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(o.owner);
  });

  it("without --ticket nothing about tickets changes", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const id = await sentQuote(polish(o.id));
    expect((await row(id)).ticket).toBe(0);
  });
});

// ------------------------------------------------------- work:quote / work:deliver CLIs (Task 2)

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const QUOTE_CLI = join(PKG_DIR, "scripts", "work-quote.ts");
const DELIVER_CLI = join(PKG_DIR, "scripts", "work-deliver.ts");
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

function runQuick(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, script, ...args], {
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

async function seedStaff(
  role: "super_admin" | "support_agent",
): Promise<Staff> {
  const email = `work-cli-${tag()}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  return { id: rec.id, email, password };
}

async function runCli(
  script: string,
  who: Staff,
  args: string[],
  after: string[] = [],
): Promise<{ status: number | null; output: string }> {
  const mark = booted!.inst.stdout().length;
  const child = spawn(process.execPath, [...NODE_FLAGS, script, ...args], {
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
  for (let i = 0; i < 1200; i++) {
    if (output.includes("Enter it below") || child.exitCode !== null) break;
    await sleep(50);
  }
  if (output.includes("Enter it below")) {
    const code = await latestOtp(who.id, mark);
    child.stdin.write(`${code}\n`);
    for (const line of after) child.stdin.write(`${line}\n`);
  }
  child.stdin.end();
  return { status: await exited, output };
}

function scopeFile(): string {
  const f = join(storageDir, `scope-${tag()}.md`);
  writeFileSync(
    f,
    "## What CDS will do\n\n- Tighten the **home page** spacing\n- Rework the footer\n",
  );
  return f;
}

describe("work:quote and work:deliver CLIs", () => {
  it("--help exits 0; bad arguments exit 1 before any sign-in", (t) => {
    if (!booted) return t.skip();
    for (const script of [QUOTE_CLI, DELIVER_CLI]) {
      expect(runQuick(script, ["--help"]).status).toBe(0);
    }
    expect(runQuick(QUOTE_CLI, ["--help"]).output).toContain("--ticket");
    const org = "abcdefghijklmno";
    const scope = scopeFile();
    const base = ["--title", "Polish", "--scope-file", scope];
    const cases: [string, string[], string][] = [
      [QUOTE_CLI, ["--kind", "polish", ...base], "--org <org-id> is required"],
      [
        QUOTE_CLI,
        ["--org", "BAD", "--kind", "polish", ...base],
        "--org is not a valid organization id",
      ],
      [QUOTE_CLI, ["--org", org, "--kind", "logo", ...base], "--kind must be"],
      [
        QUOTE_CLI,
        ["--org", org, "--kind", "polish", "--title", "Polish"],
        "--scope-file <md> is required",
      ],
      [
        QUOTE_CLI,
        [
          "--org",
          org,
          "--kind",
          "polish",
          "--title",
          "P",
          "--scope-file",
          join(storageDir, "missing.md"),
        ],
        "could not be read",
      ],
      [
        QUOTE_CLI,
        ["--org", org, "--kind", "polish", ...base, "--ticket", "abc"],
        "--ticket must be a ticket number",
      ],
      [DELIVER_CLI, [], "--quote <id> is required"],
      [DELIVER_CLI, ["--quote", "nope"], "--quote is not a valid quote id"],
    ];
    for (const [script, args, msg] of cases) {
      const r = runQuick(script, args);
      expect(r.status).toBe(1);
      expect(r.output).toContain(msg);
      expect(r.output).not.toContain("Staff email");
    }
  });

  it("work:quote prints the owner's quote; --dry-run writes nothing; --yes sends", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const who = await seedStaff("support_agent");
    const args = [
      "--org",
      o.id,
      "--kind",
      "polish",
      "--blocks",
      "1",
      "--rate-cents",
      "12000",
      "--title",
      "Home page polish",
      "--scope-file",
      scopeFile(),
    ];
    const count = async () =>
      (
        await pb.collection("work_orders").getList(1, 1, {
          filter: pb.filter("organization = {:o}", { o: o.id }),
        })
      ).totalItems;

    const dry = await runCli(QUOTE_CLI, who, [...args, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain("Design polish, 3-hour block · 3 h × $120");
    expect(dry.output).toContain("Pay now:  $360");
    expect(dry.output).toContain("Tighten the home page spacing");
    expect(dry.output).toContain("DRY RUN");
    expect(await count()).toBe(0);

    const no = await runCli(QUOTE_CLI, who, args, ["n"]);
    expect(no.status).toBe(0);
    expect(no.output).toContain("Send to the owner? [y/N]");
    expect(no.output).toContain("Nothing changed.");
    expect(await count()).toBe(0);

    const yes = await runCli(QUOTE_CLI, who, [...args, "--yes"]);
    expect(yes.status).toBe(0);
    expect(yes.output.trim().split("\n").pop()).toContain(
      "Sent. The owner sees it in Settings › Billing and by email.",
    );
    const list = await listWorkOrders(ownerCtx(o));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "sent", totalCents: 36000 });

    const missing = await runCli(QUOTE_CLI, who, [
      ...args.slice(0, 1),
      "zzzzzzzzzzzzzzz",
      ...args.slice(2),
      "--yes",
    ]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(
      "Org zzzzzzzzzzzzzzz not found, or this account isn't CDS staff.",
    );
  });

  it("work:deliver refuses unaccepted work, then delivers the add-on", async (t) => {
    if (!booted) return t.skip();
    const o = await paidOrg();
    const admin = await seedStaff("super_admin");
    const agent = await seedStaff("support_agent");
    const id = await sentQuote(privateAddon(o.id));

    const early = await runCli(DELIVER_CLI, admin, [
      "--quote",
      id,
      "--dry-run",
    ]);
    expect(early.status).toBe(1);
    expect(early.output).toContain("Status:       sent");
    expect(early.output).toContain(`Refused: ${WORK_ORDER_NOT_ACCEPTED_COPY}`);

    await acceptWorkOrder(ownerCtx(o), id, { billing });
    await fakeSettled();
    expect((await row(id)).status).toBe("deposit_paid");

    const notStaff = await runCli(DELIVER_CLI, agent, ["--quote", id]);
    expect(notStaff.status).toBe(1);
    expect(notStaff.output).toContain(
      `Quote ${id} not found, or this account isn't CDS staff.`,
    );

    // WR-A04: the case is printed first; a dry run and a "no" change nothing.
    const dry = await runCli(DELIVER_CLI, admin, ["--quote", id, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain(`Quote ${id} for `);
    expect(dry.output).toContain("Status:       deposit_paid");
    expect(dry.output).toContain(
      "Balance:      $2,000.00 (invoiced to the card on file)",
    );
    expect(dry.output).toContain("Maintenance:  $50/mo from the next bill");
    expect(dry.output).toContain("Add-on:       testimonials");
    expect(dry.output).toContain(`DRY RUN would deliver quote ${id}`);
    const no = await runCli(DELIVER_CLI, admin, ["--quote", id], ["n"]);
    expect(no.status).toBe(0);
    expect(no.output).toContain("Invoice $2,000.00 and deliver? [y/N]");
    expect(no.output).toContain("Nothing changed.");
    const untouched = await row(id);
    expect(untouched.status).toBe("deposit_paid");
    expect(untouched.balance_invoice_id).toBe("");
    const bogus = await runCli(DELIVER_CLI, admin, [
      "--quote",
      "zzzzzzzzzzzzzzz",
      "--dry-run",
    ]);
    expect(bogus.status).toBe(1);
    expect(bogus.output).toContain(
      "Quote zzzzzzzzzzzzzzz not found, or this account isn't CDS staff.",
    );

    const done = await runCli(DELIVER_CLI, admin, ["--quote", id], ["y"]);
    expect(done.status).toBe(0);
    expect(done.output).toMatch(
      /Balance invoice sent: \$2,000\.00\. Maintenance \$50\/mo added from \d{1,2} [A-Z][a-z]{2}\. Add-on installed: testimonials\./,
    );
    // The good card paid the balance in the CLI's own process.
    expect((await row(id)).status).toBe("paid");
  });
});
