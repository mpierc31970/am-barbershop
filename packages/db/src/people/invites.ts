// Member invites (11-38; DASH-22, D285, D-UI-P11-28, RESEARCH Open Q4; T-11-38-01..05).
//
//   - An invite is an emailed single-use link to `/invite/<token>`, valid 7 days. The token is
//     32 random bytes (base64url); only its sha256 hex is stored (`token_hash`, server-only).
//     The raw token exists only in the email and is never logged or audited.
//   - Writes (invite, resend, revoke) are the Owner's, never under impersonation (Pitfall 4).
//     Reads (listInvites) need members:read (Owner, Admin).
//   - Staff accounts are never invited or joined (invariant 10): assertNotStaff on both ends.
//   - Flooding: at most 20 pending invites per org and 10 sends (invite + resend) per hour per
//     org, in-process (one app instance at the 10-50 tenant target scale, like rate-limit.ts).
//   - readInvite(token) is public: it returns the org name, inviter name, role, email and
//     state only (plus whether the invited email already has an account, so the page can pick
//     "create account" or "sign in"; that tells the token holder only about their own email).
//   - acceptInvite binds to the invited email (case-insensitive) and, under the org lock,
//     re-checks the invite and adds the membership + flips the invite to accepted in one batch
//     (members.ts addMemberWith). A second accept finds it accepted: InvalidInput.
import { createHash, randomBytes } from "node:crypto";
import { CdsError, Forbidden, InvalidInput, RateLimited } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintOrgContext, type OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { addMemberWith, assertNotStaff, grantList } from "../members";
import { SlidingWindowLimiter } from "../rate-limit";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "../repository";
import {
  assertOwnerNotImpersonating,
  hubRole,
  type HubAssignableRole,
} from "./people";

const COLLECTION = "member_invites";
const DAY_MS = 86_400_000;
export const INVITE_TTL_DAYS = 7;
export const MAX_PENDING_INVITES = 20;
export const INVITE_SENDS_PER_HOUR = 10;
export const INVITE_PASSWORD_MIN = 10;
const PASSWORD_MAX = 72;
const NAME_MAX = 80;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 32 bytes base64url = 43 chars. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const sendLimiter = new SlidingWindowLimiter(INVITE_SENDS_PER_HOUR, 3_600_000);

/** The address already has access, or already has a pending invite (INVITE-EXISTS). */
export class InviteExists extends CdsError {
  override readonly code = "invite_exists";
}

/**
 * Why accepting an invite was refused when the invite itself is still good (review 11
 * WR-E03), so the invite page never says "expired" for these. Still an InvalidInput, so
 * callers that only know InvalidInput keep working.
 *   - account_exists: the create path, but the address already has an account (sign in)
 *   - already_member: the person already belongs to this site (`orgId` set: just go there)
 *   - staff:          CDS staff accounts never join a site (invariant 10)
 *   - name_* / password_*: the field is outside its limits
 */
export type InviteRefusalReason =
  | "account_exists"
  | "already_member"
  | "staff"
  | "name_missing"
  | "name_too_long"
  | "password_too_short"
  | "password_too_long";

export class InviteRefused extends InvalidInput {
  readonly reason: InviteRefusalReason;
  readonly orgId: string | undefined;
  constructor(reason: InviteRefusalReason, message: string, orgId?: string) {
    super(message);
    this.reason = reason;
    this.orgId = orgId;
  }
}

export type InviteDeps = { transport?: EmailTransport; now?: () => number };

export type InviteInput = {
  email: string;
  role: HubAssignableRole;
  grants: string[];
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  staff: "Staff",
  renter: "Renter",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

function normEmail(raw: unknown): string {
  const e = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!e || e.length > EMAIL_MAX || !EMAIL_RE.test(e)) {
    throw new InvalidInput("enter an email address like name@example.com");
  }
  return e;
}

function isExpired(row: RecordModel, now: number): boolean {
  const t = new Date(str(row.expires_at)).getTime();
  return !Number.isFinite(t) || t <= now;
}

function expiresOn(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "America/Chicago",
  }).format(at);
}

function rethrow(err: unknown): never {
  if (err instanceof ClientResponseError) mapError(err);
  throw err;
}

async function findUserByEmail(
  pb: PocketBase,
  email: string,
): Promise<RecordModel | null> {
  try {
    return await pb
      .collection("users")
      .getFirstListItem(pb.filter("email = {:email}", { email }), {
        fields: "id,email,name,staff_role",
      });
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

async function inviterAndOrg(
  pb: PocketBase,
  orgId: string,
  inviterId: string,
): Promise<{ business: string; inviterName: string }> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  let inviterName = "";
  if (inviterId) {
    const u = await pb
      .collection("users")
      .getOne(inviterId, { fields: "id,name" })
      .catch(() => null);
    inviterName = str(u?.name).trim();
  }
  return {
    business: str(org.name),
    inviterName: inviterName || "The site owner",
  };
}

async function sendInviteEmail(
  ctx: OrgContext,
  pb: PocketBase,
  to: string,
  role: string,
  token: string,
  expires: Date,
  deps: InviteDeps,
): Promise<void> {
  const { business, inviterName } = await inviterAndOrg(
    pb,
    ctx.orgId,
    ctx.actor,
  );
  await sendEmail(
    { kind: "org", ctx, orgId: ctx.orgId },
    "member.invite",
    to,
    {
      business,
      inviterName,
      role: ROLE_LABEL[role] ?? role,
      href: platformUrl("/invite/" + token),
      expiresOn: expiresOn(expires),
    },
    { transport: deps.transport },
  );
}

function takeSend(orgId: string): void {
  if (sendLimiter.take(orgId) === null) {
    throw new RateLimited("too many invites sent this hour; try again later");
  }
}

// ---------------------------------------------------------------------------------------
// Owner writes

/** Invite someone by email (Owner only). Returns the invite id; the token goes only by email. */
export async function inviteMember(
  ctx: OrgContext,
  input: InviteInput,
  deps: InviteDeps = {},
): Promise<{ inviteId: string }> {
  assertOwnerNotImpersonating(ctx);
  requirePermission(ctx, "members", "write");
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("invite input must be an object");
  }
  return createInvite(ctx, { ...input, role: hubRole(input.role) }, deps);
}

/**
 * The invite write behind inviteMember and the Studio Booking seat invite (inviteSeat), which
 * invites a barber as `renter` or `staff` with the studio grant. Owner only, like inviteMember.
 */
export async function createInvite(
  ctx: OrgContext,
  input: {
    email: string;
    role: HubAssignableRole | "staff" | "renter";
    grants: string[];
  },
  deps: InviteDeps = {},
): Promise<{ inviteId: string }> {
  assertOwnerNotImpersonating(ctx);
  requirePermission(ctx, "members", "write");
  const email = normEmail(input.email);
  const role = hubRoleOrStored(String(input.role));
  const grants = grantList(input.grants ?? []);
  const now = (deps.now ?? Date.now)();
  const id = newRecordId();

  return withSuperuser(async (pb) => {
    const existing = await findUserByEmail(pb, email);
    if (existing) {
      await assertNotStaff(pb, existing.id);
      const member = await pb.collection("memberships").getList(1, 1, {
        filter: pb.filter("user = {:u} && organization = {:org}", {
          u: existing.id,
          org: ctx.orgId,
        }),
      });
      if (member.totalItems > 0) {
        throw new InviteExists(`${email} already has access to this site`);
      }
    }
    const pending = await pb.collection(COLLECTION).getFullList({
      filter: pb.filter("organization = {:org} && status = 'pending'", {
        org: ctx.orgId,
      }),
      fields: "id,email,expires_at",
    });
    const live = pending.filter((r) => !isExpired(r, now));
    const stale = pending.filter((r) => isExpired(r, now));
    if (live.some((r) => str(r.email).toLowerCase() === email)) {
      throw new InviteExists(`${email} already has an invite`);
    }
    if (live.length >= MAX_PENDING_INVITES) {
      throw new RateLimited("too many pending invites; cancel one first");
    }
    takeSend(ctx.orgId);

    const { token, hash } = newToken();
    const expires = new Date(now + INVITE_TTL_DAYS * DAY_MS);
    const batch = pb.createBatch();
    for (const r of stale) {
      batch.collection(COLLECTION).update(r.id, { status: "expired" });
    }
    batch.collection(COLLECTION).create({
      id,
      organization: ctx.orgId,
      email,
      role,
      grants,
      token_hash: hash,
      expires_at: expires.toISOString(),
      invited_by: ctx.actor,
      status: "pending",
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "member.invited",
        targetCollection: COLLECTION,
        targetId: id,
        meta: { email, role, grants },
      }),
    );
    await batch.send();
    await sendInviteEmail(ctx, pb, email, role, token, expires, deps);
    return { inviteId: id };
  }).catch(rethrow);
}

async function getInvite(
  pb: PocketBase,
  ctx: OrgContext,
  inviteId: string,
): Promise<RecordModel> {
  assertId(inviteId);
  return pb.collection(COLLECTION).getFirstListItem(
    pb.filter("id = {:id} && organization = {:org}", {
      id: inviteId,
      org: ctx.orgId,
    }),
  );
}

/** Send a fresh link (new token, new 7 days); the old link stops working. Owner only. */
export async function resendInvite(
  ctx: OrgContext,
  inviteId: string,
  deps: InviteDeps = {},
): Promise<void> {
  assertOwnerNotImpersonating(ctx);
  requirePermission(ctx, "members", "write");
  const now = (deps.now ?? Date.now)();
  await withSuperuser(async (pb) => {
    const row = await getInvite(pb, ctx, inviteId);
    if (row.status !== "pending" && row.status !== "expired") {
      throw new InvalidInput("this invite was already used or cancelled");
    }
    takeSend(ctx.orgId);
    const { token, hash } = newToken();
    const expires = new Date(now + INVITE_TTL_DAYS * DAY_MS);
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(row.id, {
      token_hash: hash,
      expires_at: expires.toISOString(),
      status: "pending",
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "member.invite_resent",
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { email: row.email },
      }),
    );
    await batch.send();
    await sendInviteEmail(
      ctx,
      pb,
      str(row.email),
      str(row.role),
      token,
      expires,
      deps,
    );
  }).catch(rethrow);
}

/** Cancel a pending invite (Owner only); its link stops working. */
export async function revokeInvite(
  ctx: OrgContext,
  inviteId: string,
): Promise<void> {
  assertOwnerNotImpersonating(ctx);
  requirePermission(ctx, "members", "write");
  await withSuperuser(async (pb) => {
    const row = await getInvite(pb, ctx, inviteId);
    if (row.status !== "pending" && row.status !== "expired") {
      throw new InvalidInput("this invite was already used or cancelled");
    }
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(row.id, { status: "revoked" });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "member.invite_revoked",
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { email: row.email },
      }),
    );
    await batch.send();
  }).catch(rethrow);
}

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  grants: string[];
  expiresAt: string;
  expired: boolean;
  created: string;
};

/** Pending invites (expired ones flagged), newest first. Owner and Admin. */
export async function listInvites(
  ctx: OrgContext,
  deps: { now?: () => number } = {},
): Promise<InviteRow[]> {
  requirePermission(ctx, "members", "read");
  const now = (deps.now ?? Date.now)();
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter("organization = {:org} && status = 'pending'", {
        org: ctx.orgId,
      }),
      fields: "id,email,role,grants,expires_at,created",
      sort: "-created,id",
    }),
  ).catch(rethrow);
  return rows.map((r) => ({
    id: r.id,
    email: str(r.email),
    role: str(r.role),
    grants: Array.isArray(r.grants)
      ? (r.grants as unknown[]).filter(
          (g): g is string => typeof g === "string",
        )
      : [],
    expiresAt: str(r.expires_at),
    expired: isExpired(r, now),
    created: str(r.created),
  }));
}

// ---------------------------------------------------------------------------------------
// Public: the invite page

export type InviteInfo = {
  orgName: string;
  inviterName: string;
  role: string;
  email: string;
  expired: boolean;
  status: "pending" | "accepted" | "revoked" | "expired";
  hasAccount: boolean;
};

async function findByToken(
  pb: PocketBase,
  token: unknown,
): Promise<RecordModel | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  try {
    return await pb
      .collection(COLLECTION)
      .getFirstListItem(
        pb.filter("token_hash = {:h}", { h: hashInviteToken(token) }),
        { expand: "organization" },
      );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

function orgOf(row: RecordModel): RecordModel | null {
  return (
    (row.expand as { organization?: RecordModel } | undefined)?.organization ??
    null
  );
}

/** What the invite page may show; null for an unknown token or a closed site. */
export async function readInvite(
  token: string,
  deps: { now?: () => number } = {},
): Promise<InviteInfo | null> {
  const now = (deps.now ?? Date.now)();
  return withSuperuser(async (pb) => {
    const row = await findByToken(pb, token);
    if (!row) return null;
    const org = orgOf(row);
    if (!org || org.status !== "active") return null;
    const { inviterName } = await inviterAndOrg(
      pb,
      org.id,
      str(row.invited_by),
    );
    const email = str(row.email);
    const status = str(row.status) as InviteInfo["status"];
    return {
      orgName: str(org.name),
      inviterName,
      role: str(row.role),
      email,
      expired:
        status === "expired" || (status === "pending" && isExpired(row, now)),
      status,
      hasAccount: (await findUserByEmail(pb, email)) !== null,
    };
  });
}

export type AcceptResult = { orgId: string; orgName: string; email: string };

/**
 * Join the invited org as the signed-in person (`user` comes from the session token, never a
 * form). Pending, unexpired, invited email = the user's email; staff refused (invariant 10).
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
  ip = "system:invite",
  deps: { now?: () => number } = {},
): Promise<AcceptResult> {
  const now = (deps.now ?? Date.now)();
  const found = await withSuperuser(async (pb) => {
    const row = await findByToken(pb, token);
    if (!row) throw new InvalidInput("this invite link doesn't work");
    const org = orgOf(row);
    if (!org || org.status !== "active") {
      throw new InvalidInput("this invite link doesn't work");
    }
    if (row.status !== "pending" || isExpired(row, now)) {
      throw new InvalidInput("this invite has expired or was cancelled");
    }
    assertId(user?.id);
    const rec = await pb
      .collection("users")
      .getOne(user.id, { fields: "id,email,staff_role" })
      .catch(() => null);
    const invited = str(row.email).toLowerCase();
    if (
      !rec ||
      str(rec.email).toLowerCase() !== invited ||
      str(user.email).trim().toLowerCase() !== invited
    ) {
      throw new Forbidden("this invite is for a different email address");
    }
    if (rec.staff_role) {
      throw new InviteRefused("staff", "CDS staff cannot be tenant members");
    }
    const member = await pb.collection("memberships").getList(1, 1, {
      filter: pb.filter("organization = {:o} && user = {:u}", {
        o: org.id,
        u: user.id,
      }),
      fields: "id",
    });
    if (member.items.length > 0) {
      throw new InviteRefused(
        "already_member",
        "you already belong to this site",
        org.id,
      );
    }
    return { row, org };
  }).catch(rethrow);

  const { row, org } = found;
  // A system context minted for this org only (RESEARCH Open Q4): the audit row is CDS's
  // ("job: invite") and names the joining user in meta.
  const ctx = mintOrgContext({
    orgId: org.id,
    actor: user.id,
    role: "admin",
    grants: [],
    ip,
    systemJob: "invite",
  });
  const grants = Array.isArray(row.grants)
    ? (row.grants as unknown[]).filter(
        (g): g is string => typeof g === "string",
      )
    : [];
  await addMemberWith(
    ctx,
    {
      userId: user.id,
      role: hubRoleOrStored(str(row.role)),
      addonGrants: grants,
    },
    {
      action: "member.joined",
      meta: { invite: row.id, invited_by: str(row.invited_by) },
      // Under the org lock: the invite must still be pending (single use, T-11-38-01).
      precheck: async (pb) => {
        const fresh = await pb.collection(COLLECTION).getOne(row.id, {
          fields: "id,status,expires_at,token_hash",
        });
        if (
          fresh.status !== "pending" ||
          isExpired(fresh, now) ||
          fresh.token_hash !== row.token_hash
        ) {
          throw new InvalidInput("this invite has expired or was cancelled");
        }
        return [
          {
            collection: COLLECTION,
            id: row.id,
            body: { status: "accepted", accepted_by: user.id },
          },
        ];
      },
    },
  );
  return { orgId: org.id, orgName: str(org.name), email: str(row.email) };
}

/** Stored roles mirror memberships minus owner; staff/renter pass through if ever stored. */
function hubRoleOrStored(role: string): HubAssignableRole | "staff" | "renter" {
  if (role === "staff" || role === "renter") return role;
  return hubRole(role);
}

/**
 * A new person opens the invite: create their account (password >= 10, name), then join.
 * The emailed link proves the address, so the account starts verified (the same proof the
 * Submit OTP gives). If joining fails the new account is deleted again.
 */
export async function acceptInviteAsNewAccount(
  token: string,
  input: { name: string; password: string },
  ip: string,
  deps: { now?: () => number } = {},
): Promise<AcceptResult> {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!name) throw new InviteRefused("name_missing", "enter your name");
  if (name.length > NAME_MAX) {
    throw new InviteRefused(
      "name_too_long",
      `your name can be at most ${NAME_MAX} characters`,
    );
  }
  if (password.length < INVITE_PASSWORD_MIN) {
    throw new InviteRefused(
      "password_too_short",
      `password must be at least ${INVITE_PASSWORD_MIN} characters`,
    );
  }
  if (password.length > PASSWORD_MAX) {
    throw new InviteRefused(
      "password_too_long",
      `password can be at most ${PASSWORD_MAX} characters`,
    );
  }
  const now = (deps.now ?? Date.now)();
  const { userId, email } = await withSuperuser(async (pb) => {
    const row = await findByToken(pb, token);
    if (!row || row.status !== "pending" || isExpired(row, now)) {
      throw new InvalidInput("this invite has expired or was cancelled");
    }
    const email = str(row.email);
    const exists = () =>
      new InviteRefused(
        "account_exists",
        "an account with this email already exists",
      );
    if (await findUserByEmail(pb, email)) throw exists();
    let rec: RecordModel;
    try {
      rec = await pb.collection("users").create({
        email,
        name,
        password,
        passwordConfirm: password,
        verified: true,
      });
    } catch (err) {
      // Created between the check and the create (another tab, a sign-up): same answer.
      const data = (
        err instanceof ClientResponseError ? err.response?.data : null
      ) as Record<string, unknown> | null;
      if (
        err instanceof ClientResponseError &&
        err.status === 400 &&
        data?.email
      ) {
        throw exists();
      }
      throw err;
    }
    return { userId: rec.id, email };
  }).catch(rethrow);

  try {
    const res = await acceptInvite(token, { id: userId, email }, ip, deps);
    return res;
  } catch (err) {
    await withSuperuser((pb) => pb.collection("users").delete(userId)).catch(
      () => undefined,
    );
    throw err;
  }
}
