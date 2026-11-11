// Shared internals of the intake chokepoint (ONB-01, ONB-02, ONB-13; invariant 1, TEN-03,
// PD-21). Never exported from index.ts.
//   - runRead(): requirePermission(ctx, "business", "read") (Owner / Admin / Editor), then the
//     superuser client and PB error mapping
//   - runWrite(): requirePermission(ctx, "business", "write") (Owner / Admin), the per-org lock,
//     the superuser client and PB error mapping, in that order (content/shared.ts run, with the
//     business feature instead of content)
//   - orgRow(): the org's single row of a one-row-per-org collection, by bound filter
// commit / rejectForeignOrg / scopedGet are reused from ../content/shared.
import { InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { commit, type Op } from "../content/shared";
import type { OrgContext } from "../context";
import { mapError, requirePermission } from "../repository";

export {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  scopedGet,
  type Op,
} from "../content/shared";

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Business read (Owner / Admin / Editor; Viewer and renters are refused). */
export function runRead<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "business", "read");
  return mapped(withSuperuser(fn));
}

/** Business write (Owner / Admin), one writer per org at a time. */
export function runWrite<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "business", "write");
  return mapped(withOrgLock(ctx.orgId, () => withSuperuser(fn)));
}

/** The org's row of a one-row-per-org collection (unique index), or null. */
export async function orgRow(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(collection).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
  });
  return res.items[0] ?? null;
}

/** Every row of an org-scoped list collection, in display order. */
export function orgList(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
): Promise<RecordModel[]> {
  return pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    sort: "sort_order,created,id",
  });
}

/** The next sort_order at the end of the org's list (0 for an empty list). */
export function nextSortOrder(rows: readonly RecordModel[]): number {
  return rows.reduce(
    (max, r) =>
      typeof r.sort_order === "number" && r.sort_order >= max
        ? r.sort_order + 1
        : max,
    0,
  );
}

export const REORDER_COPY =
  "The list changed while you were moving things. Refresh and try again.";

/**
 * Rewrite sort_order 0..n-1 in the given order. `ids` must be exactly the org's rows (a
 * permutation: no missing, extra, foreign or repeated id), else InvalidInput. One batch;
 * the audit row is written when a staff member is impersonating.
 */
export async function reorderList(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
  ids: unknown,
): Promise<void> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new InvalidInput(REORDER_COPY);
  }
  const rows = await orgList(pb, ctx, collection);
  const own = new Set(rows.map((r) => r.id));
  const given = new Set(ids as string[]);
  if (
    ids.length !== rows.length ||
    given.size !== ids.length ||
    !(ids as string[]).every((id) => own.has(id))
  ) {
    throw new InvalidInput(REORDER_COPY);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ops: Op[] = [];
  (ids as string[]).forEach((id, i) => {
    if (byId.get(id)?.sort_order !== i) {
      ops.push({ collection, op: "update", id, body: { sort_order: i } });
    }
  });
  await commit(pb, ctx, ops, {
    action: `${collection}.reorder`,
    targetCollection: collection,
    targetId: "",
    meta: { count: ids.length },
  });
}
