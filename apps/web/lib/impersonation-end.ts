// Close the staff member's current impersonation, if any (WR-C02; CONTEXT Area 1: the tenant
// audit log shows start, every write and end). Used by End, by Start (a new view first closes
// the one the cookie points at) and by staff sign-out (before the staff row is revoked, while
// the cookie's MAC can still be verified). Best effort: an expired or already-ended view has
// nothing to close. Errors are logged by class name only.
import { endImpersonation, linkSecret, resumeImpersonation } from "@cds/db";
import { cookies } from "next/headers";
import {
  impersonationCookieName,
  verifyImpersonation,
} from "./impersonation-cookie";
import { errorName } from "./staff-action";
import type { StaffWebSession } from "./staff-session";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Delete the impersonation cookie. */
export async function clearImpersonationCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({
    name: impersonationCookieName(),
    path: "/",
    secure: isProduction(),
  });
}

/**
 * Write impersonation.end for the view the cookie points at, when the cookie verifies against
 * this staff session. Returns the org that was being viewed, or null (no valid cookie).
 * Never throws for a view that cannot be resumed (expired, already ended).
 */
export async function endCurrentImpersonation(
  staff: StaffWebSession,
): Promise<string | null> {
  const value = (await cookies()).get(impersonationCookieName())?.value;
  if (!value) return null;
  const p = verifyImpersonation(value, staff.token, linkSecret());
  if (!p || p.staff !== staff.ctx.actor) return null;
  try {
    const r = await resumeImpersonation(staff.ctx, {
      orgId: p.org,
      view: p.view,
      startId: p.startId,
    });
    await endImpersonation(r.ctx, { startId: p.startId });
  } catch (err) {
    // Expired or already ended: nothing to close.
    console.error("[impersonation] end not recorded", errorName(err));
  }
  return p.org;
}
