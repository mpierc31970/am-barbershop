// Staff console session (13-21 choice 1; CONTEXT Area 1; P13-P1; Invariant 10;
// T-13-21-04, T-13-21-05). Server-only: imports next/headers.
//
// The staff PocketBase token lives only in its own httpOnly, SameSite=Strict cookie:
// `__Host-cds_staff` in production (Secure, path /, no Domain), `cds_staff` over http in dev.
// It never shares a name with the member cookie, so a staff person who is also a member keeps
// the two populations apart. Every request re-derives the PlatformContext: readStaffSession
// looks the row up by sha256(token) (idle 2 h, absolute 12 h, sign-out revoke) and re-reads
// the role through platformContextFromToken, so a demotion takes effect at once.
//
// Role gates come from STAFF_MATRIX only (authorizeStaff); apps/web holds no role literals.
import { authorizeStaff, Forbidden, NotFound, type StaffRole } from "@cds/core";
import { readStaffSession, type PlatformContext } from "@cds/db";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { MAX_PATH_HEADER, PATH_HEADER } from "./path-header";
import { clientIp, sessionCookieName } from "./session";
import { staffSignInHrefFor } from "./staff-next";

/** The absolute staff session limit (12 h, P13-P1); the row enforces idle 2 h. */
export const STAFF_COOKIE_MAX_AGE_S = 12 * 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function staffCookieName(): string {
  const name = isProduction() ? "__Host-cds_staff" : "cds_staff";
  // Invariant 10: never the member cookie (a guard against a future rename).
  if (name === sessionCookieName()) throw new Error("staff cookie collision");
  return name;
}

export async function setStaffCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(staffCookieName(), token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: isProduction(),
    maxAge: STAFF_COOKIE_MAX_AGE_S,
  });
}

export async function clearStaffCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: staffCookieName(), path: "/", secure: isProduction() });
}

/** The raw staff token from the cookie (sign-out and impersonation binding), or null. */
export async function staffTokenFromCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(staffCookieName())?.value || null;
}

export type StaffWebSession = {
  ctx: PlatformContext;
  /** The PB token (cookie value); server-side only, never sent to client components. */
  token: string;
  sessionId: string;
  /** Signed in or stepped up within the last 15 minutes. */
  stepUpFresh: boolean;
  name: string;
  role: StaffRole;
  /** "m•••@example.com": never the full address. */
  maskedEmail: string;
};

/**
 * Forbidden / NotFound are a real sign-out (ended, idle, expired, demoted, unknown token).
 * Anything else (an outage) propagates, so it is never mistaken for one (WR-B01).
 */
function isSignedOut(err: unknown): boolean {
  return err instanceof Forbidden || err instanceof NotFound;
}

/** The staff session for this request, or null when signed out. Memoized per request. */
export const getStaffSession = cache(
  async (): Promise<StaffWebSession | null> => {
    const token = await staffTokenFromCookie();
    if (!token) return null;
    try {
      const s = await readStaffSession(token, { ip: await clientIp() });
      return {
        ctx: s.ctx,
        token,
        sessionId: s.sessionId,
        stepUpFresh: s.stepUpFresh,
        name: s.staffName,
        role: s.ctx.staffRole,
        maskedEmail: s.staffEmailMasked,
      };
    } catch (err) {
      if (isSignedOut(err)) return null;
      throw err;
    }
  },
);

/** True when `role` may use `feature` (STAFF_MATRIX via authorizeStaff). */
export function staffCan(
  role: StaffRole | "" | null | undefined,
  feature: string,
): boolean {
  try {
    authorizeStaff(role, feature);
    return true;
  } catch {
    return false;
  }
}

async function requestPath(): Promise<string | null> {
  const raw = (await headers()).get(PATH_HEADER);
  return typeof raw === "string" && raw.length <= MAX_PATH_HEADER ? raw : null;
}

/**
 * The page guard: the session, a redirect to /staff/sign-in?next=<this path> when signed out,
 * or a 404 when the role may never use `feature` (the area does not exist for them).
 */
export async function requireStaff(feature: string): Promise<StaffWebSession> {
  const session = await getStaffSession();
  if (!session) redirect(staffSignInHrefFor(await requestPath()));
  if (!staffCan(session.role, feature)) notFound();
  return session;
}
