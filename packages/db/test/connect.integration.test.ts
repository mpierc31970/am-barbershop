// 10-14: tenant Connect (Standard) onboarding and status (BILL-06, PAY-03, PAY-10; CONTEXT
// A1; T-10-14-01..05). The fake gateway plays Stripe; every emitted event goes through the
// one processor with a captured mail transport.
import { Forbidden, ImpersonationDenied, NotFound } from "@cds/core";
import type { NormalisedEvent, PaymentGateway } from "@cds/core/payments";
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import {
  canTakePayments,
  PAYMENT_PAUSED_SITE_COPY,
  readConnectStatus,
  refreshConnectLink,
  refreshConnectStatus,
  startStripeConnect,
} from "../src/payments/connect";
import {
  fakeConnectOutcome,
  fakeDeauthorize,
  fakePaymentGateway,
} from "../src/payments/fake/index";
import { fakeEvent, fakeSettled } from "../src/payments/fake/shared";
import { processNormalisedEvent } from "../src/payments/process";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
const STAFF = "staff-alerts@cds.test";
const savedStaff = process.env.CDS_STAFF_ALERT_EMAIL;
let pb: PocketBase;
let gateway: PaymentGateway;
const mail = captureTransport();

const emitted: NormalisedEvent[] = [];
const emit = async (e: NormalisedEvent): Promise<void> => {
  emitted.push(e);
  await processNormalisedEvent(e, { gateway, transport: mail });
};

const tag = () => randomBytes(4).toString("hex");

type Org = { id: string; owner: string; email: string; name: string };

async function newOrg(): Promise<Org> {
  const t = tag();
  const name = `Connect ${t}`;
  const org = await pb.collection("organizations").create({
    name,
    slug: `connect-${t}`,
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
  return { id: org.id, owner: user.id, email, name };
}

const ctxOf = (
  o: Org,
  role: "owner" | "admin" | "editor" = "owner",
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

async function rows(orgId: string) {
  return pb.collection("gateway_accounts").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
}

async function accountIdOf(orgId: string): Promise<string> {
  const r = await rows(orgId);
  return String(r[0]?.account_id ?? "");
}

beforeAll(async () => {
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF;
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  gateway = fakePaymentGateway({ emit });
});

afterAll(async () => {
  await fakeSettled();
  await booted?.inst.stop();
  if (savedStaff === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
  else process.env.CDS_STAFF_ALERT_EMAIL = savedStaff;
});

describe("startStripeConnect (BILL-06, D285, TEN-15)", () => {
  it("owner starts: one restricted row, gateway URL; a second call reuses the account", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const first = await startStripeConnect(ctxOf(org), { gateway });
    expect(first.url).toContain("/test-pay/connect?account=");
    const r1 = await rows(org.id);
    expect(r1).toHaveLength(1);
    expect(r1[0]?.status).toBe("restricted");
    expect(r1[0]?.provider).toBe("fake");
    const id = String(r1[0]?.account_id);
    expect(first.url).toContain(encodeURIComponent(id));

    const second = await startStripeConnect(ctxOf(org), { gateway });
    expect(second.url).toContain(encodeURIComponent(id));
    const r2 = await rows(org.id);
    expect(r2).toHaveLength(1);
    expect(r2[0]?.account_id).toBe(id);

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'connect.start'", {
        o: org.id,
      }),
    });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit[0]?.meta)).not.toContain("http");
  });

  it("admin is Forbidden, an impersonated owner is ImpersonationDenied; no row written", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    await expect(
      startStripeConnect(ctxOf(org, "admin"), { gateway }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      startStripeConnect(ctxOf(org, "owner", "staff123456789a"), { gateway }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    expect(await rows(org.id)).toHaveLength(0);
  });
});

describe("readConnectStatus / canTakePayments (PAY-03, D146, D156)", () => {
  it("derives the screen state from the row and the gateway", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const ctx = ctxOf(org);
    expect((await readConnectStatus(ctx)).state).toBe("not_connected");
    expect(await canTakePayments(ctx)).toEqual({
      ok: false,
      reason: "not_connected",
      message: PAYMENT_PAUSED_SITE_COPY,
    });

    await startStripeConnect(ctx, { gateway });
    const id = await accountIdOf(org.id);

    await fakeConnectOutcome(id, "unfinished", { emit });
    await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect((await readConnectStatus(ctx)).state).toBe("setup_unfinished");
    expect(await canTakePayments(ctx)).toMatchObject({
      ok: false,
      reason: "setup_unfinished",
    });

    await fakeConnectOutcome(id, "finished", { emit });
    const view = await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect(view.state).toBe("connected");
    expect(view.accountSuffix).toBe(id.slice(-4));
    expect(view.chargesEnabled).toBe(true);
    expect(view.wasConnected).toBe(true);
    expect(view.displayName).toBe("Test business");
    expect(await canTakePayments(ctx)).toEqual({ ok: true });
    // Admin reads too; the view never carries the full account id.
    const adminView = await readConnectStatus(ctxOf(org, "admin"));
    expect(JSON.stringify(adminView)).not.toContain(id);
    expect(JSON.stringify(adminView)).not.toMatch(/acct_\w{5,}/);

    await fakeConnectOutcome(id, "restricted", { emit });
    await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect((await readConnectStatus(ctx)).state).toBe("restricted");
    expect(await canTakePayments(ctx)).toEqual({
      ok: false,
      reason: "restricted",
      message: PAYMENT_PAUSED_SITE_COPY,
    });
  });

  it("an editor cannot read the Payments status", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    await expect(
      readConnectStatus(ctxOf(org, "editor")),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("cross-tenant (invariant 1, T-10-14-03)", () => {
  it("org B never sees or touches org A's account", async (t) => {
    if (!booted) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    await startStripeConnect(ctxOf(a), { gateway });
    const idA = await accountIdOf(a.id);
    await fakeConnectOutcome(idA, "finished", { emit });
    await refreshConnectStatus(ctxOf(a), { gateway, transport: mail });

    const viewB = await readConnectStatus(ctxOf(b));
    expect(viewB.state).toBe("not_connected");
    expect(await canTakePayments(ctxOf(b))).toMatchObject({ ok: false });

    await startStripeConnect(ctxOf(b), { gateway });
    const idB = await accountIdOf(b.id);
    expect(idB).not.toBe(idA);
    const rowA = (await rows(a.id))[0];
    expect(rowA?.account_id).toBe(idA);
    expect(rowA?.status).toBe("connected");
  });
});

const alertsFor = (orgId: string, event?: string) =>
  mail.sent.filter(
    (m) =>
      m.type === "billing.staff_alert" &&
      m.to === STAFF &&
      m.text.includes(orgId) &&
      (event === undefined || m.text.includes(event)),
  );
const setupMailsTo = (to: string) =>
  mail.sent.filter((m) => m.type === "billing.stripe_setup" && m.to === to);

describe("account events (PAY-03; T-10-14-03, T-10-14-04)", () => {
  it("connected -> restricted -> disconnected -> connected: one alert and one owner email per stop", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const ctx = ctxOf(org);
    await startStripeConnect(ctx, { gateway });
    const id = await accountIdOf(org.id);

    // Setup unfinished before ever connecting: no alert, no owner email.
    await fakeConnectOutcome(id, "unfinished", { emit });
    expect((await readConnectStatus(ctx)).state).toBe("setup_unfinished");
    expect(alertsFor(org.id)).toHaveLength(0);

    await fakeConnectOutcome(id, "finished", { emit });
    let row = (await rows(org.id))[0];
    expect(row?.status).toBe("connected");
    expect(row?.alerted_status).toBe("connected");
    expect(setupMailsTo(org.email)).toHaveLength(0);

    const from = emitted.length;
    await fakeConnectOutcome(id, "restricted", { emit });
    const restrictedEvents = emitted.slice(from);
    row = (await rows(org.id))[0];
    expect(row?.status).toBe("restricted");
    expect(row?.alerted_status).toBe("restricted");
    expect(alertsFor(org.id, "stripe_restricted")).toHaveLength(1);
    expect(setupMailsTo(org.email)).toHaveLength(1);
    // The owner email links to the Payments tab, never to an onboarding link.
    expect(setupMailsTo(org.email)[0]?.text).toContain(
      "/hub/settings?tab=payments",
    );
    expect(setupMailsTo(org.email)[0]?.text).not.toContain("/test-pay/");
    // 11-21: one urgent bell alert for the Owner, keyed to the Needs-you item; no generic
    // alert email (the owner email above is the dedicated one).
    const bell = () =>
      pb.collection("alerts").getFullList({
        filter: pb.filter("organization = {:org} && type = {:type}", {
          org: org.id,
          type: "payments.payouts_paused",
        }),
      });
    expect((await bell()).map((r) => [r.user, r.source_key, r.level])).toEqual([
      [org.owner, "billing:finish_stripe", "urgent"],
    ]);
    expect((await bell())[0]?.emailed_at).toBe("");

    // Replaying the same event, or a second restricted update, sends nothing more.
    for (const e of restrictedEvents) {
      expect(
        (await processNormalisedEvent(e, { gateway, transport: mail })).outcome,
      ).toBe("duplicate");
    }
    await fakeConnectOutcome(id, "restricted", { emit });
    await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect(alertsFor(org.id)).toHaveLength(1);
    expect(setupMailsTo(org.email)).toHaveLength(1);

    await fakeDeauthorize(id, { emit });
    row = (await rows(org.id))[0];
    expect(row?.status).toBe("disconnected");
    expect(alertsFor(org.id, "stripe_disconnected")).toHaveLength(1);
    // Still unread: the same key is not raised twice.
    expect(await bell()).toHaveLength(1);
    expect(alertsFor(org.id)).toHaveLength(2);
    expect(setupMailsTo(org.email)).toHaveLength(2);
    expect((await readConnectStatus(ctx)).state).toBe("disconnected");
    expect(await canTakePayments(ctx)).toMatchObject({
      ok: false,
      reason: "disconnected",
    });

    // Back to finished: connected, alerted_status updated, no owner email.
    await fakeConnectOutcome(id, "finished", { emit });
    row = (await rows(org.id))[0];
    expect(row?.status).toBe("connected");
    expect(row?.alerted_status).toBe("connected");
    expect(setupMailsTo(org.email)).toHaveLength(2);
    expect(alertsFor(org.id)).toHaveLength(2);

    // One connect.status audit row per change, none for repeats.
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'connect.status'", {
        o: org.id,
      }),
    });
    expect(audit.map((a) => (a.meta as { to: string }).to)).toEqual([
      "connected",
      "restricted",
      "disconnected",
      "connected",
    ]);
  });

  it("WR-E02: after a disconnect the owner reconnects with a new account", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const ctx = ctxOf(org);
    await startStripeConnect(ctx, { gateway });
    const first = await accountIdOf(org.id);
    await fakeConnectOutcome(first, "finished", { emit });
    await fakeDeauthorize(first, { emit });
    expect((await readConnectStatus(ctx)).state).toBe("disconnected");

    // The old account can no longer be onboarded (as on Stripe); a new one is made under
    // a fresh key, so the provider does not hand back the disconnected account.
    const again = await startStripeConnect(ctx, { gateway });
    const second = await accountIdOf(org.id);
    expect(second).not.toBe(first);
    expect(again.url).toContain(encodeURIComponent(second));
    expect((await rows(org.id))[0]?.status).toBe("restricted");

    await fakeConnectOutcome(second, "finished", { emit });
    expect(await canTakePayments(ctx)).toEqual({ ok: true });
  });

  it("WR-D02: the refresh link only re-mints for an existing account; it never creates or replaces one", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const ctx = ctxOf(org);
    // No account yet: refused, nothing written (a cross-site GET can't start Connect).
    await expect(refreshConnectLink(ctx, { gateway })).rejects.toThrow(
      NotFound,
    );
    expect(await rows(org.id)).toHaveLength(0);

    await startStripeConnect(ctx, { gateway });
    const id = await accountIdOf(org.id);
    const before = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o}", { o: org.id }),
    });
    const link = await refreshConnectLink(ctx, { gateway });
    expect(link.url).toContain(encodeURIComponent(id));
    expect(await rows(org.id)).toHaveLength(1);
    expect(await accountIdOf(org.id)).toBe(id);
    const after = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o}", { o: org.id }),
    });
    expect(after).toHaveLength(before.length);

    // Disconnected: refused, the row is not replaced (reconnecting is the tab's POST).
    await fakeConnectOutcome(id, "finished", { emit });
    await fakeDeauthorize(id, { emit });
    await expect(refreshConnectLink(ctx, { gateway })).rejects.toThrow(
      NotFound,
    );
    expect(await accountIdOf(org.id)).toBe(id);

    // Admins and impersonating owners are refused before anything is read.
    await expect(
      refreshConnectLink(ctxOf(org, "admin"), { gateway }),
    ).rejects.toThrow(Forbidden);
  });

  it("an event for an unknown account id is ignored", async (t) => {
    if (!booted) return t.skip();
    const e = fakeEvent(
      null,
      { type: "account.updated", accountId: "acct_fake_unknown0000000" },
      "acct_fake_unknown0000000",
    );
    expect(
      (await processNormalisedEvent(e, { gateway, transport: mail })).outcome,
    ).toBe("ignored");
    const d = fakeEvent(
      null,
      { type: "account.deauthorized", accountId: "acct_fake_unknown0000001" },
      "acct_fake_unknown0000001",
    );
    expect(
      (await processNormalisedEvent(d, { gateway, transport: mail })).outcome,
    ).toBe("ignored");
  });

  it("the manual re-check applies the same transition (one alert, one owner email)", async (t) => {
    if (!booted) return t.skip();
    const org = await newOrg();
    const ctx = ctxOf(org);
    await startStripeConnect(ctx, { gateway });
    const id = await accountIdOf(org.id);
    await fakeConnectOutcome(id, "finished", { emit });
    // Change the fake account without delivering the event: only the re-check sees it.
    const silent = async (): Promise<void> => {};
    await fakeConnectOutcome(id, "restricted", { emit: silent });
    expect((await rows(org.id))[0]?.status).toBe("connected");
    const view = await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect(view.state).toBe("restricted");
    expect(view.wasConnected).toBe(true);
    await refreshConnectStatus(ctx, { gateway, transport: mail });
    expect(alertsFor(org.id, "stripe_restricted")).toHaveLength(1);
    expect(setupMailsTo(org.email)).toHaveLength(1);
  });
});
