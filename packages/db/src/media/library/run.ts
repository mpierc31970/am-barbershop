// Media library lock runners (07-12; invariant 1, RESEARCH Pitfall 10). Internal: never in
// the barrel. Library, video and audio are website content, so they use the `content`
// permission (Owner / Admin / Editor write; Viewer reads); intake kinds keep `business`
// (intake/shared runRead / runWrite). Order: permission, per-org lock, superuser client, PB
// error mapping (content/shared `run`).
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import type { OrgContext } from "../../context";
import { mapError, requirePermission } from "../../repository";

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Content read (every org role), no lock. */
export function runContentRead<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "content", "read");
  return mapped(withSuperuser(fn));
}

/** Content write (Owner / Admin / Editor), one writer per org at a time. */
export function runContentWrite<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "content", "write");
  return mapped(withOrgLock(ctx.orgId, () => withSuperuser(fn)));
}

/** A lock runner for `feature` write (delete uses business for intake kinds). */
export function runFeatureWrite<T>(
  ctx: OrgContext,
  feature: "content" | "business",
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, feature, "write");
  return mapped(withOrgLock(ctx.orgId, () => withSuperuser(fn)));
}
