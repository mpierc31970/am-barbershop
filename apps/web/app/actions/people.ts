"use server";
// Settings › People & roles actions (11-39 choice 3; DASH-22, DASH-27; D285; T-11-39-01,
// T-11-39-02). Public POST endpoints: every argument is untrusted. The org comes only from the
// session (runAction). Input is narrowed first (email shape, role enum admin|editor|viewer,
// record-id shape, grants a short list of the org's ACTIVE add-on slugs); the Owner check
// runs here (impersonating staff and Admins are refused before any write) and again in
// @cds/db (assertOwnerNotImpersonating). Every success answers with the fresh lists and
// revalidates the hub layout, because badges, Today and alerts filter on roles.
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import {
  InviteExists,
  changeMemberRole,
  inviteMember,
  removePerson,
  resendInvite,
  revokeInvite,
  setMemberGrants,
  type OrgContext,
} from "@cds/db";
import {
  PEOPLE_COPY,
  inviteExistsCopy,
  isInvitableRole,
  looksLikeEmail,
  takesGrants,
  type PeopleLists,
} from "@cds/ui/hub/people";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { addonAccessOptions, loadPeopleLists } from "../../lib/people-view";

const RECORD_ID = /^[a-z0-9]{15}$/;
const MAX_GRANTS = 20;
const EMAIL_MAX = 254;

const COPY = {
  forbidden: PEOPLE_COPY.adminNote,
  impersonation: PEOPLE_COPY.impersonating,
};

const BAD_ID: ActionResult<never> = {
  ok: false,
  code: "invalid_input",
  message: "That person or invite wasn't found. Reload the page and try again.",
};

const BAD_ROLE: ActionResult<never> = {
  ok: false,
  code: "invalid_input",
  message: "Choose Admin, Editor or Viewer.",
  field: "role",
};

const BAD_GRANTS: ActionResult<never> = {
  ok: false,
  code: "invalid_input",
  message:
    "One of those add-ons isn't on your site any more. Reload the page and try again.",
};

/** Owner, signed in as themselves (checked before any @cds/db call). */
function assertOwner(ctx: OrgContext): void {
  if (ctx.impersonator) throw new ImpersonationDenied();
  if (ctx.role !== "owner") throw new Forbidden();
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[hub] people: revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

function idOk(v: unknown): v is string {
  return typeof v === "string" && RECORD_ID.test(v);
}

/** Shape only: a short list of slug-like strings, de-duplicated. */
function grantShape(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_GRANTS) return null;
  if (!v.every((g) => typeof g === "string" && /^[a-z0-9-]{1,40}$/.test(g))) {
    return null;
  }
  return [...new Set(v as string[])];
}

/** Every grant must be one of the org's active add-ons (T-11-39-02). */
async function grantsActive(
  ctx: OrgContext,
  grants: readonly string[],
): Promise<boolean> {
  if (grants.length === 0) return true;
  const active = new Set((await addonAccessOptions(ctx)).map((a) => a.slug));
  return grants.every((g) => active.has(g));
}

type Outcome =
  | { kind: "ok"; lists: PeopleLists }
  | { kind: "refused"; result: ActionResult<never> };

function unwrap(res: ActionResult<Outcome>): ActionResult<PeopleLists> {
  if (!res.ok) return res;
  return res.data.kind === "ok"
    ? { ok: true, data: res.data.lists }
    : res.data.result;
}

async function done(ctx: OrgContext): Promise<Outcome> {
  refreshHub();
  return { kind: "ok", lists: await loadPeopleLists(ctx) };
}

export async function inviteMemberAction(
  input: unknown,
): Promise<ActionResult<PeopleLists>> {
  const r =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const email =
    typeof r.email === "string" ? r.email.trim().slice(0, EMAIL_MAX + 1) : "";
  if (!looksLikeEmail(email)) {
    return {
      ok: false,
      code: "invalid_input",
      message: PEOPLE_COPY.inviteInvalid,
      field: "email",
    };
  }
  if (!isInvitableRole(r.role)) return BAD_ROLE;
  const role = r.role;
  const shaped = grantShape(r.grants ?? []);
  if (!shaped) return BAD_GRANTS;
  const grants = takesGrants(role) ? shaped : [];
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      if (!(await grantsActive(ctx, grants))) {
        return { kind: "refused", result: BAD_GRANTS };
      }
      try {
        await inviteMember(ctx, { email, role, grants });
      } catch (err) {
        if (err instanceof InviteExists) {
          return {
            kind: "refused",
            result: {
              ok: false,
              code: "invite_exists",
              message: inviteExistsCopy(email),
              field: "email",
            },
          };
        }
        if (err instanceof InvalidInput) {
          // Role and grants were checked above, so this is the address (bad shape or a CDS
          // staff address, which is never named): INVITE-INVALID.
          return {
            kind: "refused",
            result: {
              ok: false,
              code: "invalid_input",
              message: PEOPLE_COPY.inviteInvalid,
              field: "email",
            },
          };
        }
        throw err;
      }
      return done(ctx);
    }, COPY),
  );
}

export async function resendInviteAction(
  inviteId: unknown,
): Promise<ActionResult<PeopleLists>> {
  if (!idOk(inviteId)) return BAD_ID;
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      await resendInvite(ctx, inviteId);
      return done(ctx);
    }, COPY),
  );
}

export async function revokeInviteAction(
  inviteId: unknown,
): Promise<ActionResult<PeopleLists>> {
  if (!idOk(inviteId)) return BAD_ID;
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      await revokeInvite(ctx, inviteId);
      return done(ctx);
    }, COPY),
  );
}

export async function changeRoleAction(
  membershipId: unknown,
  role: unknown,
): Promise<ActionResult<PeopleLists>> {
  if (!idOk(membershipId)) return BAD_ID;
  if (!isInvitableRole(role)) return BAD_ROLE;
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      await changeMemberRole(ctx, membershipId, role);
      return done(ctx);
    }, COPY),
  );
}

export async function setGrantsAction(
  membershipId: unknown,
  grants: unknown,
): Promise<ActionResult<PeopleLists>> {
  if (!idOk(membershipId)) return BAD_ID;
  const shaped = grantShape(grants);
  if (!shaped) return BAD_GRANTS;
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      if (!(await grantsActive(ctx, shaped))) {
        return { kind: "refused", result: BAD_GRANTS };
      }
      await setMemberGrants(ctx, membershipId, shaped);
      return done(ctx);
    }, COPY),
  );
}

export async function removePersonAction(
  membershipId: unknown,
): Promise<ActionResult<PeopleLists>> {
  if (!idOk(membershipId)) return BAD_ID;
  return unwrap(
    await runAction(async ({ ctx }): Promise<Outcome> => {
      assertOwner(ctx);
      await removePerson(ctx, membershipId);
      return done(ctx);
    }, COPY),
  );
}
