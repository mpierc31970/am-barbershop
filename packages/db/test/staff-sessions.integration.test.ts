// 13-12: staff console sessions + step-up (STAFF-06, P13-P1, P13-P2; T-13-12-01..05). Idle 2 h,
// absolute 12 h, server-side sign-out, the role re-read on every request, and a fresh emailed
// code (no password) for step-up behind the sign-in limiter. Time is driven by injected `now`.
import { Forbidden, RateLimited } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setStaffRole } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { resetSignInLimitsForTests } from "../src/rate-limit";
import {
  endStaffSession,
  pruneStaffSessions,
  readStaffSession,
  staffListStaff,
  staffRequestStepUp,
  staffStepUp,
  touchStaffSession,
} from "../src/staff/sessions";
import { bootPb, type PbInstance } from "./pb-harness";
import { otpCodeFor, staffSessionFor } from "./seeded";

const IP = "203.0.113.40";
const MIN = 60_000;
const HOUR = 60 * MIN;

let inst: PbInstance | null = null;
let pb: PocketBase;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
}, 120_000);

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSignInLimitsForTests();
});

async function session(
  role: "super_admin" | "support_agent" = "support_agent",
) {
  const t0 = new Date();
  const s = await staffSessionFor(inst!, role, { now: t0 });
  return { ...s, t0, at: (ms: number) => new Date(t0.getTime() + ms) };
}

describe("staff sessions (13-12)", () => {
  it("stores only a 64-hex token hash, with step_up_at and last_seen_at at sign-in", async () => {
    if (!inst) return;
    const s = await session();
    const row = await pb.collection("staff_sessions").getOne(s.sessionId);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toBe(s.token);
    expect(JSON.stringify(row)).not.toContain(s.token);
    expect(row.user).toBe(s.ctx.actor);
    expect(row.step_up_at).toBeTruthy();
    expect(row.last_seen_at).toBeTruthy();
    expect(row.ended_at).toBeFalsy();
  });

  it("is fresh within 15 minutes of sign-in and valid but not fresh at +1 h", async () => {
    if (!inst) return;
    const s = await session();
    const early = await readStaffSession(s.token, {
      ip: IP,
      now: s.at(14 * MIN),
    });
    expect(early.stepUpFresh).toBe(true);
    expect(early.sessionId).toBe(s.sessionId);
    expect(early.ctx.actor).toBe(s.ctx.actor);
    expect(early.ctx.staffRole).toBe("support_agent");
    expect(early.staffName).toBe("Mara Agent");
    expect(early.staffEmailMasked).toMatch(/^s•••@example\.test$/);
    expect(early.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const late = await readStaffSession(s.token, { ip: IP, now: s.at(HOUR) });
    expect(late.stepUpFresh).toBe(false);
  });

  it("refuses a session idle for more than 2 h", async () => {
    if (!inst) return;
    const s = await session();
    await expect(
      readStaffSession(s.token, { ip: IP, now: s.at(2 * HOUR + MIN) }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("a touch at +1 h keeps it alive at +2 h 30; +12 h 1 min is refused regardless", async () => {
    if (!inst) return;
    const s = await session();
    await touchStaffSession(s.token, { now: s.at(HOUR) });
    const ok = await readStaffSession(s.token, {
      ip: IP,
      now: s.at(2 * HOUR + 30 * MIN),
    });
    expect(ok.sessionId).toBe(s.sessionId);
    // Keep it active every 90 minutes up to the absolute limit.
    for (let h = 4; h <= 11; h += 1.5) {
      await touchStaffSession(s.token, { now: s.at(h * HOUR) });
    }
    await touchStaffSession(s.token, { now: s.at(11 * HOUR + 50 * MIN) });
    await expect(
      readStaffSession(s.token, { ip: IP, now: s.at(12 * HOUR + MIN) }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("touches last_seen_at at most every 5 minutes", async () => {
    if (!inst) return;
    const s = await session();
    const before = (await pb.collection("staff_sessions").getOne(s.sessionId))
      .last_seen_at;
    await readStaffSession(s.token, { ip: IP, now: s.at(2 * MIN) });
    const same = (await pb.collection("staff_sessions").getOne(s.sessionId))
      .last_seen_at;
    expect(same).toBe(before);
    await readStaffSession(s.token, { ip: IP, now: s.at(6 * MIN) });
    const moved = (await pb.collection("staff_sessions").getOne(s.sessionId))
      .last_seen_at;
    expect(moved).not.toBe(before);
  });

  it("endStaffSession revokes the token server-side", async () => {
    if (!inst) return;
    const s = await session();
    await endStaffSession(s.token, { now: s.at(MIN) });
    const row = await pb.collection("staff_sessions").getOne(s.sessionId);
    expect(row.ended_at).toBeTruthy();
    await expect(
      readStaffSession(s.token, { ip: IP, now: s.at(2 * MIN) }),
    ).rejects.toBeInstanceOf(Forbidden);
    // Unknown and repeated tokens are a no-op.
    await endStaffSession(s.token);
    await endStaffSession("not-a-token");
  });

  it("refuses an unknown token", async () => {
    if (!inst) return;
    await expect(
      readStaffSession("not-a-real-token", { ip: IP }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(readStaffSession("", { ip: IP })).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it("re-reads the role: a demoted staff member is refused at once", async () => {
    if (!inst) return;
    const admin = await session("super_admin");
    const agent = await session("support_agent");
    await readStaffSession(agent.token, { ip: IP, now: agent.at(MIN) });
    await setStaffRole(admin.ctx, agent.ctx.actor, "");
    await expect(
      readStaffSession(agent.token, { ip: IP, now: agent.at(2 * MIN) }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("step-up proves a fresh emailed code and stamps step_up_at (audited)", async () => {
    if (!inst) return;
    const s = await session();
    const stale = await readStaffSession(s.token, {
      ip: IP,
      now: s.at(20 * MIN),
    });
    expect(stale.stepUpFresh).toBe(false);
    const req = await staffRequestStepUp(stale.ctx, { sessionId: s.sessionId });
    expect(req.otpId).toBeTruthy();
    expect(req.maskedEmail).toMatch(/^s•••@example\.test$/);
    const code = await otpCodeFor(inst, req.otpId);
    const stepped = await staffStepUp(stale.ctx, {
      sessionId: s.sessionId,
      otpId: req.otpId,
      code,
      ip: IP,
      now: s.at(15 * MIN),
    });
    // The pinned PB answers a correct first-factor OTP for staff with 401 + mfaId (P13-P2).
    expect(stepped.proof).toBe("mfa_401");
    const fresh = await readStaffSession(s.token, {
      ip: IP,
      now: s.at(20 * MIN),
    });
    expect(fresh.stepUpFresh).toBe(true);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'staff.step_up' && target_id = {:id}", {
        id: s.sessionId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe("");
    expect(audit[0]!.actor).toBe(s.ctx.actor);
  });

  it("a wrong code is the generic Forbidden; the 11th failure is RateLimited", async () => {
    if (!inst) return;
    const s = await session();
    const req = await staffRequestStepUp(s.ctx, { sessionId: s.sessionId });
    const right = await otpCodeFor(inst, req.otpId);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 10; i++) {
      await expect(
        staffStepUp(s.ctx, {
          sessionId: s.sessionId,
          otpId: req.otpId,
          code: wrong,
          ip: IP,
        }),
      ).rejects.toThrow(/^invalid credentials$/);
    }
    await expect(
      staffStepUp(s.ctx, {
        sessionId: s.sessionId,
        otpId: req.otpId,
        code: wrong,
        ip: IP,
      }),
    ).rejects.toBeInstanceOf(RateLimited);
    const row = await pb.collection("staff_sessions").getOne(s.sessionId);
    const signedIn = Date.parse(String(row.step_up_at).replace(" ", "T"));
    expect(signedIn).toBeLessThanOrEqual(s.t0.getTime() + 1);
  });

  it("refuses someone else's code and someone else's session", async () => {
    if (!inst) return;
    const a = await session();
    const b = await session();
    const req = await staffRequestStepUp(a.ctx, { sessionId: a.sessionId });
    const code = await otpCodeFor(inst, req.otpId);
    // b presents a's otp + correct code on b's own session.
    await expect(
      staffStepUp(b.ctx, {
        sessionId: b.sessionId,
        otpId: req.otpId,
        code,
        ip: IP,
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    // b cannot step up or request a code on a's session.
    await expect(
      staffRequestStepUp(b.ctx, { sessionId: a.sessionId }),
    ).rejects.toBeInstanceOf(Forbidden);
    // a's code still works for a.
    await staffStepUp(a.ctx, {
      sessionId: a.sessionId,
      otpId: req.otpId,
      code,
      ip: IP,
    });
  });

  it("an expired (idle) session cannot step up or request a code, so it is never revived (WR-A12)", async () => {
    if (!inst) return;
    const s = await session();
    const req = await staffRequestStepUp(s.ctx, { sessionId: s.sessionId });
    const code = await otpCodeFor(inst, req.otpId);
    const idle = s.at(2 * HOUR + MIN);
    await expect(
      staffRequestStepUp(s.ctx, { sessionId: s.sessionId, now: idle }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      staffStepUp(s.ctx, {
        sessionId: s.sessionId,
        otpId: req.otpId,
        code,
        ip: IP,
        now: idle,
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      readStaffSession(s.token, { ip: IP, now: idle }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("pruneStaffSessions deletes rows older than 30 days", async () => {
    if (!inst) return;
    const s = await session();
    const job = mintSystemContext({ job: "health" });
    expect(await pruneStaffSessions(job, { now: s.at(29 * 24 * HOUR) })).toBe(
      0,
    );
    const n = await pruneStaffSessions(job, { now: s.at(31 * 24 * HOUR) });
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(
      pb.collection("staff_sessions").getOne(s.sessionId),
    ).rejects.toThrow();
  });
});

describe("staffListStaff (13-46)", () => {
  it("lists staff with masked emails and last sign-in for a super_admin; agents are refused", async () => {
    if (!inst) return;
    const sup = await session("super_admin");
    const agent = await session("support_agent");
    const rows = await staffListStaff(sup.ctx);
    const a = rows.find((r) => r.id === agent.userId);
    const s = rows.find((r) => r.id === sup.userId);
    expect(a?.role).toBe("support_agent");
    expect(s?.role).toBe("super_admin");
    for (const r of [a!, s!]) {
      expect(r.emailMasked).toMatch(/^.•••@/);
      expect(r.lastSignIn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(JSON.stringify(rows)).not.toContain(agent.email);
    expect(JSON.stringify(rows)).not.toContain(sup.email);
    await expect(staffListStaff(agent.ctx)).rejects.toBeInstanceOf(Forbidden);
  });
});
