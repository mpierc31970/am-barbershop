// 13-27 Task 1: Pipeline actions (STAFF-01, STAFF-03, STAFF-04; T-13-27-01..03). @cds/db and
// the staff session are mocked; the real matrix (authorizeStaff inside runStaffAction) and the
// real error mapping run. Proves each button reaches the CLI's function and nothing else.
// 14-36: Approve launch needs the owner's submitted review (P14-P35) and a prepared move, then
// calls startCutover once and never setOrgStage.
import { InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  approveFit: vi.fn(),
  declineFit: vi.fn(),
  declinePaidOrg: vi.fn(),
  setOrgStage: vi.fn(),
  startCutover: vi.fn(),
  setBuildNote: vi.fn(),
  staffOrgStage: vi.fn(),
  staffLaunchQueue: vi.fn(),
  staffPolishQueue: vi.fn(),
  assembleSiteAsStaff: vi.fn(),
  revealLeadEmail: vi.fn(),
  rerunLines: vi.fn(() => ["Home  rebuilt", "1 page rebuilt, 0 left alone."]),
  BUILD_NOTE_MAX: 280,
  DECLINE_NOTE_MAX: 200,
  DECLINE_REASON_CATEGORIES: ["fit", "capacity", "scope", "other"],
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("../lib/assembly-deps", () => ({ assemblyDeps: () => ({ deps: 1 }) }));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);

const actions = await import("../app/actions/staff/pipeline");
const { kit, resetStaffKit } = await import("./staff-test-kit");

const ORG = "abcdefghijklmno";

function session(role: "super_admin" | "support_agent", fresh: boolean) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: fresh,
    name: "Sam Admin",
    role,
    maskedEmail: "s•••@example.test",
  };
}

function stage(s: string) {
  return {
    orgName: "Rivera Bakery",
    stage: s,
    launchedAt: null,
    buildNote: "",
    status: "active",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  db.setOrgStage.mockResolvedValue({
    changed: true,
    launchedAt: "2026-10-15 15:00:00.000Z",
  });
  db.staffOrgStage.mockResolvedValue(stage("ready_for_review"));
  db.staffLaunchQueue.mockResolvedValue([launchRow()]);
  db.startCutover.mockResolvedValue({ code: "M-7", status: "cutover_running" });
});

const SUBMITTED = "2026-10-15 14:00:00.000Z";
const PREPARED = {
  code: "M-7",
  state: "prepared",
  domain: "riverabakery.com",
  waitingOn: null,
};

function launchRow(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    openChangeTickets: 0,
    openChangeTicketNumbers: [],
    review: { done: 6, total: 6, submittedAt: SUBMITTED, resubmitNeeded: [] },
    move: PREPARED,
    ...over,
  };
}

describe("approveLaunchAction", () => {
  it("support_agent gets REFUSED-ROLE and nothing launches", async () => {
    sess.getStaffSession.mockResolvedValue(session("support_agent", true));
    expect(await actions.approveLaunchAction(ORG)).toEqual({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.startCutover).not.toHaveBeenCalled();
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("stale step-up asks for a code first; fresh starts the cutover once, never setOrgStage", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await actions.approveLaunchAction(ORG)).toEqual({
      ok: false,
      code: "step_up_needed",
      message: "",
    });
    expect(db.startCutover).not.toHaveBeenCalled();

    const s = session("super_admin", true);
    sess.getStaffSession.mockResolvedValue(s);
    const res = await actions.approveLaunchAction(ORG);
    expect(res).toEqual({
      ok: true,
      data: {
        message: "Launching Rivera Bakery. Follow it on Site › Domain.",
        move: "M-7",
        status: "cutover_running",
      },
    });
    expect(db.startCutover).toHaveBeenCalledTimes(1);
    expect(db.startCutover).toHaveBeenCalledWith(s.ctx, ORG);
    expect(db.setOrgStage).not.toHaveBeenCalled();
    expect(kit.revalidated).toContain("/staff");
  });

  it("WR-C03: the toast follows the move status after the first run", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.startCutover.mockResolvedValueOnce({
      code: "M-7",
      status: "failed",
      currentStep: "https",
      failedStep: "https",
    });
    expect(await actions.approveLaunchAction(ORG)).toEqual({
      ok: true,
      data: {
        message:
          "The launch of Rivera Bakery stopped at step 8 HTTPS. Open Site › Domain to retry.",
        move: "M-7",
        status: "failed",
      },
    });
    db.startCutover.mockResolvedValueOnce({
      code: "M-7",
      status: "done",
      currentStep: "search",
      failedStep: null,
    });
    expect(await actions.approveLaunchAction(ORG)).toMatchObject({
      ok: true,
      data: { message: "Rivera Bakery is live.", status: "done" },
    });
  });

  it("P14-P35: review not submitted is refused even with a prepared move and Launch anyway", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        review: { done: 6, total: 6, submittedAt: null, resubmitNeeded: [] },
      }),
    ]);
    const res = await actions.approveLaunchAction(ORG, { launchAnyway: true });
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      message: "The owner hasn't sent the review yet.",
    });
    expect(db.startCutover).not.toHaveBeenCalled();
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("CR-D01: a stale send (pages changed since) is refused even with Launch anyway", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        review: {
          done: 6,
          total: 6,
          submittedAt: SUBMITTED,
          resubmitNeeded: ["About us", "Home"],
        },
      }),
    ]);
    const res = await actions.approveLaunchAction(ORG, { launchAnyway: true });
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      message: P14_COPY.APPROVE_RESEND({ count: 2 }),
    });
    expect(db.startCutover).not.toHaveBeenCalled();
  });

  it("a move that is not prepared gets APPROVE_BLOCKED; no domain asks to connect one", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        move: {
          code: "M-7",
          state: "waiting_owner",
          domain: "riverabakery.com",
          waitingOn: "waiting on nameservers",
        },
      }),
    ]);
    const blocked = await actions.approveLaunchAction(ORG, {
      launchAnyway: true,
    });
    expect(blocked).toEqual({
      ok: false,
      code: "invalid_input",
      message: P14_COPY.APPROVE_BLOCKED({
        waitingOn: "waiting on nameservers",
      }),
    });
    expect(blocked.ok ? "" : blocked.message).toBe(
      "Domain not prepared: waiting on nameservers.",
    );

    db.staffLaunchQueue.mockResolvedValue([
      launchRow({
        move: { code: null, state: "none", waitingOn: "no domain" },
      }),
    ]);
    const none = await actions.approveLaunchAction(ORG);
    expect(none).toMatchObject({
      ok: false,
      message: "Connect a domain first: the site has no domain.",
    });
    expect(db.startCutover).not.toHaveBeenCalled();
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("open change tickets need Launch anyway", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffLaunchQueue.mockResolvedValue([
      launchRow({ openChangeTickets: 2, openChangeTicketNumbers: [1, 2] }),
    ]);
    const refused = await actions.approveLaunchAction(ORG, {
      launchAnyway: false,
    });
    expect(refused).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "launchAnyway",
    });
    expect(refused.ok ? "" : refused.message).toContain(
      "2 change requests are still open",
    );
    expect(db.startCutover).not.toHaveBeenCalled();

    const ok = await actions.approveLaunchAction(ORG, { launchAnyway: true });
    expect(ok.ok).toBe(true);
    expect(db.startCutover).toHaveBeenCalledWith(expect.anything(), ORG);
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("a cutover refusal from @cds/db comes back as its copy", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.startCutover.mockRejectedValue(
      new InvalidInput(
        P14_COPY.APPROVE_BLOCKED({
          waitingOn: "the launch is already running",
        }),
      ),
    );
    const res = await actions.approveLaunchAction(ORG);
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Domain not prepared: the launch is already running.",
    });
  });

  it("WR-C03: no launch-queue row refuses instead of reading 0 open changes", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffLaunchQueue.mockResolvedValue([]);
    const res = await actions.approveLaunchAction(ORG, { launchAnyway: true });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.startCutover).not.toHaveBeenCalled();
  });

  it("refuses a site that is not in review", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffOrgStage.mockResolvedValue(stage("being_built"));
    const res = await actions.approveLaunchAction(ORG);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.startCutover).not.toHaveBeenCalled();
  });

  it("malformed org id gets the not-found copy without a session read", async () => {
    const res = await actions.approveLaunchAction("../etc");
    expect(res).toEqual({
      ok: false,
      code: "not_found",
      message: "That site wasn't found.",
    });
    expect(sess.getStaffSession).not.toHaveBeenCalled();
  });
});

describe("fit actions", () => {
  it("approveFit calls approveFit with the reviewed fingerprint, never setOrgStage", async () => {
    const s = session("super_admin", true);
    sess.getStaffSession.mockResolvedValue(s);
    db.staffOrgStage.mockResolvedValue(stage("ready_for_build"));
    const res = await actions.approveFitAction(ORG, {
      reason: "Checked the site, it's a bakery",
      reviewed: "fp123",
    });
    expect(res).toMatchObject({ ok: true, data: { readyForBuild: true } });
    expect(db.approveFit).toHaveBeenCalledWith(
      s.ctx,
      ORG,
      "Checked the site, it's a bakery",
      { reviewed: "fp123", overrideBlocked: false },
    );
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("passes the override for a blocked verdict", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffOrgStage.mockResolvedValue(stage("intake"));
    await actions.approveFitAction(ORG, {
      reason: "Reviewed by hand",
      reviewed: "fp",
      overrideBlocked: true,
    });
    expect(db.approveFit.mock.calls[0]?.[3]).toEqual({
      reviewed: "fp",
      overrideBlocked: true,
    });
  });

  it("a blocked refusal from approveFit comes back as its copy", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.approveFit.mockRejectedValue(new InvalidInput("Blocked by screening."));
    expect(
      await actions.approveFitAction(ORG, {
        reason: "ok then",
        reviewed: "fp",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      message: "Blocked by screening.",
    });
  });

  it("needs a reason, a fingerprint, super_admin and a fresh step-up", async () => {
    expect(
      await actions.approveFitAction(ORG, { reason: "no", reviewed: "fp" }),
    ).toMatchObject({ ok: false, field: "reason" });
    expect(
      await actions.approveFitAction(ORG, { reason: "long enough" }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    sess.getStaffSession.mockResolvedValue(session("support_agent", true));
    expect(
      await actions.approveFitAction(ORG, { reason: "fine", reviewed: "fp" }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(
      await actions.approveFitAction(ORG, { reason: "fine", reviewed: "fp" }),
    ).toMatchObject({ ok: false, code: "step_up_needed" });
    expect(db.approveFit).not.toHaveBeenCalled();
  });

  it("declineFit builds the reason from category and note", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.declineFitAction(ORG, {
      reasonCategory: "scope",
      note: "We don't host marketplaces.",
    });
    expect(res.ok).toBe(true);
    expect(db.declineFit).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      "scope: We don't host marketplaces.",
    );
    expect(
      await actions.declineFitAction(ORG, { reasonCategory: "other" }),
    ).toMatchObject({ ok: false, field: "note" });
    expect(
      await actions.declineFitAction(ORG, { reasonCategory: "nope" }),
    ).toMatchObject({ ok: false, field: "reasonCategory" });
  });

  it("declinePaidOrder calls declinePaidOrg with the CLI's input and line", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.declinePaidOrg.mockResolvedValue({
      refundedCents: 150000,
      deleteOn: "14 Nov 2026",
      emailed: true,
    });
    const res = await actions.declinePaidOrderAction(ORG, {
      reasonCategory: "capacity",
    });
    expect(db.declinePaidOrg).toHaveBeenCalledWith(expect.anything(), ORG, {
      reasonCategory: "capacity",
      note: null,
    });
    expect(res).toMatchObject({
      ok: true,
      data: {
        message:
          "Declined and refunded $1,500.00. Owner emailed. Site data deletes on 14 Nov 2026.",
      },
    });
  });
});

describe("stage, assembly, note and lead actions", () => {
  it("moveStage moves between build stages without a step-up", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    db.staffOrgStage.mockResolvedValue(stage("ready_for_build"));
    const moved = await actions.moveStageAction(ORG, "being_built");
    expect(moved).toMatchObject({
      ok: true,
      data: { message: "Stage moved: ready_for_build -> being_built." },
    });
    expect(await actions.moveStageAction(ORG, "done")).toMatchObject({
      field: "to",
    });
  });

  it("WR-C03: moveStage never targets live or fit_review (launch is Approve launch)", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffOrgStage.mockResolvedValue(stage("intake"));
    const live = await actions.moveStageAction(ORG, "live");
    expect(live).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "to",
    });
    expect(live.ok ? "" : live.message).toContain("Approve launch");
    expect(await actions.moveStageAction(ORG, "fit_review")).toMatchObject({
      ok: false,
      field: "to",
    });
    expect(await actions.moveStageAction(ORG, "intake")).toMatchObject({
      ok: false,
      field: "to",
    });
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("moveStage never clears fit review (Pitfall 5)", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffOrgStage.mockResolvedValue(stage("fit_review"));
    const res = await actions.moveStageAction(ORG, "ready_for_build");
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.setOrgStage).not.toHaveBeenCalled();
  });

  it("markReadyForReview needs the site in the polish queue", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    db.staffOrgStage.mockResolvedValue(stage("being_built"));
    db.staffPolishQueue.mockResolvedValue([]);
    expect(await actions.markReadyForReviewAction(ORG)).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(db.setOrgStage).not.toHaveBeenCalled();
    db.staffPolishQueue.mockResolvedValue([{ orgId: ORG }]);
    expect(await actions.markReadyForReviewAction(ORG)).toMatchObject({
      ok: true,
      data: { to: "ready_for_review" },
    });
    expect(db.setOrgStage).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      "ready_for_review",
    );
    sess.getStaffSession.mockResolvedValue(session("support_agent", true));
    expect(await actions.markReadyForReviewAction(ORG)).toMatchObject({
      code: "forbidden",
    });
  });

  it("rerunAssembly calls assembleSiteAsStaff with rerun (agents allowed)", async () => {
    const s = session("support_agent", false);
    sess.getStaffSession.mockResolvedValue(s);
    db.assembleSiteAsStaff.mockResolvedValue({
      status: "done",
      report: { slots: [] },
      ledger: {},
      previewHost: "rivera.sites.localhost",
    });
    const res = await actions.rerunAssemblyAction(ORG);
    expect(db.assembleSiteAsStaff).toHaveBeenCalledWith(
      s.ctx,
      ORG,
      { rerun: true },
      { deps: 1 },
    );
    expect(res).toMatchObject({
      ok: true,
      data: { status: "done", message: "1 page rebuilt, 0 left alone." },
    });
    db.assembleSiteAsStaff.mockResolvedValue({ status: "busy", ledger: {} });
    expect(await actions.rerunAssemblyAction(ORG)).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("saveBuildNote sets or clears the note (agents allowed)", async () => {
    sess.getStaffSession.mockResolvedValue(session("support_agent", false));
    expect(
      await actions.saveBuildNoteAction(ORG, "  Writing your About page "),
    ).toMatchObject({ ok: true, data: { note: "Writing your About page" } });
    expect(db.setBuildNote).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      "Writing your About page",
    );
    await actions.saveBuildNoteAction(ORG, null);
    expect(db.setBuildNote).toHaveBeenLastCalledWith(
      expect.anything(),
      ORG,
      "",
    );
    expect(await actions.saveBuildNoteAction(ORG, "a\nb")).toMatchObject({
      field: "note",
    });
    expect(
      await actions.saveBuildNoteAction(ORG, "x".repeat(281)),
    ).toMatchObject({ field: "note" });
  });

  it("revealLeadEmail returns the address only through revealLeadEmail", async () => {
    const s = session("support_agent", false);
    sess.getStaffSession.mockResolvedValue(s);
    db.revealLeadEmail.mockResolvedValue("maria@example.com");
    expect(await actions.revealLeadEmailAction("lead123")).toEqual({
      ok: true,
      data: { email: "maria@example.com" },
    });
    expect(db.revealLeadEmail).toHaveBeenCalledWith(s.ctx, "lead123");
    expect(await actions.revealLeadEmailAction("bad id!")).toMatchObject({
      code: "not_found",
    });
  });
});
