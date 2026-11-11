// Shared internals of the content writers (invariant 1, TEN-03, TEN-08). Never exported
// from index.ts.
//   - run(): requirePermission(ctx, "content", "write"), the per-org lock, the superuser
//     client and PB error mapping, in that order
//   - scopedGet(): `id = {:id} && organization = {:org}` with bound params; a foreign id
//     and an absent id are the same NotFound (Pitfall 7, no oracle)
//   - commit(): a single un-impersonated write goes straight to PB; anything else is one
//     PB batch, with the audit_log row when a staff member is impersonating
//   - rejectForeignOrg(): input never chooses the organization (T-03-20)
//   - 12-08 (D102, P12-P4): commit() refuses a member's content write to a target a started
//     service window covers (TargetLocked); impersonated staff and system jobs bypass
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody, type AuditEvent } from "../audit";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { assertId, mapError, requirePermission } from "../repository";
import { assertNotLocked, lockTargetsFor, type LockOp } from "../support/lock";
import { withOrgLock } from "./lock";

export type Op =
  | {
      collection: string;
      op: "create";
      id: string;
      body: Record<string, unknown>;
    }
  | {
      collection: string;
      op: "update";
      id: string;
      body: Record<string, unknown>;
    }
  | { collection: string; op: "delete"; id: string };

export function run<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "content", "write");
  return withOrgLock(ctx.orgId, () => withSuperuser(fn)).catch((err) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

export async function scopedGet(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
  id: unknown,
): Promise<RecordModel> {
  assertId(id);
  try {
    return await pb.collection(collection).getFirstListItem(
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

/**
 * The D102 content lock for a member's writes (12-08): TargetLocked when an active service
 * window covers any target the ops touch. Impersonated staff and system jobs bypass. Every
 * content writer that builds its own batch (publish, version restore, page delete and
 * restore) calls it before writing, as commit() does (12-REVIEW CR-A03).
 */
export async function assertOpsNotLocked(
  pb: PocketBase,
  ctx: OrgContext,
  ops: readonly LockOp[],
): Promise<void> {
  if (ctx.impersonator || ctx.systemJob || ops.length === 0) return;
  const targets = await lockTargetsFor(pb, ops);
  if (targets.length) await assertNotLocked(pb, ctx, targets);
}

export async function commit(
  pb: PocketBase,
  ctx: OrgContext,
  ops: Op[],
  audit: AuditEvent,
): Promise<void> {
  if (ops.length === 0) return;
  await assertOpsNotLocked(pb, ctx, ops);
  if (!ctx.impersonator && ops.length === 1) {
    const w = ops[0]!;
    const col = pb.collection(w.collection);
    if (w.op === "create") await col.create({ ...w.body, id: w.id });
    else if (w.op === "update") await col.update(w.id, w.body);
    else await col.delete(w.id);
    return;
  }
  const batch = pb.createBatch();
  for (const w of ops) {
    const col = batch.collection(w.collection);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
  }
  if (ctx.impersonator) {
    batch.collection("audit_log").create(auditBody(ctx, audit));
  }
  await batch.send();
}

export function asInput(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput(`${what} must be an object`);
  }
  return raw as Record<string, unknown>;
}

export function rejectForeignOrg(
  ctx: OrgContext,
  input: Record<string, unknown>,
): void {
  if (
    Object.prototype.hasOwnProperty.call(input, "organization") &&
    input.organization !== ctx.orgId
  ) {
    throw new InvalidInput("organization is taken from the context");
  }
}

export function own(input: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(input, key)
    ? input[key]
    : undefined;
}

/** The org's primary site URL(s), for the search pinger. */
export async function siteUrls(
  pb: PocketBase,
  orgId: string,
): Promise<string[]> {
  const hosts = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org} && primary = true", {
      org: orgId,
    }),
    fields: "hostname",
  });
  return hosts
    .map((h) => (typeof h.hostname === "string" ? h.hostname : ""))
    .filter((h) => h !== "")
    .map((h) => `https://${h}/`);
}
