// 13-21 Task 1: runStaffAction (STAFF-06; RESEARCH Pattern 3; T-13-21-04). The staff session
// is mocked; the real matrix (authorizeStaff) and the real error mapping run.
import { Forbidden, InvalidInput, RateLimited } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
vi.mock("../lib/staff-session", () => sess);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);

const { runStaffAction } = await import("../lib/staff-action");
const { nextNavigationMock } = await import("./staff-test-kit");

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runStaffAction", () => {
  it("returns session_ended without a session and never calls fn", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const fn = vi.fn();
    expect(await runStaffAction("console", {}, fn)).toEqual({
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("re-checks the matrix: an agent on prices_set gets REFUSED-ROLE", async () => {
    sess.getStaffSession.mockResolvedValue(session("support_agent", true));
    const fn = vi.fn();
    expect(await runStaffAction("prices_set", { stepUp: true }, fn)).toEqual({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("asks for a step-up when the session is stale and does not call fn", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const fn = vi.fn();
    expect(await runStaffAction("prices_set", { stepUp: true }, fn)).toEqual({
      ok: false,
      code: "step_up_needed",
      message: "",
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs fn with the platform context when fresh", async () => {
    const s = session("super_admin", true);
    sess.getStaffSession.mockResolvedValue(s);
    const fn = vi.fn().mockResolvedValue({ done: 1 });
    expect(await runStaffAction("prices_set", { stepUp: true }, fn)).toEqual({
      ok: true,
      data: { done: 1 },
    });
    expect(fn).toHaveBeenCalledWith(s.ctx, s);
  });

  it("a stale session still runs actions that need no step-up", async () => {
    sess.getStaffSession.mockResolvedValue(session("support_agent", false));
    const res = await runStaffAction("support_reply", {}, async () => 7);
    expect(res).toEqual({ ok: true, data: 7 });
  });

  it("maps CdsErrors to fixed copy", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(
      await runStaffAction("console", {}, async () => {
        throw new Forbidden("staff role may not use x");
      }),
    ).toEqual({ ok: false, code: "forbidden", message: P13_COPY.REFUSED_ROLE });
    expect(
      await runStaffAction("console", {}, async () => {
        throw new InvalidInput("This request is already handled.");
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      message: "This request is already handled.",
    });
    const rl = await runStaffAction("console", {}, async () => {
      throw new RateLimited("slow");
    });
    expect(rl).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("logs unknown errors by class name only and returns generic copy", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runStaffAction("console", {}, async () => {
      throw new TypeError("secret body text");
    });
    expect(res).toMatchObject({ ok: false, code: "save_failed" });
    expect(spy).toHaveBeenCalledWith("[staff action] failed", "TypeError");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });

  it("an outage while reading the session is a failed result, not a rejection", async () => {
    sess.getStaffSession.mockRejectedValue(new TypeError("fetch failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runStaffAction("console", {}, async () => 1);
    expect(res).toMatchObject({ ok: false, code: "save_failed" });
    spy.mockRestore();
  });

  it("rethrows Next control flow (redirect / notFound)", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    await expect(
      runStaffAction("console", {}, async () =>
        nextNavigationMock.redirect("/staff/sites/x"),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/staff/sites/x");
  });
});
