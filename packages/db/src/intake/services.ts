// Services chokepoint (ONB-01, ONB-13, D37; CONTEXT A3-Q1; invariant 1, TEN-03, PD-21;
// T-06-52, T-06-53, T-06-54, T-06-56).
//
// The services a business offers are core data read by the Services block. Add appends at the
// end, shown on the site by default; edit keeps the position and merges only the given keys
// over the stored row. validateService owns the price rules: Fixed and Starting at need a
// price, Free and Ask store no price. A foreign id and an absent id are the same NotFound.
// Nothing takes an org id.
// 13-52 (STAFF-25, D270): every save that can show text on the site runs the publish scan
// (list-screen.ts): held saves the service hidden and opens a flag for staff review.
import { validateService, type ServiceInput } from "@cds/core/intake";
import type { RecordModel } from "pocketbase";
import { refreshSiteIndex } from "../content/site-index/build";
import {
  afterListSave,
  isToggleOff,
  screenListRow,
  type ListScanDeps,
} from "./list-screen";
import type { OrgContext } from "../context";
import { newRecordId } from "../repository";
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

const COLLECTION = "services";

export type Service = ServiceInput & { id: string; sortOrder: number };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && v > 0 ? v : null;

/** The stored row as validateService input (PB stores an empty number as 0). */
export function storedService(r: RecordModel): Record<string, unknown> {
  return {
    name: str(r.name),
    description: str(r.description),
    price_display: str(r.price_display),
    price_cents: num(r.price_cents),
    duration_minutes: num(r.duration_minutes),
    is_published: r.is_published === true,
  };
}

export function toService(r: RecordModel): Service {
  const s = storedService(r);
  return {
    id: r.id,
    name: s.name as string,
    description: s.description as string,
    price_display: s.price_display as ServiceInput["price_display"],
    price_cents: s.price_cents as number | null,
    duration_minutes: s.duration_minutes as number | null,
    is_published: s.is_published as boolean,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
  };
}

/** The org's services, in display order (business read). */
export async function listServices(ctx: OrgContext): Promise<Service[]> {
  return runRead(ctx, async (pb) =>
    (await orgList(pb, ctx, COLLECTION)).map(toService),
  );
}

/** A saved service. `held` = the scan held it, so it was saved hidden (13-52). */
export type SavedService = Service & { held: boolean };

/** Add (no id) or edit (id) a service (business write). */
export async function saveService(
  ctx: OrgContext,
  input: unknown,
  id?: string,
  deps: ListScanDeps = {},
): Promise<SavedService> {
  const raw = asInput(input, "The service");
  rejectForeignOrg(ctx, raw);
  if (id === undefined) validateService(raw); // fail fast before the lock
  const { saved, outcome, held } = await runWrite(ctx, async (pb) => {
    const current =
      id === undefined ? null : await scopedGet(pb, ctx, COLLECTION, id);
    const v = validateService(
      current ? { ...storedService(current), ...raw } : raw,
    );
    // 13-52: screen the merged public text (name, description) before it is written.
    const { body, outcome, held } = await screenListRow(
      ctx,
      deps,
      COLLECTION,
      { ...v },
      { toggleOff: isToggleOff(raw) },
    );
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
      const saved = toService(
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
    const saved = toService(await pb.collection(COLLECTION).getOne(newId));
    return { saved, outcome, held };
  });
  // 07-31 index.json rebuild rides on afterLiveSave (13-52), with the flag and the ping.
  await afterListSave(ctx, deps, outcome, {
    collection: COLLECTION,
    id: saved.id,
  });
  return { ...saved, held };
}

/** Delete a service (business write). */
export async function deleteService(
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
  await refreshSiteIndex(ctx.orgId); // 07-31: rebuild index.json
}

/** Rewrite the order; `ids` must be every service exactly once (business write). */
export async function reorderServices(
  ctx: OrgContext,
  ids: readonly string[],
): Promise<void> {
  await runWrite(ctx, (pb) => reorderList(pb, ctx, COLLECTION, ids));
  await refreshSiteIndex(ctx.orgId); // 07-31: rebuild index.json
}
