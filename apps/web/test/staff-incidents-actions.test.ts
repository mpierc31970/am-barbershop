// 13-36 Task 2: incident and idea actions (STAFF-12, D103; ideas:run in the console). @cds/db
// and the staff session are mocked; the real matrix and error mapping run. Each control reaches
// the CLI's function with the right input and returns the CLI's line.
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  staffOpenIncident: vi.fn(),
  staffLinkTicketToIncident: vi.fn(),
  staffUnlinkTicketFromIncident: vi.fn(),
  staffResolveIncident: vi.fn(),
  staffSupportLabels: vi.fn(),
  staffListIdeas: vi.fn(),
  staffSetIdeaStatus: vi.fn(),
  staffMergeIdeas: vi.fn(),
  staffHideIdea: vi.fn(),
  staffUnhideIdea: vi.fn(),
  staffEditIdea: vi.fn(),
  IDEA_STATUSES: ["suggested", "considering", "planned", "built"],
  IDEA_TITLE_MAX: 80,
  IDEA_DESCRIPTION_MAX: 2000,
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const incidents = await import("../app/actions/staff/incidents");
const ideas = await import("../app/actions/staff/ideas");
const { resetStaffKit } = await import("./staff-test-kit");

const ORG = "abcdefghijklmno";
const IDEA_A = "ideaaaaaaaaaaa1";
const IDEA_B = "ideabbbbbbbbbb1";

function session(role: "super_admin" | "support_agent" | "") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

function idea(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: "",
    status: "suggested",
    votes: 5,
    created: "2026-10-01 10:00:00.000Z",
    hiddenAt: null,
    holdReason: null,
    mergedInto: null,
    sourceOrg: ORG,
    sourceOrgName: "Rivera Bakery",
    sourceTicket: 1042,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffSupportLabels.mockResolvedValue({
    orgs: { [ORG]: "Rivera Bakery" },
    pages: {},
  });
  db.staffListIdeas.mockResolvedValue([
    idea(IDEA_A, "Gift card store", { votes: 5 }),
    idea(IDEA_B, "Gift cards", { votes: 7 }),
  ]);
});

describe("incidents", () => {
  it("resolveIncidentAction calls staffResolveIncident and returns the CLI line", async () => {
    db.staffResolveIncident.mockResolvedValue({
      code: "I-3",
      moved: 4,
      alerts: 4,
      skipped: 0,
    });
    const res = await incidents.resolveIncidentAction("i-3", "Fixed now.");
    expect(db.staffResolveIncident).toHaveBeenCalledWith(expect.anything(), {
      incident: "I-3",
      message: "Fixed now.",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        message:
          "Resolved I-3. 4 linked tickets moved to Resolved, 4 alerts raised.",
        moved: 4,
        alerts: 4,
        skipped: 0,
      },
    });
  });

  it("resolve without a closing message sends none; one ticket reads singular", async () => {
    db.staffResolveIncident.mockResolvedValue({
      code: "I-3",
      moved: 1,
      alerts: 1,
      skipped: 0,
    });
    const res = await incidents.resolveIncidentAction("I-3", "  ");
    expect(db.staffResolveIncident).toHaveBeenCalledWith(expect.anything(), {
      incident: "I-3",
    });
    expect(res.ok && res.data.message).toBe(
      "Resolved I-3. 1 linked ticket moved to Resolved, 1 alert raised.",
    );
  });

  it('linkTicketAction with "#1042" parses the number', async () => {
    db.staffLinkTicketToIncident.mockResolvedValue({
      code: "I-3",
      number: 1042,
      orgId: ORG,
      linked: true,
    });
    const res = await incidents.linkTicketAction("I-3", "#1042");
    expect(db.staffLinkTicketToIncident).toHaveBeenCalledWith(
      expect.anything(),
      { incident: "I-3", number: 1042 },
    );
    expect(res.ok && res.data.message).toBe(
      'Linked #1042 (Rivera Bakery) to I-3. The owner sees "Linked to a known problem" and the public text.',
    );
  });

  it("junk ticket or incident → refused before any call", async () => {
    expect(await incidents.linkTicketAction("I-3", "abc")).toMatchObject({
      ok: false,
      field: "ticket",
    });
    expect(await incidents.linkTicketAction("X-3", "1042")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(db.staffLinkTicketToIncident).not.toHaveBeenCalled();
  });

  it("unlinkTicketAction and openIncidentAction", async () => {
    db.staffUnlinkTicketFromIncident.mockResolvedValue({
      code: "I-3",
      number: 1042,
      orgId: ORG,
      unlinked: true,
    });
    expect(await incidents.unlinkTicketAction("I-3", 1042)).toEqual({
      ok: true,
      data: { message: "Unlinked #1042 from I-3.", unlinked: true },
    });
    db.staffOpenIncident.mockResolvedValue({ id: "x", code: "I-4" });
    expect(
      await incidents.openIncidentAction({
        title: "Uploads failing",
        publicText: "Photo uploads fail; we're on it.",
      }),
    ).toEqual({ ok: true, data: { message: "Opened I-4.", code: "I-4" } });
    expect(
      await incidents.openIncidentAction({ title: "", publicText: "x" }),
    ).toMatchObject({ ok: false, field: "title" });
  });

  it("a non-staff session is refused REFUSED-ROLE", async () => {
    sess.getStaffSession.mockResolvedValue(session(""));
    expect(await incidents.resolveIncidentAction("I-3")).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.staffResolveIncident).not.toHaveBeenCalled();
  });
});

describe("ideas", () => {
  it("mergeIdeasAction returns the CLI merge line", async () => {
    db.staffMergeIdeas.mockResolvedValue({
      fromVotes: 5,
      intoVotes: 7,
      total: 10,
      both: 2,
    });
    const res = await ideas.mergeIdeasAction(IDEA_A, IDEA_B);
    expect(db.staffMergeIdeas).toHaveBeenCalledWith(expect.anything(), {
      from: IDEA_A,
      into: IDEA_B,
    });
    expect(res.ok && res.data.message).toBe(
      'Merged "Gift card store" into "Gift cards" · votes 5 + 7 → 10 (2 sites voted for both).',
    );
    expect(await ideas.mergeIdeasAction(IDEA_A, IDEA_A)).toMatchObject({
      ok: false,
      field: "into",
    });
  });

  it("ideaStatusAction: Built line, same status no-op, merged refused", async () => {
    db.staffSetIdeaStatus.mockResolvedValue({
      from: "planned",
      to: "built",
      resolved: 2,
      notified: 7,
    });
    const res = await ideas.ideaStatusAction(IDEA_B, "built");
    expect(res.ok && res.data.message).toBe(
      '"Gift cards" is now Built · 2 suggestion tickets resolved · 7 voting sites alerted.',
    );
    expect(await ideas.ideaStatusAction(IDEA_B, "suggested")).toMatchObject({
      ok: true,
      data: { changed: false },
    });
    db.staffListIdeas.mockResolvedValue([
      idea(IDEA_A, "Dup", { mergedInto: IDEA_B }),
    ]);
    expect(await ideas.ideaStatusAction(IDEA_A, "planned")).toMatchObject({
      ok: false,
      field: "status",
    });
    expect(await ideas.ideaStatusAction(IDEA_A, "shipped")).toMatchObject({
      ok: false,
      field: "status",
    });
    expect(db.staffSetIdeaStatus).toHaveBeenCalledTimes(1);
  });

  it("hide, unhide and edit return the CLI lines", async () => {
    db.staffHideIdea.mockResolvedValue({ hidden: true });
    expect(await ideas.hideIdeaAction(IDEA_A)).toEqual({
      ok: true,
      data: {
        message:
          'Hidden "Gift card store". It is off the board and keeps its votes.',
      },
    });
    db.staffUnhideIdea.mockResolvedValue({ shown: true });
    expect(await ideas.unhideIdeaAction(IDEA_A)).toEqual({
      ok: true,
      data: { message: 'Shown "Gift card store". It is back on the board.' },
    });
    db.staffEditIdea.mockResolvedValue({ changed: ["title"] });
    expect(
      await ideas.editIdeaAction(IDEA_A, { title: "Gift cards online" }),
    ).toEqual({ ok: true, data: { message: "Saved: title changed." } });
    expect(db.staffEditIdea).toHaveBeenCalledWith(expect.anything(), {
      id: IDEA_A,
      title: "Gift cards online",
    });
    expect(await ideas.editIdeaAction(IDEA_A, {})).toMatchObject({ ok: false });
  });
});
