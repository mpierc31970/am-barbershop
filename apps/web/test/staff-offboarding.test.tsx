// 14-43 Task 2: staff Site › Offboarding wiring (choices 4-5; LIFE-01, P14-P13;
// T-14-43-01, T-14-43-02). @cds/db and the staff session are mocked; the real matrix
// (authorizeStaff), step-up gate and error mapping run. Also covers the panel's view mapping
// (reverse gate report, cancelled notice reads as not leaving, Start case blocks) and the
// panel body (no longer the 14-51 stub).
import { authorizeStaff, Forbidden, InvalidInput } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  staffCan: vi.fn(),
}));
const db = vi.hoisted(() => ({
  staffOffboardingView: vi.fn(),
  staffStartOffboarding: vi.fn(),
  staffCancelOffboarding: vi.fn(),
  staffRerunHandback: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/offboarding");
const panel =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/offboarding");

const ORG = "abcdefghijklmno";
const REASON = "Owner asked by phone.";

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Lee Admin",
    role,
    maskedEmail: "l•••@example.test",
  };
}

const MX = {
  type: "MX" as const,
  name: "riverabakery.com",
  value: "mx.example.net",
  priority: 10,
  sources: ["zone_file" as const],
};
const TXT = {
  type: "TXT" as const,
  name: "riverabakery.com",
  value: "hello",
  sources: [],
};

function zone(over: Record<string, unknown> = {}) {
  return {
    domain: "riverabakery.com",
    zoneStatus: "active",
    registrar: "Namecheap",
    groups: { copy_exactly: [MX, TXT], points_to_cds: [], remove: [] },
    destination: "registrar",
    destinationNameservers: ["dns1.registrar-servers.com"],
    cdsNameservers: ["ada.ns.cloudflare.com"],
    results: [
      { record: MX, found: false },
      { record: TXT, found: true },
    ],
    canCheckBefore: true,
    status: "mismatch",
    emailMissing: 1,
    message: null,
    checkedAt: "2026-10-16T14:00:00.000Z",
    switchedAt: null,
    movedAwayAt: null,
    checkPassed: false,
    deletedAt: null,
    ...over,
  };
}

function offView(over: Record<string, unknown> = {}) {
  return {
    status: "notice",
    requestedAt: "2026-10-15T14:00:00.000Z",
    requestedByKind: "owner",
    noticeEndsAt: "2026-11-14T15:00:00.000Z",
    daysLeft: 28,
    next: "move your DNS",
    banner: "x",
    steps: [
      { key: "dns_handback", title: "Move your DNS", status: "open", at: null },
    ],
    systemSteps: [
      { key: "zone_deleted", title: "Zone deleted", status: "open", at: null },
    ],
    reasonCategory: "provider",
    note: "Moving on",
    cancelledAt: null,
    closedAt: null,
    handbackOverdueAt: null,
    canAct: true,
    ...over,
  };
}

function view(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    business: "Rivera Bakery",
    stage: "live",
    demo: false,
    closed: false,
    offboarding: null,
    handback: { zones: [] },
    handbackNeeded: true,
    noticeWouldEnd: "2026-11-16T15:00:00.000Z",
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  sess.staffCan.mockImplementation((role: string, feature: string) => {
    try {
      authorizeStaff(role as "super_admin", feature);
      return true;
    } catch {
      return false;
    }
  });
  db.staffStartOffboarding.mockResolvedValue(offView());
  db.staffCancelOffboarding.mockResolvedValue({
    view: offView({ status: "cancelled" }),
    dnsHandedBack: false,
    message: "x",
  });
  db.staffRerunHandback.mockResolvedValue([zone()]);
  db.staffOffboardingView.mockResolvedValue(view());
});

describe("staff offboarding actions (choice 4)", () => {
  it("a support_agent is refused Start and Cancel (offboard is super_admin)", async () => {
    for (const r of [
      await actions.startOffboardingAction(ORG, REASON),
      await actions.cancelOffboardingAction(ORG, REASON),
    ]) {
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
      if (!r.ok) expect(r.message).toBe(P13_COPY.REFUSED_ROLE);
    }
    expect(db.staffStartOffboarding).not.toHaveBeenCalled();
    expect(db.staffCancelOffboarding).not.toHaveBeenCalled();
  });

  it("a super_admin needs a fresh step-up for Start and Cancel", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await actions.startOffboardingAction(ORG, REASON)).toMatchObject({
      ok: false,
      code: "step_up_needed",
    });
    expect(await actions.cancelOffboardingAction(ORG, REASON)).toMatchObject({
      ok: false,
      code: "step_up_needed",
    });
    expect(db.staffStartOffboarding).not.toHaveBeenCalled();
    expect(db.staffCancelOffboarding).not.toHaveBeenCalled();
  });

  it("a stepped-up super_admin starts and cancels with the trimmed reason", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const started = await actions.startOffboardingAction(ORG, `  ${REASON} `);
    expect(started).toMatchObject({ ok: true });
    if (started.ok)
      expect(started.data.message).toContain("emailed the checklist");
    expect(db.staffStartOffboarding).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "super_admin" }),
      ORG,
      { reason: REASON },
    );
    const cancelled = await actions.cancelOffboardingAction(ORG, REASON);
    expect(cancelled).toMatchObject({ ok: true });
    if (cancelled.ok)
      expect(cancelled.data.message).toContain(
        "Their plan and price carry on.",
      );
    expect(db.staffCancelOffboarding).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      REASON,
    );
  });

  it("narrows arguments before reading the session", async () => {
    expect(await actions.startOffboardingAction("bad", REASON)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await actions.startOffboardingAction(ORG, "ab")).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "reason",
    });
    expect(
      await actions.cancelOffboardingAction(ORG, "x".repeat(501)),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await actions.cancelOffboardingAction(ORG, 42)).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(await actions.rerunHandbackAction({})).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(sess.getStaffSession).not.toHaveBeenCalled();
  });

  it("a support_agent may re-run the handback check (no step-up)", async () => {
    const r = await actions.rerunHandbackAction(ORG);
    expect(r).toMatchObject({ ok: true });
    if (r.ok)
      expect(r.data.message).toBe("Handback check re-run for 1 domain.");
    expect(db.staffRerunHandback).toHaveBeenCalledWith(expect.anything(), ORG);
  });

  it("db refusals map to safe copy (Forbidden never leaks; InvalidInput shows)", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffStartOffboarding.mockRejectedValueOnce(new Forbidden("raw detail"));
    const r = await actions.startOffboardingAction(ORG, REASON);
    expect(r).toMatchObject({ ok: false, message: P13_COPY.REFUSED_ROLE });
    db.staffRerunHandback.mockRejectedValueOnce(
      new InvalidInput("There's no DNS handback to check yet."),
    );
    const re = await actions.rerunHandbackAction(ORG);
    expect(re).toMatchObject({
      ok: false,
      message: "There's no DNS handback to check yet.",
    });
  });
});

describe("panel mapping (choice 1)", () => {
  it("builds the reverse gate report from the handback check", () => {
    const gate = panel.reverseGate(zone() as never)!;
    expect(gate.rules).toEqual([
      expect.objectContaining({
        rule: "G1",
        result: "fail",
        overridable: false,
      }),
    ]);
    expect(gate.records).toEqual([
      expect.objectContaining({
        group: "email",
        type: "MX",
        original: "10 mx.example.net",
        copy: null,
        result: "missing",
      }),
      expect.objectContaining({
        type: "TXT",
        original: "hello",
        copy: "hello",
        result: "match",
      }),
    ]);
    expect(gate.readBackFrom).toBe("dns1.registrar-servers.com");
    expect(
      panel.reverseGate(zone({ checkedAt: null, results: [] }) as never),
    ).toBeNull();
  });

  it("a cancelled notice reads as not leaving; Start blocks for demo, closed, running", () => {
    const cancelled = panel.offboardingPanelView(
      view({
        offboarding: offView({
          status: "cancelled",
          cancelledAt: "2026-10-16T10:00:00.000Z",
        }),
      }),
    );
    expect(cancelled.offboarding).toBeNull();
    expect(cancelled.lastCancelledAt).toBe("2026-10-16T10:00:00.000Z");
    expect(cancelled.start.blocked).toBeNull();
    expect(panel.startCase(view({ demo: true })).blocked).toContain("demo");
    expect(panel.startCase(view({ closed: true })).blocked).toContain("closed");
    expect(panel.startCase(view({ offboarding: offView() })).blocked).toContain(
      "already started",
    );
    const running = panel.offboardingPanelView(
      view({ offboarding: offView(), handback: { zones: [zone()] } }),
    );
    expect(running.offboarding?.systemSteps).toHaveLength(1);
    expect(running.handback[0]).toMatchObject({
      domain: "riverabakery.com",
      status: "mismatch",
      destination: "registrar",
    });
  });

  it("the panel body renders OffboardingPanel with the role gate (not the stub)", async () => {
    const agent = await panel.default({
      session: session("support_agent") as never,
      orgId: ORG,
      params: {},
    });
    expect(isValidElement(agent)).toBe(true);
    expect(
      (agent as { props: { canOffboard: boolean } }).props.canOffboard,
    ).toBe(false);
    const sup = await panel.default({
      session: session("super_admin") as never,
      orgId: ORG,
      params: {},
    });
    expect((sup as { props: { canOffboard: boolean } }).props.canOffboard).toBe(
      true,
    );
    expect(db.staffOffboardingView).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
    );
  });

  it("a failed read shows the load error, logged by class name only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.staffOffboardingView.mockRejectedValueOnce(new Error("secret host"));
    const out = await panel.default({
      session: session("super_admin") as never,
      orgId: ORG,
      params: {},
    });
    expect(isValidElement(out)).toBe(true);
    expect(JSON.stringify(err.mock.calls)).not.toContain("secret host");
    err.mockRestore();
  });
});
