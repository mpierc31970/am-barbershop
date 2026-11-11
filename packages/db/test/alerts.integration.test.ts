// 11-20: the alerts write and read path (DASH-34, DASH-35, DASH-36, DASH-37; D285, D305, D313).
// raiseAlert fans one alert out to every eligible member in one batch, deduped per
// (recipient, source_key); emails urgent/normal alerts at once when the channel is on; sends
// push at once unless quiet hours, a same-type push within 10 minutes or the channel is off;
// and never throws. The bell reads are per person and clear themselves against Needs you.
import { randomBytes } from "node:crypto";
import { NotFound } from "@cds/core";
import { CORE_ALERT_TYPES } from "@cds/core/alerts";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bellCount,
  bellCounts,
  listBell,
  markAlertRead,
  markAllRead,
  sourceKeyIsNeedsYouKind,
} from "../src/alerts/list";
import { raiseAlert } from "../src/alerts/raise";
import {
  createFakePushSender,
  setPushSenderForTests,
  type FakePushSender,
} from "../src/alerts/push";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { captureTransport } from "../src/email/transport";
import { setAlertChannel } from "../src/today/prefs";
import { DAY_MS, fakeNow, MINUTE_MS } from "./helpers/fake-clock";
import { bootPb, type PbInstance } from "./pb-harness";

const SYS = mintSystemContext({ job: "test" });

let inst: PbInstance | null = null;
let pb: PocketBase;
let push: FakePushSender;

const tag = () => randomBytes(4).toString("hex");

// America/Chicago is CDT (UTC-5) in October.
const AT_1000 = "2026-10-12T15:00:00.000Z"; // 10:00 business time
const AT_2230 = "2026-10-13T03:30:00.000Z"; // 22:30 business time

type Org = {
  org: string;
  name: string;
  owner: string;
  admin: string;
  editor: string;
  viewer: string;
  emails: Record<string, string>;
  ctx: (
    user: string,
    role: "owner" | "admin" | "editor" | "viewer",
  ) => OrgContext;
};

async function newUser(prefix: string): Promise<{ id: string; email: string }> {
  const password = randomBytes(18).toString("hex");
  const email = `${prefix}-${tag()}@cds.test`;
  const id = (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
    })
  ).id;
  return { id, email };
}

async function newOrg(profile: Record<string, unknown> = {}): Promise<Org> {
  const t = tag();
  const name = `Alerts ${t}`;
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `alerts-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    time_zone: "America/Chicago",
    business_type: "bakery",
    ...profile,
  });
  const emails: Record<string, string> = {};
  const member = async (role: string) => {
    const u = await newUser(role);
    emails[u.id] = u.email;
    await pb
      .collection("memberships")
      .create({ user: u.id, organization: org, role });
    return u.id;
  };
  const owner = await member("owner");
  const admin = await member("admin");
  const editor = await member("editor");
  const viewer = await member("viewer");
  return {
    org,
    name,
    owner,
    admin,
    editor,
    viewer,
    emails,
    ctx: (user, role) =>
      mintOrgContext({
        orgId: org,
        actor: user,
        role,
        grants: [],
        ip: "127.0.0.1",
      }),
  };
}

async function rows(org: string, filter = "") {
  return pb.collection("alerts").getFullList({
    filter: pb.filter(`organization = {:org}${filter ? ` && ${filter}` : ""}`, {
      org,
    }),
    sort: "created",
  });
}

async function subscribe(org: string, user: string): Promise<string> {
  const endpoint = `https://push.example.com/${tag()}`;
  await pb.collection("push_subscriptions").create({
    organization: org,
    user,
    endpoint,
    p256dh: randomBytes(32).toString("hex"),
    auth: randomBytes(8).toString("hex"),
    ua_family: "chrome",
    fail_count: 0,
  });
  return endpoint;
}

function message(id = tag()) {
  return {
    type: "form.message",
    sourceKey: `inbox:${id}`,
    title: `New message from Jane Doe ${id}`,
    safeTitle: "New message",
    href: `/hub/inbox?tab=messages&message=${id}`,
  };
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  push = createFakePushSender();
  setPushSenderForTests(push);
});

afterEach(() => {
  setPushSenderForTests(null);
});

describe("raiseAlert fan-out (DASH-36, D285)", () => {
  it("billing.card_failed reaches the owner only; form.message the owner and admin (contacts:read)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const transport = captureTransport();
    const now = new Date(AT_1000);

    const billing = await raiseAlert(
      { orgId: o.org, as: SYS },
      {
        type: "billing.card_failed",
        sourceKey: "billing:fix_card",
        title: "Your card was declined",
        safeTitle: "Your card was declined",
        href: "/hub/settings?tab=billing",
      },
      { now, transport },
    );
    expect(billing).toEqual({ recipients: 1 });
    const billRows = await rows(o.org, "type = 'billing.card_failed'");
    expect(billRows.map((r) => r.user)).toEqual([o.owner]);
    expect(billRows[0]!.level).toBe("urgent");
    expect(billRows[0]!.section).toBe("settings");

    const msg = await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now,
      transport,
    });
    expect(msg).toEqual({ recipients: 2 });
    const users = (await rows(o.org, "type = 'form.message'"))
      .map((r) => r.user)
      .sort();
    // D285 matrix: contacts:read is owner/admin (staff/renter on Studio); not editor or viewer.
    expect(users).toEqual([o.owner, o.admin].sort());
  });

  it("raising the same sourceKey twice creates no duplicate unread row", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const m = message();
    const deps = { now: new Date(AT_1000), transport: captureTransport() };
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps);
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps);
    expect(await rows(o.org)).toHaveLength(2); // owner + admin, once each
  });

  it("a read alert raised again comes back unread (one row per key)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const m = message();
    const deps = { now: new Date(AT_1000), transport: captureTransport() };
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps);
    const first = (
      await rows(o.org, pb.filter("user = {:u}", { u: o.owner }))
    )[0]!;
    await pb.collection("alerts").update(first.id, { read_at: AT_1000 });
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps);
    const mine = await rows(o.org, pb.filter("user = {:u}", { u: o.owner }));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.read_at).toBe("");
  });

  it("WR-B01: a Needs-you alert left unread and raised again a month later comes back fresh and is pushed", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await subscribe(o.org, o.owner);
    const card = {
      type: "billing.card_failed",
      sourceKey: "billing:fix_card",
      title: "Your payment to CDS failed. Update your card.",
      safeTitle: "Your payment to CDS failed",
      href: "/hub/settings?tab=billing",
    };
    const target = { orgId: o.org, as: SYS };
    const first = await raiseAlert(target, card, {
      now: new Date(AT_1000),
      transport: captureTransport(),
    });
    expect(first).toEqual({ recipients: 1 });
    // A back-to-back duplicate (same event twice) is still dropped.
    expect(
      await raiseAlert(target, card, {
        now: new Date(AT_1000),
        transport: captureTransport(),
      }),
    ).toEqual({ recipients: 0 });
    expect(push.sent).toHaveLength(1);
    const old = (await rows(o.org))[0]!;
    expect(old.read_at).toBe("");

    // The card was fixed without opening the bell; 31 days later it fails again. `created`
    // is the PocketBase clock, so the wall clock moves forward for this raise.
    const later = Date.now() + 31 * DAY_MS;
    const spy = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      const again = await raiseAlert(target, card, {
        now: new Date(Date.parse(AT_1000) + 31 * DAY_MS),
        transport: captureTransport(),
      });
      expect(again).toEqual({ recipients: 1 });
    } finally {
      spy.mockRestore();
    }
    const mine = await rows(o.org);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe(old.id);
    expect(mine[0]!.read_at).toBe("");
    expect(mine[0]!.push_state).toBe("sent");
    expect(push.sent).toHaveLength(2);
    expect(await bellCount(o.ctx(o.owner, "owner"), ["billing:fix_card"])).toBe(
      1,
    );
  });

  it("WR-B07: a target without a minted context writes nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const deps = { now: new Date(AT_1000), transport: captureTransport() };
    for (const forged of [
      { orgId: o.org, system: "billing" },
      { orgId: o.org, as: { job: "billing" } },
      { orgId: o.org },
    ]) {
      await expect(
        raiseAlert(forged as never, message(), deps),
      ).resolves.toEqual({ recipients: 0 });
    }
    expect(await rows(o.org)).toHaveLength(0);
  });

  it("an invalid href or unknown type returns {recipients:0} without throwing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const deps = { now: new Date(AT_1000), transport: captureTransport() };
    await expect(
      raiseAlert(
        o.ctx(o.owner, "owner"),
        { ...message(), href: "https://evil.example/x" },
        deps,
      ),
    ).resolves.toEqual({ recipients: 0 });
    await expect(
      raiseAlert(
        o.ctx(o.owner, "owner"),
        { ...message(), href: "//evil.example" },
        deps,
      ),
    ).resolves.toEqual({ recipients: 0 });
    await expect(
      raiseAlert(
        o.ctx(o.owner, "owner"),
        { ...message(), type: "nope.unknown" },
        deps,
      ),
    ).resolves.toEqual({ recipients: 0 });
    await expect(
      raiseAlert({ orgId: "", as: SYS }, message(), deps),
    ).resolves.toEqual({ recipients: 0 });
    expect(await rows(o.org)).toHaveLength(0);
  });
});

describe("raiseAlert delivery (DASH-35, DASH-36, DASH-37)", () => {
  it("emails urgent/normal alerts when the channel is on, not when the person turned it off", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await setAlertChannel(
      o.ctx(o.admin, "admin"),
      "form.message",
      "email",
      false,
    );
    const transport = captureTransport();
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_1000),
      transport,
    });
    expect(transport.sent.map((m) => m.to)).toEqual([o.emails[o.owner]]);
    expect(transport.sent[0]!.type).toBe("alert.notify");
    expect(transport.sent[0]!.subject).toMatch(/^New message from Jane Doe/);
    const ownerRow = (
      await rows(o.org, pb.filter("user = {:u}", { u: o.owner }))
    )[0]!;
    expect(ownerRow.emailed_at).not.toBe("");
    const adminRow = (
      await rows(o.org, pb.filter("user = {:u}", { u: o.admin }))
    )[0]!;
    expect(adminRow.emailed_at).toBe("");
  });

  it("holds push in quiet hours, sends at 10:00, holds a same-type push 5 minutes later", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    await setAlertChannel(
      o.ctx(o.admin, "admin"),
      "form.message",
      "push",
      false,
    );
    const transport = captureTransport();
    const own = () => rows(o.org, pb.filter("user = {:u}", { u: o.owner }));

    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_2230),
      transport,
    });
    expect(push.sent).toHaveLength(0);
    expect((await own())[0]!.push_state).toBe("held");
    // The admin turned push off: nothing held for later either.
    const adminRow = (
      await rows(o.org, pb.filter("user = {:u}", { u: o.admin }))
    )[0]!;
    expect(adminRow.push_state).toBe("skipped");

    const clock = fakeNow(AT_1000);
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: clock.now(),
      transport,
    });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.endpoint).toBe(endpoint);
    expect(push.sent[0]!.payload).toMatchObject({
      title: o.name,
      org: o.org,
      tag: "form.message",
      urgency: "normal",
    });
    expect(push.sent[0]!.payload.body).toMatch(/^New message from Jane Doe/);
    const sent = (await own()).find((r) => r.push_state === "sent")!;
    expect(sent.pushed_at).not.toBe("");

    clock.advance(5 * MINUTE_MS);
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: clock.now(),
      transport,
    });
    expect(push.sent).toHaveLength(1);
    expect((await own()).map((r) => r.push_state)).toEqual([
      "held",
      "sent",
      "held",
    ]);

    // 11 minutes after the first push the window is closed again.
    clock.advance(6 * MINUTE_MS);
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: clock.now(),
      transport,
    });
    expect(push.sent).toHaveLength(2);
  });

  it("a collapse: false type pushes every alert at once, each with its own tag and the badge", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await subscribe(o.org, o.owner);
    const types = CORE_ALERT_TYPES.map((s) =>
      s.type === "form.message" ? { ...s, collapse: false } : s,
    );
    const transport = captureTransport();
    const clock = fakeNow(AT_1000);
    const a = message();
    await raiseAlert(o.ctx(o.owner, "owner"), a, {
      now: clock.now(),
      transport,
      types,
    });
    clock.advance(2 * MINUTE_MS);
    const b = message();
    await raiseAlert(o.ctx(o.owner, "owner"), b, {
      now: clock.now(),
      transport,
      types,
    });
    expect(push.sent).toHaveLength(2);
    expect(push.sent.map((p) => p.payload.tag)).toEqual([
      `form.message:${a.sourceKey}`,
      `form.message:${b.sourceKey}`,
    ]);
    expect(push.sent[1]!.payload.badge).toBe(2);
    const own = await rows(o.org, pb.filter("user = {:u}", { u: o.owner }));
    expect(own.map((r) => r.push_state)).toEqual(["sent", "sent"]);
  });

  it("a failed push is marked failed; no subscription is skipped", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    push.fail.set(endpoint, "error");
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_1000),
      transport: captureTransport(),
    });
    const byUser = new Map(
      (await rows(o.org)).map((r) => [r.user as string, r]),
    );
    expect(byUser.get(o.owner)!.push_state).toBe("failed");
    expect(byUser.get(o.owner)!.pushed_at).toBe("");
    expect(byUser.get(o.admin)!.push_state).toBe("skipped");
  });

  it("sensitive org: push body and email subject are the safe title; title is the business name", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ business_type: "therapist" });
    await subscribe(o.org, o.owner);
    const transport = captureTransport();
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_1000),
      transport,
    });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.payload.title).toBe(o.name);
    expect(push.sent[0]!.payload.body).toBe("New message");
    expect(transport.sent.length).toBeGreaterThan(0);
    for (const m of transport.sent) {
      expect(m.subject).toBe("New message");
      expect(m.text).not.toContain("Jane Doe");
    }
    // The hub keeps the full title (D305).
    expect((await rows(o.org))[0]!.title).toMatch(/Jane Doe/);
  });

  it("an explicit sensitive_practice off overrides the business type", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({
      business_type: "therapist",
      sensitive_practice: "off",
    });
    await subscribe(o.org, o.owner);
    await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_1000),
      transport: captureTransport(),
    });
    expect(push.sent[0]!.payload.body).toMatch(/Jane Doe/);
  });

  it("summary types write bell rows but never email or push here (digest is the job)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await subscribe(o.org, o.owner);
    const transport = captureTransport();
    const res = await raiseAlert(
      o.ctx(o.owner, "owner"),
      {
        type: "contact.new",
        sourceKey: `contact:${tag()}`,
        title: "New subscriber",
        safeTitle: "New subscriber",
        href: "/hub/inbox",
      },
      { now: new Date(AT_1000), transport },
    );
    expect(res.recipients).toBe(2);
    expect(transport.sent).toHaveLength(0);
    expect(push.sent).toHaveLength(0);
    for (const r of await rows(o.org)) expect(r.push_state).toBe("skipped");
  });

  it("an email failure never reaches the caller", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const res = await raiseAlert(o.ctx(o.owner, "owner"), message(), {
      now: new Date(AT_1000),
      transport: {
        send: () => Promise.reject(new Error("smtp down")),
      },
    });
    expect(res.recipients).toBe(2);
    for (const r of await rows(o.org)) expect(r.emailed_at).toBe("");
  });
});

describe("bell reads (DASH-34, DASH-37; T-11-20-05)", () => {
  const deps = () => ({
    now: new Date(AT_1000),
    transport: captureTransport(),
  });

  it("listBell returns only the caller's rows, newest first", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const a = message();
    const b = message();
    await raiseAlert(o.ctx(o.owner, "owner"), a, deps());
    await raiseAlert(o.ctx(o.owner, "owner"), b, deps());
    const keys = new Set([a.sourceKey, b.sourceKey]);

    const owner = await listBell(o.ctx(o.owner, "owner"), {
      needsYouKeys: keys,
    });
    expect(owner.map((r) => r.title)).toEqual([b.title, a.title]);
    const ownerIds = new Set(owner.map((r) => r.id));
    const admin = await listBell(o.ctx(o.admin, "admin"), {
      needsYouKeys: keys,
    });
    expect(admin).toHaveLength(2);
    for (const r of admin) expect(ownerIds.has(r.id)).toBe(false);
    // The editor got none (D285) and sees none of the others'.
    expect(
      await listBell(o.ctx(o.editor, "editor"), { needsYouKeys: keys }),
    ).toEqual([]);
    expect(owner[0]).toMatchObject({
      type: "form.message",
      level: "normal",
      section: "inbox",
      href: b.href,
      read: false,
      cleared: false,
    });
    expect(owner[0]).not.toHaveProperty("source_key");
    expect(await bellCount(o.ctx(o.owner, "owner"), keys)).toBe(2);
  });

  it("an unread inbox alert whose key left Needs you reads cleared and is not counted", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const m = message();
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps());
    await raiseAlert(
      o.ctx(o.owner, "owner"),
      {
        type: "site.stage",
        sourceKey: "stage:ready_for_review",
        title: "Your site is ready for your review",
        safeTitle: "Your site is ready for your review",
        href: "/hub/today",
      },
      deps(),
    );
    const ctx = o.ctx(o.owner, "owner");
    const done = await listBell(ctx, { needsYouKeys: new Set<string>() });
    const byType = new Map(done.map((r) => [r.type, r]));
    expect(byType.get("form.message")!.cleared).toBe(true);
    // site.stage has no Needs-you item, so it never self-clears.
    expect(byType.get("site.stage")!.cleared).toBe(false);
    expect(await bellCount(ctx, new Set<string>())).toBe(1);
    expect(await bellCount(ctx, [m.sourceKey])).toBe(2);
    // Nothing was written: the row is still unread.
    const row = (
      await rows(
        o.org,
        pb.filter("user = {:u} && type = 'form.message'", { u: o.owner }),
      )
    )[0]!;
    expect(row.read_at).toBe("");
  });

  it("bellCounts names urgent unread alerts", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await raiseAlert(
      { orgId: o.org, as: SYS },
      {
        type: "billing.card_failed",
        sourceKey: "billing:fix_card",
        title: "Your card was declined",
        safeTitle: "Your card was declined",
        href: "/hub/settings?tab=billing",
      },
      deps(),
    );
    await raiseAlert(o.ctx(o.owner, "owner"), message(), deps());
    const ctx = o.ctx(o.owner, "owner");
    const all = (await listBell(ctx, { needsYouKeys: [] })).length;
    expect(all).toBe(2);
    expect(await bellCounts(ctx, ["billing:fix_card"])).toEqual({
      unread: 1,
      urgent: 1,
    });
  });

  it("markAlertRead marks own rows; a colleague's id is NotFound; markAllRead clears the rest", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const a = message();
    const b = message();
    await raiseAlert(o.ctx(o.owner, "owner"), a, deps());
    await raiseAlert(o.ctx(o.owner, "owner"), b, deps());
    const keys = [a.sourceKey, b.sourceKey];
    const owner = o.ctx(o.owner, "owner");
    const admin = o.ctx(o.admin, "admin");
    const [first] = await listBell(owner, { needsYouKeys: keys });
    const adminRows = await listBell(admin, { needsYouKeys: keys });

    await expect(markAlertRead(admin, first!.id)).rejects.toThrow(NotFound);
    await expect(markAlertRead(owner, adminRows[0]!.id)).rejects.toThrow(
      NotFound,
    );
    await expect(markAlertRead(owner, "nope")).rejects.toThrow(NotFound);

    await markAlertRead(owner, first!.id);
    const after = await listBell(owner, { needsYouKeys: keys });
    expect(after.find((r) => r.id === first!.id)!.read).toBe(true);
    expect(await bellCount(owner, keys)).toBe(1);
    // The admin's rows are untouched.
    expect(await bellCount(admin, keys)).toBe(2);

    expect(await markAllRead(owner)).toEqual({ marked: 1 });
    expect(await bellCount(owner, keys)).toBe(0);
    expect(await bellCount(admin, keys)).toBe(2);
  });

  it("other orgs never see the rows; impersonating staff see no bell and cannot mark", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const other = await newOrg();
    const m = message();
    await raiseAlert(o.ctx(o.owner, "owner"), m, deps());
    const [mine] = await listBell(o.ctx(o.owner, "owner"), {
      needsYouKeys: [m.sourceKey],
    });

    // Same user id as a member of another org: org scoping still holds.
    const foreign = mintOrgContext({
      orgId: other.org,
      actor: o.owner,
      role: "owner",
      grants: [],
      ip: "127.0.0.1",
    });
    expect(await listBell(foreign, { needsYouKeys: [m.sourceKey] })).toEqual(
      [],
    );
    await expect(markAlertRead(foreign, mine!.id)).rejects.toThrow(NotFound);

    const staff = mintOrgContext({
      orgId: o.org,
      actor: o.owner,
      role: "owner",
      grants: [],
      impersonator: other.owner,
      ip: "10.0.0.9",
    });
    expect(await listBell(staff, { needsYouKeys: [m.sourceKey] })).toEqual([]);
    expect(await bellCount(staff, [m.sourceKey])).toBe(0);
    await markAlertRead(staff, mine!.id); // silently refused
    expect(await markAllRead(staff)).toEqual({ marked: 0 });
    expect(await bellCount(o.ctx(o.owner, "owner"), [m.sourceKey])).toBe(1);
  });

  it("sourceKeyIsNeedsYouKind covers core Needs-you types and add-on keys", () => {
    expect(sourceKeyIsNeedsYouKind("form.message", "inbox:abc")).toBe(true);
    expect(
      sourceKeyIsNeedsYouKind("billing.card_failed", "billing:fix_card"),
    ).toBe(true);
    expect(sourceKeyIsNeedsYouKind("site.stage", "stage:live")).toBe(false);
    expect(sourceKeyIsNeedsYouKind("cds.notice", "cds:1")).toBe(false);
    expect(
      sourceKeyIsNeedsYouKind("appointments.request", "appointments:r1"),
    ).toBe(true);
    expect(
      sourceKeyIsNeedsYouKind("appointments.request", "billing:fix_card"),
    ).toBe(false);
  });
});

// 12-05: support alerts reuse raiseAlert (RESEARCH Pattern 4; Pitfalls 3-4; D97).
describe("raiseAlert audience, renotify and CDS Support email (12-05)", () => {
  const reply = (n = 1042) => ({
    type: "support.reply",
    sourceKey: `support:ticket:${n}`,
    title: `CDS replied to ticket #${n}`,
    safeTitle: `CDS replied to ticket #${n}`,
    href: `/hub/support/tickets/${n}`,
  });
  const vars = (n = 1042) => ({
    type: "support.notify" as const,
    vars: {
      kind: "support.reply" as const,
      business: "Rivera Bakery",
      ticket: { number: n, subject: "Menu photo" },
      excerpt: "Fixed.",
      href: `https://cds.needtobeedgy.com/hub/support/tickets/${n}`,
    },
  });

  it("audience {users:[editor]} reaches only that editor", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const res = await raiseAlert(
      { orgId: o.org, as: SYS },
      { ...reply(), audience: { users: [o.editor] } },
      { now: new Date(AT_1000), transport: captureTransport() },
    );
    expect(res).toEqual({ recipients: 1 });
    expect((await rows(o.org)).map((r) => r.user)).toEqual([o.editor]);
  });

  it("audience users + roles: filer plus owner/admin; viewers never (eligibleFor)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await raiseAlert(
      { orgId: o.org, as: SYS },
      {
        ...reply(),
        audience: { users: [o.editor, o.viewer], roles: ["owner", "admin"] },
      },
      { now: new Date(AT_1000), transport: captureTransport() },
    );
    expect((await rows(o.org)).map((r) => r.user).sort()).toEqual(
      [o.owner, o.admin, o.editor].sort(),
    );
  });

  it("renotify: two raises a minute apart give one unread row and two emails", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const transport = captureTransport();
    const target = { orgId: o.org, as: SYS };
    const input = { ...reply(), audience: { users: [o.editor] } };
    await raiseAlert(target, input, {
      now: new Date(AT_1000),
      transport,
      renotify: true,
      cdsEmail: vars(),
    });
    const first = (await rows(o.org))[0]!;
    await raiseAlert(target, input, {
      now: new Date(Date.parse(AT_1000) + MINUTE_MS),
      transport,
      renotify: true,
      cdsEmail: vars(),
    });
    const mine = await rows(o.org);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe(first.id);
    expect(mine[0]!.read_at).toBe("");
    expect(transport.sent).toHaveLength(2);
  });

  it("without renotify the second raise is deduped (unchanged)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const transport = captureTransport();
    const target = { orgId: o.org, as: SYS };
    const input = { ...reply(), audience: { users: [o.editor] } };
    await raiseAlert(target, input, { now: new Date(AT_1000), transport });
    const again = await raiseAlert(target, input, {
      now: new Date(Date.parse(AT_1000) + MINUTE_MS),
      transport,
    });
    expect(again).toEqual({ recipients: 0 });
    expect(await rows(o.org)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it("cdsEmail sends support.notify as CDS Support, no-reply, with no Reply-To", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const transport = captureTransport();
    let emailed = 0;
    await raiseAlert(
      { orgId: o.org, as: SYS },
      { ...reply(), audience: { users: [o.editor] } },
      {
        now: new Date(AT_1000),
        transport,
        renotify: true,
        cdsEmail: vars(),
        onEmailed: () => {
          emailed += 1;
        },
      },
    );
    expect(emailed).toBe(1);
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.type).toBe("support.notify");
    expect(m.to).toBe(o.emails[o.editor]);
    expect(m.fromName).toBe("CDS Support");
    expect(m.fromAddress.startsWith("no-reply@")).toBe(true);
    expect(m.replyTo).toBeNull();
    expect(m.orgId).toBeNull();
    expect(m.subject).toBe("CDS replied to ticket #1042");
    expect((await rows(o.org))[0]!.emailed_at).not.toBe("");
  });

  it("support and cds message kinds are Needs-you kinds; cds.document is not", () => {
    expect(
      sourceKeyIsNeedsYouKind("support.reply", "support:ticket:1042"),
    ).toBe(true);
    expect(
      sourceKeyIsNeedsYouKind("support.status", "support:ticket:1042"),
    ).toBe(true);
    expect(sourceKeyIsNeedsYouKind("cds.message", "support:messages")).toBe(
      true,
    );
    expect(sourceKeyIsNeedsYouKind("cds.note", "support:messages")).toBe(true);
    expect(sourceKeyIsNeedsYouKind("cds.document", "cds:document:d1")).toBe(
      false,
    );
    // "support" is a core prefix, never mistaken for an add-on slug.
    expect(sourceKeyIsNeedsYouKind("support.other", "support:x")).toBe(false);
  });
});
