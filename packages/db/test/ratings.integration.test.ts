// 13-16: ticket ratings on the real PocketBase binary (STAFF-21, D212, P13-P18, P13-P32;
// T-13-16-02..04). Resolve-time agent credit and signed links in the Resolved email, the
// tenant write rules, the thumbs-down staff mail, the month report and the follow-up flag.
import "@cds/addon-registry/server";
import { Forbidden, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { TENANT_COLLECTIONS } from "../src/registry";
import {
  staffMarkRatingFollowedUp,
  staffRatingsReport,
} from "../src/staff/ratings-report";
import {
  fileTicket,
  markTicketSolved,
  rateTicket,
  ratingLinkState,
  staffReplyToTicket,
  ticketRatingView,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z"); // Monday 10:00 Chicago
const LATER = new Date("2026-10-12T16:00:00.000Z");
const STAFF_MAIL = "staff-alerts@cds.test";

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  saved.CDS_STAFF_ALERT_EMAIL = process.env.CDS_STAFF_ALERT_EMAIL;
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF_MAIL;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
});

afterAll(async () => {
  await inst?.stop();
  if (saved.CDS_STAFF_ALERT_EMAIL === undefined) {
    delete process.env.CDS_STAFF_ALERT_EMAIL;
  } else {
    process.env.CDS_STAFF_ALERT_EMAIL = saved.CDS_STAFF_ALERT_EMAIL;
  }
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

const clock = (at: Date) => ({ now: () => at });

async function file(subject: string): Promise<number> {
  const r = await fileTicket(
    s.A.ctx.editor,
    { type: "problem", subject, body: "The menu photo looks blurry." },
    { clock: clock(AT) },
  );
  return r.number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

/** Assign to the agent, then resolve; returns the captured mail. */
async function resolveAssigned(number: number) {
  const transport = captureTransport();
  await staffReplyToTicket(
    s.staff.superAdmin,
    { number, assign: "support-agent@cds.test" },
    { clock: clock(AT), transport },
  );
  await staffReplyToTicket(
    s.staff.superAdmin,
    { number, body: "Fixed the photo.", status: "resolved" },
    { clock: clock(AT), transport },
  );
  return transport;
}

describe("resolve-time credit and links (choice 4)", () => {
  it("stamps rated_agent = assignee and the Resolved email carries two signed /rate? links", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Blurry photo");
    const transport = await resolveAssigned(n);
    const row = await threadOf(n);
    expect(row.status).toBe("resolved");
    expect(row.rated_agent).toBe(s.staff.agentUser);

    const resolvedMail = transport.sent.filter(
      (m) => m.text.includes("/rate?") && m.type === "support.notify",
    );
    expect(resolvedMail.length).toBeGreaterThan(0);
    const links = [
      ...resolvedMail[0]!.text.matchAll(/https?:\/\/\S+\/rate\?\S+/g),
    ].map((m) => new URL(m[0]));
    expect(links).toHaveLength(2);
    expect(links.map((u) => u.searchParams.get("r")).sort()).toEqual([
      "down",
      "up",
    ]);
    for (const u of links) {
      expect(u.pathname).toBe(`/hub/support/tickets/${n}/rate`);
      expect(u.searchParams.get("t")).toBe(row.id);
      expect(
        ratingLinkState(
          u.searchParams.get("t"),
          u.searchParams.get("r"),
          u.searchParams.get("e"),
          u.searchParams.get("sig"),
          AT.getTime(),
        ),
      ).toBe("valid");
    }
  });

  it("without an assignee credits the last public staff replier", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Hours wrong");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Looking now." },
      { clock: clock(AT), transport: captureTransport() },
    );
    await markTicketSolved(s.A.ctx.editor, n, AT);
    expect((await threadOf(n)).rated_agent).toBe(s.staff.agentUser);
  });
});

describe("rateTicket (choice 2)", () => {
  it("editor rates up, changes to down with a comment (one staff mail), down again sends none", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Menu prices");
    await resolveAssigned(n);
    const transport = captureTransport();

    const up = await rateTicket(
      s.A.ctx.editor,
      { number: n, rating: "up" },
      { now: AT, transport },
    );
    expect(up.changed).toBe(true);
    expect(up.alert).toBe("none");
    let row = await threadOf(n);
    expect(row.rating).toBe("up");
    expect(row.rated_by).toBe(s.A.users.editor);
    expect(transport.sent).toHaveLength(0);

    const down = await rateTicket(
      s.A.ctx.owner,
      { number: n, rating: "down", comment: "  Still blurry on mobile.  " },
      { now: LATER, transport },
    );
    expect(down.alert).toBe("sent");
    row = await threadOf(n);
    expect(row.rating).toBe("down");
    expect(row.rating_comment).toBe("Still blurry on mobile.");
    expect(row.status).toBe("resolved");
    const staffMail = transport.sent.filter(
      (m) => m.type === "support.rating_down",
    );
    expect(staffMail).toHaveLength(1);
    expect(staffMail[0]!.to).toBe(STAFF_MAIL);
    expect(staffMail[0]!.text).toContain(`/staff/tickets/${n}`);
    expect(staffMail[0]!.text).toContain("Mara");

    const again = await rateTicket(
      s.A.ctx.owner,
      { number: n, rating: "down" },
      { now: LATER, transport },
    );
    expect(again.changed).toBe(false);
    expect(again.comment).toBe("Still blurry on mobile.");
    expect(
      transport.sent.filter((m) => m.type === "support.rating_down"),
    ).toHaveLength(1);

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.rated' && target_id = {:id}", {
        id: row.id,
      }),
    });
    expect(audit).toHaveLength(3);
    expect(audit[0]!.organization).toBe(s.A.org);
    expect(JSON.stringify(audit.map((a) => a.meta))).not.toContain("blurry");
  });

  it("refuses a viewer, an impersonated owner, a long comment, a non-resolved ticket and another org", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Footer link");
    await expect(
      rateTicket(s.A.ctx.owner, { number: n, rating: "up" }, { now: AT }),
    ).rejects.toThrow(InvalidInput);
    await resolveAssigned(n);
    await expect(
      rateTicket(s.A.ctx.viewer, { number: n, rating: "up" }, { now: AT }),
    ).rejects.toThrow(Forbidden);
    await expect(
      rateTicket(
        s.A.impersonatedOwner,
        { number: n, rating: "up" },
        { now: AT },
      ),
    ).rejects.toThrow();
    await expect(
      rateTicket(
        s.A.ctx.owner,
        { number: n, rating: "up", comment: "x".repeat(501) },
        { now: AT },
      ),
    ).rejects.toThrow(InvalidInput);
    await expect(
      rateTicket(s.B.ctx.owner, { number: n, rating: "up" }, { now: AT }),
    ).rejects.toThrow();
    expect((await threadOf(n)).rating ?? "").toBe("");
  });

  it("reopening a rated ticket clears the rating, so the next resolve starts unrated (WR-A13)", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Reopened ticket");
    await resolveAssigned(n);
    await rateTicket(
      s.A.ctx.owner,
      { number: n, rating: "down", comment: "Not fixed." },
      { now: AT, transport: captureTransport() },
    );
    await staffReplyToTicket(
      s.staff.superAdmin,
      { number: n, body: "Looking again.", status: "in_progress" },
      { clock: clock(LATER), transport: captureTransport() },
    );
    const reopened = await threadOf(n);
    expect(reopened.status).toBe("in_progress");
    expect(reopened.rating ?? "").toBe("");
    expect(reopened.rating_comment ?? "").toBe("");
    expect(reopened.rated_at ?? "").toBe("");
    expect(reopened.rated_by ?? "").toBe("");
    await staffReplyToTicket(
      s.staff.superAdmin,
      { number: n, body: "Fixed now.", status: "resolved" },
      { clock: clock(LATER), transport: captureTransport() },
    );
    expect((await threadOf(n)).rating ?? "").toBe("");
    // The history stays in the audit log.
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.rated' && target_id = {:id}", {
        id: reopened.id,
      }),
    });
    expect(audit).toHaveLength(1);
  });

  it("refuses after Closed with InvalidInput", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Old ticket");
    await resolveAssigned(n);
    await staffReplyToTicket(
      s.staff.superAdmin,
      { number: n, status: "closed" },
      { clock: clock(AT), transport: captureTransport() },
    );
    await expect(
      rateTicket(s.A.ctx.owner, { number: n, rating: "up" }, { now: AT }),
    ).rejects.toThrow("This ticket is closed, so ratings are finished.");
  });
});

describe("ratings report and follow-up (choice 5)", () => {
  it("counts per agent, lists comments and thumbs-down to follow up; marking removes it with audit", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Report ticket");
    await resolveAssigned(n);
    await rateTicket(
      s.A.ctx.owner,
      { number: n, rating: "down", comment: "Took long." },
      { now: LATER, transport: captureTransport() },
    );

    const report = await staffRatingsReport(s.staff.agent, {
      month: "2026-10",
      now: LATER,
    });
    expect(report.label).toBe("October 2026");
    const mara = report.byAgent.find((a) => a.agentId === s.staff.agentUser);
    expect(mara).toBeDefined();
    expect(mara!.name).toBe("Mara");
    expect(mara!.down).toBeGreaterThanOrEqual(1);
    expect(report.overall.up + report.overall.down).toBeGreaterThanOrEqual(1);
    expect(report.comments.some((c) => c.number === n)).toBe(true);
    expect(report.toFollowUp.some((f) => f.number === n)).toBe(true);

    const empty = await staffRatingsReport(s.staff.agent, {
      month: "2026-09",
      now: LATER,
    });
    expect(empty.overall).toEqual({ up: 0, down: 0, rate: null });

    const marked = await staffMarkRatingFollowedUp(s.staff.agent, n, {
      now: LATER,
    });
    expect(marked.changed).toBe(true);
    const after = await staffRatingsReport(s.staff.agent, {
      month: "2026-10",
      now: LATER,
    });
    expect(after.toFollowUp.some((f) => f.number === n)).toBe(false);
    const row = await threadOf(n);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.rating_followed_up' && target_id = {:id}",
        { id: row.id },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(s.A.org);

    const twice = await staffMarkRatingFollowedUp(s.staff.agent, n, {
      now: LATER,
    });
    expect(twice.changed).toBe(false);
  });

  it("export of support_threads includes rating, never rated_agent", () => {
    const spec: { export: readonly string[] | "never" } =
      TENANT_COLLECTIONS.support_threads;
    const list: readonly string[] = spec.export === "never" ? [] : spec.export;
    expect(list).toContain("rating");
    expect(list).toContain("rating_comment");
    expect(list).toContain("rated_at");
    expect(list).not.toContain("rated_agent");
    expect(list).not.toContain("rated_by");
    expect(list).not.toContain("rating_followed_at");
  });
});

describe("ticketRatingView (13-42)", () => {
  it("shows the stored rating, who may rate, impersonation read-only, and hides other orgs", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Rating view");
    const before = await ticketRatingView(s.A.ctx.owner, n);
    expect(before.status).toBe("open");
    expect(before.canRate).toBe(false);
    expect(before.isRater).toBe(true);
    await resolveAssigned(n);
    await rateTicket(
      s.A.ctx.editor,
      { number: n, rating: "up", comment: "Quick fix." },
      { now: AT, transport: captureTransport() },
    );
    const owner = await ticketRatingView(s.A.ctx.owner, n);
    expect(owner).toMatchObject({
      number: n,
      status: "resolved",
      rating: "up",
      comment: "Quick fix.",
      isRater: true,
      canRate: true,
    });
    expect(JSON.stringify(owner)).not.toContain(s.staff.agentUser);
    const viewer = await ticketRatingView(s.A.ctx.viewer, n);
    expect(viewer.isRater).toBe(false);
    expect(viewer.canRate).toBe(false);
    const imp = await ticketRatingView(s.A.impersonatedOwner, n);
    expect(imp.rating).toBe("up");
    expect(imp.canRate).toBe(false);
    await expect(ticketRatingView(s.B.ctx.owner, n)).rejects.toThrow();
  });
});
