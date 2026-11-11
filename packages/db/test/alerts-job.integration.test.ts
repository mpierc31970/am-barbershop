// 11-23: the every-5-minutes alert job (DASH-35, DASH-36; D313). Held pushes are released as
// one push per person when quiet hours end; a burst of one type collapses into "3 new
// messages"; the 7am morning summary goes out once per business day and never empty; the
// job writes a heartbeat; a dry run writes nothing. Rows are inserted directly (the write
// path is covered by alerts.integration.test.ts). The clock is real-time relative: the job
// reads `created` (stamped by PocketBase), so each case runs at the next matching business
// time after the rows were written (always within 24 h).
import { randomBytes } from "node:crypto";
import { zonedMinutes } from "@cds/core/today";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  collapsedPushBody,
  digestLines,
  runAlertJobs,
} from "../src/alerts/jobs";
import {
  createFakePushSender,
  setPushSenderForTests,
  type FakePushSender,
} from "../src/alerts/push";
import { CORE_ALERT_TYPES } from "@cds/core/alerts";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { readPlatformMeta } from "../src/platform-meta";
import { DAY_MS, fakeNow, MINUTE_MS } from "./helpers/fake-clock";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let push: FakePushSender;

const TZ = "America/Chicago";
const tag = () => randomBytes(4).toString("hex");

/** The next instant after `from` whose business-local time is hh:mm. */
function nextLocal(hh: number, mm: number, from = Date.now()): Date {
  const target = hh * 60 + mm;
  let t = Math.ceil((from + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i < 2 * 24 * 60; i += 1) {
    if (zonedMinutes(new Date(t), TZ) === target) return new Date(t);
    t += MINUTE_MS;
  }
  throw new Error("no matching local time");
}

type Org = { org: string; name: string; owner: string; ownerEmail: string };

async function newOrg(profile: Record<string, unknown> = {}): Promise<Org> {
  const t = tag();
  const name = `Alert job ${t}`;
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `alert-job-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    time_zone: TZ,
    business_type: "bakery",
    ...profile,
  });
  const password = randomBytes(18).toString("hex");
  const ownerEmail = `owner-${t}@cds.test`;
  const owner = (
    await pb.collection("users").create({
      email: ownerEmail,
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  return { org, name, owner, ownerEmail };
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

async function heldMessage(o: Org, n: number): Promise<void> {
  const id = tag();
  await pb.collection("alerts").create({
    organization: o.org,
    user: o.owner,
    type: "form.message",
    level: "normal",
    title: `New message from Jane Doe ${n}`,
    safe_title: "New message",
    href: `/hub/inbox?tab=messages&message=${id}`,
    section: "inbox",
    source_key: `inbox:${id}`,
    push_state: "held",
  });
}

async function summaryAlert(
  o: Org,
  type: "contact.new" | "reports.monthly",
  title: string,
): Promise<void> {
  await pb.collection("alerts").create({
    organization: o.org,
    user: o.owner,
    type,
    level: "summary",
    title,
    safe_title: "New contact",
    href: "/hub/marketing?tab=contacts",
    section: "inbox",
    source_key: `contact:${tag()}`,
    push_state: "skipped",
  });
}

async function rows(org: string) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "created",
  });
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

describe("pure helpers", () => {
  it("collapsed push copy and digest lines", () => {
    expect(collapsedPushBody(3, "form.message")).toBe("3 new messages");
    expect(collapsedPushBody(2, null)).toBe("2 new alerts");
    expect(collapsedPushBody(2, "unknown.type")).toBe("2 new alerts");
    const lines = digestLines(
      [
        { type: "contact.new", title: "New contact: Ana" },
        { type: "contact.new", title: "New contact: Ben" },
      ],
      CORE_ALERT_TYPES,
    );
    expect(lines).toEqual([
      {
        text: "New contacts and subscribers: 2",
        safeText: "New contacts and subscribers: 2",
        count: 2,
      },
    ]);
    expect(
      digestLines([{ type: "contact.new", title: "New contact: Ana" }], [])[0],
    ).toEqual({
      text: "New contact: Ana",
      safeText: "New updates: 1",
      count: 1,
    });
  });
});

describe("runAlertJobs: held pushes (DASH-36)", () => {
  it("at 23:00 business time held pushes stay held", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    for (const n of [1, 2, 3]) await heldMessage(o, n);
    const clock = fakeNow(nextLocal(23, 0));

    const res = await runAlertJobs({ now: clock.now(), push });
    expect(res.busy).toBe(false);
    expect(res.heldQuiet).toBeGreaterThanOrEqual(3);
    expect(push.sent.filter((p) => p.endpoint === endpoint)).toEqual([]);
    expect((await rows(o.org)).map((r) => r.push_state)).toEqual([
      "held",
      "held",
      "held",
    ]);
  });

  it("dry run at 07:05 reports the release and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    for (const n of [1, 2]) await heldMessage(o, n);
    const clock = fakeNow(nextLocal(7, 5));
    const before = await readPlatformMeta("job:alerts:last_counts");

    const res = await runAlertJobs({ now: clock.now(), push, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.pushSent).toBeGreaterThanOrEqual(1);
    expect(res.collapsed).toBeGreaterThanOrEqual(1);
    expect(push.sent.filter((p) => p.endpoint === endpoint)).toEqual([]);
    expect((await rows(o.org)).every((r) => r.push_state === "held")).toBe(
      true,
    );
    expect(await readPlatformMeta("job:alerts:last_counts")).toBe(before);
    // Leave nothing held for the next cases.
    for (const r of await rows(o.org))
      await pb.collection("alerts").delete(r.id);
  });

  it("at 07:05 three held messages go out as ONE push '3 new messages', all sent; heartbeat written", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    for (const n of [1, 2, 3]) await heldMessage(o, n);
    const clock = fakeNow(nextLocal(7, 5));

    const res = await runAlertJobs({ now: clock.now(), push });
    expect(res.failedSteps).toEqual([]);
    const mine = push.sent.filter((p) => p.endpoint === endpoint);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toMatchObject({
      title: o.name,
      org: o.org,
      body: "3 new messages",
      href: "/hub/inbox",
      tag: "form.message",
      urgency: "normal",
    });
    const after = await rows(o.org);
    expect(after.map((r) => r.push_state)).toEqual(["sent", "sent", "sent"]);
    expect(after.every((r) => r.pushed_at !== "")).toBe(true);
    expect(res.collapsed).toBeGreaterThanOrEqual(1);
    expect(res.released).toBeGreaterThanOrEqual(3);

    expect(await readPlatformMeta("job:alerts:last_success")).toBe(
      clock.now().toISOString(),
    );
    const counts = JSON.parse(
      (await readPlatformMeta("job:alerts:last_counts")) ?? "{}",
    ) as Record<string, unknown>;
    expect(counts.pushSent).toBe(res.pushSent);

    // A new held message 2 minutes later waits for the 10-minute window to close.
    await heldMessage(o, 4);
    clock.advance(2 * MINUTE_MS);
    const again = await runAlertJobs({ now: clock.now(), push });
    expect(again.heldCollapse).toBeGreaterThanOrEqual(1);
    expect(push.sent.filter((p) => p.endpoint === endpoint)).toHaveLength(1);
    // After the window it goes out on its own, with its own title.
    clock.advance(10 * MINUTE_MS);
    await runAlertJobs({ now: clock.now(), push });
    const all = push.sent.filter((p) => p.endpoint === endpoint);
    expect(all).toHaveLength(2);
    expect(all[1]!.payload.body).toBe("New message from Jane Doe 4");
  });

  it("sensitive practice: a single released push shows the safe title only", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ business_type: "therapist" });
    const endpoint = await subscribe(o.org, o.owner);
    await heldMessage(o, 1);
    await runAlertJobs({ now: nextLocal(7, 5), push });
    const mine = push.sent.filter((p) => p.endpoint === endpoint);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload.body).toBe("New message");
    expect(JSON.stringify(mine[0]!.payload)).not.toContain("Jane");
  });

  it("IN-B03: a held alert already read in the bell is skipped, not pushed at 7am", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const endpoint = await subscribe(o.org, o.owner);
    await heldMessage(o, 1);
    await heldMessage(o, 2);
    // By title, not position: two rows created in the same millisecond tie on `created`.
    const first = (await rows(o.org)).find(
      (r) => r.title === "New message from Jane Doe 1",
    );
    await pb
      .collection("alerts")
      .update(first!.id, { read_at: new Date().toISOString() });
    await runAlertJobs({ now: nextLocal(7, 5), push });
    const mine = push.sent.filter((p) => p.endpoint === endpoint);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload.body).toBe("New message from Jane Doe 2");
    const after = new Map((await rows(o.org)).map((r) => [r.id, r]));
    expect(after.get(first!.id)!.push_state).toBe("skipped");
  });

  it("no device: held rows become skipped", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await heldMessage(o, 1);
    await runAlertJobs({ now: nextLocal(7, 5), push });
    expect((await rows(o.org)).map((r) => r.push_state)).toEqual(["skipped"]);
  });
});

describe("runAlertJobs: morning summary (DASH-35)", () => {
  it("at 07:05 two new contacts become one alerts.digest email; a second run the same day sends nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await summaryAlert(o, "contact.new", "New contact: Ana Lopez");
    await summaryAlert(o, "contact.new", "New contact: Ben Ito");
    const transport = captureTransport();
    const clock = fakeNow(nextLocal(7, 5));

    const res = await runAlertJobs({ now: clock.now(), push, transport });
    expect(res.failedSteps).toEqual([]);
    const mine = transport.sent.filter((m) => m.to === o.ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe(`Your morning summary for ${o.name}`);
    expect(mine[0]!.text).toContain("New contacts and subscribers: 2");
    expect((await rows(o.org)).every((r) => r.emailed_at !== "")).toBe(true);

    // Same business day, a new contact arrives: it waits for tomorrow's summary.
    await summaryAlert(o, "contact.new", "New contact: Cy Park");
    clock.advance(30 * MINUTE_MS);
    await runAlertJobs({ now: clock.now(), push, transport });
    expect(transport.sent.filter((m) => m.to === o.ownerEmail)).toHaveLength(1);

    // Next day at 07:05 it goes out, with its own title.
    clock.advance(DAY_MS - 30 * MINUTE_MS);
    await runAlertJobs({ now: clock.now(), push, transport });
    const later = transport.sent.filter((m) => m.to === o.ownerEmail);
    expect(later).toHaveLength(2);
    expect(later[1]!.text).toContain("New contact: Cy Park");
  });

  it("before 07:00 nothing is sent", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await summaryAlert(o, "contact.new", "New contact: Ana Lopez");
    const transport = captureTransport();
    await runAlertJobs({ now: nextLocal(6, 55), push, transport });
    expect(transport.sent.filter((m) => m.to === o.ownerEmail)).toEqual([]);
  });

  it("nothing to say (only a non-digest summary type): no email, counted as skipped empty", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await summaryAlert(o, "reports.monthly", "Your site this month");
    const transport = captureTransport();
    const res = await runAlertJobs({ now: nextLocal(7, 5), push, transport });
    expect(transport.sent.filter((m) => m.to === o.ownerEmail)).toEqual([]);
    expect(res.digestsSkippedEmpty).toBeGreaterThanOrEqual(1);
  });

  it("sensitive practice: counts only, never a client name", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg({ sensitive_practice: "on" });
    await summaryAlert(o, "contact.new", "New contact: Ana Lopez");
    const transport = captureTransport();
    await runAlertJobs({ now: nextLocal(7, 5), push, transport });
    const mine = transport.sent.filter((m) => m.to === o.ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("New contacts and subscribers: 1");
    expect(mine[0]!.text).not.toContain("Ana");
    expect(mine[0]!.html).not.toContain("Ana");
  });
});

describe("runAlertJobs: prune", () => {
  it("deletes read alerts after 90 days and any alert after 180 days", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await summaryAlert(o, "contact.new", "Old unread");
    await summaryAlert(o, "contact.new", "Old read");
    const [unread, read] = await rows(o.org);
    await pb.collection("alerts").update(read!.id, { read_at: new Date() });

    const at91 = new Date(Date.now() + 91 * DAY_MS);
    const dry = await runAlertJobs({ now: at91, push, dryRun: true });
    expect(dry.pruned).toBeGreaterThanOrEqual(1);
    expect(await rows(o.org)).toHaveLength(2);

    await runAlertJobs({ now: at91, push });
    expect((await rows(o.org)).map((r) => r.id)).toEqual([unread!.id]);

    await runAlertJobs({ now: new Date(Date.now() + 181 * DAY_MS), push });
    expect(await rows(o.org)).toEqual([]);
  });
});
