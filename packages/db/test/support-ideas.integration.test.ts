// 12-22: the Suggest a feature board on the real PocketBase binary (CUSTOM-01, D297;
// T-12-22-01..04). Submitting files a private suggestion ticket plus a public card with no
// organization exposed and the site's own vote; one vote per org (concurrent double votes are
// one); held text is not listed; staff merge, hide, edit and status (tickets resolved, Built
// tells voters).
import "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { ContentScanner } from "../src/content/ports";
import { keywordScanner } from "../src/content/scan-standin";
import { mintOrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  listIdeas,
  resolveMergedIdea,
  staffEditIdea,
  staffHideIdea,
  staffListIdeas,
  staffMergeIdeas,
  staffSetIdeaStatus,
  staffUnhideIdea,
  submitIdea,
  toggleIdeaVote,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let orgC: string;
let ctxC: ReturnType<typeof mintOrgContext>;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  orgC = (
    await pb
      .collection("organizations")
      .create({ name: "Third Site Co", slug: "third-ideas", status: "active" })
  ).id;
  const owner = (
    await pb.collection("users").create({
      email: "ideas-owner-c@cds.test",
      password: "ideas-owner-c-password",
      passwordConfirm: "ideas-owner-c-password",
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: owner, organization: orgC, role: "owner" });
  ctxC = mintOrgContext({
    orgId: orgC,
    actor: owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

const clock = { now: () => AT };
// 12-REVIEW WR-A07: the keyword stand-in holds every idea, so these tests use a scanner that
// screens the same way but stands for a real one.
const scanner: ContentScanner = { scan: (i) => keywordScanner.scan(i) };

async function submitA(title: string, description = "Sell gift cards online.") {
  return submitIdea(s.A.ctx.editor, { title, description }, { clock, scanner });
}

async function threadOf(id: string) {
  return pb.collection("support_threads").getOne(id);
}

describe("submit, list, vote (choices 1-3)", () => {
  it("submit → suggestion ticket + idea with one vote; org B sees it without source fields", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA("Gift cards in the store");
    expect(r.held).toBe(false);
    expect(r.number).toBeGreaterThan(1000);

    const idea = await pb.collection("feature_ideas").getOne(r.ideaId);
    expect(idea.votes).toBe(1);
    expect(idea.source_org).toBe(s.A.org);
    const ticket = await threadOf(idea.source_thread);
    expect(ticket).toMatchObject({
      type: "suggestion",
      kind: "ticket",
      organization: s.A.org,
      first_reply_due_at: "",
    });
    const msgs = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t}", { t: ticket.id }),
    });
    expect(msgs.map((m) => m.body)).toEqual(["Sell gift cards online."]);

    const mineA = (await listIdeas(s.A.ctx.viewer)).find(
      (c) => c.id === r.ideaId,
    );
    expect(mineA).toMatchObject({ mine: true, voted: true, votes: 1 });

    const listB = await listIdeas(s.B.ctx.viewer);
    const card = listB.find((c) => c.id === r.ideaId);
    expect(card).toMatchObject({
      title: "Gift cards in the store",
      status: "suggested",
      votes: 1,
      mine: false,
      voted: false,
    });
    const json = JSON.stringify(listB);
    expect(json).not.toContain(s.A.org);
    expect(json).not.toContain(ticket.id);
    expect(json).not.toContain("source_");
    expect(Object.keys(card!).sort()).toEqual(
      [
        "created",
        "description",
        "id",
        "mine",
        "status",
        "title",
        "voted",
        "votes",
      ].sort(),
    );
    // Other statuses do not list it.
    expect(
      (await listIdeas(s.B.ctx.viewer, { status: "planned" })).some(
        (c) => c.id === r.ideaId,
      ),
    ).toBe(false);
  });

  it("viewer and impersonated owner cannot vote or suggest", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA("Waitlist for classes");
    await expect(toggleIdeaVote(s.A.ctx.viewer, r.ideaId)).rejects.toThrow(
      Forbidden,
    );
    await expect(
      toggleIdeaVote(s.B.impersonatedOwner, r.ideaId),
    ).rejects.toThrow(ImpersonationDenied);
    await expect(
      submitIdea(
        s.B.ctx.viewer,
        { title: "Something", description: "More" },
        { clock, scanner },
      ),
    ).rejects.toThrow(Forbidden);
    await expect(toggleIdeaVote(s.B.ctx.editor, "junk")).rejects.toThrow(
      NotFound,
    );
  });

  it("org B toggles on and off; concurrent double votes give one", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA("Online gift vouchers");
    expect(await toggleIdeaVote(s.B.ctx.editor, r.ideaId)).toEqual({
      voted: true,
      votes: 2,
    });
    expect(await toggleIdeaVote(s.B.ctx.owner, r.ideaId)).toEqual({
      voted: false,
      votes: 1,
    });
    const both = await Promise.all([
      toggleIdeaVote(s.B.ctx.editor, r.ideaId),
      toggleIdeaVote(s.B.ctx.admin, r.ideaId),
    ]);
    // Toggles race: when one call commits before the other reads, the second toggles off.
    // Either way the org never holds two vote rows and the count matches the rows.
    expect(both.some((x) => x.voted)).toBe(true);
    const rows = await pb.collection("feature_idea_votes").getFullList({
      filter: pb.filter("idea = {:i} && organization = {:o}", {
        i: r.ideaId,
        o: s.B.org,
      }),
    });
    expect(rows.length).toBeLessThanOrEqual(1);
    const voted = rows.length === 1;
    const idea = await pb.collection("feature_ideas").getOne(r.ideaId);
    expect(idea.votes).toBe(1 + rows.length);
    const card = (await listIdeas(s.B.ctx.viewer)).find(
      (c) => c.id === r.ideaId,
    );
    expect(card).toMatchObject({ votes: 1 + rows.length, voted });
  });

  it("flagged text is held hidden and not listed", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA(
      "A flagged idea",
      "Please add __cds_test_held__ now",
    );
    expect(r.held).toBe(true);
    const idea = await pb.collection("feature_ideas").getOne(r.ideaId);
    expect(idea.hold_reason).toBe("review");
    expect(idea.hidden_at).not.toBe("");
    expect(
      (await listIdeas(s.B.ctx.viewer)).some((c) => c.id === r.ideaId),
    ).toBe(false);
    await expect(toggleIdeaVote(s.B.ctx.editor, r.ideaId)).rejects.toThrow(
      NotFound,
    );
    const staff = await staffListIdeas(s.staff.agent);
    expect(staff[0]).toMatchObject({ id: r.ideaId, holdReason: "review" });
  });

  it("while the keyword stand-in is the scanner, a clean idea waits for staff (12-REVIEW WR-A07)", async (t) => {
    if (!inst) return t.skip();
    const r = await submitIdea(
      s.A.ctx.editor,
      { title: "Loyalty stamps", description: "A punch card for regulars." },
      { clock },
    );
    expect(r.held).toBe(true);
    const idea = await pb.collection("feature_ideas").getOne(r.ideaId);
    expect(idea.hold_reason).toBe("review");
    expect(
      (await listIdeas(s.B.ctx.viewer)).some((c) => c.id === r.ideaId),
    ).toBe(false);
    await staffUnhideIdea(s.staff.agent, { id: r.ideaId });
    expect(
      (await listIdeas(s.B.ctx.viewer)).some((c) => c.id === r.ideaId),
    ).toBe(true);
  });
});

describe("staff curation (choice 4)", () => {
  it("merge X (A, B) into Y (B, C) → Y has 3; X not listed and resolves to Y", async (t) => {
    if (!inst) return t.skip();
    const x = await submitA("Gift card store");
    await toggleIdeaVote(s.B.ctx.editor, x.ideaId);
    const y = (
      await submitIdea(
        s.B.ctx.editor,
        { title: "Gift cards", description: "Let people buy gift cards." },
        { clock, scanner },
      )
    ).ideaId;
    await toggleIdeaVote(ctxC, y);

    const res = await staffMergeIdeas(s.staff.agent, {
      from: x.ideaId,
      into: y,
    });
    expect(res).toEqual({ fromVotes: 2, intoVotes: 2, total: 3, both: 1 });
    const ids = (await listIdeas(s.A.ctx.viewer)).map((c) => c.id);
    expect(ids).not.toContain(x.ideaId);
    expect(await resolveMergedIdea(s.A.ctx.viewer, x.ideaId)).toBe(y);
    const cardA = (await listIdeas(s.A.ctx.viewer)).find((c) => c.id === y);
    expect(cardA).toMatchObject({ votes: 3, voted: true, mine: false });
    expect((await pb.collection("feature_ideas").getOne(x.ideaId)).votes).toBe(
      0,
    );
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.idea_merged' && target_id = {:id}", {
        id: x.ideaId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe("");
    await expect(
      staffMergeIdeas(s.staff.agent, { from: x.ideaId, into: y }),
    ).rejects.toThrow();
  });

  it("planned resolves the linked suggestion ticket with a system line", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA("Recurring classes");
    const res = await staffSetIdeaStatus(
      s.staff.agent,
      { id: r.ideaId, to: "planned" },
      { clock },
    );
    expect(res).toMatchObject({
      from: "suggested",
      to: "planned",
      resolved: 1,
      notified: 0,
    });
    const idea = await pb.collection("feature_ideas").getOne(r.ideaId);
    const ticket = await threadOf(idea.source_thread);
    expect(ticket.status).toBe("resolved");
    const lines = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t} && author_kind = 'system'", {
        t: ticket.id,
      }),
      sort: "created,id",
    });
    expect(lines.map((l) => l.event?.label)).toContain("Idea status: Planned");
    expect(lines.some((l) => l.event?.to === "resolved")).toBe(true);
    expect(lines.every((l) => l.visibility === "public")).toBe(true);
    // Listed under Planned now.
    expect(
      (await listIdeas(s.B.ctx.viewer, { status: "planned" })).some(
        (c) => c.id === r.ideaId,
      ),
    ).toBe(true);
    // Same status again changes nothing.
    expect(
      await staffSetIdeaStatus(
        s.staff.agent,
        { id: r.ideaId, to: "planned" },
        { clock },
      ),
    ).toMatchObject({ resolved: 0 });
  });

  it("built raises one alert per voting org's owners, admins and editors", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const r = await submitA("Loyalty points");
    await toggleIdeaVote(s.B.ctx.editor, r.ideaId);
    const res = await staffSetIdeaStatus(
      s.staff.agent,
      { id: r.ideaId, to: "built" },
      { clock, transport },
    );
    expect(res.notified).toBe(2);
    const title = "An idea you voted for is built: Loyalty points";
    for (const org of [s.A, s.B]) {
      const rows = await pb.collection("alerts").getFullList({
        filter: pb.filter("organization = {:o} && title = {:t}", {
          o: org.org,
          t: title,
        }),
      });
      const users = rows.map((a) => a.user).sort();
      expect(users).toEqual(
        [org.users.owner, org.users.admin, org.users.editor].sort(),
      );
    }
    const none = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:o} && title = {:t}", {
        o: orgC,
        t: title,
      }),
    });
    expect(none).toHaveLength(0);
  });

  it("hide removes from the board, unhide restores; edit changes the text", async (t) => {
    if (!inst) return t.skip();
    const r = await submitA("Mention Acme Spa in my idea");
    expect(
      await staffHideIdea(s.staff.agent, { id: r.ideaId }, { clock }),
    ).toEqual({ hidden: true });
    expect(
      (await listIdeas(s.B.ctx.viewer)).some((c) => c.id === r.ideaId),
    ).toBe(false);
    await expect(resolveMergedIdea(s.B.ctx.viewer, r.ideaId)).rejects.toThrow(
      NotFound,
    );
    expect(
      await staffEditIdea(s.staff.agent, {
        id: r.ideaId,
        title: "Booking reminders by text",
      }),
    ).toEqual({ changed: ["title"] });
    expect(await staffUnhideIdea(s.staff.agent, { id: r.ideaId })).toEqual({
      shown: true,
    });
    const card = (await listIdeas(s.B.ctx.viewer)).find(
      (c) => c.id === r.ideaId,
    );
    expect(card?.title).toBe("Booking reminders by text");
    const staffRow = (await staffListIdeas(s.staff.agent)).find(
      (x) => x.id === r.ideaId,
    );
    expect(staffRow?.sourceOrg).toBe(s.A.org);
    expect(staffRow?.sourceTicket).toBe(r.number);
  });

  it("members cannot reach staff functions", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffHideIdea(s.A.ctx.owner as never, { id: "x".repeat(15) }),
    ).rejects.toThrow();
  });
});
