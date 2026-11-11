// Grow your social ticks (11-37; DASH-16, D200; T-11-37-01).
//
// The Grow checklist content is static (@cds/core/social GROW_CHECKLIST); what a site has
// ticked is stored per org in `business_profile.grow_checklist` (json string[] of tip ids,
// 11-03). Every member of the org sees the same ticks.
//   - readGrowTicks: content read (Owner, Admin, Editor, Viewer); returns the ticks plus the
//     business category (from the intake business type) the hub filters tips by
//   - setGrowTick: settings write (Owner, Admin; UI-SPEC, 11-50), under the per-org lock; the tip id
//     must exist in GROW_CHECKLIST (InvalidInput otherwise); creates the org's business_profile
//     row when it is missing. Ticks for an account that was removed are kept, so re-adding the
//     account brings them back.
import { InvalidInput } from "@cds/core";
import {
  GROW_CHECKLIST,
  growCategoryFor,
  type GrowCategory,
} from "@cds/core/social";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { commit, run } from "../content/shared";
import type { OrgContext } from "../context";
import { mapError, newRecordId, requirePermission } from "../repository";

const COLLECTION = "business_profile";

const TIP_IDS: ReadonlySet<string> = new Set(GROW_CHECKLIST.map((t) => t.id));

export const GROW_TIP_UNKNOWN_COPY =
  "That tip isn't on the list any more. Refresh the page and try again.";

export type GrowState = {
  /** Ticked tip ids, in checklist order (unknown ids dropped). */
  ticks: string[];
  /** The business category the tips are filtered by (intake business type). */
  category: GrowCategory;
};

function ticksOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const on = new Set(raw.filter((v): v is string => typeof v === "string"));
  return GROW_CHECKLIST.filter((t) => on.has(t.id)).map((t) => t.id);
}

async function profileRow(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "id,business_type,grow_checklist",
  });
  return res.items[0] ?? null;
}

function stateOf(row: RecordModel | null): GrowState {
  return {
    ticks: ticksOf(row?.grow_checklist),
    category: growCategoryFor(row?.business_type),
  };
}

/** The site's Grow ticks and business category (content read). */
export async function readGrowTicks(ctx: OrgContext): Promise<GrowState> {
  requirePermission(ctx, "content", "read");
  return withSuperuser(async (pb) =>
    stateOf(await profileRow(pb, ctx.orgId)),
  ).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Tick or untick one Grow tip for the whole site (settings write: Owner, Admin). */
export async function setGrowTick(
  ctx: OrgContext,
  tipId: unknown,
  on: unknown,
): Promise<GrowState> {
  requirePermission(ctx, "settings", "write");
  if (typeof tipId !== "string" || !TIP_IDS.has(tipId)) {
    throw new InvalidInput(GROW_TIP_UNKNOWN_COPY);
  }
  if (typeof on !== "boolean") {
    throw new InvalidInput("on must be true or false");
  }
  return run(ctx, async (pb) => {
    const row = await profileRow(pb, ctx.orgId);
    const current = ticksOf(row?.grow_checklist);
    const has = current.includes(tipId);
    if (has === on) return stateOf(row);
    const next = ticksOf(
      on ? [...current, tipId] : current.filter((id) => id !== tipId),
    );
    const id = row?.id ?? newRecordId();
    await commit(
      pb,
      ctx,
      [
        row
          ? {
              collection: COLLECTION,
              op: "update",
              id,
              body: { grow_checklist: next },
            }
          : {
              collection: COLLECTION,
              op: "create",
              id,
              body: { organization: ctx.orgId, grow_checklist: next },
            },
      ],
      {
        action: "social.grow_tick",
        targetCollection: COLLECTION,
        targetId: id,
        meta: { tip: tipId, on },
      },
    );
    return { ticks: next, category: growCategoryFor(row?.business_type) };
  });
}
