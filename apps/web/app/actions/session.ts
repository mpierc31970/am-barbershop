"use server";
// Member sign-in and sign-out (CONT-08, CONTEXT A2-Q2: pulled forward from P11; UI-SPEC
// "Sign-in" copy; T-03-43, T-03-45, T-03-47). Public POST endpoints: they take only the
// email and password. Site access is looked up from the token, never from the form.
// signInMember applies the per-IP and per-account rate limits with the real client IP.
// Staff accounts (MfaRequired, right password) go on to /staff/sign-in (A&M fork); accounts
// with no active site get the no-site copy and no cookie. No forgot-password link in P3 (D-UI-9).
//
// Sign in with an emailed code (06-17; D-UI-P6-3; T-06-82, T-06-83): owners created at
// Submit have no password. requestMemberCodeAction sends a code (requestMemberCode never
// creates a user: an unknown address gets PB's decoy otpId, and the reply is the same), and
// the pending otpId lives in the httpOnly cds_signin_code cookie. completeMemberCodeAction
// exchanges the code; staff are refused by the chokepoint (they keep the MFA flow).
//
// Org switch (11-11, DASH-18; T-11-11-01, T-11-11-02): switchOrgAction checks the id against
// the person's own memberships before writing the cds_org cookie, then revalidates the hub
// layout and lands on Today, so no RSC payload from the previous org is reused.
import { CdsError, InvalidInput, MfaRequired, RateLimited } from "@cds/core";
import { ERR_EMAIL } from "@cds/core/email";
import {
  completeMemberCode,
  ERR_CODE,
  ERR_CODE_EXPIRED,
  listMemberOrganizations,
  requestMemberCode,
  signInMember,
  SUBMIT_RATE_COPY,
  SubmitCodeExpired,
  SubmitCodeInvalid,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SEND_CODE_FAILED_COPY } from "../../lib/action";
import {
  clearAuthMethodCookie,
  clearOrgCookie,
  clearSessionCookie,
  clientIp,
  firstSiteFor,
  forgetPushDevice,
  hasDeclinedSite,
  sessionCookieName,
  setAuthMethodCookie,
  setOrgCookie,
  setSessionCookie,
} from "../../lib/session";
import { withFlash } from "../../lib/flash";
import { safeSignInNext } from "../../lib/sign-in-next";
import {
  clearSignInCodeCookie,
  readSignInCodeCookie,
  setSignInCodeCookie,
} from "../../lib/submit-cookie";

export type SignInState = { error: string | null };

const WRONG_CREDENTIALS =
  "That email and password don't match. Check both and try again.";
const RATE_LIMITED = "Too many attempts. Wait 15 minutes, then try again.";
const NO_SITE =
  "This account isn't linked to an active site. Ask the site owner to invite you.";
const UNAVAILABLE =
  "We couldn't sign you in just now. Wait a minute, then try again.";

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const rawEmail = formData.get("email");
  const password = formData.get("password");
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email || typeof password !== "string" || !password) {
    return { error: WRONG_CREDENTIALS };
  }

  let token: string;
  try {
    ({ token } = await signInMember(email, password, await clientIp()));
  } catch (err) {
    if (err instanceof RateLimited) return { error: RATE_LIMITED };
    // A&M fork: one sign-in screen. MfaRequired comes only after the right password for a
    // staff account (the website admin): hand over to the staff flow (password again, then
    // the emailed code), email prefilled.
    if (err instanceof MfaRequired) {
      redirect(`/staff/sign-in?email=${encodeURIComponent(email)}`);
    }
    // Forbidden (and any other refusal): one message, never the reason (enumeration).
    if (err instanceof CdsError) return { error: WRONG_CREDENTIALS };
    console.error("[sign-in] failed", err);
    return { error: UNAVAILABLE };
  }

  // An outage during the site lookup is UNAVAILABLE, never "no site" (WR-B01).
  let site: Awaited<ReturnType<typeof firstSiteFor>>;
  try {
    site = await firstSiteFor(token);
  } catch (err) {
    console.error("[sign-in] site lookup failed", err);
    return { error: UNAVAILABLE };
  }
  // 10-32: a declined site's members sign in to read the declined notice.
  if (!site && !(await hasDeclinedSite(token))) return { error: NO_SITE };

  await setSessionCookie(token);
  // AGR-03 evidence: the signature records how the signer authenticated (Pitfall 9).
  await setAuthMethodCookie("password", token);
  // WR-E02: back to the invite that sent them here (validated: /invite/<token> only).
  redirect(safeSignInNext(formData.get("next")) ?? "/hub");
}

export type MemberCodeState = {
  step: "email" | "code";
  email: string;
  error: string | null;
};

const EMAIL_MAX = 254;
const CODE_RE = /^[0-9]{6}$/;

export async function requestMemberCodeAction(
  _prev: MemberCodeState,
  formData: FormData,
): Promise<MemberCodeState> {
  const raw = formData.get("email");
  const email =
    typeof raw === "string" ? raw.trim().toLowerCase().slice(0, EMAIL_MAX) : "";
  try {
    const { otpId } = await requestMemberCode(email, await clientIp());
    await setSignInCodeCookie({ otpId, email });
  } catch (err) {
    if (err instanceof RateLimited) {
      return { step: "email", email, error: SUBMIT_RATE_COPY };
    }
    if (err instanceof InvalidInput) {
      return { step: "email", email, error: ERR_EMAIL };
    }
    console.error(
      "[sign-in] code request failed",
      err instanceof Error ? err.name : typeof err,
    );
    return { step: "email", email, error: SEND_CODE_FAILED_COPY };
  }
  // The same answer whether or not the address has an account (T-06-82).
  return { step: "code", email, error: null };
}

export async function completeMemberCodeAction(
  prev: MemberCodeState,
  formData: FormData,
): Promise<{ step: "code"; email: string; error: string | null }> {
  const pending = await readSignInCodeCookie();
  const email = pending?.email ?? prev.email;
  const fail = (error: string) => ({ step: "code" as const, email, error });
  if (!pending) return fail(ERR_CODE_EXPIRED);
  const raw = formData.get("code");
  const code = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  if (!CODE_RE.test(code)) return fail(ERR_CODE);

  let token: string;
  try {
    ({ token } = await completeMemberCode({
      otpId: pending.otpId,
      code,
      ip: await clientIp(),
    }));
  } catch (err) {
    if (err instanceof SubmitCodeInvalid) return fail(ERR_CODE);
    if (err instanceof SubmitCodeExpired) return fail(ERR_CODE_EXPIRED);
    if (err instanceof RateLimited) return fail(SUBMIT_RATE_COPY);
    if (err instanceof CdsError) return fail(ERR_CODE);
    console.error(
      "[sign-in] code exchange failed",
      err instanceof Error ? err.name : typeof err,
    );
    return fail(UNAVAILABLE);
  }

  // Same rule as the password path: no active site, no cookie (and never "no site" on
  // an outage, WR-B01).
  let site: Awaited<ReturnType<typeof firstSiteFor>>;
  try {
    site = await firstSiteFor(token);
  } catch (err) {
    console.error("[sign-in] site lookup failed", err);
    return fail(UNAVAILABLE);
  }
  if (!site && !(await hasDeclinedSite(token))) return fail(NO_SITE);

  await clearSignInCodeCookie();
  await setSessionCookie(token);
  await setAuthMethodCookie("otp", token);
  redirect(safeSignInNext(formData.get("next")) ?? "/hub");
}

// Never gated (09-15): sign-out reads no session, so the re-accept gate cannot trap it.
// `endpoint` (review 11 WR-E01): this browser's push endpoint, read and unsubscribed by the
// client first; the signed-out person's row for it is dropped (best effort, never blocks).
export async function signOutAction(endpoint?: unknown): Promise<void> {
  await forgetPushDevice(endpoint);
  await clearSessionCookie();
  await clearAuthMethodCookie();
  await clearOrgCookie();
  redirect("/sign-in");
}

export type SwitchOrgResult = { ok: false };

/** PocketBase record ids: 15 lowercase letters and digits. */
const ORG_ID_RE = /^[a-z0-9]{15}$/;

/**
 * Switch the hub to another org (DASH-18, D286). The id is untrusted: it must be one of the
 * signed-in person's active memberships, or nothing is written and `{ ok: false }` comes
 * back with no detail (a foreign id, a malformed id, no session and an outage all look the
 * same). On success: cookie set, hub layout revalidated (A8), redirect to /hub/today.
 */
export async function switchOrgAction(
  orgId: unknown,
): Promise<SwitchOrgResult> {
  const refuse: SwitchOrgResult = { ok: false };
  if (typeof orgId !== "string" || !ORG_ID_RE.test(orgId)) return refuse;
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return refuse;
  let member = false;
  try {
    const linked = await listMemberOrganizations(token);
    member = linked.organizations.some((o) => o.id === orgId);
  } catch (err) {
    if (!(err instanceof CdsError)) {
      console.error(
        "[org-switch] membership lookup failed",
        err instanceof Error ? err.name : typeof err,
      );
    }
    return refuse;
  }
  if (!member) return refuse;
  await setOrgCookie(orgId);
  revalidatePath("/hub", "layout");
  // 11-50: Today shows the toast "You're now in {site}." once (HubFlash).
  redirect(withFlash("/hub/today", "switched"));
}
