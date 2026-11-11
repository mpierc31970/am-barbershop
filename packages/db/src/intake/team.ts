// Team members chokepoint (ONB-13, D37, D257; CONTEXT A3-Q1; invariant 1, TEN-03, PD-21;
// T-06-52, T-06-53, T-06-54, T-06-56).
//
// The team is core data, not add-on data: the Our Team block and Studio Booking staff read
// these rows. Add appends at the end of the list, shown on the site by default; edit keeps the
// position and merges only the given keys over the stored row (so a Show-on-site toggle sends
// just is_published). A photo must be the org's own, un-removed media_assets row of kind team.
// A foreign id and an absent id are the same NotFound (no oracle). Nothing takes an org id.
// 13-52 (STAFF-25, D270): every save that can show text on the site runs the publish scan
// (list-screen.ts): held saves the member hidden and opens a flag for staff review.
import { InvalidInput } from "@cds/core";
import { validateTeamMember, type TeamMemberInput } from "@cds/core/intake";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { promoteMedia } from "../media/library/promote";
import { assertId, newRecordId } from "../repository";
import {
  afterListSave,
  isToggleOff,
  screenListRow,
  type ListScanDeps,
} from "./list-screen";
import {
  asInput,
  commit,
  nextSortOrder,
  orgList,
  rejectForeignOrg,
  reorderList,
  runRead,
  runWrite,
  scopedGet,
} from "./shared";

const COLLECTION = "team_members";

export type TeamMember = TeamMemberInput & {
  id: string;
  sortOrder: number;
  photoId: string | null;
};

export const PHOTO_COPY =
  "That photo isn't in your team photos. Upload it again and pick it.";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function toTeamMember(r: RecordModel): TeamMember {
  return {
    id: r.id,
    name: str(r.name),
    role: str(r.role),
    bio: str(r.bio),
    is_published: r.is_published === true,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
    photoId: str(r.photo) || null,
  };
}

/** null clears the photo; an id must be the org's own live team photo. */
async function checkPhoto(
  pb: PocketBase,
  ctx: OrgContext,
  raw: unknown,
): Promise<string> {
  if (raw === null || raw === "") return "";
  try {
    assertId(raw);
  } catch {
    throw new InvalidInput(PHOTO_COPY);
  }
  try {
    await pb
      .collection("media_assets")
      .getFirstListItem(
        pb.filter(
          "id = {:id} && organization = {:org} && kind = 'team' && removed_at = ''",
          { id: raw, org: ctx.orgId },
        ),
        { fields: "id" },
      );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new InvalidInput(PHOTO_COPY);
    }
    throw err;
  }
  return raw as string;
}

/** The org's team, in display order (business read). */
export async function listTeam(ctx: OrgContext): Promise<TeamMember[]> {
  return runRead(ctx, async (pb) => {
    const [rows, photos] = await Promise.all([
      orgList(pb, ctx, COLLECTION),
      pb.collection("media_assets").getFullList({
        filter: pb.filter(
          "organization = {:org} && kind = 'team' && removed_at = ''",
          { org: ctx.orgId },
        ),
        fields: "id",
      }),
    ]);
    // A-WR-06: a removed photo reads as no photo (restoring it relinks the member).
    const live = new Set(photos.map((p) => p.id));
    return rows
      .map(toTeamMember)
      .map((t) =>
        t.photoId !== null && !live.has(t.photoId)
          ? { ...t, photoId: null }
          : t,
      );
  });
}

export type SaveTeamMemberDeps = ListScanDeps & {
  promote?: typeof promoteMedia;
};

/** A saved member. `held` = the scan held it, so it was saved hidden (13-52). */
export type SavedTeamMember = TeamMember & { held: boolean };

/**
 * Add (no id) or edit (id) a team member (business write). WR-C01: a shown member's photo
 * is promoted to public delivery after the write (outside the org lock, best effort, like
 * the share image), so the Our team block serves it from the public CDN path, not on a
 * short-lived token. A failed promotion never fails the save; the photo stays tokenized.
 */
export async function saveTeamMember(
  ctx: OrgContext,
  input: unknown,
  id?: string,
  deps: SaveTeamMemberDeps = {},
): Promise<SavedTeamMember> {
  const raw = asInput(input, "The team member");
  rejectForeignOrg(ctx, raw);
  if (id === undefined) validateTeamMember(raw); // fail fast before the lock
  const { saved, outcome, held } = await writeTeamMember(ctx, deps, raw, id);
  await afterListSave(ctx, deps, outcome, {
    collection: COLLECTION,
    id: saved.id,
  });
  if (saved.is_published && saved.photoId !== null) {
    await (deps.promote ?? promoteMedia)(ctx, [saved.photoId]).catch(() => {
      console.error("[media] team photo promote failed", saved.id);
    });
  }
  return { ...saved, held };
}

async function writeTeamMember(
  ctx: OrgContext,
  deps: ListScanDeps,
  raw: Record<string, unknown>,
  id: string | undefined,
) {
  return runWrite(ctx, async (pb) => {
    const current =
      id === undefined ? null : await scopedGet(pb, ctx, COLLECTION, id);
    const merged: Record<string, unknown> = current
      ? {
          name: current.name,
          role: current.role,
          bio: current.bio,
          is_published: current.is_published === true,
          ...raw,
        }
      : raw;
    const v = validateTeamMember(merged);
    // 13-52: screen the merged public text (name, role, bio) before it is written.
    const { body, outcome, held } = await screenListRow(
      ctx,
      deps,
      COLLECTION,
      { ...v },
      { toggleOff: isToggleOff(raw) },
    );
    if (Object.hasOwn(raw, "photoId")) {
      body.photo = await checkPhoto(pb, ctx, raw.photoId);
    }
    if (current) {
      await commit(
        pb,
        ctx,
        [{ collection: COLLECTION, op: "update", id: current.id, body }],
        {
          action: `${COLLECTION}.update`,
          targetCollection: COLLECTION,
          targetId: current.id,
        },
      );
      const saved = toTeamMember(
        await pb.collection(COLLECTION).getOne(current.id),
      );
      return { saved, outcome, held };
    }
    const newId = newRecordId();
    const sort_order = nextSortOrder(await orgList(pb, ctx, COLLECTION));
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "create",
          id: newId,
          body: { ...body, organization: ctx.orgId, sort_order },
        },
      ],
      {
        action: `${COLLECTION}.create`,
        targetCollection: COLLECTION,
        targetId: newId,
      },
    );
    const saved = toTeamMember(await pb.collection(COLLECTION).getOne(newId));
    return { saved, outcome, held };
  });
}

/** Remove a team member (business write). The photo stays in the media library. */
export async function removeTeamMember(
  ctx: OrgContext,
  id: string,
): Promise<void> {
  await runWrite(ctx, async (pb) => {
    const current = await scopedGet(pb, ctx, COLLECTION, id);
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "delete", id: current.id }],
      {
        action: `${COLLECTION}.delete`,
        targetCollection: COLLECTION,
        targetId: current.id,
      },
    );
  });
}

/** Rewrite the order; `ids` must be every team member exactly once (business write). */
export async function reorderTeam(
  ctx: OrgContext,
  ids: readonly string[],
): Promise<void> {
  await runWrite(ctx, (pb) => reorderList(pb, ctx, COLLECTION, ids));
}
