// Studio Booking chokepoint helpers (D144, D145, D162; invariant 1).
//
// Who sees what:
//   - Owner / Admin ("managers"): every seat, service, booking and lease of their org.
//   - A barber (a `renter` or `staff` member holding the `studio-booking` grant): their OWN
//     seat only. Every seat-scoped read and write resolves the seat through seatFor(), which
//     answers NotFound for another barber's seat, exactly like a foreign or absent id.
//   - Everyone else: Forbidden by the permission matrix (addon:studio-booking).
// Every query is scoped `organization = {:org}` with bound params; no input names an org.
import { Forbidden, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { assertAddonActive } from "../addons/entitlements";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { withOrgLock } from "../content/lock";
import { scopedGet } from "../content/shared";
import { assertId, mapError, requirePermission } from "../repository";

export const STUDIO_SLUG = "studio-booking";
export const STUDIO_FEATURE = `addon:${STUDIO_SLUG}`;
const MANIFEST = { slug: STUDIO_SLUG, name: "Studio Booking" } as const;

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Owner and Admin manage every seat; barbers only their own. */
export function isManager(ctx: OrgContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

export function requireStudio(ctx: OrgContext, action: "read" | "write"): void {
  assertOrgContext(ctx);
  requirePermission(ctx, STUDIO_FEATURE, action);
}

export function requireManager(
  ctx: OrgContext,
  action: "read" | "write",
): void {
  requireStudio(ctx, action);
  if (!isManager(ctx)) throw new Forbidden("only the shop owner can do this");
}

function mapped(err: unknown): never {
  if (err instanceof ClientResponseError) mapError(err);
  throw err;
}

/** A read with the superuser client, PB errors mapped. */
export function studioRead<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch(mapped);
}

/** A write under the studio lock, only while the add-on is active. */
export function studioWrite<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  return withOrgLock(`studio:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      await assertAddonActive(pb, ctx.orgId, MANIFEST);
      return fn(pb);
    }),
  ).catch(mapped);
}

/**
 * The barber's own seat, or null. A seat the owner created for this person's email links
 * itself to their account on first use (the owner set the email and sent the invite).
 */
export async function ownSeat(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<RecordModel | null> {
  const linked = await pb.collection("studio_seats").getList(1, 1, {
    filter: pb.filter("organization = {:org} && user = {:u}", {
      org: ctx.orgId,
      u: ctx.actor,
    }),
  });
  if (linked.items[0]) return linked.items[0];
  if (!ctx.actor || ctx.impersonator) return null;
  const user = await pb
    .collection("users")
    .getOne(ctx.actor, { fields: "id,email" })
    .catch(() => null);
  const email = str(user?.email).trim().toLowerCase();
  if (!email) return null;
  const byEmail = await pb.collection("studio_seats").getList(1, 1, {
    filter: pb.filter("organization = {:org} && email = {:e} && user = ''", {
      org: ctx.orgId,
      e: email,
    }),
  });
  const seat = byEmail.items[0];
  if (!seat) return null;
  return pb.collection("studio_seats").update(seat.id, { user: ctx.actor });
}

/**
 * One seat the caller may act on: any seat of the org for a manager, only their own for a
 * barber. Another barber's seat is NotFound (same as foreign or absent).
 */
export async function seatFor(
  pb: PocketBase,
  ctx: OrgContext,
  seatId: unknown,
): Promise<RecordModel> {
  assertId(seatId);
  if (isManager(ctx)) return scopedGet(pb, ctx, "studio_seats", seatId);
  const own = await ownSeat(pb, ctx);
  if (!own || own.id !== seatId) throw new NotFound();
  return own;
}

/** A row of a seat-scoped collection that belongs to `seat` (else NotFound). */
export async function seatRow(
  pb: PocketBase,
  ctx: OrgContext,
  collection: string,
  seat: RecordModel,
  id: unknown,
): Promise<RecordModel> {
  const row = await scopedGet(pb, ctx, collection, id);
  if (row.seat !== seat.id) throw new NotFound();
  return row;
}

/** Seat ids the caller may see: every seat for managers, their own (or none) for barbers. */
export async function visibleSeatIds(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<string[] | "all"> {
  if (isManager(ctx)) return "all";
  const own = await ownSeat(pb, ctx);
  return own ? [own.id] : [];
}

/** True when the org has the add-on on (public pages show nothing otherwise). */
export async function studioActive(
  pb: PocketBase,
  orgId: string,
): Promise<boolean> {
  try {
    await assertAddonActive(pb, orgId, MANIFEST);
    return true;
  } catch {
    return false;
  }
}
