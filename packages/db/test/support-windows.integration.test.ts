// 12-08: service windows (COMM-11; D99-D101, P12-P6, P12-P8, P12-P10). Role-scoped creation,
// notices that reach only the right orgs, dismissal per person, one cds.notice per reached
// org stamped in alerted_at (T-12-08-03, T-12-08-04, T-12-08-05).
import { Forbidden, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { resetLockCacheForTests } from "../src/support/lock";
import {
  activeServiceNotices,
  jobClearEndedWindows,
  jobStartServiceWindows,
  staffClearServiceWindow,
  staffCreateServiceWindow,
  staffListServiceWindows,
} from "../src/support/windows";
import { markDismissed } from "../src/today/prefs";
import { bootPb, type PbInstance } from "./pb-harness";
import { fixedClock } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;

const AT = "2026-10-12T15:00:00.000Z";
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.parse(AT) + ms);
const ADDONS = [
  { slug: "booking", name: "Booking" },
  { slug: "fixture-seed", name: "Fixture seed" },
];

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb, { now: new Date(AT) });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetLockCacheForTests();
});

/** One raise = one bell row per person; returns the rows after checking no person has two. */
async function noticeRows(org: string, windowId: string) {
  const rows = await pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && source_key = {:key}", {
      org,
      key: `cds:notice:${windowId}`,
    }),
  });
  const people = new Set(rows.map((r) => String(r.user)));
  expect(people.size).toBe(rows.length);
  for (const r of rows) {
    expect(r.type).toBe("cds.notice");
    expect(r.level).toBe("urgent");
  }
  return rows;
}

describe("service windows (COMM-11)", () => {
  let orgWindow = "";

  it("support_agent creates an organization window: code W-1, audited", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const made = await staffCreateServiceWindow(
      seed.staff.agent,
      {
        scope: "organization",
        orgId: seed.A.org,
        message: "Moving your site to a faster server.",
        startsAt: at(-HOUR),
        endsAt: at(2 * HOUR),
      },
      { clock, notify: { transport: captureTransport() } },
    );
    expect(made.code).toBe("W-1");
    orgWindow = made.id;
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'platform.service_window_set' && target_id = {:id}",
        {
          id: made.id,
        },
      ),
    });
    expect(audit).toHaveLength(1);
    // Already started and org-wide: alerted at creation (P12-P8).
    expect(made.alerted).toBe(1);
    const rowsA = await noticeRows(seed.A.org, made.id);
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA[0]?.title).toMatch(/^CDS is working on your site until /);
    expect(await noticeRows(seed.B.org, made.id)).toHaveLength(0);
    const row = await pb.collection("service_windows").getOne(made.id);
    expect(String(row.alerted_at)).not.toBe("");
  });

  it("support_agent may not create platform or add-on windows (D100)", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    await expect(
      staffCreateServiceWindow(
        seed.staff.agent,
        { scope: "platform", endsAt: at(HOUR) },
        { clock },
      ),
    ).rejects.toThrow(Forbidden);
    await expect(
      staffCreateServiceWindow(
        seed.staff.agent,
        { scope: "addon", addon: "booking", endsAt: at(HOUR) },
        { clock, addons: ADDONS },
      ),
    ).rejects.toThrow(Forbidden);
  });

  it("validates scope fields, message length and span", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const sa = seed.staff.superAdmin;
    const bad = [
      { scope: "addon", addon: "nope", endsAt: at(HOUR) },
      {
        scope: "page",
        orgId: seed.A.org,
        pageId: seed.B.livePage,
        endsAt: at(HOUR),
      },
      {
        scope: "component",
        orgId: seed.A.org,
        component: "sidebar",
        endsAt: at(HOUR),
      },
      {
        scope: "organization",
        orgId: seed.A.org,
        message: "x".repeat(281),
        endsAt: at(HOUR),
      },
      {
        scope: "organization",
        orgId: seed.A.org,
        startsAt: at(HOUR),
        endsAt: at(HOUR),
      },
      {
        scope: "organization",
        orgId: seed.A.org,
        endsAt: at(15 * 24 * HOUR),
      },
    ] as const;
    for (const input of bad) {
      await expect(
        staffCreateServiceWindow(sa, input, { clock, addons: ADDONS }),
      ).rejects.toThrow();
    }
    await expect(
      staffCreateServiceWindow(
        sa,
        { scope: "addon", addon: "booking", endsAt: at(HOUR) },
        { clock },
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("notices: org A sees its window, org B never does (T-12-08-04)", async (t) => {
    if (!inst) return t.skip();
    const now = at(0);
    const a = await activeServiceNotices(seed.A.ctx.editor, {
      activeAddons: [],
      now,
    });
    const mine = a.find((n) => n.id === orgWindow);
    expect(mine?.phase).toBe("active");
    expect(mine?.text).toContain("CDS is working on your site until");
    expect(mine?.text).toContain("Moving your site to a faster server.");
    const b = await activeServiceNotices(seed.B.ctx.owner, {
      activeAddons: [],
      now,
    });
    expect(b.some((n) => n.id === orgWindow)).toBe(false);
  });

  it("an add-on window reaches an org only when that add-on is active", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const made = await staffCreateServiceWindow(
      seed.staff.superAdmin,
      {
        scope: "addon",
        addon: "booking",
        startsAt: at(-HOUR),
        endsAt: at(HOUR),
      },
      { clock, addons: ADDONS, notify: { transport: captureTransport() } },
    );
    const on = await activeServiceNotices(seed.A.ctx.owner, {
      activeAddons: ["booking"],
      now: at(0),
      addonNames: { booking: "Booking" },
    });
    const n = on.find((x) => x.id === made.id);
    expect(n?.text).toContain("CDS is working on Booking until");
    const off = await activeServiceNotices(seed.A.ctx.owner, {
      activeAddons: ["fixture-seed"],
      now: at(0),
    });
    expect(off.some((x) => x.id === made.id)).toBe(false);
    // Nobody seeded has booking active: nobody was alerted.
    expect(made.alerted).toBe(0);
  });

  it("a window starting in 23 h is upcoming; dismissal hides it for that person only", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const made = await staffCreateServiceWindow(
      seed.staff.agent,
      {
        scope: "page",
        orgId: seed.A.org,
        pageId: seed.A.livePage,
        startsAt: at(23 * HOUR),
        endsAt: at(25 * HOUR),
      },
      { clock },
    );
    const before = await activeServiceNotices(seed.A.ctx.owner, {
      activeAddons: [],
      now: at(0),
    });
    const up = before.find((x) => x.id === made.id);
    expect(up?.phase).toBe("upcoming");
    expect(up?.dismissible).toBe(true);
    expect(up?.text).toContain("Planned work on your About page");
    // Active notices sort before upcoming ones.
    expect(before[0]?.phase).toBe("active");

    await markDismissed(seed.A.ctx.owner, `notice:${made.id}`);
    const owner = await activeServiceNotices(seed.A.ctx.owner, {
      activeAddons: [],
      now: at(0),
    });
    expect(owner.some((x) => x.id === made.id)).toBe(false);
    const editor = await activeServiceNotices(seed.A.ctx.editor, {
      activeAddons: [],
      now: at(0),
    });
    expect(editor.some((x) => x.id === made.id)).toBe(true);
    // 25 h out: not yet shown at all.
    const far = await activeServiceNotices(seed.A.ctx.editor, {
      activeAddons: [],
      now: at(-2 * HOUR),
    });
    expect(far.some((x) => x.id === made.id)).toBe(false);
  });

  it("jobStartServiceWindows: one cds.notice per reached org, then a no-op", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const made = await staffCreateServiceWindow(
      seed.staff.superAdmin,
      {
        scope: "platform",
        message: "Database upgrade.",
        startsAt: at(HOUR),
        endsAt: at(3 * HOUR),
      },
      { clock },
    );
    expect(made.alerted).toBe(0);
    const transport = captureTransport();
    const first = await jobStartServiceWindows(at(2 * HOUR), { transport });
    expect(first.windows).toBeGreaterThanOrEqual(1);
    const a1 = await noticeRows(seed.A.org, made.id);
    const b1 = await noticeRows(seed.B.org, made.id);
    expect(a1.length).toBeGreaterThan(0);
    expect(b1.length).toBeGreaterThan(0);
    expect(first.alerted).toBeGreaterThanOrEqual(2);
    const second = await jobStartServiceWindows(at(2 * HOUR), { transport });
    expect(second).toEqual({ windows: 0, alerted: 0 });
    expect(await noticeRows(seed.A.org, made.id)).toHaveLength(a1.length);
    expect(transport.sent.length).toBeGreaterThan(0);
  });

  it("two concurrent start runs alert a window once (12-REVIEW WR-A05)", async (t) => {
    if (!inst) return t.skip();
    const made = await staffCreateServiceWindow(
      seed.staff.superAdmin,
      {
        scope: "platform",
        message: "Second upgrade.",
        startsAt: at(4 * HOUR),
        endsAt: at(6 * HOUR),
      },
      { clock: fixedClock(AT) },
    );
    const transport = captureTransport();
    const [x, y] = await Promise.all([
      jobStartServiceWindows(at(5 * HOUR), { transport }, made.id),
      jobStartServiceWindows(at(5 * HOUR), { transport }),
    ]);
    expect(x.windows + y.windows).toBe(1);
    expect(x.alerted === 0 || y.alerted === 0).toBe(true);
    const subjects = transport.sent.map((m) => `${m.to} ${m.subject}`);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(
      (await pb.collection("service_windows").getOne(made.id)).alerted_at,
    ).not.toBe("");
  });

  it("a platform window never reaches a closed site (12-REVIEW WR-A01)", async (t) => {
    if (!inst) return t.skip();
    const closed = (
      await pb.collection("organizations").create({
        name: "Closed Co",
        slug: `closed-${Date.now().toString(36)}`,
        status: "disabled",
        closed_reason: "cancelled",
        closed_at: AT,
      })
    ).id;
    const pw = `pw-${Math.random().toString(36).slice(2)}-Aa1!`;
    const member = (
      await pb.collection("users").create({
        email: `closed-${closed}@cds.test`,
        password: pw,
        passwordConfirm: pw,
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: member, organization: closed, role: "owner" });
    const made = await staffCreateServiceWindow(
      seed.staff.superAdmin,
      {
        scope: "platform",
        message: "Network move.",
        startsAt: at(-HOUR),
        endsAt: at(HOUR),
      },
      { clock: fixedClock(AT), notify: { transport: captureTransport() } },
    );
    expect(await noticeRows(closed, made.id)).toHaveLength(0);
    expect((await noticeRows(seed.A.org, made.id)).length).toBeGreaterThan(0);
  });

  it("page windows never raise a notice", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const made = await staffCreateServiceWindow(
      seed.staff.agent,
      {
        scope: "page",
        orgId: seed.B.org,
        pageId: seed.B.livePage,
        startsAt: at(-HOUR),
        endsAt: at(HOUR),
      },
      { clock },
    );
    expect(made.alerted).toBe(0);
    await jobStartServiceWindows(at(0), { transport: captureTransport() });
    expect(await noticeRows(seed.B.org, made.id)).toHaveLength(0);
  });

  it("list, clear by code and the clear-ended job", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock(AT);
    const list = await staffListServiceWindows(seed.staff.agent, {}, clock);
    const w1 = list.find((w) => w.code === "W-1");
    expect(w1?.scope).toBe("organization");
    expect(w1?.phase).toBe("active");

    // support_agent cannot clear a platform window.
    const platform = list.find((w) => w.scope === "platform");
    expect(platform).toBeTruthy();
    await expect(
      staffClearServiceWindow(seed.staff.agent, { id: platform!.id }, clock),
    ).rejects.toThrow(Forbidden);

    const cleared = await staffClearServiceWindow(
      seed.staff.agent,
      { code: "W-1" },
      clock,
    );
    expect(cleared).toMatchObject({ code: "W-1", cleared: true });
    const after = await staffListServiceWindows(seed.staff.agent, {}, clock);
    expect(after.some((w) => w.code === "W-1")).toBe(false);
    const all = await staffListServiceWindows(
      seed.staff.agent,
      { includeEnded: true },
      clock,
    );
    expect(all.find((w) => w.code === "W-1")?.phase).toBe("ended");
    const notices = await activeServiceNotices(seed.A.ctx.owner, {
      activeAddons: [],
      now: at(0),
    });
    expect(notices.some((n) => n.id === orgWindow)).toBe(false);

    const ended = await jobClearEndedWindows(at(30 * HOUR));
    expect(ended.cleared).toBeGreaterThanOrEqual(1);
    expect((await jobClearEndedWindows(at(30 * HOUR))).cleared).toBe(0);
  });
});
