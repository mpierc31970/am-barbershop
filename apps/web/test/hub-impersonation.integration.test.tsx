// 13-26 Task 1: hub impersonation against PocketBase 0.39.11 (STAFF-06; D10, D98, P13-P4;
// RESEARCH Pattern 4, Pitfall 13; T-13-26-01..03). The real start / end actions, the real
// staff session, the real member sign-in and getHubSession; next/* come from the shared staff
// test kit. All four cookie combinations, a foreign-token cookie, the 60-minute box, End, and
// the audit row count (start 1, resumes 0, end 1).
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
import { authorize, ImpersonationDenied } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { linkSecret, signInMember } from "@cds/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  auditRowsFor,
  createTestMember,
} from "../../../packages/db/test/hub-member";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";
import { resetSignInLimitsForTests } from "../../../packages/db/test/staff-users";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import {
  kit,
  nextSignal,
  resetStaffKit,
  signInStaffForTest,
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

const { startImpersonationAction, endImpersonationAction } =
  await import("../app/actions/staff/impersonation");
const { getHubSession, requireHubSession } = await import("../lib/session");
const { getStaffSession } = await import("../lib/staff-session");
const { signImpersonation } = await import("../lib/impersonation-cookie");

const IMP = "cds_imp";
const STAFF = "cds_staff";
const MEMBER = "cds_session";

let inst: PbInstance | undefined;
let seed: TwoOrgs;
let superToken = "";
let superId = "";
let agentToken = "";
let memberToken = "";

function setCookies(c: { staff?: string; member?: string; imp?: string }) {
  kit.cookies.clear();
  if (c.staff) kit.cookies.set(STAFF, c.staff);
  if (c.member) kit.cookies.set(MEMBER, c.member);
  if (c.imp) kit.cookies.set(IMP, c.imp);
}

/** Start a view of org B as super admin; returns the cookie value. */
async function startAsSuper(reason = "Checking the menu"): Promise<string> {
  setCookies({ staff: superToken, member: memberToken });
  const signal = await nextSignal(() =>
    startImpersonationAction({ orgId: seed.B.org, view: "admin", reason }),
  );
  expect(signal).toBe("NEXT_REDIRECT:/hub");
  const value = kit.cookies.get(IMP);
  expect(value).toBeTruthy();
  return value!;
}

beforeAll(async () => {
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  resetStaffKit();
  resetSignInLimitsForTests();
  superToken = (await signInStaffForTest(inst, "super_admin")).token;
  superId = (await getStaffSession())!.ctx.actor;
  resetStaffKit();
  resetSignInLimitsForTests();
  agentToken = (await signInStaffForTest(inst, "support_agent")).token;
  const member = await createTestMember(seed.A.org, "owner");
  memberToken = (
    await signInMember(member.email, member.password, "203.0.113.21")
  ).token;
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

describe("getHubSession: the four cookie combinations (Pitfall 13)", () => {
  it("staff cookie only, no impersonation cookie: no hub session", async (t) => {
    if (!inst) return t.skip();
    setCookies({ staff: superToken });
    expect(await getHubSession()).toBeNull();
  });

  it("member cookie only: the member session, unchanged", async (t) => {
    if (!inst) return t.skip();
    setCookies({ member: memberToken });
    const s = await getHubSession();
    expect(s?.org.id).toBe(seed.A.org);
    expect(s?.ctx.impersonator).toBeFalsy();
    expect(s?.impersonation).toBeUndefined();
  });

  it("member + staff cookies without impersonation: the member session", async (t) => {
    if (!inst) return t.skip();
    setCookies({ member: memberToken, staff: superToken });
    const s = await getHubSession();
    expect(s?.org.id).toBe(seed.A.org);
    expect(s?.ctx.impersonator).toBeFalsy();
  });

  it("staff + valid impersonation cookie (member cookie too): the staff view of B", async (t) => {
    if (!inst) return t.skip();
    const before = (await auditRowsFor(seed.B.org, "impersonation.start"))
      .length;
    const imp = await startAsSuper();
    const set = kit.sets.find((c) => c.name === IMP);
    expect(set?.options).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 3600,
    });
    expect((await auditRowsFor(seed.B.org, "impersonation.start")).length).toBe(
      before + 1,
    );
    const total = (await auditRowsFor(seed.B.org)).length;

    setCookies({ staff: superToken, member: memberToken, imp });
    for (let i = 0; i < 5; i++) {
      const s = await getHubSession();
      expect(s?.org.id).toBe(seed.B.org);
      expect(s?.org.name).toBe("Org B");
      expect(s?.orgs).toEqual([
        { id: seed.B.org, name: "Org B", role: "admin" },
      ]);
      expect(s?.ctx.impersonator).toBe(superId);
      expect(s?.ctx.role).toBe("admin");
      expect(s?.email).toMatch(/•••/);
      expect(s?.impersonation).toMatchObject({
        business: "Org B",
        view: "admin",
        reason: "Checking the menu",
      });
      expect(Date.parse(s!.impersonation!.endsAt) - Date.now()).toBeGreaterThan(
        55 * 60 * 1000,
      );
    }
    // Resumes write nothing (P13-P4).
    expect((await auditRowsFor(seed.B.org)).length).toBe(total);
  });
});

describe("refused impersonation cookies fall through to the member cookie", () => {
  it("a cookie bound to another staff token is ignored", async (t) => {
    if (!inst) return t.skip();
    const imp = await startAsSuper();
    // Same payload, but presented with the agent's staff cookie.
    setCookies({ staff: agentToken, member: memberToken, imp });
    const s = await getHubSession();
    expect(s?.org.id).toBe(seed.A.org);
    expect(s?.impersonation).toBeUndefined();
    // A cookie signed for the agent's token naming the super admin's start row: refused
    // server-side (actor check), so still the member session.
    const forged = signImpersonation(
      JSON.parse(Buffer.from(imp.split(".")[1]!, "base64url").toString("utf8")),
      agentToken,
      linkSecret(),
    );
    setCookies({ staff: agentToken, member: memberToken, imp: forged });
    expect((await getHubSession())?.org.id).toBe(seed.A.org);
  });

  it("after 60 minutes the cookie is ignored; requireHubSession sends staff back to the console", async (t) => {
    if (!inst) return t.skip();
    const imp = await startAsSuper();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 60 * 1000 });
    setCookies({ staff: superToken, member: memberToken, imp });
    const s = await getHubSession();
    expect(s?.org.id).toBe(seed.A.org);
    expect(s?.impersonation).toBeUndefined();
    setCookies({ staff: superToken, imp });
    expect(await getHubSession()).toBeNull();
    expect(await nextSignal(() => requireHubSession())).toBe(
      "NEXT_REDIRECT:/staff/sites",
    );
    vi.useRealTimers();
  });

  it("End writes impersonation.end, clears the cookie, returns to the site page; the old cookie is then ignored", async (t) => {
    if (!inst) return t.skip();
    const imp = await startAsSuper();
    const startId = JSON.parse(
      Buffer.from(imp.split(".")[1]!, "base64url").toString("utf8"),
    ).startId as string;
    setCookies({ staff: superToken, imp });
    expect(await nextSignal(() => endImpersonationAction())).toBe(
      `NEXT_REDIRECT:/staff/sites/${seed.B.org}`,
    );
    expect(kit.cookies.has(IMP)).toBe(false);
    expect(kit.deletes).toContain(IMP);
    const ends = await auditRowsFor(seed.B.org, "impersonation.end");
    const mine = ends.filter(
      (r) => (r.meta as { startId?: string } | null)?.startId === startId,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.actor).toBe(superId);
    setCookies({ staff: superToken, member: memberToken, imp });
    expect((await getHubSession())?.org.id).toBe(seed.A.org);
  });

  it("End without a staff session still deletes the cookie and goes to sign-in", async (t) => {
    if (!inst) return t.skip();
    const imp = await startAsSuper();
    setCookies({ imp });
    expect(await nextSignal(() => endImpersonationAction())).toBe(
      "NEXT_REDIRECT:/staff/sign-in",
    );
    expect(kit.cookies.has(IMP)).toBe(false);
  });
});

describe("start refusals and the deny list", () => {
  it("support agent asking for the owner view: REFUSED-ROLE, no cookie", async (t) => {
    if (!inst) return t.skip();
    setCookies({ staff: agentToken });
    const r = await startImpersonationAction({
      orgId: seed.B.org,
      view: "owner",
      reason: "Checking the menu",
    });
    expect(r).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(kit.cookies.has(IMP)).toBe(false);
  });

  it("a one-character reason is a field error and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const before = (await auditRowsFor(seed.B.org, "impersonation.start"))
      .length;
    setCookies({ staff: superToken });
    const r = await startImpersonationAction({
      orgId: seed.B.org,
      view: "admin",
      reason: "x",
    });
    expect(r).toMatchObject({ ok: false, field: "reason" });
    expect((await auditRowsFor(seed.B.org, "impersonation.start")).length).toBe(
      before,
    );
  });

  it("no staff session: session_ended", async (t) => {
    if (!inst) return t.skip();
    setCookies({ member: memberToken });
    const r = await startImpersonationAction({
      orgId: seed.B.org,
      view: "admin",
      reason: "Checking the menu",
    });
    expect(r).toMatchObject({ ok: false, code: "session_ended" });
  });

  it("the impersonated context keeps the deny list (support:write refused)", async (t) => {
    if (!inst) return t.skip();
    const imp = await startAsSuper();
    setCookies({ staff: superToken, imp });
    const s = await getHubSession();
    expect(s?.ctx.impersonator).toBe(superId);
    expect(() => authorize(s!.ctx, "support", "write")).toThrow(
      ImpersonationDenied,
    );
  });
});

describe("WR-C02: every impersonation.start gets an end", () => {
  function startIdOf(imp: string): string {
    return JSON.parse(
      Buffer.from(imp.split(".")[1]!, "base64url").toString("utf8"),
    ).startId as string;
  }

  async function endsFor(startId: string) {
    return (await auditRowsFor(seed.B.org, "impersonation.end")).filter(
      (r) => (r.meta as { startId?: string } | null)?.startId === startId,
    );
  }

  it("starting a second view ends the first one", async (t) => {
    if (!inst) return t.skip();
    const first = await startAsSuper("First look");
    // The cookie stays in the jar: open another view from the console.
    expect(
      await nextSignal(() =>
        startImpersonationAction({
          orgId: seed.B.org,
          view: "admin",
          reason: "Second look",
        }),
      ),
    ).toBe("NEXT_REDIRECT:/hub");
    const second = kit.cookies.get(IMP)!;
    expect(startIdOf(second)).not.toBe(startIdOf(first));
    expect(await endsFor(startIdOf(first))).toHaveLength(1);
    expect(await endsFor(startIdOf(second))).toHaveLength(0);
  });

  it("staff sign-out ends the running view and deletes the impersonation cookie", async (t) => {
    if (!inst) return t.skip();
    // A fresh staff session: signing out revokes it.
    resetStaffKit();
    resetSignInLimitsForTests();
    const token = (await signInStaffForTest(inst, "super_admin")).token;
    setCookies({ staff: token });
    expect(
      await nextSignal(() =>
        startImpersonationAction({
          orgId: seed.B.org,
          view: "admin",
          reason: "Before sign-out",
        }),
      ),
    ).toBe("NEXT_REDIRECT:/hub");
    const imp = kit.cookies.get(IMP)!;
    const { staffSignOutAction } = await import("../app/actions/staff/session");
    expect(await nextSignal(() => staffSignOutAction())).toBe(
      "NEXT_REDIRECT:/staff/sign-in",
    );
    expect(kit.cookies.has(IMP)).toBe(false);
    expect(kit.cookies.has(STAFF)).toBe(false);
    expect(await endsFor(startIdOf(imp))).toHaveLength(1);
  });
});
