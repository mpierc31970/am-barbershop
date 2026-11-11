// 14-39 (LIFE-01; D282, D263, D161, D293; P14-P27, P14-P28, P14-P34, P14-P36; T-14-39-01..04):
// Leaving CDS on the real PocketBase binary. The owner starts with an emailed code (never under
// impersonation, never an Admin), a super_admin starts with a reason, DNS is first and every
// later step is refused until it is done or not applicable, the checklist lists manifest items
// (fixture add-on), connected services and billing, and an org B owner can never reach org A.
import "@cds/addon-registry/server";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, ImpersonationDenied, NotFound } from "@cds/core";
import { FIXTURE_OFFBOARDING } from "../../core/src/addons/__fixtures__/manifests";
import { P14_COPY } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import type { SendingDomains } from "../src/email/sending-domains/ports";
import { captureTransport } from "../src/email/transport";
import { runRetentionJob } from "../src/jobs/retention";
import { markOrgClosed } from "../src/org-closure";
import {
  advanceOffboardings,
  cancelOffboarding,
  leavingNeedsYou,
  offboardingView,
  requestOffboardingCode,
  startOffboarding,
} from "../src/offboarding/offboardings";
import {
  closeAtNoticeEnd,
  completeOffboardingStep,
  GA4_TRANSFER_RUNBOOK,
  MOVE_DNS_FIRST,
  offboardingChecklist,
  recordHandbackDone,
  requestOffboardingDownload,
} from "../src/offboarding/steps";
import { mintSystemContext } from "../src/context";
import { startMove } from "../src/dns/moves";
import { createBillingSpy } from "./fake-billing-spy";
import {
  bootSeededPb,
  otpCodeFor,
  staffContext,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let superAdmin: PlatformContext;
let supportAgent: PlatformContext;
let storageDir = "";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
};
const NOW = new Date("2026-10-17T15:00:00.000Z");
const DAY = 86_400_000;
const MANIFESTS = [FIXTURE_OFFBOARDING];

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-offboarding-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  const t = randomBytes(3).toString("hex");
  superAdmin = await staffContext(
    booted.inst,
    `off-super-${t}@cds.test`,
    "super_admin",
  );
  supportAgent = await staffContext(
    booted.inst,
    `off-agent-${t}@cds.test`,
    "support_agent",
  );
}, 60_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await booted?.inst.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

let n = 0;
const tag = () => randomBytes(4).toString("hex");

type Site = {
  org: string;
  owner: OrgContext;
  ownerId: string;
  admin: OrgContext;
  impersonated: OrgContext;
};

async function site(
  opts: {
    demo?: boolean;
    stage?: string;
    analytics?: Record<string, unknown>;
  } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Leaving ${n}`,
      slug: `leaving-${n}-${t}`,
      status: "active",
      stage: opts.stage ?? "live",
      ...(opts.demo ? { demo: true } : {}),
      ...(opts.analytics ? { analytics: opts.analytics } : {}),
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: `leaving-${n}-${t}.sites.localhost`,
    organization: org,
    kind: "preview",
    primary: true,
  });
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const id = (
      await pb.collection("users").create({
        email: `${role}-${t}@cds.test`,
        password,
        passwordConfirm: password,
        name: role === "owner" ? "Maria" : "Ada",
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return id;
  };
  const ownerId = await member("owner");
  const adminId = await member("admin");
  const mk = (actor: string, role: "owner" | "admin", impersonator?: string) =>
    mintOrgContext({
      orgId: org,
      actor,
      role,
      grants: [],
      ip: `203.0.113.${(n % 200) + 1}`,
      ...(impersonator ? { impersonator } : {}),
    });
  return {
    org,
    owner: mk(ownerId, "owner"),
    ownerId,
    admin: mk(adminId, "admin"),
    impersonated: mk(ownerId, "owner", superAdmin.actor),
  };
}

async function activeZone(org: string, domain: string): Promise<string> {
  const r = await pb.collection("dns_zones").create({
    org_id: org,
    domain,
    provider: "fake",
    provider_zone_id: `fz-${tag()}`,
    status: "active",
    nameservers: ["ana.ns.fake.test", "bob.ns.fake.test"],
  });
  return r.id;
}

async function ownerCode(s: Site): Promise<{ otpId: string; code: string }> {
  const { otpId, maskedEmail } = await requestOffboardingCode(s.owner);
  expect(maskedEmail).toContain("•");
  const code = await otpCodeFor(booted!.inst, otpId);
  return { otpId, code };
}

async function ownerStart(
  s: Site,
  extra: Record<string, unknown> = {},
  deps: Record<string, unknown> = {},
) {
  return startOffboarding(
    s.owner,
    s.org,
    { code: await ownerCode(s), ...extra },
    { now: NOW, ...deps },
  );
}

async function rowOf(org: string) {
  return pb
    .collection("offboardings")
    .getFirstListItem(pb.filter("org_id = {:o}", { o: org }));
}

async function audits(action: string, org: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = {:a} && organization = {:o}", {
      a: action,
      o: org,
    }),
  });
}

describe("Leaving CDS: start, order, checklist (14-39 Task 1)", () => {
  it("the owner starts with the emailed code; no zone means DNS not applicable", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    const mail = captureTransport();
    const view = await ownerStart(
      s,
      { reasonCategory: "cost" },
      { transport: mail },
    );
    expect(view.status).toBe("notice");
    expect(view.daysLeft).toBe(30);
    expect(view.noticeEndsAt).toBe(
      new Date(NOW.getTime() + 30 * DAY).toISOString(),
    );
    expect(view.steps.map((x) => [x.key, x.status])).toEqual([
      ["dns_handback", "not_applicable"],
      ["download", "open"],
      ["addons", "open"],
      ["services", "open"],
      ["billing", "open"],
      ["close", "open"],
    ]);
    expect(view.next).toBe("download your data");
    expect(view.systemSteps).toBeNull();
    expect(view.note).toBeNull();
    expect(mail.sent.map((m) => m.subject)).toContain(P14_COPY.MAIL_LEAVING_S);
    const rows = await audits("offboarding.started", s.org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(s.ownerId);
    expect(rows[0]!.meta).toMatchObject({ by: "owner", handback: false });
    // Steps after DNS are open: the owner may tick them.
    await expect(
      completeOffboardingStep(s.owner, s.org, "addons", { now: NOW }),
    ).resolves.toEqual({ step: "addons", status: "done" });
    // A second start while the notice runs is refused.
    await expect(ownerStart(s)).rejects.toThrow(/already started/);
  });

  it("impersonating staff and Admins are refused; a wrong code is Forbidden", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    await expect(requestOffboardingCode(s.impersonated)).rejects.toBeInstanceOf(
      ImpersonationDenied,
    );
    await expect(
      startOffboarding(s.impersonated, s.org, {
        code: { otpId: "x".repeat(15), code: "123456" },
      }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await expect(requestOffboardingCode(s.admin)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      startOffboarding(s.admin, s.org, {
        code: { otpId: "x".repeat(15), code: "123456" },
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    const { otpId, code } = await ownerCode(s);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(
      startOffboarding(s.owner, s.org, { code: { otpId, code: wrong } }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(startOffboarding(s.owner, s.org, {})).rejects.toThrow(
      /code we emailed/,
    );
    expect(
      await pb.collection("offboardings").getList(1, 1, {
        filter: pb.filter("org_id = {:o}", { o: s.org }),
      }),
    ).toMatchObject({ totalItems: 0 });
  });

  it("a super_admin starts with a reason; support agents cannot; DNS first with an active zone", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    await activeZone(s.org, `leaving-${tag()}.com`);
    await expect(
      startOffboarding(supportAgent, s.org, { reason: "Customer asked" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(startOffboarding(superAdmin, s.org, {})).rejects.toThrow(
      /reason/,
    );
    const view = await startOffboarding(
      superAdmin,
      s.org,
      { reason: "Customer asked by phone" },
      { now: NOW },
    );
    expect(view.steps.map((x) => [x.key, x.status])).toEqual([
      ["dns_handback", "open"],
      ["download", "locked"],
      ["addons", "locked"],
      ["services", "locked"],
      ["billing", "locked"],
      ["close", "locked"],
    ]);
    expect(view.systemSteps?.map((x) => x.key)).toEqual([
      "hosts_removed",
      "site_closed",
      "zone_deleted",
    ]);
    expect(view.note).toBe("Customer asked by phone");
    const ownerView = await offboardingView(s.owner, s.org, NOW);
    expect(ownerView?.banner).toBe(
      P14_COPY.BANNER({ days: 30, next: "move your DNS" }),
    );
    const audit = await audits("offboarding.started", s.org);
    expect(audit[0]!.meta).toMatchObject({ by: "staff", handback: true });

    // Every later step is refused server-side until the handback (T-14-39-01).
    for (const step of ["download", "addons", "services", "billing"] as const) {
      await expect(
        completeOffboardingStep(s.owner, s.org, step, { now: NOW }),
      ).rejects.toThrow(MOVE_DNS_FIRST);
    }
    await expect(
      requestOffboardingDownload(s.owner, s.org, { now: NOW, run: false }),
    ).rejects.toThrow(MOVE_DNS_FIRST);

    // Needs you: the owner sees "Move your DNS before you leave"; an Admin does not.
    const items = await leavingNeedsYou(s.owner, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "leaving:dns",
      title: "Move your DNS before you leave",
      href: "/hub/leaving",
      level: "normal",
    });
    expect(await leavingNeedsYou(s.admin, NOW)).toEqual([]);

    // 14-40 marks the handback done: the later steps open.
    await recordHandbackDone(mintSystemContext({ job: "test" }), s.org, {
      now: NOW,
    });
    expect(await leavingNeedsYou(s.owner, NOW)).toEqual([]);
    const after = await offboardingView(s.owner, s.org, NOW);
    expect(after?.steps.find((x) => x.key === "download")?.status).toBe("open");
    const dl = await requestOffboardingDownload(s.owner, s.org, {
      now: NOW,
      run: false,
    });
    expect(dl.id).toMatch(/^[a-z0-9]{15}$/);
    const done = await offboardingView(s.owner, s.org, NOW);
    expect(done?.steps.find((x) => x.key === "download")?.status).toBe("done");
  });

  it("checklist: fixture add-on item, services, billing, GA4 transfer line", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site({ analytics: { ga4_measurement_id: "G-TEST1234" } });
    const plain = await site();
    // Preview before a notice runs (stated before the owner confirms).
    const pre = await offboardingChecklist(s.owner, s.org, {
      manifests: MANIFESTS,
      now: NOW,
    });
    expect(pre.status).toBe("preview");
    expect(pre.addons.items).toEqual([]);
    expect(pre.addons.line).toBe(P14_COPY.ADDONS_NA);
    const ga = pre.services.find((l) => l.key === "analytics");
    expect(ga?.state).toMatch(/^Transfer to your own Google account before /);
    expect(ga?.runbook).toBe(GA4_TRANSFER_RUNBOOK);
    expect(GA4_TRANSFER_RUNBOOK).toContain("ga4-search-console.md");
    expect(pre.services.find((l) => l.key === "stripe")?.state).toBe(
      "not connected",
    );
    expect(pre.services.find((l) => l.key === "gbp")?.state).toBe(
      "not connected",
    );
    expect(pre.services.find((l) => l.key === "shipping")?.state).toBe(
      "not connected",
    );
    const noGa = await offboardingChecklist(plain.owner, undefined, {
      manifests: MANIFESTS,
      now: NOW,
    });
    expect(noGa.services.find((l) => l.key === "analytics")?.state).toBe(
      "not connected",
    );

    // Installed fixture add-on contributes one not-applicable item; Stripe connected;
    // annual plan with a launch rate lock.
    await pb.collection("org_addons").create({
      organization: s.org,
      addon: FIXTURE_OFFBOARDING.slug,
      status: "active",
      source: "staff",
    });
    await pb.collection("gateway_accounts").create({
      organization: s.org,
      provider: "fake",
      account_id: `acct_${tag()}`,
      status: "connected",
      charges_enabled: true,
    });
    await pb.collection("billing_accounts").create({
      organization: s.org,
      provider: "fake",
      status: "active",
      cadence: "yearly",
      installments_paid: 0,
      price_locked_until: new Date(NOW.getTime() + 365 * DAY).toISOString(),
    });
    const list = await offboardingChecklist(s.owner, s.org, {
      manifests: MANIFESTS,
      now: NOW,
    });
    expect(list.addons.items).toEqual([
      {
        slug: "fixture-offboarding",
        addon: FIXTURE_OFFBOARDING.name,
        key: "gift_balances",
        label: "Gift card balances",
        line: "No gift card balances to settle.",
      },
    ]);
    expect(list.addons.line).toBeNull();
    expect(list.services.find((l) => l.key === "stripe")?.state).toBe(
      "disconnects on 16 Nov 2026",
    );
    expect(list.billing.lines).toEqual([
      "Your plan ends on 16 Nov 2026.",
      "Your annual prepay isn't refunded.",
      "You lose your launch price. If you come back later, current prices apply.",
    ]);
    expect(list.close.line).toBe(
      "16 Nov 2026. Deleted 30 days later, on 16 Dec 2026.",
    );
    // An Admin reads it; a support agent reads it; a missing manifests list is refused.
    await expect(
      offboardingChecklist(s.admin, s.org, { manifests: [], now: NOW }),
    ).resolves.toBeTruthy();
    await expect(
      offboardingChecklist(supportAgent, s.org, { manifests: [], now: NOW }),
    ).resolves.toBeTruthy();
    await expect(
      offboardingChecklist(s.owner, s.org, {
        manifests: undefined as never,
      }),
    ).rejects.toThrow(/manifests/);
  });

  it("Stay with CDS cancels during the notice; starting again re-opens the same row", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    await ownerStart(s);
    const first = await rowOf(s.org);
    await expect(cancelOffboarding(s.admin, s.org)).rejects.toBeInstanceOf(
      Forbidden,
    );
    const res = await cancelOffboarding(s.owner, s.org, undefined, {
      now: new Date(NOW.getTime() + DAY),
    });
    expect(res.view.status).toBe("cancelled");
    expect(res.dnsHandedBack).toBe(false);
    expect(res.message).toBe(P14_COPY.STAY_B);
    expect(await audits("offboarding.cancelled", s.org)).toHaveLength(1);
    await expect(cancelOffboarding(s.owner, s.org)).rejects.toThrow(
      /no notice/,
    );
    const again = await ownerStart(s);
    expect(again.status).toBe("notice");
    expect((await rowOf(s.org)).id).toBe(first.id);
  });

  it("the demo org is refused", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site({ demo: true });
    await expect(
      startOffboarding(superAdmin, s.org, { reason: "Never allowed" }),
    ).rejects.toThrow(/demo/);
  });

  it("org B's owner never reaches org A (P14-P34)", async (ctx) => {
    if (!booted) return ctx.skip();
    const a = await site();
    const b = await site();
    await ownerStart(a);
    const before = await rowOf(a.org);
    await expect(
      startOffboarding(b.owner, a.org, {
        code: { otpId: "x".repeat(15), code: "123456" },
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(cancelOffboarding(b.owner, a.org)).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      offboardingChecklist(b.owner, a.org, { manifests: [], now: NOW }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(offboardingView(b.owner, a.org)).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      completeOffboardingStep(b.owner, a.org, "download"),
    ).rejects.toBeInstanceOf(NotFound);
    const after = await rowOf(a.org);
    expect(after.status).toBe("notice");
    expect(after.updated).toBe(before.updated);
    // org B's own view is empty.
    expect(await offboardingView(b.owner)).toBeNull();
  });
});

function sendingStub(): SendingDomains & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    name: "fake",
    deleted,
    createIdentity: () =>
      Promise.resolve({ dkimTokens: [], mailFrom: "send.example.com" }),
    status: () => Promise.resolve("verified"),
    deleteIdentity: (d: string) => {
      deleted.push(d);
      return Promise.resolve();
    },
  } as unknown as SendingDomains & { deleted: string[] };
}

const at = (days: number) => new Date(NOW.getTime() + days * DAY);

async function orgOf(id: string) {
  return pb.collection("organizations").getOne(id);
}

async function hostKinds(org: string): Promise<string[]> {
  const rows = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:o}", { o: org }),
  });
  return rows.map((r) => String(r.kind)).sort();
}

async function billingWithSub(org: string): Promise<string> {
  const r = await pb.collection("billing_accounts").create({
    organization: org,
    provider: "fake",
    status: "active",
    cadence: "monthly",
    installments_paid: 0,
    customer_id: `cus_${tag()}`,
    subscription_id: `sub_${tag()}`,
    price_locked_until: at(400).toISOString(),
  });
  return String(r.subscription_id);
}

type Call = { args: unknown[] };
const subOf = (c: Call) =>
  (c.args[0] as { subscriptionId: string }).subscriptionId;

describe("Leaving CDS: notice end and retention guard (14-39 Task 2)", () => {
  it("WR-A05: no domain can connect during the notice; a zone delegated after the start reopens the handback", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site({ stage: "being_built" });
    await ownerStart(s);
    expect((await rowOf(s.org)).steps.dns_handback.status).toBe(
      "not_applicable",
    );
    await expect(
      startMove(s.owner, s.org, {
        domain: `leaving-${tag()}.com`,
        kind: "launch",
        by: s.ownerId,
      }),
    ).rejects.toThrow(
      "This site is leaving CDS, so it can't connect a domain.",
    );

    // A zone that reached CDS anyway (e.g. delegated before the guard): close refuses and
    // the DNS handback opens again, later steps locked.
    await activeZone(s.org, `late-${tag()}.com`);
    await expect(closeAtNoticeEnd(s.org, { now: at(31) })).rejects.toThrow(
      MOVE_DNS_FIRST,
    );
    const steps = (await rowOf(s.org)).steps as Record<
      string,
      { status: string }
    >;
    expect(steps.dns_handback!.status).toBe("open");
    expect(steps.zone_deleted!.status).toBe("open");
    expect(steps.close!.status).toBe("locked");
    expect((await orgOf(s.org)).closed_reason).toBe("");
    expect(await audits("offboarding.handback_reopened", s.org)).toHaveLength(
      1,
    );
    // Out of the later notice-end runs (they sweep every open notice).
    await pb.collection("offboardings").delete((await rowOf(s.org)).id);
  });

  it("notice end closes the org: hosts, sending, billing, Connect, closure", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    const d = `closing-${tag()}.com`;
    await pb.collection("org_hosts").create({
      hostname: d,
      organization: s.org,
      kind: "custom",
      primary: true,
    });
    await pb.collection("org_hosts").create({
      hostname: `www.${d}`,
      organization: s.org,
      kind: "redirect",
      primary: false,
    });
    await pb.collection("business_profile").create({
      organization: s.org,
      sending_domain: d,
      sending_status: "verified",
      sending_local_part: "hello",
    });
    await pb.collection("gateway_accounts").create({
      organization: s.org,
      provider: "fake",
      account_id: `acct_${tag()}`,
      status: "connected",
      charges_enabled: true,
    });
    const sub = await billingWithSub(s.org);
    await ownerStart(s);
    const spy = createBillingSpy();
    const sending = sendingStub();
    const mail = captureTransport();
    const deps = { billing: spy, sending, transport: mail };

    // Before the notice ends nothing closes (and closeAtNoticeEnd refuses).
    await expect(
      closeAtNoticeEnd(s.org, { ...deps, now: at(29) }),
    ).rejects.toThrow(/hasn't ended/);
    const early = await advanceOffboardings({ now: at(29), deps });
    expect(early.waiting).toBeGreaterThanOrEqual(1);
    expect((await orgOf(s.org)).closed_reason).toBe("");
    // A dry run counts and writes nothing.
    await advanceOffboardings({ now: at(31), dryRun: true, deps });
    expect((await orgOf(s.org)).closed_reason).toBe("");
    expect(spy.callsTo("cancel")).toHaveLength(0);

    const res = await advanceOffboardings({ now: at(31), deps });
    expect(res.closed).toBeGreaterThanOrEqual(1);
    const org = await orgOf(s.org);
    expect(org.closed_reason).toBe("cancelled");
    expect(org.status).toBe("disabled");
    expect(String(org.closed_at)).not.toBe("");
    expect(await hostKinds(s.org)).toEqual(["preview"]);
    const cancels = spy.callsTo("cancel").filter((c) => subOf(c) === sub);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.args[0]).toMatchObject({ mode: "now" });
    expect(spy.callsTo("refundAll")).toHaveLength(0);
    const acct = await pb
      .collection("billing_accounts")
      .getFirstListItem(pb.filter("organization = {:o}", { o: s.org }));
    expect(String(acct.price_locked_until)).toBe("");
    expect(sending.deleted).toContain(d);
    const profile = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: s.org }));
    expect(profile.sending_status).toBe("none");
    const gw = await pb
      .collection("gateway_accounts")
      .getFirstListItem(pb.filter("organization = {:o}", { o: s.org }));
    expect(gw.status).toBe("disconnected");
    expect(gw.charges_enabled).toBe(false);
    expect((await rowOf(s.org)).status).toBe("closed");
    const view = await offboardingView(superAdmin, s.org, at(31));
    expect(view?.systemSteps?.map((x) => [x.key, x.status])).toEqual([
      ["hosts_removed", "done"],
      ["site_closed", "done"],
      ["zone_deleted", "not_applicable"],
    ]);
    expect(await audits("organization.close", s.org)).toHaveLength(1);
    expect(await audits("offboarding.closed", s.org)).toHaveLength(1);
    expect(await audits("connect.offboarded", s.org)).toHaveLength(1);
    // Idempotent: a second run does nothing more.
    await advanceOffboardings({ now: at(32), deps });
    expect(await audits("organization.close", s.org)).toHaveLength(1);
  });

  it("DNS still at CDS at notice end: nothing closes, billing ends, alerts once, reminder, closes after handback (P14-P36)", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    const d = `overdue-${tag()}.com`;
    const zoneId = await activeZone(s.org, d);
    await pb.collection("org_hosts").create({
      hostname: d,
      organization: s.org,
      kind: "custom",
      primary: true,
    });
    const sub = await billingWithSub(s.org);
    await startOffboarding(
      superAdmin,
      s.org,
      { reason: "Customer asked by email" },
      { now: NOW },
    );
    // close is refused before the handback, even after the notice.
    await expect(closeAtNoticeEnd(s.org, { now: at(31) })).rejects.toThrow(
      MOVE_DNS_FIRST,
    );
    const spy = createBillingSpy();
    const mail = captureTransport();
    const deps = { billing: spy, transport: mail, sending: sendingStub() };
    const mine = () => spy.callsTo("cancel").filter((c) => subOf(c) === sub);
    const staffMail = () =>
      mail.sent.filter(
        (m) => m.subject.includes("handback overdue") && m.subject.includes(d),
      );
    const ownerMail = () =>
      mail.sent.filter((m) => m.subject === P14_COPY.MAIL_HANDBACK_OVERDUE_S);

    const r1 = await advanceOffboardings({ now: at(31), deps });
    expect(r1.overdue).toBeGreaterThanOrEqual(1);
    expect((await orgOf(s.org)).closed_reason).toBe("");
    expect(await hostKinds(s.org)).toEqual(["custom", "preview"]);
    expect((await pb.collection("dns_zones").getOne(zoneId)).status).toBe(
      "active",
    );
    expect(mine()).toHaveLength(1);
    expect(staffMail()).toHaveLength(1);
    expect(ownerMail()).toHaveLength(1);
    const v1 = await offboardingView(s.owner, s.org, at(31));
    expect(v1?.status).toBe("notice");
    expect(v1?.handbackOverdueAt).toBe(at(31).toISOString());
    expect(v1?.steps.find((x) => x.key === "close")?.status).toBe("locked");
    const items = await leavingNeedsYou(s.owner, at(31));
    expect(items[0]?.level).toBe("urgent");
    // The notice has ended: Stay with CDS is refused.
    await expect(
      cancelOffboarding(s.owner, s.org, undefined, { now: at(31) }),
    ).rejects.toThrow(/already ended/);

    // A day later: no second alert, no second cancel.
    await advanceOffboardings({ now: at(32), deps });
    expect(mine()).toHaveLength(1);
    expect(staffMail()).toHaveLength(1);
    expect(ownerMail()).toHaveLength(1);
    // 7 days after the first overdue mail: one owner reminder, still no staff mail.
    await advanceOffboardings({ now: at(38), deps });
    expect(ownerMail()).toHaveLength(2);
    expect(staffMail()).toHaveLength(1);
    expect((await orgOf(s.org)).closed_reason).toBe("");

    // 14-40 completes the handback: the next run closes the site.
    await recordHandbackDone(mintSystemContext({ job: "test" }), s.org, {
      now: at(39),
    });
    await pb.collection("dns_zones").update(zoneId, { status: "handed_back" });
    await advanceOffboardings({ now: at(39), deps });
    expect((await orgOf(s.org)).closed_reason).toBe("cancelled");
    expect(await hostKinds(s.org)).toEqual(["preview"]);
    expect(mine()).toHaveLength(1);
    expect((await rowOf(s.org)).status).toBe("closed");
  });

  it("the demo org is never offboarded by the job", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site({ demo: true });
    await pb.collection("offboardings").create({
      org_id: s.org,
      status: "notice",
      requested_at: NOW.toISOString(),
      notice_ends_at: NOW.toISOString(),
      steps: { dns_handback: { status: "not_applicable" } },
    });
    await advanceOffboardings({
      now: at(1),
      deps: { billing: createBillingSpy() },
    });
    expect((await orgOf(s.org)).closed_reason).toBe("");
    await expect(closeAtNoticeEnd(s.org, { now: at(1) })).rejects.toThrow(
      /demo/,
    );
  });

  it("retention skips a closed org whose CDS zone is still active and alerts staff once (P14-P27)", async (ctx) => {
    if (!booted) return ctx.skip();
    const s = await site();
    const d = `kept-${tag()}.com`;
    await activeZone(s.org, d);
    await markOrgClosed(superAdmin, s.org, "declined", { now: at(-40) });
    const mail = captureTransport();
    const alerts = () => mail.sent.filter((m) => m.subject.includes(d));
    const r1 = await runRetentionJob({ now: NOW, deps: { transport: mail } });
    expect(r1.zoneSkipped).toBeGreaterThanOrEqual(1);
    expect(r1.deletedOrgs.map((o) => o.id)).not.toContain(s.org);
    expect((await orgOf(s.org)).id).toBe(s.org);
    expect(alerts()).toHaveLength(1);
    const r2 = await runRetentionJob({ now: NOW, deps: { transport: mail } });
    expect(r2.zoneSkipped).toBeGreaterThanOrEqual(1);
    expect(alerts()).toHaveLength(1);
    // Once the zone is handed back, retention deletes the org.
    const zone = await pb
      .collection("dns_zones")
      .getFirstListItem(pb.filter("org_id = {:o}", { o: s.org }));
    await pb.collection("dns_zones").update(zone.id, { status: "handed_back" });
    const r3 = await runRetentionJob({ now: NOW, deps: { transport: mail } });
    expect(r3.deletedOrgs.map((o) => o.id)).toContain(s.org);
  });
});
