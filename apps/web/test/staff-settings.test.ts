// 13-46 Task 1: Settings actions (STAFF-18, STAFF-16; T-13-46-01, T-13-46-03). @cds/db and the
// staff session are mocked; the real matrix (authorizeStaff inside runStaffAction), the real
// input checks and the real error mapping run.
import { readFileSync } from "node:fs";
import { InvalidInput } from "@cds/core";
import { renderToStaticMarkup } from "react-dom/server";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  DEMO_NAME: "Bella's Salon",
  setStaffRole: vi.fn(),
  staffListStaff: vi.fn(),
  staffResetDemo: vi.fn(),
  monitorStatus: vi.fn(),
  DEMO_JOB_COUNTS_KEY: "job:demo:last_counts",
  DEMO_LAST_RESET_KEY: "demo:last_reset",
  DEMO_RESET_HOUR: 3,
  DEMO_RESET_TIME_ZONE: "America/Chicago",
  findDemoOrgId: vi.fn(),
  readPlatformMeta: vi.fn(),
  staffGetSite: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { list: () => [], get: () => undefined },
}));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: { sr: 1 } }));
vi.mock("../lib/invalidator", () => ({ nextInvalidator: { inv: 1 } }));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/settings");
const { resetStaffKit } = await import("./staff-test-kit");

const ME = "me0000000000001";
const LEE = "lee000000000001";

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: ME, staffRole: role, ip: "203.0.113.46" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Sam Admin",
    role,
    maskedEmail: "s•••@example.test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffListStaff.mockResolvedValue([
    {
      id: LEE,
      name: "Lee Park",
      emailMasked: "l•••@example.test",
      role: "super_admin",
      lastSignIn: null,
    },
  ]);
  db.setStaffRole.mockResolvedValue(undefined);
  db.staffResetDemo.mockResolvedValue({
    orgId: "demo00000000001",
    rowsDeleted: 400,
    rowsSeeded: 412,
  });
});

describe("changeStaffRoleAction", () => {
  it("agent → REFUSED-ROLE; setStaffRole never called", async () => {
    const res = await actions.changeStaffRoleAction(LEE, "support_agent");
    expect(res).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.setStaffRole).not.toHaveBeenCalled();
  });

  it("super_admin with a stale step-up → step_up_needed; nothing read or written", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await actions.changeStaffRoleAction(LEE, "support_agent");
    expect(res).toMatchObject({ ok: false, code: "step_up_needed" });
    expect(db.staffListStaff).not.toHaveBeenCalled();
    expect(db.setStaffRole).not.toHaveBeenCalled();
  });

  it("fresh super_admin → setStaffRole with the same arguments as the CLI path", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.changeStaffRoleAction(LEE, "support_agent");
    expect(res).toEqual({
      ok: true,
      data: { message: "Lee is now a Support agent." },
    });
    expect(db.setStaffRole).toHaveBeenCalledTimes(1);
    const [ctx, id, role] = db.setStaffRole.mock.calls[0]!;
    expect(ctx).toMatchObject({ kind: "platform", staffRole: "super_admin" });
    expect(id).toBe(LEE);
    expect(role).toBe("support_agent");
  });

  it('"none" removes the staff role (setStaffRole with "")', async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.changeStaffRoleAction(LEE, "none");
    expect(res).toEqual({
      ok: true,
      data: { message: "Lee no longer has a staff role." },
    });
    expect(db.setStaffRole.mock.calls[0]![2]).toBe("");
  });

  it("refuses your own role, an unknown role, a bad id and a non-staff id", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(await actions.changeStaffRoleAction(ME, "support_agent")).toEqual({
      ok: false,
      code: "invalid_input",
      message: "You can't change your own role.",
    });
    expect(await actions.changeStaffRoleAction(LEE, "owner")).toMatchObject({
      ok: false,
      code: "invalid_input",
      field: "role",
    });
    expect(
      await actions.changeStaffRoleAction("../x", "support_agent"),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await actions.changeStaffRoleAction("nobody000000001", "support_agent"),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(db.setStaffRole).not.toHaveBeenCalled();
  });

  it("the last super_admin refusal is shown in console words", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.setStaffRole.mockRejectedValue(
      new InvalidInput("the platform must keep one super_admin"),
    );
    const res = await actions.changeStaffRoleAction(LEE, "support_agent");
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(res.ok ? "" : res.message).toContain("must keep one Super Admin");
  });
});

describe("resetDemoAction", () => {
  it("agent → REFUSED-ROLE; stale super_admin → step_up_needed", async () => {
    expect(await actions.resetDemoAction()).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    expect(await actions.resetDemoAction()).toMatchObject({
      ok: false,
      code: "step_up_needed",
    });
    expect(db.staffResetDemo).not.toHaveBeenCalled();
  });

  it("fresh super_admin → staffResetDemo with the app registries and the result line", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.resetDemoAction();
    expect(res).toEqual({
      ok: true,
      data: {
        message:
          "Reset Bella's Salon. 412 rows replaced. No other site changed.",
        rowsSeeded: 412,
        rowsDeleted: 400,
      },
    });
    const [ctx, opts] = db.staffResetDemo.mock.calls[0]!;
    expect(ctx).toMatchObject({ staffRole: "super_admin" });
    expect(opts).toMatchObject({
      sections: { sr: 1 },
      invalidator: { inv: 1 },
    });
    expect(opts.addons).toBeDefined();
  });

  it("a busy reset shows the lock message", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    db.staffResetDemo.mockRejectedValue(
      new InvalidInput(
        "A demo reset is already running. Try again in a few minutes.",
      ),
    );
    expect(await actions.resetDemoAction()).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "A demo reset is already running. Try again in a few minutes.",
    });
  });
});

const MONITOR_PANEL =
  "app/(platform)/staff/(console)/settings/panels/monitor.tsx";

describe("Settings › Monitor panel (T-13-46-02)", () => {
  it("renders Token configured: Yes and never the token value", async () => {
    const secret = "tok_" + "x".repeat(40);
    vi.stubEnv("MONITOR_TOKEN", secret);
    db.monitorStatus.mockResolvedValue({
      generated_at: "2026-10-16T12:00:00.000Z",
      version: "1",
      overall: "degraded",
      components: [],
      tenants: [],
      failsafe: null,
    });
    try {
      const { default: Panel } =
        await import("../app/(platform)/staff/(console)/settings/panels/monitor");
      const html = renderToStaticMarkup(await Panel());
      expect(html).toContain("Token configured");
      expect(html).toContain('data-token-configured="yes"');
      expect(html).not.toContain(secret);
      expect(html).toContain("/api/monitor/status");
      expect(html).toContain('data-section="failsafe"');
      expect(html).toContain("Degraded");
    } finally {
      vi.unstubAllEnvs();
    }
    // A cold import of a settings panel (its @cds/ui + islands graph) can pass 5 s (07-33).
  }, 30_000);

  it("reads process.env.MONITOR_TOKEN only inside Boolean(...)", () => {
    const src = readFileSync(
      new URL(`../${MONITOR_PANEL}`, import.meta.url),
      "utf8",
    );
    const uses = src.match(/.{0,8}process\.env\.MONITOR_TOKEN.?/g) ?? [];
    expect(uses.length).toBe(1);
    expect(uses[0]).toContain("Boolean(process.env.MONITOR_TOKEN)");
  });
});

describe("Settings › Demo tenant next reset", () => {
  it("is today's 3:30 am before it, tomorrow's after it (America/Chicago, across DST)", async () => {
    const { nextDemoResetText } =
      await import("../app/(platform)/staff/(console)/settings/panels/demo");
    // 2026-10-16 02:00 CDT = 07:00Z -> today.
    expect(nextDemoResetText(new Date("2026-10-16T07:00:00Z"))).toBe(
      "Oct 16, 3:30 am (America/Chicago)",
    );
    // 2026-10-16 03:45 CDT = 08:45Z -> tomorrow.
    expect(nextDemoResetText(new Date("2026-10-16T08:45:00Z"))).toBe(
      "Oct 17, 3:30 am (America/Chicago)",
    );
    // 2026-12-31 23:00 CST = 2027-01-01 05:00Z -> Jan 1.
    expect(nextDemoResetText(new Date("2027-01-01T05:00:00Z"))).toBe(
      "Jan 1, 3:30 am (America/Chicago)",
    );
  }, 30_000);
});
