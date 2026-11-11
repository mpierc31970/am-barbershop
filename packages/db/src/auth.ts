// Platform-user sign-in flows (TEN-15, TEN-11, TEN-05, TEN-02; D9, D98; RESEARCH Pattern 7,
// Pitfall 2). PocketBase tokens carry no MFA claim, so this module owns the whole staff
// flow and is the only place a PlatformContext is minted from a real sign-in:
//   - staff: password -> 401 {mfaId} -> OTP -> token (PB mfa rule "staff_role != ''")
//   - any valid staff token was issued through MFA, because setStaffRole rotates tokenKey
//     in the same update that changes staff_role (tokens issued before the change die)
//   - PB's users impersonate endpoint mints MFA-less tokens and is NEVER called (grep gate)
// PB auth calls use a fresh guestClient() each time; lookups and tokenKey rotation use the
// superuser client with pb.filter bound params. Passwords, codes and tokens are never logged.
import { randomInt } from "node:crypto";
import {
  authorizeStaff,
  Forbidden,
  InvalidInput,
  MfaRequired,
  NotFound,
  ORG_ROLES,
  STAFF_ROLES,
  type OrgRole,
  type StaffRole,
} from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { removeEndpointRows } from "./alerts/push/store";
import { assertPushEndpoint } from "./alerts/subscriptions";
import { appendAudit } from "./audit";
import { guestClient, withSuperuser } from "./client";
import { beginSignIn } from "./rate-limit";
import {
  assertPlatformContext,
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "./context";

/** One generic message for every staff sign-in failure: no account enumeration (T-02-30). */
const INVALID_CREDENTIALS = "invalid credentials";
const INVALID_SESSION = "invalid session";
const TOKEN_KEY_LENGTH = 50;
const TOKEN_KEY_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function isStaffRole(v: unknown): v is StaffRole {
  return (
    typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v)
  );
}

function isOrgRole(v: unknown): v is OrgRole {
  return typeof v === "string" && (ORG_ROLES as readonly string[]).includes(v);
}

function mfaIdOf(err: unknown): string | undefined {
  if (err instanceof ClientResponseError && err.status === 401) {
    const id = (err.response as { mfaId?: unknown } | undefined)?.mfaId;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

function randomTokenKey(): string {
  let out = "";
  for (let i = 0; i < TOKEN_KEY_LENGTH; i++) {
    out += TOKEN_KEY_ALPHABET[randomInt(TOKEN_KEY_ALPHABET.length)];
  }
  return out;
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v)
    throw new InvalidInput(`${name} is required`);
  return v;
}

/** PB statuses that mean "this token is not a valid session" (WR-B01). */
const REJECTED_TOKEN_STATUSES: readonly number[] = [401, 403, 404];

/**
 * authRefresh a presented token. Only PB rejecting the token (401/403/404) is an invalid
 * session (Forbidden). Anything else (network error, timeout, 5xx) is rethrown as is, so an
 * outage is never mistaken for a sign-out (WR-B01): callers that map CdsError to "signed
 * out" let it through as an error instead.
 */
async function refreshUser(token: string): Promise<RecordModel> {
  if (typeof token !== "string" || !token) throw new Forbidden(INVALID_SESSION);
  const pb = guestClient();
  pb.authStore.save(token, null);
  try {
    const res = await pb.collection("users").authRefresh();
    return res.record;
  } catch (err) {
    if (
      err instanceof ClientResponseError &&
      REJECTED_TOKEN_STATUSES.includes(err.status)
    ) {
      throw new Forbidden(INVALID_SESSION);
    }
    throw err;
  } finally {
    pb.authStore.clear();
  }
}

export type StaffSignInStarted = {
  status: "mfa_required";
  mfaId: string;
  otpId: string;
};

/**
 * Step 1 of staff sign-in: check the password and send the OTP (second factor). A bad
 * password, an unknown account and a non-staff account all throw the same Forbidden.
 * `ip` is the real client IP: failed attempts are rate-limited per IP, per (account, IP) and
 * per account before PB is called (WR-01), because PB only ever sees the app server's IP.
 * A right password never counts (WR-02). One source can only fill its own (account, IP)
 * bucket, so locking the real user out takes failures from many IPs at once, until the
 * 10-minute window passes (iteration-3 WR-01; limits in rate-limit.ts).
 */
export async function signInStaff(
  email: string,
  password: string,
  ip: string,
): Promise<StaffSignInStarted> {
  if (typeof email !== "string" || typeof password !== "string") {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
  const attempt = beginSignIn("email", ip, email);
  const pb = guestClient();
  let mfaId: string | undefined;
  try {
    await pb.collection("users").authWithPassword(email, password);
  } catch (err) {
    mfaId = mfaIdOf(err);
  } finally {
    // A token without MFA means "not staff": discard it.
    pb.authStore.clear();
  }
  if (!mfaId) throw new Forbidden(INVALID_CREDENTIALS);
  // The password was right: this attempt is not a failure (WR-02).
  attempt.succeeded();
  try {
    const { otpId } = await guestClient().collection("users").requestOTP(email);
    return { status: "mfa_required", mfaId, otpId };
  } catch {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
}

/** Step 2 of staff sign-in: OTP + mfaId -> token and PlatformContext. */
export async function completeStaffSignIn(input: {
  mfaId: string;
  otpId: string;
  code: string;
  ip: string;
}): Promise<{ ctx: PlatformContext; token: string }> {
  const mfaId = requireString(input?.mfaId, "mfaId");
  const otpId = requireString(input?.otpId, "otpId");
  const code = requireString(input?.code, "code");
  const attempt = beginSignIn("otp", input.ip, otpId);
  const pb = guestClient();
  let token: string;
  let record: RecordModel;
  try {
    const res = await pb
      .collection("users")
      .authWithOTP(otpId, code, { mfaId });
    token = res.token;
    record = res.record;
  } catch {
    throw new Forbidden(INVALID_CREDENTIALS);
  } finally {
    pb.authStore.clear();
  }
  if (!isStaffRole(record.staff_role) || !token) {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
  attempt.succeeded();
  const ctx = mintPlatformContext({
    actor: record.id,
    staffRole: record.staff_role,
    ip: input.ip,
  });
  return { ctx, token };
}

/** Re-validate a staff token (authRefresh); the user must still hold a staff_role. */
export async function platformContextFromToken(
  token: string,
  ip: string,
): Promise<PlatformContext> {
  const record = await refreshUser(token);
  if (!isStaffRole(record.staff_role)) throw new Forbidden(INVALID_SESSION);
  return mintPlatformContext({
    actor: record.id,
    staffRole: record.staff_role,
    ip,
  });
}

/**
 * Member (non-staff) password sign-in. Staff accounts must use the MFA flow. Pass the real
 * client `ip`: failed attempts are rate-limited per IP, per (account, IP) and per account
 * (WR-01, WR-02; iteration-3 WR-01). Callers without an IP share one source per account.
 */
export async function signInMember(
  email: string,
  password: string,
  ip?: string,
): Promise<{ token: string }> {
  if (typeof email !== "string" || typeof password !== "string") {
    throw new Forbidden(INVALID_CREDENTIALS);
  }
  const attempt = beginSignIn("email", ip, email);
  const pb = guestClient();
  try {
    const res = await pb.collection("users").authWithPassword(email, password);
    if (!res.token) throw new Forbidden(INVALID_CREDENTIALS);
    attempt.succeeded();
    return { token: res.token };
  } catch (err) {
    if (mfaIdOf(err)) {
      // PB returns an mfaId only after a password match: not a failed guess (WR-02).
      attempt.succeeded();
      throw new MfaRequired("staff accounts sign in with password and OTP");
    }
    throw new Forbidden(INVALID_CREDENTIALS);
  } finally {
    pb.authStore.clear();
  }
}

/**
 * Mint an OrgContext for a platform user in one organization: the token must refresh, a
 * memberships row (user, org) must exist and the org must be active; otherwise NotFound.
 */
export async function orgContextFromToken(
  token: string,
  orgId: string,
  ip: string,
): Promise<OrgContext> {
  if (typeof orgId !== "string" || !orgId) throw new NotFound("not found");
  const record = await refreshUser(token);
  // CDS staff enter a tenant only through startImpersonation (audited, flagged), never as a
  // plain member (CR-03, invariant 10). A stray membership row grants them nothing.
  if (record.staff_role) throw new NotFound("not found");
  const membership = await withSuperuser(async (pb) => {
    try {
      return await pb
        .collection("memberships")
        .getFirstListItem(
          pb.filter(
            "user = {:user} && organization = {:org} && organization.status = 'active'",
            { user: record.id, org: orgId },
          ),
        );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
  if (!membership || !isOrgRole(membership.role)) {
    throw new NotFound("not found");
  }
  const rawGrants: unknown = membership.addon_grants;
  const grants = Array.isArray(rawGrants)
    ? rawGrants.filter((g): g is string => typeof g === "string")
    : [];
  return mintOrgContext({
    orgId,
    actor: record.id,
    role: membership.role,
    grants,
    ip,
  });
}

export type MemberOrganization = {
  id: string;
  name: string;
  /** The person's role in this org (memberships.role). */
  role: OrgRole;
  /** Always "active": inactive orgs are excluded. */
  status: "active";
  primaryHost: string | null;
};

export type MemberOrganizations = {
  userId: string;
  email: string;
  organizations: MemberOrganization[];
};

/**
 * The active organizations a platform user belongs to, each with the person's role there,
 * for the hub session and the org switcher (RESEARCH Pattern 6; 11-11, DASH-18). Order is
 * membership order (created, id): the first is the default org. The chosen org id then goes
 * to orgContextFromToken, which re-checks the membership, so this list never grants access
 * by itself. CDS staff are never members (invariant 10): a staff token is NotFound, like
 * orgContextFromToken. One bound memberships query, then one bound primary-host query.
 */
export async function listMemberOrganizations(
  token: string,
): Promise<MemberOrganizations> {
  const record = await refreshUser(token);
  if (record.staff_role) throw new NotFound("not found");
  return withSuperuser(async (pb) => {
    const memberships = await pb.collection("memberships").getFullList({
      filter: pb.filter("user = {:user} && organization.status = 'active'", {
        user: record.id,
      }),
      expand: "organization",
      sort: "created,id",
    });
    const picked: { org: RecordModel; role: OrgRole }[] = [];
    for (const m of memberships) {
      const org = (m.expand as { organization?: RecordModel } | undefined)
        ?.organization;
      if (!org || org.status !== "active" || !isOrgRole(m.role)) continue;
      if (picked.some((p) => p.org.id === org.id)) continue;
      picked.push({ org, role: m.role });
    }
    const hostOf = new Map<string, string>();
    if (picked.length > 0) {
      const params: Record<string, string> = {};
      const clauses = picked.map((p, i) => {
        params["o" + i] = p.org.id;
        return "organization = {:o" + i + "}";
      });
      // Placeholders only: every org id is a bound param (T-02-13).
      const expr = "primary = true && (" + clauses.join(" || ") + ")";
      const hosts = await pb.collection("org_hosts").getFullList({
        filter: pb.filter(expr, params),
        fields: "organization,hostname",
      });
      for (const h of hosts) {
        const org = typeof h.organization === "string" ? h.organization : "";
        const name = typeof h.hostname === "string" ? h.hostname : "";
        if (org && name && !hostOf.has(org)) hostOf.set(org, name);
      }
    }
    return {
      userId: record.id,
      email: typeof record.email === "string" ? record.email : "",
      organizations: picked.map(({ org, role }) => ({
        id: org.id,
        name: typeof org.name === "string" ? org.name : "",
        role,
        status: "active" as const,
        primaryHost: hostOf.get(org.id) ?? null,
      })),
    };
  });
}

/**
 * The declined-notice context (10-32; BILL-09, D214, D-UI-P10-19). A site CDS declined is
 * closed (`status = disabled`, `closed_reason = declined`), so listMemberOrganizations and
 * orgContextFromToken refuse it. Its members still need to read one screen: the refund,
 * the deletion date, their signed agreement and invoices. This mints an OrgContext for the
 * first declined org the user belongs to, only for that read-only screen and the agreement
 * download (the web app never hands it to a Server Action). Staff tokens get null, like a
 * plain member lookup (invariant 10). null when the user has no declined membership.
 */
export async function declinedMemberContext(
  token: string,
  ip: string,
): Promise<{
  ctx: OrgContext;
  email: string;
  org: { id: string; name: string };
} | null> {
  const record = await refreshUser(token);
  if (record.staff_role) return null;
  const membership = await withSuperuser(async (pb) => {
    const list = await pb.collection("memberships").getList(1, 1, {
      filter: pb.filter(
        "user = {:user} && organization.closed_reason = 'declined'",
        { user: record.id },
      ),
      expand: "organization",
      sort: "created,id",
    });
    return list.items[0] ?? null;
  });
  if (!membership || !isOrgRole(membership.role)) return null;
  const org = (membership.expand as { organization?: RecordModel } | undefined)
    ?.organization;
  if (!org || org.closed_reason !== "declined") return null;
  const rawGrants: unknown = membership.addon_grants;
  const grants = Array.isArray(rawGrants)
    ? rawGrants.filter((g): g is string => typeof g === "string")
    : [];
  return {
    ctx: mintOrgContext({
      orgId: org.id,
      actor: record.id,
      role: membership.role,
      grants,
      ip,
    }),
    email: typeof record.email === "string" ? record.email : "",
    org: { id: org.id, name: typeof org.name === "string" ? org.name : "" },
  };
}

/**
 * Change a user's staff role (TEN-11: super_admin only). The same update rotates tokenKey,
 * so every token issued before the change is rejected (Pitfall 2). Audited.
 */
export async function setStaffRole(
  ctx: PlatformContext,
  userId: string,
  role: StaffRole | "",
): Promise<void> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "staff_management");
  const id = requireString(userId, "userId");
  if (role !== "" && !isStaffRole(role)) {
    throw new InvalidInput("unknown staff role");
  }
  await withSuperuser(async (pb) => {
    let current: RecordModel;
    try {
      current = await pb
        .collection("users")
        .getOne(id, { fields: "id,staff_role" });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound("not found");
      }
      throw err;
    }
    // Never demote the last super_admin, the caller included (WR-08): nobody could restore
    // tenants or manage staff afterwards without direct database access.
    if (current.staff_role === "super_admin" && role !== "super_admin") {
      const admins = await pb.collection("users").getList(1, 1, {
        filter: "staff_role = 'super_admin'",
        fields: "id",
      });
      if (admins.totalItems <= 1) {
        throw new InvalidInput("the platform must keep one super_admin");
      }
    }
    // Staff and tenant memberships never mix (CR-03, invariant 10): a user who belongs to
    // an organization must leave it before becoming staff.
    if (role !== "") {
      const memberships = await pb.collection("memberships").getList(1, 1, {
        filter: pb.filter("user = {:user}", { user: id }),
        fields: "id",
      });
      if (memberships.totalItems > 0) {
        throw new InvalidInput(
          "remove the user's tenant memberships before granting a staff role",
        );
      }
    }
    try {
      await pb
        .collection("users")
        .update(id, { staff_role: role, tokenKey: randomTokenKey() });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound("not found");
      }
      throw err;
    }
  });
  await appendAudit(ctx, {
    action: "staff_role.change",
    organization: null,
    targetCollection: "users",
    targetId: id,
    meta: { role },
  });
}

/**
 * Sign-out (review 11 WR-A02, WR-E01): forget this browser's push device for the signed-in
 * person, in every org, so the next person on a shared computer never gets their alerts.
 * The person comes from the session token only; the endpoint is untrusted input (shape
 * checked, and only the caller's own rows match it). Not gated: the re-accept gate never
 * traps sign-out. Returns the rows removed; a rejected token or a bad endpoint removes
 * nothing and throws (the caller treats it as best effort).
 */
export async function forgetPushDeviceForSession(
  token: string,
  endpoint: unknown,
): Promise<number> {
  const e = assertPushEndpoint(endpoint);
  const record = await refreshUser(token);
  return withSuperuser((pb) => removeEndpointRows(pb, record.id, e));
}
