// The page-draft fingerprint (R2-WR-02). Extracted from the add-on installer in 08-11 so
// assembly reuses the same print (CONTEXT discretion). Behaviour is unchanged: the installer
// imports it from here. Internal to @cds/db (never re-exported from index.ts).
import { createHash } from "node:crypto";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { mapError } from "../repository";

/** Objects with keys sorted at every depth; arrays keep their order. */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** JSON with keys sorted at every depth (key order never changes the text). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonical(v));
}

// Bookkeeping fields every write moves; everything else on the page and its blocks is
// something an owner edit (or an owner publish) would change.
const VOLATILE = new Set([
  "created",
  "updated",
  "collectionId",
  "collectionName",
  "expand",
  "has_unpublished_changes",
]);

function stable(rec: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rec).filter(([k]) => !VOLATILE.has(k)),
  );
}

/**
 * The draft fingerprint of a page (R2-WR-02): a sha256 over the page record and its blocks
 * in order, minus bookkeeping fields. The installer stores it in the pending marker after
 * each of its own writes, and assembly in its ledger, so a later run can prove nobody
 * touched the page since. Pure (unit-tested).
 */
export function pageDraftPrint(
  page: Record<string, unknown>,
  blocks: readonly Record<string, unknown>[],
): string {
  const ordered = inPageOrder(blocks);
  const body = canonicalJson({
    page: stable(page),
    blocks: ordered.map(stable),
  });
  return createHash("sha256").update(body).digest("hex");
}

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Blocks in page order (sort_order, then id): the order pageDraftPrint hashes them in. */
export function inPageOrder<T extends Record<string, unknown>>(
  blocks: readonly T[],
): T[] {
  return [...blocks].sort(
    (a, b) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * The page's current draft: fingerprint, its blocks in page order and their types, or null
 * when it is gone.
 */
export async function readPageDraft(
  ctx: OrgContext,
  pageId: string,
): Promise<{
  page: RecordModel;
  blocks: RecordModel[];
  types: string[];
  print: string;
} | null> {
  assertOrgContext(ctx);
  return pbRun(async (pb) => {
    // 11-29: a page in Recently deleted reads as deleted (assembly never rebuilds it).
    const res = await pb.collection("pages").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && id = {:id} && deleted_at = ''",
        {
          org: ctx.orgId,
          id: pageId,
        },
      ),
    });
    const page = res.items[0];
    if (!page) return null;
    const blocks = await pb.collection("page_sections").getFullList({
      filter: pb.filter("organization = {:org} && page = {:page}", {
        org: ctx.orgId,
        page: page.id,
      }),
    });
    const ordered = inPageOrder(blocks);
    return {
      page,
      blocks: ordered,
      types: ordered.map((b) => String(b.section_type)),
      print: pageDraftPrint(page, ordered),
    };
  });
}
