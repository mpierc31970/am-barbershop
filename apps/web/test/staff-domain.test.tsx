// 14-51 Task 2: staff Site › Domain wiring (choice 4; DOM-08, DOM-05; T-14-51-01..03).
// @cds/db and the staff session are mocked; the real matrix (authorizeStaff), step-up gate,
// same-origin check, capped body reader and error mapping run.
import { authorizeStaff, Forbidden } from "@cds/core";
import { STAFF_TAB_IDS } from "@cds/core/staff";
import { P14_COPY } from "@cds/core/dns";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  staffCan: vi.fn(),
}));
const db = vi.hoisted(() => ({
  staffDomainView: vi.fn(),
  staffRetryStep: vi.fn(),
  staffRetakeSnapshot: vi.fn(),
  staffRerunPostSwitch: vi.fn(),
  staffAddZoneFile: vi.fn(),
  staffCancelMove: vi.fn(),
  staffOverrideGate: vi.fn(),
  staffStartMove: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/domains");
const route =
  await import("../app/(platform)/staff/api/domain/zone-file/route");
const sections = await import("../app/(platform)/staff/sections");
const domainPanel =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/domain");

const ORG = "abcdefghijklmno";
const REASON = "Owner asked on the phone today.";

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

const MOVE = {
  id: "move00000000001",
  code: "M-3",
  orgId: ORG,
  kind: "launch",
  fromHost: "rivera.sites.example.test",
  toHost: "riverabakery.com",
  status: "running",
  currentStep: "gate",
  steps: [],
  failedStep: null,
  findings: null,
  overrides: [],
  acks: [],
  primaryChoice: "apex",
  prepared: false,
  cancelNote: null,
};

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
  for (const fn of [
    db.staffRetryStep,
    db.staffRetakeSnapshot,
    db.staffRerunPostSwitch,
    db.staffAddZoneFile,
    db.staffCancelMove,
    db.staffOverrideGate,
  ]) {
    fn.mockResolvedValue(MOVE);
  }
  db.staffStartMove.mockResolvedValue({
    move: { ...MOVE, kind: "move" },
    message: "Move started. Rivera Bakery's owner was asked to connect x.com.",
  });
});

describe("site tabs (choice 1)", () => {
  it("Overview · Add-ons · Support · Media · Indexing · Domain · Offboarding · Audit · Actions", () => {
    const labels = sections.STAFF_SECTIONS.sites.tabs.map((t) => t.label);
    expect(labels).toEqual([
      "Overview",
      "Add-ons",
      "Support",
      "Media",
      "Indexing",
      "Domain",
      "Offboarding",
      "Audit",
      "Actions",
    ]);
    expect([...STAFF_TAB_IDS.sites]).toEqual(
      sections.STAFF_SECTIONS.sites.tabs.map((t) => t.id),
    );
  });

  it("Domain · 1 for a failed step or a pending override, never otherwise", () => {
    const counts = sections.staffTabLinks("sites", {
      base: `/staff/sites/${ORG}`,
      counts: { "sites.domain": 1 },
    });
    expect(counts.find((t) => t.id === "domain")?.label).toBe("Domain · 1");
    const attention = domainPanel.staffDomainAttention;
    expect(attention(null)).toBe(0);
    const view = (move: unknown, rules: unknown[] = []) =>
      ({ move, gate: { rules } }) as never;
    expect(attention(view(null))).toBe(0);
    expect(attention(view(MOVE))).toBe(0);
    expect(
      attention(view({ ...MOVE, status: "failed", failedStep: "https" })),
    ).toBe(1);
    // WR-D03: a failed move that was then cancelled keeps failedStep but needs nobody.
    expect(
      attention(view({ ...MOVE, status: "cancelled", failedStep: "https" })),
    ).toBe(0);
    expect(
      attention(
        view(MOVE, [{ rule: "G2", result: "fail", overridable: true }]),
      ),
    ).toBe(1);
    expect(
      attention(
        view({ ...MOVE, status: "cancelled" }, [
          { rule: "G2", result: "fail", overridable: true },
        ]),
      ),
    ).toBe(0);
  });
});

describe("staff domain actions (choice 2)", () => {
  it("a support_agent may retry, re-take, re-run and add a zone file", async () => {
    expect(await actions.retryStepAction(ORG)).toMatchObject({ ok: true });
    expect(await actions.retakeSnapshotAction(ORG)).toMatchObject({
      ok: true,
    });
    expect(await actions.rerunPostSwitchAction(ORG)).toMatchObject({
      ok: true,
    });
    expect(
      await actions.addZoneFileAction(
        ORG,
        "$ORIGIN x.com.\n@ 300 IN A 1.2.3.4",
      ),
    ).toMatchObject({ ok: true });
    expect(db.staffRetryStep).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "support_agent" }),
      ORG,
    );
  });

  it("a support_agent cannot cancel, override or start a move", async () => {
    sess.getStaffSession.mockResolvedValue(session("support_agent", true));
    for (const r of [
      await actions.cancelMoveAction(ORG, REASON),
      await actions.overrideGateAction(ORG, "G2", REASON),
      await actions.startMoveAction(ORG, { domain: "x.com", reason: REASON }),
    ]) {
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
      if (!r.ok) expect(r.message).toBe(P13_COPY.REFUSED_ROLE);
    }
    expect(db.staffCancelMove).not.toHaveBeenCalled();
    expect(db.staffOverrideGate).not.toHaveBeenCalled();
    expect(db.staffStartMove).not.toHaveBeenCalled();
  });

  it("cancel, override and start need a fresh step-up", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await actions.cancelMoveAction(ORG, REASON)).toEqual({
      ok: false,
      code: "step_up_needed",
      message: "",
    });
    expect(await actions.overrideGateAction(ORG, "G2", REASON)).toMatchObject({
      code: "step_up_needed",
    });
    expect(
      await actions.startMoveAction(ORG, { domain: "x.com", reason: REASON }),
    ).toMatchObject({ code: "step_up_needed" });
    expect(db.staffCancelMove).not.toHaveBeenCalled();

    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(await actions.cancelMoveAction(ORG, REASON)).toMatchObject({
      ok: true,
    });
    expect(db.staffCancelMove).toHaveBeenCalledWith(
      expect.objectContaining({ staffRole: "super_admin" }),
      ORG,
      REASON,
    );
    expect(
      await actions.startMoveAction(ORG, { domain: " x.com ", reason: REASON }),
    ).toMatchObject({ ok: true, data: { message: expect.any(String) } });
    expect(db.staffStartMove).toHaveBeenCalledWith(expect.anything(), ORG, {
      domain: "x.com",
      reason: REASON,
    });
  });

  it("narrows untrusted arguments before any session read", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(await actions.retryStepAction("../etc")).toMatchObject({
      code: "not_found",
    });
    expect(await actions.overrideGateAction(ORG, "G9", REASON)).toMatchObject({
      code: "invalid_input",
      field: "rule",
    });
    expect(await actions.overrideGateAction(ORG, "G2", "short")).toMatchObject({
      code: "invalid_input",
      field: "reason",
    });
    expect(await actions.cancelMoveAction(ORG, "x".repeat(501))).toMatchObject({
      code: "invalid_input",
      field: "reason",
    });
    expect(
      await actions.addZoneFileAction(ORG, "a".repeat(300 * 1024)),
    ).toMatchObject({ code: "invalid_input", field: "file" });
    expect(sess.getStaffSession).not.toHaveBeenCalled();
  });

  it("a db Forbidden maps to REFUSED-ROLE copy, never the raw error", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffOverrideGate.mockRejectedValueOnce(new Forbidden("raw detail"));
    const r = await actions.overrideGateAction(ORG, "G2", REASON);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(JSON.stringify(r)).not.toContain("raw detail");
  });
});

function upload(
  opts: { origin?: string; bytes?: number; org?: string } = {},
): Request {
  const form = new FormData();
  form.set("org", opts.org ?? ORG);
  form.set(
    "file",
    new File(
      [
        opts.bytes
          ? "a".repeat(opts.bytes)
          : "$ORIGIN x.com.\n@ 300 IN A 1.2.3.4\n",
      ],
      "zone.txt",
      { type: "text/plain" },
    ),
  );
  return new Request("http://console.test/staff/api/domain/zone-file", {
    method: "POST",
    headers: {
      host: "console.test",
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body: form,
  });
}

describe("POST /staff/api/domain/zone-file (choice 3)", () => {
  it("a foreign Origin → 403, the session is never read", async () => {
    const res = await route.POST(upload({ origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(sess.getStaffSession).not.toHaveBeenCalled();
    expect(db.staffAddZoneFile).not.toHaveBeenCalled();
  });

  it("no staff session → 401", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await route.POST(upload({ origin: "http://console.test" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: P13_COPY.SESSION_ENDED });
  });

  it("a 300 KiB file → 413 ZONE-TOO-BIG before the db is called", async () => {
    const res = await route.POST(
      upload({ origin: "http://console.test", bytes: 300 * 1024 }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: P14_COPY.ZONE_TOO_BIG });
    expect(db.staffAddZoneFile).not.toHaveBeenCalled();
  });

  it("a same-origin upload reaches staffAddZoneFile as text", async () => {
    const res = await route.POST(upload({ origin: "http://console.test" }));
    expect(res.status).toBe(200);
    expect(db.staffAddZoneFile).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "platform" }),
      ORG,
      "$ORIGIN x.com.\n@ 300 IN A 1.2.3.4\n",
    );
  });

  it("a bad org id → 404 without a db call", async () => {
    const res = await route.POST(
      upload({ origin: "http://console.test", org: "nope" }),
    );
    expect(res.status).toBe(404);
    expect(db.staffAddZoneFile).not.toHaveBeenCalled();
  });
});
