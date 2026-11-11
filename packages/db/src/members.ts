// Membership management (TEN-06, TEN-07, TEN-09, TEN-03; D9, D285, D286; RESEARCH Pattern 6).
//
// memberships is a writes:"custom" collection: tenantRepo exposes reads only, and every write
// lives here with its invariants:
//   - every call: assertOrgContext + requirePermission(ctx, "members", "write")
//   - every lookup is scoped `id = {:id} && organization = {:org}`: a foreign id is NotFound
//   - "owner" is never assigned by addMember/changeRole; only transferOwnership makes one
//   - an organization never loses its last owner (LastOwner); touching an owner's row
//     needs an owner context
//   - one owned organization per user is enforced by the DB partial unique index (D286)
//   - CDS staff are never members (invariant 10): addMember and transferOwnership refuse
//     a user with a staff_role; staff reach a tenant only through impersonation
//   - every write goes in one PB batch with its audit_log row (actor, impersonator, IP)
//
// Known limit (RESEARCH A2): the owner count is read before the write, so owner-changing
// operations are serialized per organization with an in-process promise-chain mutex. A
// second app process could still race; accepted at the 10-50 tenant target scale.
import {
  Forbidden,
  InvalidInput,
  LastOwner,
  NotFound,
  ORG_ROLES,
  type OrgRole,
} from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody, type AuditEvent } from "./audit";
import { withSuperuser } from "./client";
import type { OrgContext } from "./context";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "./repository";

const COLLECTION = "memberships";
const GRANT_SLUG = /^[a-z0-9-]{1,40}$/;
const MAX_GRANTS = 100;

export type AddMemberInput = {
  userId: string;
  role: Exclude<OrgRole, "owner">;
  addonGrants?: string[];
};

// ---------------------------------------------------------------------------------------
// Per-organization mutex (A2 known limit, see header).
const chains = new Map<string, Promise<unknown>>();

function withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(orgId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(orgId, tail);
  void tail.then(() => {
    if (chains.get(orgId) === tail) chains.delete(orgId);
  });
  return run;
}

// ---------------------------------------------------------------------------------------
// Validation

function assignableRole(role: unknown): Exclude<OrgRole, "owner"> {
  if (
    typeof role !== "string" ||
    role === "owner" ||
    !(ORG_ROLES as readonly string[]).includes(role)
  ) {
    throw new InvalidInput(
      "role must be admin, editor, viewer, staff or renter (owner only by transfer)",
    );
  }
  return role as Exclude<OrgRole, "owner">;
}

export function grantList(slugs: unknown): string[] {
  if (!Array.isArray(slugs) || slugs.length > MAX_GRANTS) {
    throw new InvalidInput("add-on grants must be a list of add-on slugs");
  }
  for (const s of slugs) {
    if (typeof s !== "string" || !GRANT_SLUG.test(s)) {
      throw new InvalidInput("add-on grants must be a list of add-on slugs");
    }
  }
  return [...new Set(slugs as string[])];
}

function userIdOf(v: unknown): string {
  if (typeof v !== "string" || !/^[a-z0-9]{1,64}$/i.test(v)) {
    throw new InvalidInput("userId is required");
  }
  return v;
}

/**
 * CDS staff reach a tenant only by audited impersonation, never as a member (CR-03,
 * invariant 10). An unknown user is InvalidInput too (same message, no enumeration).
 */
export async function assertNotStaff(
  pb: PocketBase,
  userId: string,
): Promise<void> {
  let u: RecordModel;
  try {
    u = await pb
      .collection("users")
      .getOne(userId, { fields: "id,staff_role" });
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new InvalidInput("the user cannot be a member");
    }
    throw err;
  }
  if (u.staff_role)
    throw new InvalidInput("CDS staff cannot be tenant members");
}

// ---------------------------------------------------------------------------------------
// Scoped reads and batched writes

async function getMembership(
  pb: PocketBase,
  ctx: OrgContext,
  id: string,
): Promise<RecordModel> {
  assertId(id);
  try {
    return await pb.collection(COLLECTION).getFirstListItem(
      pb.filter("id = {:id} && organization = {:org}", {
        id,
        org: ctx.orgId,
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
}

async function ownerCount(pb: PocketBase, orgId: string): Promise<number> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
  });
  return res.totalItems;
}

/** Changing or removing an owner's row: owner context only, never the last owner. */
async function guardOwnerRow(
  pb: PocketBase,
  ctx: OrgContext,
  row: RecordModel,
): Promise<void> {
  if (row.role !== "owner") return;
  if (ctx.role !== "owner") {
    throw new Forbidden("only an owner may change an owner's membership");
  }
  if ((await ownerCount(pb, ctx.orgId)) <= 1) {
    throw new LastOwner("an organization must keep at least one owner");
  }
}

type Op =
  | { op: "create"; id: string; body: Record<string, unknown> }
  | { op: "update"; id: string; body: Record<string, unknown> }
  | { op: "delete"; id: string };

/** An update to another collection sent in the same batch as a membership write (11-38). */
export type ExtraUpdate = {
  collection: string;
  id: string;
  body: Record<string, unknown>;
};

/**
 * A person's own rows in one org (review 11 CR-A01): their Today prefs, their alerts and
 * their push devices. They mean nothing once the membership is gone, so removing a member
 * deletes them with it (and a deleted user cascades them, migration 1790000840).
 */
const PERSONAL_COLLECTIONS = [
  "member_prefs",
  "alerts",
  "push_subscriptions",
] as const;

type PersonalRow = { collection: string; id: string };

/** Personal rows sent in the membership batch; any beyond this go one by one after it. */
const PERSONAL_BATCH_MAX = 900;

async function personalRows(
  pb: PocketBase,
  orgId: string,
  userId: string,
): Promise<PersonalRow[]> {
  const out: PersonalRow[] = [];
  for (const collection of PERSONAL_COLLECTIONS) {
    const rows = await pb.collection(collection).getFullList({
      filter: pb.filter("organization = {:org} && user = {:user}", {
        org: orgId,
        user: userId,
      }),
      fields: "id",
    });
    for (const r of rows) out.push({ collection, id: r.id });
  }
  return out;
}

/** Send the membership writes and their audit row in one batch (all or nothing). */
async function sendBatch(
  pb: PocketBase,
  ctx: OrgContext,
  ops: Op[],
  audit: AuditEvent,
  extra: readonly ExtraUpdate[] = [],
  extraDeletes: readonly PersonalRow[] = [],
): Promise<void> {
  const batch = pb.createBatch();
  const col = batch.collection(COLLECTION);
  for (const w of ops) {
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
  }
  for (const e of extra) batch.collection(e.collection).update(e.id, e.body);
  for (const d of extraDeletes) batch.collection(d.collection).delete(d.id);
  batch.collection("audit_log").create(auditBody(ctx, audit));
  await batch.send();
}

function run<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "members", "write");
  return withOrgLock(ctx.orgId, () => withSuperuser(fn)).catch((err) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

// ---------------------------------------------------------------------------------------
// Public API

/** Add a user to the caller's organization (never as owner). Returns the membership id. */
export async function addMember(
  ctx: OrgContext,
  input: AddMemberInput,
): Promise<string> {
  return addMemberWith(ctx, input);
}

export type AddMemberOptions = {
  /** Runs under the org lock before the batch (e.g. re-check an invite is still pending). */
  precheck?: (pb: PocketBase) => Promise<ExtraUpdate[] | void>;
  /** Audit action override (default `memberships.create`). */
  action?: string;
  /** Extra audit meta merged into the row. */
  meta?: Record<string, unknown>;
};

/**
 * addMember plus, in the same batch, the updates `precheck` returns (11-38: the invite's
 * status flips with the membership create, all or nothing).
 */
export async function addMemberWith(
  ctx: OrgContext,
  input: AddMemberInput,
  opts: AddMemberOptions = {},
): Promise<string> {
  requirePermission(ctx, "members", "write");
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("member input must be an object");
  }
  if (
    "organization" in input &&
    (input as { organization?: unknown }).organization !== ctx.orgId
  ) {
    throw new InvalidInput("organization is taken from the context");
  }
  const user = userIdOf(input.userId);
  const role = assignableRole(input.role);
  const grants = grantList(input.addonGrants ?? []);
  const id = newRecordId();
  await run(ctx, async (pb) => {
    await assertNotStaff(pb, user);
    const extra = (await opts.precheck?.(pb)) ?? [];
    await sendBatch(
      pb,
      ctx,
      [
        {
          op: "create",
          id,
          body: {
            user,
            organization: ctx.orgId,
            role,
            addon_grants: grants,
          },
        },
      ],
      {
        action: opts.action ?? `${COLLECTION}.create`,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { ...(opts.meta ?? {}), user, role, addon_grants: grants },
      },
      extra,
    );
  });
  return id;
}

/** Change a member's role (never to owner; demoting the last owner throws LastOwner). */
export async function changeRole(
  ctx: OrgContext,
  membershipId: string,
  role: OrgRole,
): Promise<void> {
  requirePermission(ctx, "members", "write");
  const next = assignableRole(role);
  await run(ctx, async (pb) => {
    const row = await getMembership(pb, ctx, membershipId);
    await guardOwnerRow(pb, ctx, row);
    await sendBatch(
      pb,
      ctx,
      [{ op: "update", id: row.id, body: { role: next } }],
      {
        action: `${COLLECTION}.update`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { from: row.role, role: next },
      },
    );
  });
}

/** Replace a member's per-add-on grants (TEN-07). Slugs match /^[a-z0-9-]{1,40}$/. */
export async function setAddonGrants(
  ctx: OrgContext,
  membershipId: string,
  slugs: string[],
): Promise<void> {
  requirePermission(ctx, "members", "write");
  const grants = grantList(slugs);
  await run(ctx, async (pb) => {
    const row = await getMembership(pb, ctx, membershipId);
    await sendBatch(
      pb,
      ctx,
      [{ op: "update", id: row.id, body: { addon_grants: grants } }],
      {
        action: `${COLLECTION}.update`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { addon_grants: grants },
      },
    );
  });
}

/** Remove a member (removing the last owner throws LastOwner). */
export async function removeMember(
  ctx: OrgContext,
  membershipId: string,
): Promise<void> {
  requirePermission(ctx, "members", "write");
  await run(ctx, async (pb) => {
    const row = await getMembership(pb, ctx, membershipId);
    await guardOwnerRow(pb, ctx, row);
    const personal = await personalRows(pb, ctx.orgId, String(row.user));
    await sendBatch(
      pb,
      ctx,
      [{ op: "delete", id: row.id }],
      {
        action: `${COLLECTION}.delete`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { user: row.user, role: row.role },
      },
      [],
      personal.slice(0, PERSONAL_BATCH_MAX),
    );
    // Rare overflow (a very long alert history): the membership is already gone, so the
    // rest are tidied best-effort. The user cascade (1790000840) still covers them.
    for (const d of personal.slice(PERSONAL_BATCH_MAX)) {
      await pb
        .collection(d.collection)
        .delete(d.id)
        .catch(() => undefined);
    }
  });
}

/**
 * Hand ownership to another member of the organization (TEN-06). Only the current owner
 * (ctx.role owner with an owner membership of their own) may do it. One batch: demote the
 * old owner to admin first, then promote the new one, then the audit row. If the new owner
 * already owns another organization the partial unique index rejects the promote and PB
 * rolls the whole batch back (D286).
 */
export async function transferOwnership(
  ctx: OrgContext,
  toMembershipId: string,
): Promise<void> {
  requirePermission(ctx, "members", "write");
  if (ctx.role !== "owner") {
    throw new Forbidden("only the owner may transfer ownership");
  }
  await run(ctx, async (pb) => {
    const target = await getMembership(pb, ctx, toMembershipId);
    if (target.user === ctx.actor || target.role === "owner") {
      throw new InvalidInput("the target is already an owner");
    }
    await assertNotStaff(pb, String(target.user));
    let current: RecordModel;
    try {
      current = await pb
        .collection(COLLECTION)
        .getFirstListItem(
          pb.filter(
            "user = {:user} && organization = {:org} && role = 'owner'",
            { user: ctx.actor, org: ctx.orgId },
          ),
        );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new Forbidden("only the owner may transfer ownership");
      }
      throw err;
    }
    await sendBatch(
      pb,
      ctx,
      [
        { op: "update", id: current.id, body: { role: "admin" } },
        { op: "update", id: target.id, body: { role: "owner" } },
      ],
      {
        action: "ownership.transfer",
        targetCollection: COLLECTION,
        targetId: target.id,
        meta: { from: current.id, to: target.id, to_user: target.user },
      },
    );
  });
}
