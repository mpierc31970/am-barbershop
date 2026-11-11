// 13-38 Task 1: review queue actions (STAFF-23, STAFF-24, STAFF-26; T-13-38-01). @cds/db and
// the staff session are mocked; the real matrix, step-up gate and error mapping run. Each
// outcome is gated by its own feature; a logged report is a case, never a ticket.
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  listReviewQueue: vi.fn(),
  staffAddCaseStep: vi.fn(),
  staffAssignCase: vi.fn(),
  staffCaseOutcome: vi.fn(),
  staffCreateCase: vi.fn(),
  staffGetCase: vi.fn(),
  staffMarkSpotPage: vi.fn(),
  staffResolveFlag: vi.fn(),
  staffOpenTicket: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("../lib/content", () => ({ contentDeps: () => ({ sections: {} }) }));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: {} }));
vi.mock("../lib/invalidator", () => ({ nextInvalidator: {} }));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const review = await import("../app/actions/staff/review");
const { resetStaffKit } = await import("./staff-test-kit");

const ORG = "abcdefghijklmno";
const FLAG = "flagaaaaaaaaaa1";
const PAGE = "pageaaaaaaaaaa1";

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

function reviewCase(over: Record<string, unknown> = {}) {
  return {
    id: "caseaaaaaaaaaa1",
    ref: "R-31",
    seq: 31,
    kind: "report",
    orgId: ORG,
    business: "Rivera Bakery",
    targetUrl: "https://rivera.example/about",
    targetCollection: "pages",
    targetId: PAGE,
    category: "scam",
    description: "Fake codes",
    reporterName: "",
    reporterEmail: "",
    dmcaStatement: null,
    status: "open",
    steps: [],
    currentStep: "received",
    dueAt: null,
    assignee: null,
    outcome: null,
    pages: [],
    repeatInfringer: false,
    created: "",
    updated: "",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffGetCase.mockResolvedValue(reviewCase());
  db.staffCaseOutcome.mockImplementation(
    (_ctx: unknown, ref: string, outcome: string) =>
      Promise.resolve({ ref, outcome, orgId: ORG, flagsResolved: 1 }),
  );
});

describe("caseOutcomeAction", () => {
  it("suspended as an agent is REFUSED-ROLE and never reaches staffCaseOutcome", async () => {
    const res = await review.caseOutcomeAction("R-31", "suspended", {
      note: "Phishing kit",
    });
    expect(res).toMatchObject({ ok: false, message: P13_COPY.REFUSED_ROLE });
    expect(db.staffCaseOutcome).not.toHaveBeenCalled();
  });

  it("suspended as a super admin with a stale sign-in asks for step-up", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await review.caseOutcomeAction("R-31", "suspended", {
      note: "Phishing kit",
    });
    expect(res).toEqual({ ok: false, code: "step_up_needed", message: "" });
    expect(db.staffCaseOutcome).not.toHaveBeenCalled();
  });

  it("suspended fresh calls staffCaseOutcome with the note and category", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await review.caseOutcomeAction("r-31", "suspended", {
      note: "Phishing kit",
      suspendCategory: "illegal",
    });
    expect(res.ok).toBe(true);
    expect(db.staffCaseOutcome).toHaveBeenCalledWith(
      expect.anything(),
      "R-31",
      "suspended",
      expect.objectContaining({
        note: "Phishing kit",
        suspendCategory: "illegal",
      }),
    );
  });

  it("fix_requested as an agent calls staffCaseOutcome (the notice path, no step-up)", async () => {
    const res = await review.caseOutcomeAction("R-31", "fix_requested", {
      message: "Remove the fake discount codes.",
    });
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Notice sent to Rivera Bakery. 3 days to fix." },
    });
    expect(db.staffCaseOutcome).toHaveBeenCalledWith(
      expect.anything(),
      "R-31",
      "fix_requested",
      expect.objectContaining({ message: "Remove the fake discount codes." }),
    );
  });

  it("fix_requested without an owner message is refused before any call", async () => {
    const res = await review.caseOutcomeAction("R-31", "fix_requested", {});
    expect(res).toMatchObject({ ok: false, field: "message" });
    expect(db.staffGetCase).not.toHaveBeenCalled();
  });

  it("removing a media file needs media_takedown (agent refused); a page does not", async () => {
    db.staffGetCase.mockResolvedValue(
      reviewCase({ targetCollection: "media_assets" }),
    );
    const media = await review.caseOutcomeAction("R-31", "removed");
    expect(media).toMatchObject({ ok: false, message: P13_COPY.REFUSED_ROLE });
    db.staffGetCase.mockResolvedValue(reviewCase());
    const page = await review.caseOutcomeAction("R-31", "removed");
    expect(page.ok).toBe(true);
    expect(db.staffCaseOutcome).toHaveBeenCalledTimes(1);
  });

  it("an unknown ref or outcome is refused", async () => {
    expect((await review.caseOutcomeAction("31", "cleared")).ok).toBe(false);
    expect((await review.caseOutcomeAction("R-31", "nuke")).ok).toBe(false);
    expect(db.staffCaseOutcome).not.toHaveBeenCalled();
  });
});

describe("flagOutcomeAction", () => {
  it("clears a held page with the CLI-style toast", async () => {
    db.listReviewQueue.mockResolvedValue([
      {
        kind: "scan_hold",
        ref: FLAG,
        orgId: ORG,
        business: "Rivera Bakery",
        target: {
          collection: "pages",
          id: PAGE,
          title: "Page · About us",
          url: null,
        },
        reasons: [],
        pastPromise: false,
        status: "open",
        assignee: null,
        createdAt: "",
        href: `/staff/review/${FLAG}`,
      },
    ]);
    db.staffResolveFlag.mockResolvedValue({
      ref: FLAG,
      outcome: "cleared",
      orgId: ORG,
      flagsResolved: 1,
    });
    const res = await review.flagOutcomeAction(FLAG, "cleared");
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Cleared. About us is published." },
    });
    expect(db.staffResolveFlag).toHaveBeenCalledWith(
      expect.anything(),
      FLAG,
      "cleared",
      expect.anything(),
    );
  });

  it("a handled flag is refused", async () => {
    db.listReviewQueue.mockResolvedValue([]);
    const res = await review.flagOutcomeAction(FLAG, "cleared");
    expect(res).toMatchObject({
      ok: false,
      message: "This flag is already handled.",
    });
    expect(db.staffResolveFlag).not.toHaveBeenCalled();
  });
});

describe("logReportAction", () => {
  it("creates a case and returns R-n; no ticket function is called", async () => {
    db.staffCreateCase.mockResolvedValue({ id: "x", ref: "R-32", orgId: ORG });
    const res = await review.logReportAction({
      category: "scam",
      url: "https://rivera.example/about",
      description: "Fake discount codes on the about page.",
      name: "Sam Caller",
      email: "",
      receivedVia: "phone",
      receivedAt: "2026-10-12T09:30",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        ref: "R-32",
        orgId: ORG,
        message: "Case R-32 logged. The owner was not contacted.",
      },
    });
    const input = db.staffCreateCase.mock.calls[0]![1];
    expect(input).toMatchObject({
      kind: "report",
      category: "scam",
      receivedVia: "phone",
      reporter: { name: "Sam Caller" },
    });
    expect(input.reporter.email).toBeUndefined();
    expect(input.receivedAt).toBeInstanceOf(Date);
    expect(db.staffOpenTicket).not.toHaveBeenCalled();
  });

  it("a copyright report with the statements becomes a DMCA case", async () => {
    db.staffCreateCase.mockResolvedValue({ id: "x", ref: "R-33", orgId: ORG });
    await review.logReportAction({
      category: "copyright",
      url: "https://rivera.example/gallery",
      description: "My photo is used without permission.",
      name: "Pat Lens",
      email: "pat@example.test",
      goodFaith: true,
      accuracy: true,
      signature: "Pat Lens",
    });
    expect(db.staffCreateCase.mock.calls[0]![1]).toMatchObject({
      kind: "dmca",
      dmcaStatement: { goodFaith: true, accuracy: true, signature: "Pat Lens" },
    });
  });

  it("field errors come back with the field name", async () => {
    const res = await review.logReportAction({ category: "scam", url: "nope" });
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "url",
    });
    expect(db.staffCreateCase).not.toHaveBeenCalled();
  });
});

describe("steps, assignment and spot pages", () => {
  it("addCaseStepAction passes the restore day as a Chicago-safe instant", async () => {
    db.staffAddCaseStep.mockResolvedValue(reviewCase({ kind: "dmca" }));
    const res = await review.addCaseStepAction(
      "R-31",
      "restore_date_set",
      undefined,
      "2026-10-30",
    );
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Restore date set." },
    });
    expect(db.staffAddCaseStep).toHaveBeenCalledWith(
      expect.anything(),
      "R-31",
      {
        step: "restore_date_set",
        restoreDate: "2026-10-30T17:00:00.000Z",
      },
    );
  });

  it("assignCaseAction 'me' assigns the signed-in staff member", async () => {
    db.staffAssignCase.mockResolvedValue({ ref: "R-31", assignee: "u1" });
    const res = await review.assignCaseAction("R-31", "me");
    expect(db.staffAssignCase).toHaveBeenCalledWith(
      expect.anything(),
      "R-31",
      "u1",
    );
    expect(res).toMatchObject({
      ok: true,
      data: { message: "R-31 assigned to you." },
    });
  });

  it("markSpotPageAction issue keeps the note; ok drops it", async () => {
    db.staffMarkSpotPage.mockResolvedValue(reviewCase({ kind: "spot_check" }));
    await review.markSpotPageAction("R-40", PAGE, "issue", "Claims a cure.");
    await review.markSpotPageAction("R-40", PAGE, "ok", "ignored");
    expect(db.staffMarkSpotPage.mock.calls[0]![2]).toEqual({
      pageId: PAGE,
      state: "issue",
      note: "Claims a cure.",
    });
    expect(db.staffMarkSpotPage.mock.calls[1]![2]).toEqual({
      pageId: PAGE,
      state: "ok",
    });
  });
});
