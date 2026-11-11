"use server";
// Staff sign-in, step-up and sign-out (13-21 choice 4; CONTEXT Area 1; P13-P1, P13-P2;
// 13-UI-SPEC "Sign-in and step-up"; T-13-21-01..05). Public POST endpoints: every argument is
// untrusted. Server Actions are POST-only with Next's Origin check, and the staff cookie is
// SameSite=Strict.
//
// Sign-in is two steps. staffSignInAction checks the password (signInStaff, which applies the
// per-IP / per-account sign-in limiter with the real client IP) and emails a code; the
// `{ mfaId, otpId }` pair goes back to the form's client state, never into a cookie.
// staffConfirmCodeAction exchanges the code (completeStaffSignIn), creates the staff_sessions
// row and only then sets the staff cookie and redirects to a safe `next` (/staff/** only).
// Every refusal at step 1 is one message (STAFF-SIGNIN-FAILED): a wrong password, an unknown
// address and a member account all read the same (no enumeration).
//
// Step-up (the 15-minute window for dangerous actions) is a code-only proof against the
// signed-in session (staffRequestStepUp / staffStepUp). Sign-out revokes the row
// (endStaffSession) and clears the cookie. Errors are logged by class name only.
import { CdsError, RateLimited } from "@cds/core";
import { maskEmail, P13_COPY } from "@cds/core/staff";
import {
  completeStaffSignIn,
  createStaffSession,
  endStaffSession,
  signInStaff,
  staffRequestStepUp,
  staffStepUp,
} from "@cds/db";
import { redirect } from "next/navigation";
import {
  clearImpersonationCookie,
  endCurrentImpersonation,
} from "../../../lib/impersonation-end";
import { clientIp } from "../../../lib/session";
import {
  errorName,
  sessionEnded,
  STAFF_UNAVAILABLE_COPY,
  type ActionResult,
} from "../../../lib/staff-action";
import { safeStaffNext } from "../../../lib/staff-next";
import {
  clearStaffCookie,
  getStaffSession,
  setStaffCookie,
  staffTokenFromCookie,
} from "../../../lib/staff-session";

type Failure = Extract<ActionResult<never>, { ok: false }>;

export type StaffCodeStarted = {
  mfaId: string;
  otpId: string;
  maskedEmail: string;
  /** The validated `next` (or null): the form posts it back with the code. */
  next: string | null;
};

const MAX_EMAIL = 254;
const MAX_PASSWORD = 1024;
const MAX_ID = 64;
const CODE_RE = /^\d{6}$/;

function fail(code: string, message: string): Failure {
  return { ok: false, code, message };
}

const SIGNIN_FAILED = (): Failure =>
  fail("signin_failed", P13_COPY.STAFF_SIGNIN_FAILED);
const CODE_WRONG = (): Failure => fail("code_wrong", P13_COPY.CODE_WRONG);
const RATE = (): Failure => fail("rate_limited", P13_COPY.RATE_SIGNIN);
const UNAVAILABLE = (): Failure => fail("unavailable", STAFF_UNAVAILABLE_COPY);

function str(v: unknown, max: number): string {
  return typeof v === "string" && v.length <= max ? v : "";
}

function idOf(v: unknown): string {
  const s = str(v, MAX_ID);
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : "";
}

async function startSignIn(
  rawEmail: unknown,
  rawPassword: unknown,
  rawNext: unknown,
): Promise<ActionResult<StaffCodeStarted>> {
  const email = str(rawEmail, MAX_EMAIL).trim();
  const password = str(rawPassword, MAX_PASSWORD);
  if (!email || !password) return SIGNIN_FAILED();
  try {
    const started = await signInStaff(email, password, await clientIp());
    return {
      ok: true,
      data: {
        mfaId: started.mfaId,
        otpId: started.otpId,
        maskedEmail: maskEmail(email),
        next: safeStaffNext(rawNext),
      },
    };
  } catch (err) {
    if (err instanceof RateLimited) return RATE();
    // Forbidden and every other refusal: one message, never the reason (T-13-21-01).
    if (err instanceof CdsError) return SIGNIN_FAILED();
    console.error("[staff sign-in] failed", errorName(err));
    return UNAVAILABLE();
  }
}

/** Step 1: email + password → a code is emailed; `{ mfaId, otpId }` stay in client state. */
export async function staffSignInAction(
  email: unknown,
  password: unknown,
  next?: unknown,
): Promise<ActionResult<StaffCodeStarted>> {
  return startSignIn(email, password, next);
}

/**
 * "Send a new code": the same password check again, which emails a fresh code with a fresh
 * `{ mfaId, otpId }` (the 30 s cooldown is client side; failures hit the sign-in limiter).
 * The form still holds the email and password from step 1.
 */
export async function staffResendCodeAction(
  email: unknown,
  password: unknown,
  next?: unknown,
): Promise<ActionResult<StaffCodeStarted>> {
  return startSignIn(email, password, next);
}

/**
 * Step 2: the emailed code → staff_sessions row → staff cookie → redirect to a safe `next`
 * (else /staff). Returns a failure only; success redirects.
 */
export async function staffConfirmCodeAction(input: {
  mfaId: unknown;
  otpId: unknown;
  code: unknown;
  next?: unknown;
}): Promise<ActionResult<never>> {
  const mfaId = idOf(input?.mfaId);
  const otpId = idOf(input?.otpId);
  const code = str(input?.code, 6).trim();
  if (!mfaId || !otpId || !CODE_RE.test(code)) return CODE_WRONG();
  try {
    const ip = await clientIp();
    const { ctx, token } = await completeStaffSignIn({
      mfaId,
      otpId,
      code,
      ip,
    });
    await createStaffSession({ token, ctx, ip });
    await setStaffCookie(token);
  } catch (err) {
    if (err instanceof RateLimited) return RATE();
    // PocketBase answers a wrong and an expired code the same way: CODE-WRONG says "check
    // the latest email", and Send a new code is right there.
    if (err instanceof CdsError) return CODE_WRONG();
    console.error("[staff sign-in] code failed", errorName(err));
    return UNAVAILABLE();
  }
  redirect(safeStaffNext(input?.next) ?? "/staff");
}

/** Step-up 1: email a fresh code to the signed-in staff member. */
export async function staffRequestStepUpAction(): Promise<
  ActionResult<{ otpId: string; maskedEmail: string }>
> {
  try {
    const session = await getStaffSession();
    if (!session) return sessionEnded();
    const sent = await staffRequestStepUp(session.ctx, {
      sessionId: session.sessionId,
    });
    return { ok: true, data: sent };
  } catch (err) {
    if (err instanceof RateLimited) return RATE();
    if (err instanceof CdsError) return sessionEnded();
    console.error("[staff step-up] request failed", errorName(err));
    return UNAVAILABLE();
  }
}

/** Step-up 2: prove the code; the 15-minute window starts again. */
export async function staffConfirmStepUpAction(input: {
  otpId: unknown;
  code: unknown;
}): Promise<ActionResult<null>> {
  const otpId = idOf(input?.otpId);
  const code = str(input?.code, 6).trim();
  try {
    const session = await getStaffSession();
    if (!session) return sessionEnded();
    if (!otpId || !CODE_RE.test(code)) return CODE_WRONG();
    await staffStepUp(session.ctx, {
      sessionId: session.sessionId,
      otpId,
      code,
      ip: await clientIp(),
    });
    return { ok: true, data: null };
  } catch (err) {
    if (err instanceof RateLimited) return RATE();
    // Wrong code, someone else's otpId or a malformed input: one message.
    if (err instanceof CdsError) return CODE_WRONG();
    console.error("[staff step-up] confirm failed", errorName(err));
    return UNAVAILABLE();
  }
}

/**
 * Sign out: end any running impersonation (WR-C02, while the cookie still verifies), revoke the
 * row (best effort), clear both cookies, back to sign-in.
 */
export async function staffSignOutAction(): Promise<never> {
  const token = await staffTokenFromCookie();
  if (token) {
    try {
      const staff = await getStaffSession();
      if (staff && staff.token === token) await endCurrentImpersonation(staff);
    } catch (err) {
      console.error(
        "[staff sign-out] impersonation end failed",
        errorName(err),
      );
    }
    try {
      await endStaffSession(token);
    } catch (err) {
      // The cookie still goes; the row then ends at its idle limit (2 h).
      console.error("[staff sign-out] revoke failed", errorName(err));
    }
  }
  await clearImpersonationCookie();
  await clearStaffCookie();
  redirect("/staff/sign-in");
}
