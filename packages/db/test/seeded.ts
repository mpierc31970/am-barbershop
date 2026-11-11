// Booted + seeded PocketBase for integration tests outside packages/db (apps/web, 03-12).
// Keeps the superuser client inside packages/db (Invariant 1): callers get the harness
// handle and the TwoOrgs seed (org contexts included), never a PocketBase client.
import { createHash, randomBytes } from "node:crypto";
import type { AddonRegistry } from "@cds/core/addons";
import { pathFixtureRegistry } from "../../core/src/onboarding/__fixtures__/path-addons";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { __setPolicySetForTests } from "../src/legal/policy-versions";
import { captureTransport } from "../src/email";
import { createStaffSession } from "../src/staff/sessions";
import type { FitChecker } from "../src/fit";
import type { HumanCheck } from "../src/human-check";

/** startSubmit deps whose human check always passes (A-WR-02; tests never call Turnstile). */
export const PASS_HUMAN: { humanCheck: HumanCheck } = {
  humanCheck: { verify: () => Promise.resolve(true) },
};
import { completeSubmit, startSubmit, type SubmitOutcome } from "../src/signup";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

export type SeededPb = { inst: PbInstance; seed: TwoOrgs };

/** null when the PB binary is unavailable outside CI (the caller then skips). */
export async function bootSeededPb(): Promise<SeededPb | null> {
  const inst = await bootPb();
  if (!inst) return null;
  try {
    resetClientForTests();
    const seed = await seedTwoOrgs(await superuser());
    return { inst, seed };
  } catch (err) {
    await inst.stop();
    throw err;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function otpCode(inst: PbInstance, otpId: string): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users (\\w+) ${otpId} (\\d{6})`);
  for (let i = 0; i < 100; i++) {
    const m = re.exec(inst.stdout());
    if (m) return m[2]!;
    await sleep(50);
  }
  throw new Error(`no OTP_STANDIN line for ${otpId}`);
}

/**
 * 04-14: a staff PlatformContext from a real password + emailed-code sign-in (the
 * impersonation test pattern), for tests outside packages/db. Test-only staff user.
 */
export async function staffContext(
  inst: PbInstance,
  email: string,
  role: "super_admin" | "support_agent",
  ip = "203.0.113.14",
): Promise<PlatformContext> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const pb = await superuser();
  await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  const started = await signInStaff(email, password, ip);
  const code = await otpCode(inst, started.otpId);
  const { ctx } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code,
    ip,
  });
  return ctx;
}

/**
 * 13-12: a signed-in staff console session: a fresh test-only staff user, the real password +
 * emailed-code sign-in, then createStaffSession (step_up_at = now). Returns the PB token (the
 * cookie value), the context and the staff_sessions row id.
 */
export async function staffSessionFor(
  inst: PbInstance,
  role: "super_admin" | "support_agent",
  opts: { email?: string; ip?: string; now?: Date } = {},
): Promise<{
  token: string;
  ctx: PlatformContext;
  sessionId: string;
  email: string;
  userId: string;
}> {
  const ip = opts.ip ?? "203.0.113.15";
  const email =
    opts.email ??
    `staff-${role}-${randomBytes(4).toString("hex")}@example.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const pb = await superuser();
  const user = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
    name: role === "super_admin" ? "Sam Admin" : "Mara Agent",
  });
  const started = await signInStaff(email, password, ip);
  const code = await otpCode(inst, started.otpId);
  const { ctx, token } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code,
    ip,
  });
  const { id } = await createStaffSession({ token, ctx, ip, now: opts.now });
  return { token, ctx, sessionId: id, email, userId: user.id };
}

/** 04-14: the stored organizations.design, read raw (test-only superuser read). */
export async function storedOrgDesign(orgId: string): Promise<unknown> {
  const pb = await superuser();
  return (await pb.collection("organizations").getOne(orgId)).design ?? null;
}

/** 05-13: every PocketBase collection name, sorted (test-only; proves install is not a migration). */
export async function collectionNames(): Promise<string[]> {
  const pb = await superuser();
  return (await pb.collections.getFullList()).map((c) => c.name).sort();
}

/** 05-13: ids of one org's rows in a collection (test-only superuser read). */
export async function orgRowIds(
  collection: string,
  orgId: string,
): Promise<string[]> {
  const pb = await superuser();
  const rows = await pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "id",
  });
  return rows.map((r) => r.id).sort();
}

/** 05-13: delete one org's rows in a collection (test-only superuser write; fixture reset). */
export async function clearOrgRows(
  collection: string,
  orgId: string,
): Promise<void> {
  const pb = await superuser();
  for (const id of await orgRowIds(collection, orgId)) {
    await pb.collection(collection).delete(id);
  }
}

/** Review 11 WR-B06: put an org at a stage (test-only superuser write; production uses setOrgStage). */
export async function setOrgStageForTests(
  orgId: string,
  stage: string,
): Promise<void> {
  const pb = await superuser();
  await pb.collection("organizations").update(orgId, { stage });
}

/** 04-14: clear an org's design (test-only superuser write; production uses the importer). */
export async function clearOrgDesign(orgId: string): Promise<void> {
  const pb = await superuser();
  await pb.collection("organizations").update(orgId, { design: null });
}

// ---------------------------------------------------------------- 06-07 quote helpers

/** 06-07: the path-rule fixture registry (standard-only fixture-quote, studio-only booking). */
export function testRegistry(): AddonRegistry {
  return pathFixtureRegistry();
}

/** 06-07: a HumanCheck that answers `pass` and counts its calls. */
export function fakeHumanCheck(pass = true): HumanCheck & {
  calls: { token: string; ip: string }[];
} {
  const calls: { token: string; ip: string }[] = [];
  return {
    calls,
    verify(token: string, ip: string) {
      calls.push({ token, ip });
      return Promise.resolve(pass);
    },
  };
}

export { captureTransport };

/**
 * Org A's context with another role (09-18): apps/web tests may not import the context
 * minter by relative path (Invariant 1 lint), so the seed helper mints it.
 */
export function orgAContextAs(
  seed: TwoOrgs,
  role: "owner" | "admin" | "editor" | "viewer",
): OrgContext {
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
  });
}

/** The policy-set test seam for apps/web integration tests (09-18). */
export { __setPolicySetForTests };

export type SeedQuoteInput = {
  status?: "draft" | "saved" | "submitted" | "expired" | "blocked";
  path?: "standard" | "studio";
  email?: string;
  selections?: Record<string, unknown>;
  expiresAt?: Date;
  savedAt?: Date;
  businessType?: string;
  businessTypeOther?: string;
};

/**
 * 06-07: insert a quote row directly (test-only superuser write) and return its raw token.
 * Defaults: a standard draft that expires in 30 days.
 */
export async function seedQuote(
  input: SeedQuoteInput = {},
): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString("base64url");
  const pb = await superuser();
  const row = await pb.collection("quotes").create({
    token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    status: input.status ?? "draft",
    path: input.path ?? "standard",
    email: input.email ?? "",
    selections: input.selections ?? {
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    },
    expires_at: (
      input.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)
    ).toISOString(),
    saved_at: input.savedAt ? input.savedAt.toISOString() : "",
    business_type: input.businessType ?? "",
    business_type_other: input.businessTypeOther ?? "",
  });
  return { token, id: row.id };
}

// ---------------------------------------------------------------- 06-08 submit helpers

/** 06-08: the 6-digit code the OTP stand-in logged for this otpId. */
export async function otpCodeFor(
  inst: PbInstance,
  otpId: string,
): Promise<string> {
  return otpCode(inst, otpId);
}

/**
 * 06-08: the whole Submit flow as a visitor does it: step A (pending user + code), read the
 * code from the harness stdout, step B (verify + fit check + merge).
 */
export async function submitWithCode(
  inst: PbInstance,
  input: {
    quoteToken: string;
    businessName: string;
    description: string;
    email: string;
    ip?: string;
  },
  deps: { registry?: AddonRegistry; fitChecker?: FitChecker } = {},
): Promise<SubmitOutcome> {
  const ip = input.ip ?? "203.0.113.80";
  const { otpId } = await startSubmit({ ...input, ip }, PASS_HUMAN);
  const code = await otpCode(inst, otpId);
  return completeSubmit(
    { quoteToken: input.quoteToken, otpId, code, ip },
    {
      registry: deps.registry ?? pathFixtureRegistry(),
      fitChecker: deps.fitChecker,
    },
  );
}

/** 06-07: one quote row, raw (test-only superuser read). */
export async function storedQuote(
  id: string,
): Promise<Record<string, unknown>> {
  const pb = await superuser();
  return { ...(await pb.collection("quotes").getOne(id)) };
}
