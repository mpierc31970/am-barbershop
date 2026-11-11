// People & roles (11-38; D285, D-UI-P11-21; RESEARCH Pitfall 4, T-11-38-02).
//
// Owner-checked wrappers over members.ts. The permission matrix lets Admins write members
// (staff paths rely on that), so every write here asserts the caller is the Owner AND is not
// a CDS staff member impersonating them. Reads need members:read (Owner, Admin).
// The Owner cannot change or remove their own row here (transfer stays a staff path,
// D-UI-P11-21), and an owner row is never touched by these wrappers.
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
  type OrgRole,
} from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { changeRole, removeMember, setAddonGrants } from "../members";
import { assertId, mapError, requirePermission } from "../repository";

/** Roles an Owner may give in the hub (D-UI-P11-22: no v1.0 add-on uses staff or renter). */
export const HUB_ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const;
export type HubAssignableRole = (typeof HUB_ASSIGNABLE_ROLES)[number];

export function hubRole(role: unknown): HubAssignableRole {
  if (
    typeof role !== "string" ||
    !(HUB_ASSIGNABLE_ROLES as readonly string[]).includes(role)
  ) {
    throw new InvalidInput("role must be admin, editor or viewer");
  }
  return role as HubAssignableRole;
}

/**
 * People writes: the Owner only, never under impersonation (Pitfall 4 option A). Throws
 * ImpersonationDenied first so staff see why the buttons are off.
 */
export function assertOwnerNotImpersonating(ctx: OrgContext): void {
  assertOrgContext(ctx);
  if (ctx.impersonator) {
    throw new ImpersonationDenied("people changes are off while impersonating");
  }
  if (ctx.role !== "owner" || ctx.systemJob) {
    throw new Forbidden("only the site owner can manage people");
  }
}

export type PersonRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  addonGrants: string[];
  isYou: boolean;
};

const ROLE_ORDER: readonly OrgRole[] = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "staff",
  "renter",
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Everyone with access to the org: Owner first, then by role, then name. */
export async function listPeople(ctx: OrgContext): Promise<PersonRow[]> {
  requirePermission(ctx, "members", "read");
  const rows = await withSuperuser((pb) =>
    pb.collection("memberships").getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      expand: "user",
      sort: "created,id",
    }),
  ).catch((err) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
  const out: PersonRow[] = [];
  for (const r of rows) {
    const u = (r.expand as { user?: RecordModel } | undefined)?.user;
    const role = str(r.role) as OrgRole;
    if (!u || !ROLE_ORDER.includes(role)) continue;
    out.push({
      membershipId: r.id,
      userId: u.id,
      name: str(u.name).trim(),
      email: str(u.email),
      role,
      addonGrants: Array.isArray(r.addon_grants)
        ? (r.addon_grants as unknown[]).filter(
            (g): g is string => typeof g === "string",
          )
        : [],
      isYou: u.id === ctx.actor,
    });
  }
  return out.sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      (a.name || a.email).localeCompare(b.name || b.email),
  );
}

/** The membership row, scoped to the org; refuses the caller's own row and any owner row. */
async function otherMember(
  ctx: OrgContext,
  membershipId: string,
): Promise<RecordModel> {
  assertId(membershipId);
  const row = await withSuperuser(async (pb) => {
    try {
      return await pb.collection("memberships").getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id: membershipId,
          org: ctx.orgId,
        }),
      );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound();
      }
      throw err;
    }
  });
  if (row.user === ctx.actor || row.role === "owner") {
    throw new InvalidInput(
      "the owner's own access is changed by CDS support, not here",
    );
  }
  return row;
}

export async function changeMemberRole(
  ctx: OrgContext,
  membershipId: string,
  role: HubAssignableRole,
): Promise<void> {
  assertOwnerNotImpersonating(ctx);
  const next = hubRole(role);
  await otherMember(ctx, membershipId);
  await changeRole(ctx, membershipId, next);
}

export async function setMemberGrants(
  ctx: OrgContext,
  membershipId: string,
  grants: string[],
): Promise<void> {
  assertOwnerNotImpersonating(ctx);
  await otherMember(ctx, membershipId);
  await setAddonGrants(ctx, membershipId, grants);
}

export async function removePerson(
  ctx: OrgContext,
  membershipId: string,
): Promise<void> {
  assertOwnerNotImpersonating(ctx);
  await otherMember(ctx, membershipId);
  await removeMember(ctx, membershipId);
}
