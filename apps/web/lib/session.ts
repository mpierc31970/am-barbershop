// Hub session (CONT-08, CONTEXT A2-Q2, RESEARCH Pattern 6; ASVS V3; T-03-42, T-03-43).
// Member sign-in is pulled forward from P11 so drafts and the hub sit behind a login.
//
// The PocketBase token lives only in an httpOnly, SameSite=Lax cookie: `__Host-` prefixed
// (Secure, path /, no Domain) in production, `cds_session` over http in dev. It never goes
// in a URL or to client JS. Every hub request and Server Action re-derives the OrgContext
// from this cookie: listMemberOrganizations -> the site picked by the cds_org cookie (11-11,
// DASH-18), else the first active site -> orgContextFromToken, which re-checks the
// membership. The cds_org value is untrusted: it only picks among the person's own
// memberships and never grants a foreign org. No caller passes a tenant id in (invariant 1).
// Server-only: imports next/headers.
import { Forbidden, NotFound, type OrgRole } from "@cds/core";
import {
  declinedMemberContext,
  forgetPushDeviceForSession,
  linkSecret,
  listMemberOrganizations,
  orgContextFromToken,
  resumeImpersonation,
  type OrgContext,
} from "@cds/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  signAuthMethod,
  verifyAuthMethod,
  type AuthMethod,
} from "./auth-method";
import {
  impersonationCookieName,
  verifyImpersonation,
} from "./impersonation-cookie";
import { getStaffSession, staffTokenFromCookie } from "./staff-session";
import {
  getAgreementStatus,
  isGateExempt,
  isHubPath,
  PATH_HEADER,
  reacceptTarget,
} from "./agreement-gate";

/** PocketBase's default auth token lifetime for the users collection (7 days). */
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionCookieName(): string {
  return isProduction() ? "__Host-cds_session" : "cds_session";
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({
    name: sessionCookieName(),
    path: "/",
    secure: isProduction(),
  });
}

/**
 * The selected organization (11-11, DASH-01, DASH-18; D5, D286): an org id in an httpOnly
 * cookie with the session cookie's flags (`__Host-` in production). Untrusted: getHubSession
 * uses it only when it names one of the person's active memberships; anything else falls
 * back to the first org. Written only by switchOrgAction (never during RSC render); cleared
 * at sign-out.
 */
/**
 * Sign-out (review 11 WR-A02, WR-E01): drop the signed-in person's push device for this
 * browser, in every org, before the session cookie goes. `arg` is the endpoint the client
 * read before unsubscribing (a string, or a form's `endpoint` field). Untrusted: the person
 * comes from the session cookie, and only their own rows match. Best effort and never
 * throws: sign-out always goes ahead (no session, a bad endpoint or an outage do nothing).
 */
export async function forgetPushDevice(arg: unknown): Promise<void> {
  const endpoint =
    typeof FormData !== "undefined" && arg instanceof FormData
      ? arg.get("endpoint")
      : arg;
  if (typeof endpoint !== "string" || endpoint === "") return;
  try {
    const token = (await cookies()).get(sessionCookieName())?.value;
    if (!token) return;
    await forgetPushDeviceForSession(token, endpoint);
  } catch (err) {
    console.error(
      "[sign-out] push device not forgotten",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

export function orgCookieName(): string {
  return isProduction() ? "__Host-cds_org" : "cds_org";
}

export async function setOrgCookie(orgId: string): Promise<void> {
  const jar = await cookies();
  jar.set(orgCookieName(), orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearOrgCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({
    name: orgCookieName(),
    path: "/",
    secure: isProduction(),
  });
}

/**
 * How the member signed in (AGR-03 evidence, RESEARCH Pitfall 9, CONTEXT A2-Q2): `otp` or
 * `password`, in an httpOnly companion cookie with the session cookie's flags, cleared at
 * sign-out. The signing screen records it on the signature. Evidence only: never part of
 * OrgContext, never an access decision.
 *
 * The value is HMAC-signed and bound to the session token (review CR-C01, lib/auth-method):
 * an edited, copied or left-over cookie reads as "unknown", never as a forged method.
 */
export type { AuthMethod };

export function authMethodCookieName(): string {
  return isProduction() ? "__Host-cds_auth_method" : "cds_auth_method";
}

/**
 * Records `method` for the session `token` just set. A missing link secret (a production
 * misconfiguration) is logged and the cookie is skipped, so sign-in still works and the
 * evidence says "unknown" rather than guessing.
 */
export async function setAuthMethodCookie(
  method: AuthMethod,
  token: string,
): Promise<void> {
  let value: string;
  try {
    value = signAuthMethod(method, token, linkSecret());
  } catch (err) {
    console.error(
      "[session] auth-method cookie not set",
      err instanceof Error ? err.message : typeof err,
    );
    await clearAuthMethodCookie();
    return;
  }
  const jar = await cookies();
  jar.set(authMethodCookieName(), value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearAuthMethodCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({
    name: authMethodCookieName(),
    path: "/",
    secure: isProduction(),
  });
}

/**
 * The recorded sign-in method, verified against the current session token; "unknown" when
 * missing, unsigned, forged, from another session, or when the secret is unavailable.
 */
export async function readAuthMethod(): Promise<AuthMethod | "unknown"> {
  const jar = await cookies();
  const v = jar.get(authMethodCookieName())?.value;
  const token = jar.get(sessionCookieName())?.value;
  let secret: string;
  try {
    secret = linkSecret();
  } catch {
    return "unknown";
  }
  return verifyAuthMethod(v, token, secret);
}

/**
 * How many trusted proxies sit in front of the app (WR-B07). Proxy chain on the Coolify VPS
 * (checked 2026-09-27): client -> coolify-proxy (Traefik v3, the edge on :80/:443, no
 * forwardedHeaders.trustedIPs / insecure) -> app. Traefik drops a client-sent
 * X-Forwarded-For and writes the peer address, so the rightmost entry is the real client:
 * 1 hop. Put another proxy in front (a CDN, an edge Caddy that Traefik trusts) and each one
 * appends its peer, so set TRUSTED_PROXY_HOPS to the number of proxies. A bad value is 1.
 */
function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The client IP from request headers (WR-B07): the X-Forwarded-For entry `hops` from the
 * right, the one our own nearest trusted proxy wrote. Entries to the left of it are
 * client-controlled and never used, so rotating a spoofed leftmost value cannot mint fresh
 * rate-limit buckets or fake the IP in audit rows. With fewer entries than hops (a request
 * that skipped the proxy), fall back to x-real-ip, else "".
 */
export function clientIpFrom(h: Headers, hops: number): string {
  const parts =
    h
      .get("x-forwarded-for")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  if (parts.length >= hops) return parts[parts.length - hops] ?? "";
  return h.get("x-real-ip")?.trim() ?? "";
}

/** The caller's IP for rate limits and audit rows (see clientIpFrom). */
export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers(), trustedProxyHops());
}

/**
 * True when the database refused the token or membership (Forbidden, NotFound): a real
 * sign-out. Anything else, including an outage (network error, timeout, 5xx, which
 * @cds/db rethrows as is), is not, and must propagate (WR-B01).
 */
function isSignedOut(err: unknown): boolean {
  return err instanceof Forbidden || err instanceof NotFound;
}

export type HubSite = { id: string; name: string; primaryHost: string | null };

/** One org in the switcher: the person's role there (11-11). */
export type HubOrg = { id: string; name: string; role: OrgRole };

export type HubSession = {
  ctx: OrgContext;
  email: string;
  org: HubSite;
  /** Every active org the person belongs to, membership order (the switcher list). */
  orgs: HubOrg[];
  /**
   * True when the cds_org cookie named an org that is not (or no longer) one of the
   * person's memberships, so the first org was used instead. The layout carries on; the
   * cookie is rewritten on the next switch (no cookie write during render).
   */
  staleOrg: boolean;
  /**
   * Set only when CDS staff are viewing this site (13-26, STAFF-06, P13-P4): what the
   * ImpersonationBanner shows. Absent on every member session.
   */
  impersonation?: HubImpersonation;
};

/** The running staff view of one site (banner facts; 13-26 choice 2). */
export type HubImpersonation = {
  business: string;
  view: "admin" | "owner";
  reason: string;
  /** ISO time the 60-minute box ends. */
  endsAt: string;
  startId: string;
};

/**
 * The impersonated session for this request, or null (13-26 choice 2; RESEARCH Pattern 4,
 * Pitfall 13; T-13-26-01). The staff cookie is read ONLY when an impersonation cookie is
 * present, and it counts only when that cookie's MAC verifies against the same staff token
 * (it dies with the staff session) and resumeImpersonation re-checks the start row, the 60
 * minutes, the end row and the staff actor in @cds/db (writes nothing). Any refusal (no
 * staff session, bad signature, expired, ended, other staff) is null, so the caller falls
 * through to the member cookie unchanged. An outage still throws (WR-B01).
 */
async function impersonatedSession(
  value: string | undefined,
): Promise<HubSession | null> {
  if (!value) return null;
  const staffToken = await staffTokenFromCookie();
  if (!staffToken) return null;
  let secret: string;
  try {
    secret = linkSecret();
  } catch {
    return null;
  }
  const payload = verifyImpersonation(value, staffToken, secret);
  if (!payload) return null;
  const staff = await getStaffSession();
  if (!staff || staff.token !== staffToken) return null;
  if (staff.ctx.actor !== payload.staff) return null;
  try {
    const r = await resumeImpersonation(staff.ctx, {
      orgId: payload.org,
      view: payload.view,
      startId: payload.startId,
    });
    return {
      ctx: r.ctx,
      email: staff.maskedEmail,
      org: { id: payload.org, name: r.business, primaryHost: r.primaryHost },
      orgs: [{ id: payload.org, name: r.business, role: r.view }],
      staleOrg: false,
      impersonation: {
        business: r.business,
        view: r.view,
        reason: r.reason,
        endsAt: r.expiresAt,
        startId: r.startId,
      },
    };
  } catch (err) {
    if (isSignedOut(err)) return null;
    throw err;
  }
}

/** True when the request carries an impersonation cookie (valid or not). */
export async function hasImpersonationCookie(): Promise<boolean> {
  return Boolean((await cookies()).get(impersonationCookieName())?.value);
}

/**
 * The first active site the token's user belongs to, or null (none, or a staff token).
 * Used by sign-in so the action file never handles tenant ids itself.
 */
export async function firstSiteFor(token: string): Promise<HubSite | null> {
  try {
    const linked = await listMemberOrganizations(token);
    const org = linked.organizations[0];
    return org
      ? { id: org.id, name: org.name, primaryHost: org.primaryHost }
      : null;
  } catch (err) {
    if (isSignedOut(err)) return null;
    throw err;
  }
}

/**
 * The signed-in member's session for this request, or null. Cached per request (React
 * cache), so the layout, page and actions share one lookup, and every hub request builds
 * exactly one OrgContext (DASH-01). The org is the one the cds_org cookie names when it is
 * one of the person's memberships, else the first active site (`staleOrg` when the cookie
 * named anything else). A token the database rejects (expired, revoked, staff, removed
 * membership: Forbidden or NotFound) is null, never an error. An outage (or any other error)
 * still throws, so it is not mistaken for a sign-out (WR-B01).
 *
 * 13-26: before the member cookie, a CDS staff view (impersonation cookie bound to the staff
 * cookie) is tried; the member cookie never authenticates staff and the staff cookie alone
 * never opens the hub.
 */
export const getHubSession = cache(async (): Promise<HubSession | null> => {
  const jar = await cookies();
  // 13-26: a valid staff view wins; anything less falls through to the member cookie.
  const imp = await impersonatedSession(
    jar.get(impersonationCookieName())?.value,
  );
  if (imp) return imp;
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  const wanted = jar.get(orgCookieName())?.value ?? "";
  try {
    const linked = await listMemberOrganizations(token);
    const chosen = wanted
      ? linked.organizations.find((o) => o.id === wanted)
      : undefined;
    const org = chosen ?? linked.organizations[0];
    if (!org) return null;
    const ctx = await orgContextFromToken(token, org.id, await clientIp());
    return {
      ctx,
      email: linked.email,
      org: { id: org.id, name: org.name, primaryHost: org.primaryHost },
      orgs: linked.organizations.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
      })),
      staleOrg: wanted !== "" && !chosen,
    };
  } catch (err) {
    if (isSignedOut(err)) return null;
    throw err;
  }
});

/**
 * The re-acceptance gate (AGR-07, CONTEXT A3-Q1, D216, D287; 09-15 choices 1-4). Only the
 * Owner, never impersonating staff, never Admin/Editor/Viewer; only on /hub paths off the
 * opt-out list; an org that never signed is "unsigned", never redirected. A failed status
 * read is logged and lets the Owner through: the signing screen reports its own errors.
 */
export async function enforceAgreementGate(session: HubSession): Promise<void> {
  const { ctx } = session;
  if (ctx.role !== "owner" || ctx.impersonator) return;
  const path = await requestPath();
  if (await agreementBlocks(session, path)) redirect(reacceptTarget(path));
}

async function requestPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/hub";
}

/**
 * True when the re-acceptance gate refuses this request (same rules as
 * enforceAgreementGate) without redirecting. Server Actions (runAction) and hub route
 * handlers (media) answer `agreement_required` instead, so a client editor keeps its
 * unsaved work (review WR-C01, WR-C02). `path` defaults to the middleware's path header.
 */
export async function agreementBlocks(
  session: HubSession,
  path?: string,
): Promise<boolean> {
  const { ctx } = session;
  if (ctx.role !== "owner" || ctx.impersonator) return false;
  const p = path ?? (await requestPath());
  if (!isHubPath(p) || isGateExempt(p)) return false;
  try {
    return (await getAgreementStatus(ctx)).state === "outdated";
  } catch (err) {
    console.error(
      "[agreement-gate] status read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return false;
  }
}

/** Where an ended / expired staff view lands (13-26): the console's Sites list. */
export const IMPERSONATION_ENDED_PATH = "/staff/sites";

/** Where a declined org's hub requests land (10-32): the layout renders the notice. */
export const DECLINED_PATH = "/hub/declined";

/**
 * The declined-notice session (10-32; BILL-09, D214): set only when the member has no
 * active site but belongs to one CDS declined (closed_reason = declined). Read-only: the
 * hub layout renders the declined notice with it and the agreement download route serves
 * the signed copy. Never used by Server Actions (runAction stays on getHubSession), so a
 * declined org cannot change anything (T-10-32-02). Any failure reads as null.
 */
export const getDeclinedSession = cache(
  async (): Promise<HubSession | null> => {
    const token = (await cookies()).get(sessionCookieName())?.value;
    if (!token) return null;
    try {
      if (await getHubSession()) return null;
      const declined = await declinedMemberContext(token, await clientIp());
      if (!declined) return null;
      return {
        ctx: declined.ctx,
        email: declined.email,
        org: { ...declined.org, primaryHost: null },
        orgs: [
          {
            id: declined.org.id,
            name: declined.org.name,
            role: declined.ctx.role,
          },
        ],
        staleOrg: false,
      };
    } catch (err) {
      console.error(
        "[session] declined lookup failed",
        err instanceof Error ? err.name : typeof err,
      );
      return null;
    }
  },
);

/**
 * True when `token` belongs to a member of a declined site (sign-in lets them in to read
 * the notice). Any failure is false, so sign-in answers as before.
 */
export async function hasDeclinedSite(token: string): Promise<boolean> {
  try {
    return (await declinedMemberContext(token, await clientIp())) !== null;
  } catch {
    return false;
  }
}

/**
 * The session, or a redirect to /sign-in. Runs the re-acceptance gate unless
 * `{ agreementGate: false }` (the agreement pages and download route, 09-17/09-18).
 * 10-32: a member of a declined site goes to the declined notice instead.
 */
export async function requireHubSession(
  opts: { agreementGate?: boolean } = {},
): Promise<HubSession> {
  const session = await getHubSession();
  if (!session) {
    // 13-26: a staff view that ended or expired goes back to the console, not member sign-in.
    if (await hasImpersonationCookie()) redirect(IMPERSONATION_ENDED_PATH);
    if (await getDeclinedSession()) redirect(DECLINED_PATH);
    redirect("/sign-in");
  }
  if (opts.agreementGate !== false) await enforceAgreementGate(session);
  return session;
}
