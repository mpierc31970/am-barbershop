"use server";
// Staff impersonation start / end (13-26 choice 1; STAFF-06; D10, D98, P13-P4, D-UI-P13-12;
// T-13-26-01..04). Public POST endpoints: every argument is untrusted. Server Actions are
// POST-only with Next's Origin check, and both staff cookies are SameSite=Strict.
//
// Start: runStaffAction("impersonate") re-reads the staff session and STAFF_MATRIX, then
// startImpersonationSession in @cds/db (reason 3-500, the owner view's super_admin rule, the
// one tenant-visible impersonation.start audit row) and sets the signed impersonation cookie
// bound to the staff token (it dies with the staff session), then opens /hub in the same tab.
// End: verify the cookie, resume, endImpersonation (impersonation.end with meta.startId),
// delete the cookie, back to /staff/sites/<org>. End always deletes the cookie, even when the
// staff session is gone (then /staff/sign-in) or the view already expired.
// A new Start first ends the view the cookie points at (WR-C02), so every start row gets an end.
// Errors are logged by class name only.
import { linkSecret, startImpersonationSession } from "@cds/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  impersonationCookieName,
  signImpersonation,
} from "../../../lib/impersonation-cookie";
import {
  clearImpersonationCookie,
  endCurrentImpersonation,
} from "../../../lib/impersonation-end";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";
import {
  getStaffSession,
  staffTokenFromCookie,
} from "../../../lib/staff-session";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
const REASON_MIN = 3;
const REASON_MAX = 500;
const COOKIE_MAX_AGE_S = 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Open a site's hub as CDS staff. `input` = `{ orgId, view: "admin" | "owner", reason }`.
 * On success the cookie is set and the request redirects to /hub (never returns).
 */
export async function startImpersonationAction(
  input: unknown,
): Promise<ActionResult<never>> {
  const raw = (typeof input === "object" && input !== null ? input : {}) as {
    orgId?: unknown;
    view?: unknown;
    reason?: unknown;
  };
  const orgId = typeof raw.orgId === "string" ? raw.orgId : "";
  if (!ORG_RE.test(orgId)) {
    return { ok: false, code: "not_found", message: "That site wasn't found." };
  }
  const view = raw.view === "owner" ? "owner" : "admin";
  if (raw.view !== undefined && raw.view !== "admin" && raw.view !== "owner") {
    return {
      ok: false,
      code: "invalid_input",
      message: "Pick As admin or As owner.",
      field: "view",
    };
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Write a reason of ${REASON_MIN} to ${REASON_MAX} characters.`,
      field: "reason",
    } satisfies Failure;
  }
  const result = await runStaffAction(
    "impersonate",
    {},
    async (ctx, session) => {
      // WR-C02: close the previous view first, so its start row is not left open.
      await endCurrentImpersonation(session);
      const s = await startImpersonationSession(ctx, orgId, reason, { view });
      const value = signImpersonation(
        {
          org: orgId,
          view,
          staff: ctx.actor,
          startId: s.startId,
          exp: Date.parse(s.expiresAt),
        },
        session.token,
        linkSecret(),
      );
      const jar = await cookies();
      jar.set(impersonationCookieName(), value, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: isProduction(),
        maxAge: COOKIE_MAX_AGE_S,
      });
      return true as const;
    },
  );
  if (!result.ok) return result;
  redirect("/hub");
}

/**
 * Stop viewing as CDS staff (the banner's End form). Arguments (a form's FormData) are
 * ignored: the session comes from the cookies. Always redirects.
 */
export async function endImpersonationAction(): Promise<never> {
  let target = "/staff/sites";
  try {
    const staffToken = await staffTokenFromCookie();
    const staff = staffToken ? await getStaffSession() : null;
    if (!staff || staff.token !== staffToken) {
      target = "/staff/sign-in";
    } else {
      const org = await endCurrentImpersonation(staff);
      if (org) target = `/staff/sites/${org}`;
    }
  } catch (err) {
    console.error("[impersonation] end failed", errorName(err));
  }
  await clearImpersonationCookie();
  redirect(target);
}
