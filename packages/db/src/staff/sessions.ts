// Staff console sessions + step-up (13-12; STAFF-06, P13-P1, P13-P2; T-13-12-01..05). The cookie
// holds the PocketBase token only; this module keeps one `staff_sessions` row per sign-in,
// keyed by sha256(token) (the token itself is never stored). Every read rejects an ended
// session, one idle for more than 2 h and one older than 12 h, then re-reads the role through
// platformContextFromToken (a demoted staff member loses access at once). `last_seen_at` is
// touched at most every 5 minutes (a DB write is allowed during render; a cookie write is not).
// Step-up = a fresh emailed code (PocketBase OTP as first factor, no password): a correct code
// answers 401 + mfaId (MFA on staff) or 200; anything else is the generic Forbidden. Failures
// never say why (no enumeration). Errors are never logged here; callers log class names only.
import { createHash } from "node:crypto";
import {
  authorizeStaff,
  Forbidden,
  InvalidInput,
  STAFF_ROLES,
  type StaffRole,
} from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { platformContextFromToken } from "../auth";
import { guestClient, withSuperuser } from "../client";
import {
  assertPlatformContext,
  assertSystemContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { beginSignIn } from "../rate-limit";

const COLLECTION = "staff_sessions";
const INVALID_SESSION = "invalid session";
const INVALID_CREDENTIALS = "invalid credentials";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Idle timeout: no request for this long ends the session. */
export const STAFF_SESSION_IDLE_MS = 2 * HOUR;
/** Absolute timeout from sign-in. */
export const STAFF_SESSION_ABSOLUTE_MS = 12 * HOUR;
/** A sign-in or step-up this recent lets a dangerous action through. */
export const STAFF_STEP_UP_FRESH_MS = 15 * MINUTE;
/** `last_seen_at` is written at most this often. */
export const STAFF_SESSION_TOUCH_MS = 5 * MINUTE;
/** Rows older than this are pruned (13-44 health job). */
export const STAFF_SESSION_RETAIN_MS = 30 * 24 * HOUR;

const RECORD_ID = /^[a-z0-9]{15}$/;

export type StaffSession = {
  ctx: PlatformContext;
  sessionId: string;
  /** Sign-in or step-up within the last 15 minutes. */
  stepUpFresh: boolean;
  staffName: string;
  /** "m•••@example.com": never the full address. */
  staffEmailMasked: string;
  /** ISO time of sign-in. */
  createdAt: string;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireToken(token: unknown): string {
  if (typeof token !== "string" || !token) throw new Forbidden(INVALID_SESSION);
  return token;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** PB date string ("2026-10-15 10:00:00.000Z") → epoch ms; NaN when empty. */
function ms(v: unknown): number {
  const s = str(v);
  return s ? Date.parse(s.replace(" ", "T")) : Number.NaN;
}

function iso(v: unknown): string {
  const t = ms(v);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function nowOf(now?: Date): Date {
  return now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
}

/** "mara@example.com" → "m•••@example.com" (UI-SPEC). */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

async function rowByHash(hash: string): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    try {
      return await pb
        .collection(COLLECTION)
        .getFirstListItem(pb.filter("token_hash = {:h}", { h: hash }));
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

/**
 * The caller's own live session row by id, else the generic Forbidden. Live means not ended
 * and not expired (idle or absolute), so a step-up can never revive an old session (WR-A12).
 */
async function ownRow(
  ctx: PlatformContext,
  sessionId: unknown,
  now: Date,
): Promise<RecordModel> {
  if (typeof sessionId !== "string" || !RECORD_ID.test(sessionId)) {
    throw new Forbidden(INVALID_SESSION);
  }
  const row = await withSuperuser(async (pb) => {
    try {
      return await pb.collection(COLLECTION).getOne(sessionId);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
  if (!row || row.user !== ctx.actor || expired(row, now)) {
    throw new Forbidden(INVALID_SESSION);
  }
  return row;
}

async function staffUser(
  id: string,
): Promise<{ name: string; email: string } | null> {
  return withSuperuser(async (pb) => {
    try {
      const r = await pb
        .collection("users")
        .getOne(id, { fields: "id,name,email" });
      return { name: str(r.name), email: str(r.email) };
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

/** Why a row is no longer a valid session at `now` (null = still valid). */
function expired(row: RecordModel, now: Date): boolean {
  if (str(row.ended_at)) return true;
  const t = now.getTime();
  const created = ms(row.created);
  if (Number.isNaN(created) || t - created > STAFF_SESSION_ABSOLUTE_MS) {
    return true;
  }
  const seen = ms(row.last_seen_at);
  const lastSeen = Number.isNaN(seen) ? created : seen;
  return t - lastSeen > STAFF_SESSION_IDLE_MS;
}

/**
 * Record a fresh staff sign-in (called right after completeStaffSignIn). Sign-in precedes the
 * role check, so no feature gate: the context must be a real PlatformContext. Stores only
 * sha256(token); `step_up_at` and `last_seen_at` = now (the sign-in itself proved a code).
 */
export async function createStaffSession(input: {
  token: string;
  ctx: PlatformContext;
  ip?: string;
  now?: Date;
}): Promise<{ id: string }> {
  assertPlatformContext(input?.ctx);
  const token = requireToken(input.token);
  const now = nowOf(input.now);
  const row = await withSuperuser((pb) =>
    pb.collection(COLLECTION).create({
      token_hash: tokenHash(token),
      user: input.ctx.actor,
      last_seen_at: now.toISOString(),
      step_up_at: now.toISOString(),
      ip: str(input.ip).slice(0, 64),
    }),
  );
  return { id: row.id };
}

/**
 * Re-validate a staff session on every request. Throws Forbidden(INVALID_SESSION) when the
 * row is missing, ended, idle > 2 h or older than 12 h, when PocketBase rejects the token, or
 * when the user no longer holds a staff role. Touches `last_seen_at` when older than 5 min.
 */
export async function readStaffSession(
  token: string,
  opts: { ip: string; now?: Date },
): Promise<StaffSession> {
  const t = requireToken(token);
  const now = nowOf(opts?.now);
  const row = await rowByHash(tokenHash(t));
  if (!row || expired(row, now)) throw new Forbidden(INVALID_SESSION);
  // The role is re-read from PocketBase on every request (T-13-12-03).
  const ctx = await platformContextFromToken(t, str(opts?.ip));
  if (ctx.actor !== row.user) throw new Forbidden(INVALID_SESSION);
  authorizeStaff(ctx.staffRole, "console");
  const user = await staffUser(ctx.actor);
  if (!user) throw new Forbidden(INVALID_SESSION);
  const seen = ms(row.last_seen_at);
  if (Number.isNaN(seen) || now.getTime() - seen >= STAFF_SESSION_TOUCH_MS) {
    await withSuperuser((pb) =>
      pb
        .collection(COLLECTION)
        .update(row.id, { last_seen_at: now.toISOString() }),
    );
  }
  const created = ms(row.created);
  const stepped = ms(row.step_up_at);
  const proof = Math.max(
    Number.isNaN(created) ? 0 : created,
    Number.isNaN(stepped) ? 0 : stepped,
  );
  return {
    ctx,
    sessionId: row.id,
    stepUpFresh: now.getTime() - proof <= STAFF_STEP_UP_FRESH_MS,
    staffName: user.name,
    staffEmailMasked: maskEmail(user.email),
    createdAt: iso(row.created),
  };
}

/**
 * Slide the idle window without the full read (tests, long-running actions). Refuses an
 * already-expired session; never extends past the 12 h absolute limit.
 */
export async function touchStaffSession(
  token: string,
  opts: { now?: Date } = {},
): Promise<void> {
  const t = requireToken(token);
  const now = nowOf(opts.now);
  const row = await rowByHash(tokenHash(t));
  if (!row || expired(row, now)) throw new Forbidden(INVALID_SESSION);
  await withSuperuser((pb) =>
    pb
      .collection(COLLECTION)
      .update(row.id, { last_seen_at: now.toISOString() }),
  );
}

/** Step 1 of step-up: email a fresh code to the signed-in staff member. */
export async function staffRequestStepUp(
  ctx: PlatformContext,
  input: { sessionId: string; now?: Date },
): Promise<{ otpId: string; maskedEmail: string }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  await ownRow(ctx, input?.sessionId, nowOf(input?.now));
  const user = await staffUser(ctx.actor);
  if (!user || !user.email) throw new Forbidden(INVALID_CREDENTIALS);
  try {
    const { otpId } = await guestClient()
      .collection("users")
      .requestOTP(user.email);
    return { otpId, maskedEmail: maskEmail(user.email) };
  } catch {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
}

/** The OTP must belong to the caller: a code for someone else's otpId never counts. */
async function otpBelongsTo(otpId: string, userId: string): Promise<boolean> {
  return withSuperuser(async (pb) => {
    try {
      const otp = await pb
        .collection("_otps")
        .getOne(otpId, { fields: "id,recordRef" });
      return otp.recordRef === userId;
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404)
        return false;
      throw err;
    }
  });
}

/**
 * Step 2 of step-up: prove the emailed code (no password) and stamp `step_up_at`. Behind the
 * sign-in OTP limiter (10 failures per otpId, 30 per IP). PocketBase OTP as first factor: a
 * correct code answers 401 carrying `mfaId` (MFA is on for staff) or 200; a wrong or expired
 * code answers 400. Audited `staff.step_up` (no organization).
 */
export async function staffStepUp(
  ctx: PlatformContext,
  input: {
    sessionId: string;
    otpId: string;
    code: string;
    ip: string;
    now?: Date;
  },
): Promise<{ stepUpAt: string; proof: "mfa_401" | "auth_200" }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const row = await ownRow(ctx, input?.sessionId, nowOf(input?.now));
  const otpId = input?.otpId;
  const code = input?.code;
  if (
    typeof otpId !== "string" ||
    !otpId ||
    typeof code !== "string" ||
    !code
  ) {
    throw new InvalidInput("code is required");
  }
  const now = nowOf(input.now);
  const attempt = beginSignIn("otp", input.ip, otpId);
  if (!RECORD_ID.test(otpId) || !(await otpBelongsTo(otpId, ctx.actor))) {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
  const pb = guestClient();
  let proved = false;
  let proof: "mfa_401" | "auth_200" = "mfa_401";
  try {
    const res = await pb.collection("users").authWithOTP(otpId, code);
    proved = res.record?.id === ctx.actor;
    proof = "auth_200";
  } catch (err) {
    proved =
      err instanceof ClientResponseError &&
      err.status === 401 &&
      typeof (err.response as { mfaId?: unknown } | undefined)?.mfaId ===
        "string" &&
      Boolean((err.response as { mfaId: string }).mfaId);
  } finally {
    // A token minted by the 200 path is never used: the session keeps its own.
    pb.authStore.clear();
  }
  if (!proved) throw new Forbidden(INVALID_CREDENTIALS);
  attempt.succeeded();
  const stepUpAt = now.toISOString();
  await withSuperuser(async (su) => {
    const batch = su.createBatch();
    batch.collection(COLLECTION).update(row.id, {
      step_up_at: stepUpAt,
      last_seen_at: stepUpAt,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "staff.step_up",
        targetCollection: COLLECTION,
        targetId: row.id,
      }),
    );
    await batch.send();
  });
  return { stepUpAt, proof };
}

/** Sign-out: set `ended_at`; the same token is refused afterwards. Unknown tokens are a no-op. */
export async function endStaffSession(
  token: string,
  opts: { now?: Date } = {},
): Promise<void> {
  if (typeof token !== "string" || !token) return;
  const row = await rowByHash(tokenHash(token));
  if (!row || str(row.ended_at)) return;
  await withSuperuser((pb) =>
    pb
      .collection(COLLECTION)
      .update(row.id, { ended_at: nowOf(opts.now).toISOString() }),
  );
}

/** Delete session rows created more than 30 days ago (13-44 health job). Returns the count. */
export async function pruneStaffSessions(
  ctx: SystemContext,
  opts: { now?: Date } = {},
): Promise<number> {
  assertSystemContext(ctx);
  const cut = new Date(nowOf(opts.now).getTime() - STAFF_SESSION_RETAIN_MS);
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({
      filter: pb.filter("created < {:cut}", { cut }),
      fields: "id",
    });
    for (const r of rows) await pb.collection(COLLECTION).delete(r.id);
    return rows.length;
  });
}

/** One staff member for Settings › Staff (13-46 choice 1). Never the full email address. */
export type StaffMemberRow = {
  id: string;
  name: string;
  /** "m•••@example.com". */
  emailMasked: string;
  role: StaffRole;
  /** ISO time of the newest `staff_sessions` row (a sign-in), or null if never. */
  lastSignIn: string | null;
};

/**
 * Everyone with a staff role, name order (13-46; `staff_roles`, super_admin). Last sign-in is
 * the newest `staff_sessions` row for the user. Read-only: inviting and removing staff stay on
 * the CLI path (CONTEXT deferred), role changes go through setStaffRole.
 */
export async function staffListStaff(
  ctx: PlatformContext,
): Promise<StaffMemberRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "staff_roles");
  return withSuperuser(async (pb) => {
    const users = await pb.collection("users").getFullList({
      filter: "staff_role != ''",
      fields: "id,name,email,staff_role",
    });
    const rows: StaffMemberRow[] = [];
    for (const u of users) {
      const role = str(u.staff_role);
      if (!(STAFF_ROLES as readonly string[]).includes(role)) continue;
      const last = await pb.collection(COLLECTION).getList(1, 1, {
        filter: pb.filter("user = {:u}", { u: u.id }),
        sort: "-created",
        fields: "id,created",
      });
      const at = last.items[0] ? iso(last.items[0].created) : "";
      rows.push({
        id: u.id,
        name: str(u.name),
        emailMasked: maskEmail(str(u.email)),
        role: role as StaffRole,
        lastSignIn: at || null,
      });
    }
    return rows.sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"),
    );
  });
}
