// 13-21 Task 2: staff sign-in, step-up and sign-out actions against PocketBase 0.39.11
// (STAFF-06; P13-P1, P13-P2; T-13-21-01, T-13-21-02, T-13-21-04). The real actions, the real
// staff_sessions rows and the real OTP stand-in; next/* come from the shared staff test kit.
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
import { P13_COPY } from "@cds/core/staff";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb, otpCodeFor } from "../../../packages/db/test/seeded";
import {
  createTestStaffUser,
  resetSignInLimitsForTests,
} from "../../../packages/db/test/staff-users";
import {
  kit,
  nextSignal,
  resetStaffKit,
  signInStaffForTest,
  staffCookieValue,
} from "./staff-test-kit";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/session");
const { getStaffSession } = await import("../lib/staff-session");
const { runStaffAction } = await import("../lib/staff-action");

let inst: PbInstance | undefined;

beforeAll(async () => {
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
});

afterAll(async () => {
  vi.useRealTimers();
  await inst?.stop();
});

beforeEach(() => {
  vi.useRealTimers();
  resetStaffKit();
  resetSignInLimitsForTests();
});

describe("staff sign-in actions", () => {
  it("password then code: no cookie until the code, then cookie + redirect to next", async (t) => {
    if (!inst) return t.skip();
    const { email, password } = await createTestStaffUser("super_admin");
    const started = await actions.staffSignInAction(
      email,
      password,
      "/staff/tickets?tab=inbox",
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.otpId).toBeTruthy();
    expect(started.data.mfaId).toBeTruthy();
    expect(started.data.maskedEmail).toMatch(/^s•••@example\.test$/);
    expect(started.data.next).toBe("/staff/tickets?tab=inbox");
    expect(kit.sets).toEqual([]);

    const code = await otpCodeFor(inst, started.data.otpId);
    const signal = await nextSignal(() =>
      actions.staffConfirmCodeAction({
        mfaId: started.data.mfaId,
        otpId: started.data.otpId,
        code,
        next: "/staff/tickets?tab=inbox",
      }),
    );
    expect(signal).toBe("NEXT_REDIRECT:/staff/tickets?tab=inbox");
    expect(kit.sets).toHaveLength(1);
    expect(kit.sets[0]).toMatchObject({
      name: "cds_staff",
      options: { httpOnly: true, sameSite: "strict", path: "/" },
    });
    const session = await getStaffSession();
    expect(session).toMatchObject({ role: "super_admin", stepUpFresh: true });
  });

  it("an unsafe next falls back to /staff", async (t) => {
    if (!inst) return t.skip();
    const { email, password } = await createTestStaffUser("support_agent");
    const started = await actions.staffSignInAction(email, password);
    if (!started.ok) throw new Error(started.code);
    const code = await otpCodeFor(inst, started.data.otpId);
    const signal = await nextSignal(() =>
      actions.staffConfirmCodeAction({
        mfaId: started.data.mfaId,
        otpId: started.data.otpId,
        code,
        next: "https://evil.example/staff",
      }),
    );
    expect(signal).toBe("NEXT_REDIRECT:/staff");
  });

  it("a member account, a wrong password and an unknown address read the same", async (t) => {
    if (!inst) return t.skip();
    const member = await createTestStaffUser("");
    const staff = await createTestStaffUser("super_admin");
    const failed = {
      ok: false,
      code: "signin_failed",
      message: P13_COPY.STAFF_SIGNIN_FAILED,
    };
    expect(
      await actions.staffSignInAction(member.email, member.password),
    ).toEqual(failed);
    expect(await actions.staffSignInAction(staff.email, "nope-nope")).toEqual(
      failed,
    );
    expect(
      await actions.staffSignInAction("nobody@example.test", "whatever-pw"),
    ).toEqual(failed);
    expect(kit.sets).toEqual([]);
  });

  it("a wrong code is CODE-WRONG and sets no cookie", async (t) => {
    if (!inst) return t.skip();
    const { email, password } = await createTestStaffUser("super_admin");
    const started = await actions.staffSignInAction(email, password);
    if (!started.ok) throw new Error(started.code);
    const real = await otpCodeFor(inst, started.data.otpId);
    const wrong = real === "000000" ? "111111" : "000000";
    expect(
      await actions.staffConfirmCodeAction({
        mfaId: started.data.mfaId,
        otpId: started.data.otpId,
        code: wrong,
      }),
    ).toEqual({ ok: false, code: "code_wrong", message: P13_COPY.CODE_WRONG });
    expect(
      await actions.staffConfirmCodeAction({
        mfaId: started.data.mfaId,
        otpId: started.data.otpId,
        code: "12ab",
      }),
    ).toMatchObject({ code: "code_wrong" });
    expect(staffCookieValue()).toBeUndefined();
  });

  it("resend emails a fresh code that signs in", async (t) => {
    if (!inst) return t.skip();
    const { email, password } = await createTestStaffUser("support_agent");
    const first = await actions.staffSignInAction(email, password);
    const again = await actions.staffResendCodeAction(email, password);
    if (!first.ok || !again.ok) throw new Error("sign-in refused");
    expect(again.data.otpId).not.toBe(first.data.otpId);
    const code = await otpCodeFor(inst, again.data.otpId);
    const signal = await nextSignal(() =>
      actions.staffConfirmCodeAction({
        mfaId: again.data.mfaId,
        otpId: again.data.otpId,
        code,
      }),
    );
    expect(signal).toBe("NEXT_REDIRECT:/staff");
  });
});

describe("step-up and sign-out actions", () => {
  it("a stale session asks for a step-up; request + confirm makes it fresh", async (t) => {
    if (!inst) return t.skip();
    await signInStaffForTest(inst, "super_admin");
    // 20 minutes later: past the 15-minute step-up window, inside the 2 h idle limit.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 20 * 60 * 1000));

    const ran = vi.fn(async () => "done");
    expect(await runStaffAction("prices_set", { stepUp: true }, ran)).toEqual({
      ok: false,
      code: "step_up_needed",
      message: "",
    });
    expect(ran).not.toHaveBeenCalled();

    const req = await actions.staffRequestStepUpAction();
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    expect(req.data.maskedEmail).toMatch(/•••@example\.test$/);

    const real = await otpCodeFor(inst, req.data.otpId);
    const wrong = real === "000000" ? "111111" : "000000";
    expect(
      await actions.staffConfirmStepUpAction({
        otpId: req.data.otpId,
        code: wrong,
      }),
    ).toMatchObject({ ok: false, code: "code_wrong" });

    expect(
      await actions.staffConfirmStepUpAction({
        otpId: req.data.otpId,
        code: real,
      }),
    ).toEqual({ ok: true, data: null });
    expect(await runStaffAction("prices_set", { stepUp: true }, ran)).toEqual({
      ok: true,
      data: "done",
    });
  });

  it("step-up actions without a session are session_ended", async (t) => {
    if (!inst) return t.skip();
    expect(await actions.staffRequestStepUpAction()).toEqual({
      ok: false,
      code: "session_ended",
      message: P13_COPY.SESSION_ENDED,
    });
    expect(
      await actions.staffConfirmStepUpAction({ otpId: "x", code: "123456" }),
    ).toMatchObject({ code: "session_ended" });
  });

  it("sign-out deletes the cookie and revokes the token", async (t) => {
    if (!inst) return t.skip();
    const { token } = await signInStaffForTest(inst, "support_agent");
    expect(await getStaffSession()).not.toBeNull();
    expect(await nextSignal(() => actions.staffSignOutAction())).toBe(
      "NEXT_REDIRECT:/staff/sign-in",
    );
    expect(kit.deletes).toContain("cds_staff");
    expect(staffCookieValue()).toBeUndefined();
    // The old token, replayed, is refused: the row is ended server-side.
    kit.cookies.set("cds_staff", token);
    expect(await getStaffSession()).toBeNull();
    expect(await runStaffAction("console", {}, async () => 1)).toMatchObject({
      code: "session_ended",
    });
  });

  it("the member cookie never signs anyone into the console", async (t) => {
    if (!inst) return t.skip();
    const { token } = await signInStaffForTest(inst, "super_admin");
    resetStaffKit();
    kit.cookies.set("cds_session", token);
    expect(await getStaffSession()).toBeNull();
  });
});
