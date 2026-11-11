// 13-47: staff Today counts and Find on the real PocketBase binary (STAFF-20, STAFF-26; D292,
// P13-P10, P13-P32). One ranked work list over the existing reads (missed SLA first), badges
// from the same counts, a failing source marked "Couldn't count", and Find by ticket number,
// case ref and business name.
import "@cds/addon-registry/server";
import { businessDeadline } from "@cds/core/support";
import { queueFor, QUEUE_MAP } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import { staffFind } from "../src/staff/find";
import { staffCreateCase } from "../src/staff/review";
import { staffTodayCounts, type StaffTodayFeeders } from "../src/staff/today";
import { fileTicket } from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
const START = new Date();
let now: Date;
let missedA = 0;
let missedB = 0;
let reportRef = "";

/** Health in a fresh test PocketBase can warn (never-run jobs); keep it quiet where asked. */
const quietHealth: Partial<StaffTodayFeeders> = {
  health: async () => ({ critical: 0, warn: 0, jobsLate: 0 }),
};

const QUEUE_KINDS = new Set(Object.keys(QUEUE_MAP));

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb, { now: START });
  await pb
    .collection("organizations")
    .update(s.A.org, { name: "Bella Rivera Studio" });
  clearResolverCache();
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

describe("nothing needs attention", () => {
  it("rows are empty and every badge is 0", async (t) => {
    if (!inst) return t.skip();
    const res = await staffTodayCounts(s.staff.agent, {
      now: START,
      feeders: quietHealth,
    });
    expect(res.failed).toEqual([]);
    expect(res.rows).toEqual([]);
    expect(res.badges).toEqual({
      tickets: 0,
      pipeline: 0,
      review: 0,
      health: 0,
    });
    expect(res.status.openTickets).toBe(0);
    expect(res.status.jobsLate).toBe(0);
  });

  it("the real Health source reads without failing", async (t) => {
    if (!inst) return t.skip();
    const res = await staffTodayCounts(s.staff.agent, { now: START });
    expect(res.failed).toEqual([]);
    expect(typeof res.status.jobsLate).toBe("number");
    for (const r of res.rows) expect(r.kind).toBe("health");
  });
});

describe("seeded attention", () => {
  beforeAll(async () => {
    if (!inst) return;
    const clock = { now: () => START };
    missedA = (
      await fileTicket(
        s.A.ctx.editor,
        { type: "problem", subject: "Menu photo is blurry", body: "Blurry." },
        { clock },
      )
    ).number;
    missedB = (
      await fileTicket(
        s.B.ctx.editor,
        { type: "question", subject: "Holiday hours", body: "When?" },
        { clock },
      )
    ).number;
    const rated = (
      await fileTicket(
        s.A.ctx.editor,
        { type: "change", subject: "New logo", body: "Swap it." },
        { clock },
      )
    ).number;
    const threadA = await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("number = {:n}", { n: missedA }));
    await pb
      .collection("support_threads")
      .update(threadA.id, { assignee: s.staff.agentUser });
    const threadRated = await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("number = {:n}", { n: rated }));
    await pb.collection("support_threads").update(threadRated.id, {
      status: "closed",
      rating: "down",
      rating_comment: "Still wrong.",
      rated_at: START.toISOString(),
    });

    // A held page, then "now" is 2 business days later (both tickets are past due by then).
    await pb.collection("pages").update(s.A.livePage, { status: "held" });
    const held = await pb.collection("content_flags").create({
      organization: s.A.org,
      target_collection: "pages",
      target_id: s.A.livePage,
      verdict: "held",
      reasons: ['Text: matched "replica"'],
      status: "open",
    });
    now = new Date(
      businessDeadline(
        new Date(String(held.created).replace(" ", "T")),
        2,
      ).getTime() + 60_000,
    );

    // A fit hold (B) and a build ready to approve (A).
    await pb
      .collection("organizations")
      .update(s.B.org, { stage: "fit_review" });
    await pb
      .collection("organizations")
      .update(s.A.org, { stage: "ready_for_review" });

    await pb.collection("failsafe_requests").create({
      organization: s.A.org,
      addon: "fixture-premium",
      capture_id: "cap-today-1",
      name: "Ana",
      message: "Thursday at 3?",
      captured_at: START.toISOString(),
      status: "pending",
    });

    const hostA = String(
      (await pb.collection("org_hosts").getOne(s.base.A.host)).hostname,
    );
    reportRef = (
      await staffCreateCase(
        s.staff.agent,
        {
          kind: "report",
          targetUrl: `https://${hostA}/about`,
          category: "scam",
          description: "Fake discounts",
        },
        { now },
      )
    ).ref;
    clearResolverCache();
  });

  it("ranks missed SLA first, then held past promise; counts and badges come from one read", async (t) => {
    if (!inst) return t.skip();
    const res = await staffTodayCounts(s.staff.agent, {
      now,
      feeders: quietHealth,
    });
    expect(res.failed).toEqual([]);
    const ids = res.rows.map((r) => r.id);
    expect(ids[0]).toBe("sla_missed");
    expect(res.rows[0]).toMatchObject({
      severity: "critical",
      count: 2,
      label: "2 tickets missed SLA",
      href: "/staff/tickets?sla=missed",
    });
    expect(ids[1]).toBe("held_late");
    const byId = new Map(res.rows.map((r) => [r.id, r]));
    expect(byId.get("held_late")?.count).toBe(1);
    expect(byId.get("unassigned")?.count).toBe(1);
    expect(byId.get("fit_holds")?.count).toBe(1);
    expect(byId.get("launch_ready")?.count).toBe(1);
    expect(byId.get("ratings_down")?.label).toBe(
      "1 thumbs-down rating to follow up",
    );
    expect(byId.get("failsafe_pending")?.count).toBe(1);
    expect(byId.get("reports_open")?.count).toBe(1);
    // Severity never goes back up the list.
    const rank = { critical: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < res.rows.length; i++) {
      expect(rank[res.rows[i]!.severity]).toBeGreaterThanOrEqual(
        rank[res.rows[i - 1]!.severity],
      );
    }
    // Queue rows are classified through QUEUE_MAP.
    expect(byId.get("sla_missed")?.kind).toBe(queueFor("problem"));
    expect(byId.get("held_late")?.kind).toBe(queueFor("scan_hold"));
    expect(byId.get("fit_holds")?.kind).toBe(queueFor("fit_hold"));
    for (const r of res.rows) {
      if (QUEUE_KINDS.has(r.kind)) expect(QUEUE_MAP).toHaveProperty(r.kind);
    }
    const sla = byId.get("sla_at_risk")?.count ?? 0;
    expect(res.badges.tickets).toBe(2 + sla + 1);
    expect(res.badges.pipeline).toBe(2);
    expect(res.badges.review).toBe(1 + 1);
    expect(res.badges.health).toBe(1);
    expect(res.status.openTickets).toBe(2);
  });

  it("a source that throws is listed in failed and its row reads as uncounted", async (t) => {
    if (!inst) return t.skip();
    const res = await staffTodayCounts(s.staff.agent, {
      now,
      feeders: {
        ...quietHealth,
        fit: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(res.failed).toEqual(["fit"]);
    const fit = res.rows.find((r) => r.id === "fit_holds");
    expect(fit).toMatchObject({ count: null, label: "Fit holds" });
    expect(res.badges.pipeline).toBeNull();
    expect(res.rows[0]?.id).toBe("sla_missed");
  });

  it("Find: #number first, a case ref, a business name", async (t) => {
    if (!inst) return t.skip();
    const byNumber = await staffFind(s.staff.agent, `#${missedB}`, { now });
    expect(byNumber.tickets[0]).toMatchObject({
      number: missedB,
      href: `/staff/tickets/${missedB}`,
    });
    const bySubject = await staffFind(s.staff.agent, "blurry", { now });
    expect(bySubject.tickets.map((h) => h.number)).toEqual([missedA]);
    const byCase = await staffFind(s.staff.agent, reportRef.toLowerCase(), {
      now,
    });
    expect(byCase.cases[0]).toMatchObject({
      group: "Cases",
      href: `/staff/review/${reportRef}`,
    });
    const bySite = await staffFind(s.staff.agent, "Bella", { now });
    expect(bySite.sites[0]).toMatchObject({
      group: "Sites",
      label: "Bella Rivera Studio",
      href: `/staff/sites/${s.A.org}`,
    });
    const empty = await staffFind(s.staff.agent, "   ", { now });
    expect(empty).toEqual({ tickets: [], sites: [], cases: [] });
    const long = await staffFind(s.staff.agent, "x".repeat(500), { now });
    expect(long.tickets).toEqual([]);
  });
});
