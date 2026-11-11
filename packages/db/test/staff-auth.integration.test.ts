// TEN-15 staff MFA, TEN-11 staff role management and member context minting on the real
// PocketBase 0.39.11 binary (RESEARCH Pattern 7, Pitfall 2). Tokens carry no MFA claim, so
// the chokepoint owns the sign-in flow and rotates tokenKey whenever staff_role changes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Forbidden,
  InvalidInput,
  MfaRequired,
  NotFound,
  RateLimited,
} from "@cds/core";
import PocketBase, { ClientResponseError } from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  completeStaffSignIn,
  orgContextFromToken,
  platformContextFromToken,
  setStaffRole,
  signInMember,
  signInStaff,
} from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type PlatformContext } from "../src/context";
import { addMember, transferOwnership } from "../src/members";
import {
  SIGN_IN_PER_ACCOUNT,
  SIGN_IN_PER_ACCOUNT_IP,
  SIGN_IN_PER_IP,
} from "../src/rate-limit";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const HOOK_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "pb_hooks",
  "otp_standin.pb.js",
);
const GUARD_FILE = join(HOOK_FILE, "..", "users_auth_guard.pb.js");

let inst: PbInstance | null = null;
let pb: PocketBase;

type Seeded = { id: string; email: string; password: string };
let S: Seeded; // super_admin
let T: Seeded; // support_agent
let M: Seeded; // member, owner of org A
let orgA: string;
let orgB: string;

// Shared across ordered tests (Vitest runs one file's tests sequentially).
let sCtx: PlatformContext;
let tCtx: PlatformContext;
let tToken: string;
let mToken: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedUser(
  email: string,
  staffRole: "" | "super_admin" | "support_agent",
): Promise<Seeded> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: staffRole,
  });
  return { id: rec.id, email, password };
}

/** Read the OTP code the stand-in hook logged for this otpId (mail is never sent). */
async function otpCode(otpId: string): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users (\\w+) ${otpId} (\\d{6})`);
  for (let i = 0; i < 100; i++) {
    const m = re.exec(inst!.stdout());
    if (m) return m[2]!;
    await sleep(50);
  }
  throw new Error(`no OTP_STANDIN line for ${otpId}`);
}

async function fullStaffSignIn(
  u: Seeded,
): Promise<{ ctx: PlatformContext; token: string }> {
  const started = await signInStaff(u.email, u.password, IP);
  const code = await otpCode(started.otpId);
  return completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code,
    ip: IP,
  });
}

/** Request options carrying the app key, as guestClient() sends it (review CR-01). */
function appKeyHeader(key: string = inst!.appKey): {
  headers: Record<string, string>;
} {
  return { headers: { "X-CDS-App-Key": key } };
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  S = await seedUser("super@cds.test", "super_admin");
  T = await seedUser("agent@cds.test", "support_agent");
  M = await seedUser("member@cds.test", "");
  orgA = (
    await pb
      .collection("organizations")
      .create({ name: "Org A", slug: "org-a", status: "active" })
  ).id;
  orgB = (
    await pb
      .collection("organizations")
      .create({ name: "Org B", slug: "org-b", status: "active" })
  ).id;
  await pb.collection("memberships").create({
    user: M.id,
    organization: orgA,
    role: "owner",
    addon_grants: ["newsletter"],
  });
});

afterAll(async () => {
  await inst?.stop();
});

describe("TEN-15 PocketBase MFA on staff accounts (raw PB)", () => {
  it("staff password alone -> 401 with mfaId, no token", async (ctx) => {
    if (!inst) return ctx.skip();
    const guest = new PocketBase(inst.url);
    const err = await catchErr(
      guest
        .collection("users")
        .authWithPassword(S.email, S.password, appKeyHeader()),
    );
    expect(err).toBeInstanceOf(ClientResponseError);
    const e = err as ClientResponseError;
    expect(e.status).toBe(401);
    expect(typeof e.response.mfaId).toBe("string");
    expect(guest.authStore.token).toBe("");
  });

  it("staff OTP alone (no mfaId) -> 401 with mfaId", async (ctx) => {
    if (!inst) return ctx.skip();
    const guest = new PocketBase(inst.url);
    const { otpId } = await guest
      .collection("users")
      .requestOTP(S.email, appKeyHeader());
    const code = await otpCode(otpId);
    const err = await catchErr(
      guest.collection("users").authWithOTP(otpId, code, appKeyHeader()),
    );
    const e = err as ClientResponseError;
    expect(e.status).toBe(401);
    expect(typeof e.response.mfaId).toBe("string");
  });
});

// Review iteration-3 CR-01: PB is public, so guest users sign-in must come from the app
// (which applies the rate limits). Without the app key PB refuses before checking anything.
describe("CR-01 users guest sign-in only through the app", () => {
  const status = async (p: Promise<unknown>) =>
    ((await catchErr(p)) as ClientResponseError).status;

  it("refuses auth-with-password, request-otp and auth-with-otp without the app key", async (ctx) => {
    if (!inst) return ctx.skip();
    const guest = new PocketBase(inst.url);
    const users = guest.collection("users");
    // A right password is refused too: the hook runs before any credential check.
    expect(await status(users.authWithPassword(M.email, M.password))).toBe(403);
    expect(await status(users.authWithPassword(S.email, S.password))).toBe(403);
    expect(await status(users.requestOTP(S.email))).toBe(403);
    // A real otpId and its right code are still refused without the key.
    const { otpId } = await users.requestOTP(M.email, appKeyHeader());
    const code = await otpCode(otpId);
    expect(await status(users.authWithOTP(otpId, code))).toBe(403);
    expect(guest.authStore.token).toBe("");
  });

  it("refuses a wrong or empty app key", async (ctx) => {
    if (!inst) return ctx.skip();
    const users = new PocketBase(inst.url).collection("users");
    for (const key of ["wrong-key", `${inst.appKey}x`, ""]) {
      expect(
        await status(
          users.authWithPassword(M.email, M.password, appKeyHeader(key)),
        ),
      ).toBe(403);
      expect(await status(users.requestOTP(S.email, appKeyHeader(key)))).toBe(
        403,
      );
    }
  });

  it("accepts the right app key, and the app client sends it", async (ctx) => {
    if (!inst) return ctx.skip();
    const res = await new PocketBase(inst.url)
      .collection("users")
      .authWithPassword(M.email, M.password, appKeyHeader());
    expect(res.token).toBeTruthy();
    expect(
      (await signInMember(M.email, M.password, "10.8.0.1")).token,
    ).toBeTruthy();
  });

  it("the guard hook covers all three users endpoints and fails closed", () => {
    const src = readFileSync(GUARD_FILE, "utf8");
    for (const hook of [
      "onRecordAuthWithPasswordRequest",
      "onRecordRequestOTPRequest",
      "onRecordAuthWithOTPRequest",
    ]) {
      expect(src).toMatch(new RegExp(`${hook}\\(\\(e\\) => \\{`));
    }
    expect(src.match(/\}, "users"\);/g)).toHaveLength(3);
    // An unset or empty PB_APP_KEY refuses every guest request (fail closed).
    expect(src.match(/if \(!key \|\| !sent \|\|/g)).toHaveLength(3);
  });

  it("the app client refuses to run without PB_APP_KEY", async (ctx) => {
    if (!inst) return ctx.skip();
    const saved = process.env.PB_APP_KEY;
    delete process.env.PB_APP_KEY;
    try {
      await expect(
        signInMember(M.email, M.password, "10.8.0.2"),
      ).rejects.toThrow(/PB_APP_KEY/);
    } finally {
      process.env.PB_APP_KEY = saved;
    }
  });
});

describe("TEN-15 chokepoint staff sign-in", () => {
  it("password + OTP -> PlatformContext and token", async (ctx) => {
    if (!inst) return ctx.skip();
    const started = await signInStaff(S.email, S.password, IP);
    expect(started.status).toBe("mfa_required");
    const code = await otpCode(started.otpId);
    const res = await completeStaffSignIn({
      mfaId: started.mfaId,
      otpId: started.otpId,
      code,
      ip: IP,
    });
    expect(res.ctx.staffRole).toBe("super_admin");
    expect(res.ctx.actor).toBe(S.id);
    expect(typeof res.token).toBe("string");
    expect(res.token.length).toBeGreaterThan(20);
    sCtx = res.ctx;
  });

  it("a wrong OTP code is rejected", async (ctx) => {
    if (!inst) return ctx.skip();
    const started = await signInStaff(S.email, S.password, IP);
    const code = await otpCode(started.otpId);
    const wrong = code === "000000" ? "111111" : "000000";
    const err = await catchErr(
      completeStaffSignIn({
        mfaId: started.mfaId,
        otpId: started.otpId,
        code: wrong,
        ip: IP,
      }),
    );
    expect(err).toBeInstanceOf(Forbidden);
  });

  it("bad password and non-staff get the identical Forbidden message (no enumeration)", async (ctx) => {
    if (!inst) return ctx.skip();
    const bad = await catchErr(signInStaff(S.email, "wrong-password-123", IP));
    const member = await catchErr(signInStaff(M.email, M.password, IP));
    const unknown = await catchErr(
      signInStaff("nobody@cds.test", "whatever-123456", IP),
    );
    expect(bad).toBeInstanceOf(Forbidden);
    expect(member).toBeInstanceOf(Forbidden);
    expect(unknown).toBeInstanceOf(Forbidden);
    expect((bad as Error).message).toBe((member as Error).message);
    expect((bad as Error).message).toBe((unknown as Error).message);
  });

  it("platformContextFromToken accepts a staff token, rejects a member token", async (ctx) => {
    if (!inst) return ctx.skip();
    const t = await fullStaffSignIn(T);
    tCtx = t.ctx;
    tToken = t.token;
    const re = await platformContextFromToken(tToken, IP);
    expect(re.staffRole).toBe("support_agent");
    expect(re.actor).toBe(T.id);

    mToken = (await signInMember(M.email, M.password)).token;
    expect(await catchErr(platformContextFromToken(mToken, IP))).toBeInstanceOf(
      Forbidden,
    );
    expect(
      await catchErr(platformContextFromToken("not-a-token", IP)),
    ).toBeInstanceOf(Forbidden);
  });
});

describe("TEN-02 member sign-in -> OrgContext via memberships", () => {
  it("signInMember on a staff account -> MfaRequired", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await catchErr(signInMember(S.email, S.password))).toBeInstanceOf(
      MfaRequired,
    );
    expect(
      await catchErr(signInMember(M.email, "nope-nope-123")),
    ).toBeInstanceOf(Forbidden);
  });

  it("member token + own org -> OrgContext with role and grants", async (ctx) => {
    if (!inst) return ctx.skip();
    const oc = await orgContextFromToken(mToken, orgA, IP);
    expect(oc.orgId).toBe(orgA);
    expect(oc.actor).toBe(M.id);
    expect(oc.role).toBe("owner");
    expect([...oc.grants]).toEqual(["newsletter"]);
  });

  it("member token + an org without membership -> NotFound", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(
      await catchErr(orgContextFromToken(mToken, orgB, IP)),
    ).toBeInstanceOf(NotFound);
  });

  it("an org that is not active -> NotFound", async (ctx) => {
    if (!inst) return ctx.skip();
    await pb.collection("organizations").update(orgA, { status: "held" });
    try {
      expect(
        await catchErr(orgContextFromToken(mToken, orgA, IP)),
      ).toBeInstanceOf(NotFound);
    } finally {
      await pb.collection("organizations").update(orgA, { status: "active" });
    }
  });
});

describe("TEN-11 setStaffRole", () => {
  it("a support_agent cannot manage staff", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(
      await catchErr(setStaffRole(tCtx, M.id, "support_agent")),
    ).toBeInstanceOf(Forbidden);
    const m = await pb.collection("users").getOne(M.id);
    expect(m.staff_role).toBe("");
  });

  it("rejects an unknown role and a forged context", async (ctx) => {
    if (!inst) return ctx.skip();
    await expect(
      setStaffRole(sCtx, T.id, "god" as unknown as "super_admin"),
    ).rejects.toThrow();
    await expect(
      setStaffRole(
        { actor: S.id, staffRole: "super_admin", ip: IP } as PlatformContext,
        T.id,
        "",
      ),
    ).rejects.toThrow();
  });

  it("never demotes the last super_admin, the caller included (WR-08)", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const next of ["", "support_agent"] as const) {
      expect(await catchErr(setStaffRole(sCtx, S.id, next))).toBeInstanceOf(
        InvalidInput,
      );
    }
    expect((await pb.collection("users").getOne(S.id)).staff_role).toBe(
      "super_admin",
    );
    // With a second super_admin, one may step down.
    const S2 = await seedUser("super2@cds.test", "super_admin");
    await setStaffRole(sCtx, S2.id, "support_agent");
    expect((await pb.collection("users").getOne(S2.id)).staff_role).toBe(
      "support_agent",
    );
    expect(
      await catchErr(setStaffRole(sCtx, "zzzzzzzzzzzzzzz", "")),
    ).toBeInstanceOf(NotFound);
  });

  it("removing a staff role kills the old token and is audited", async (ctx) => {
    if (!inst) return ctx.skip();
    await setStaffRole(sCtx, T.id, "");
    expect(await catchErr(platformContextFromToken(tToken, IP))).toBeInstanceOf(
      Forbidden,
    );
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'staff_role.change' && target_id = {:t}", {
        t: T.id,
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization).toBe("");
    expect(rows[0]!.actor).toBe(S.id);
    expect(rows[0]!.target_collection).toBe("users");
    expect(rows[0]!.meta).toEqual({ role: "" });
  });

  it("granting a staff role rotates the member's token and forces MFA", async (ctx) => {
    if (!inst) return ctx.skip();
    // CR-03: a tenant member cannot become staff while still holding memberships.
    expect(
      await catchErr(setStaffRole(sCtx, M.id, "support_agent")),
    ).toBeInstanceOf(InvalidInput);
    expect((await pb.collection("users").getOne(M.id)).staff_role).toBe("");
    const rows = await pb.collection("memberships").getFullList({
      filter: pb.filter("user = {:u}", { u: M.id }),
    });
    for (const r of rows) await pb.collection("memberships").delete(r.id);
    await setStaffRole(sCtx, M.id, "support_agent");
    expect(
      await catchErr(orgContextFromToken(mToken, orgA, IP)),
    ).toBeInstanceOf(Forbidden);
    expect(await catchErr(signInMember(M.email, M.password))).toBeInstanceOf(
      MfaRequired,
    );
    const promoted = await fullStaffSignIn(M);
    expect(promoted.ctx.staffRole).toBe("support_agent");
  });
});

describe("CR-03 staff never become tenant members (invariant 10)", () => {
  let X: Seeded;
  let xMembership: string;
  const ownerCtxB = () =>
    mintOrgContext({
      orgId: orgB,
      actor: S.id,
      role: "owner",
      grants: [],
      ip: IP,
    });

  it("a staff token with a stray membership row gets no OrgContext", async (ctx) => {
    if (!inst) return ctx.skip();
    X = await seedUser("stray-staff@cds.test", "support_agent");
    xMembership = (
      await pb
        .collection("memberships")
        .create({ user: X.id, organization: orgB, role: "admin" })
    ).id;
    const { token } = await fullStaffSignIn(X);
    expect(await catchErr(orgContextFromToken(token, orgB, IP))).toBeInstanceOf(
      NotFound,
    );
  });

  it("addMember refuses a staff user", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const userId of [S.id, X.id]) {
      expect(
        await catchErr(addMember(ownerCtxB(), { userId, role: "admin" })),
      ).toBeInstanceOf(InvalidInput);
    }
    const rows = await pb.collection("memberships").getFullList({
      filter: pb.filter("user = {:u}", { u: S.id }),
    });
    expect(rows).toEqual([]);
  });

  it("transferOwnership refuses a staff target", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(
      await catchErr(transferOwnership(ownerCtxB(), xMembership)),
    ).toBeInstanceOf(InvalidInput);
    expect((await pb.collection("memberships").getOne(xMembership)).role).toBe(
      "admin",
    );
  });
});

describe("WR-01 app-layer sign-in rate limit", () => {
  it("refuses an account after too many attempts, before PocketBase", async (ctx) => {
    if (!inst) return ctx.skip();
    const email = "brute@cds.test";
    // Tight bucket per (account, IP) (iteration-3 WR-01).
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP; i++) {
      expect(
        await catchErr(signInStaff(email, `guess-${i}-123456`, "10.1.0.1")),
      ).toBeInstanceOf(Forbidden);
    }
    expect(
      await catchErr(signInStaff(email, "guess-final-123456", "10.1.0.1")),
    ).toBeInstanceOf(RateLimited);
    // The account buckets are shared by every password flow: the member flow is no second
    // budget of guesses against a staff account (iteration-2 WR-01).
    expect(
      await catchErr(signInMember(email, "guess-final-123456", "10.1.0.1")),
    ).toBeInstanceOf(RateLimited);
    expect(
      await catchErr(
        signInMember(" BRUTE@cds.test ", "guess-final-123456", "10.1.0.1"),
      ),
    ).toBeInstanceOf(RateLimited);
    // Another source is not blocked by that one.
    expect(
      await catchErr(signInStaff(email, "guess-other-123456", "10.1.1.1")),
    ).toBeInstanceOf(Forbidden);
    // Loose bucket per account across all IPs: a distributed ceiling.
    const more = SIGN_IN_PER_ACCOUNT - SIGN_IN_PER_ACCOUNT_IP - 1;
    for (let i = 0; i < more; i++) {
      expect(
        await catchErr(
          signInMember(
            email,
            `g-${i}-123456`,
            `10.1.${2 + (i >> 8)}.${i & 255}`,
          ),
        ),
      ).toBeInstanceOf(Forbidden);
    }
    expect(
      await catchErr(signInStaff(email, "guess-final-123456", "10.1.9.9")),
    ).toBeInstanceOf(RateLimited);
  });

  // Iteration-3 WR-01: one IP failing once a minute cannot lock out the real user, or the
  // restore CLI (which signs in through signInStaff).
  it("one IP failing once a minute for 30 minutes never locks out the real staff user", async (ctx) => {
    if (!inst) return ctx.skip();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      for (let m = 0; m < 30; m++) {
        vi.setSystemTime(start + m * 60_000);
        const err = await catchErr(
          signInStaff(S.email, `wrong-${m}-123456`, "10.6.6.6"),
        );
        expect(err instanceof Forbidden || err instanceof RateLimited).toBe(
          true,
        );
      }
      const started = await signInStaff(S.email, S.password, "10.7.7.7");
      expect(started.status).toBe("mfa_required");
      const cli = await signInStaff(S.email, S.password, "cli");
      expect(cli.status).toBe("mfa_required");
    } finally {
      vi.useRealTimers();
    }
  });

  // Iteration-2 WR-02: only failed guesses count, and refused attempts count nowhere.
  it("a right password never uses up the account budget", async (ctx) => {
    if (!inst) return ctx.skip();
    const U = await seedUser(
      `wr02-${Date.now()}-${Math.random().toString(36).slice(2)}@cds.test`,
      "",
    );
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP + 2; i++) {
      expect(
        (await signInMember(U.email, U.password, "10.2.0.1")).token,
      ).toBeTruthy();
      // A right staff password answers MfaRequired and does not count either.
      expect(
        await catchErr(signInMember(S.email, S.password, "10.2.0.2")),
      ).toBeInstanceOf(MfaRequired);
    }
    expect(
      await catchErr(signInMember(U.email, "wrong-pass-123456", "10.2.0.1")),
    ).toBeInstanceOf(Forbidden);
  });

  it("an over-limit IP cannot burn a named account's budget", async (ctx) => {
    if (!inst) return ctx.skip();
    const U = await seedUser(
      `wr02-${Date.now()}-${Math.random().toString(36).slice(2)}@cds.test`,
      "",
    );
    const ip = "10.3.3.3";
    for (let i = 0; i < SIGN_IN_PER_IP; i++) {
      await catchErr(signInMember(`spray${i}@cds.test`, "guess-123456", ip));
    }
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP * 2; i++) {
      expect(
        await catchErr(signInMember(U.email, "guess-123456", ip)),
      ).toBeInstanceOf(RateLimited);
    }
    expect(
      (await signInMember(U.email, U.password, "10.4.4.4")).token,
    ).toBeTruthy();
  });
});

describe("TEN-15 OTP stand-in hook", () => {
  it("logs the code only when CDS_OTP_STANDIN=1 and never sends mail", () => {
    const src = readFileSync(HOOK_FILE, "utf8");
    expect(src).toContain("onMailerRecordOTPSend");
    expect(src).toMatch(/\$os\.getenv\("CDS_OTP_STANDIN"\)\s*===\s*"1"/);
    expect(src).toContain("(code hidden)");
    expect(src).not.toContain("e.next()");
  });
});
