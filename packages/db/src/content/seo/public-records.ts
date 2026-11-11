// Published services and team members for a visitor (07-30; CONT-13, D188, D253; invariant 1).
//
// Read with a SiteContext only (assertSiteContext), scoped to the site's org with bound
// params, `is_published = true` rows only, projected through the registry `public` list,
// field by field (never spread). JSON-LD's makesOffer / employee read these; 07-31's site
// index reads them too. At most 100 rows each, in sort_order.
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import type { OrgContext } from "../../context";
import { getCollectionSpec, projectPublic } from "../../registry";
import { requirePermission } from "../../repository";
import { assertSiteContext, type SiteContext } from "../site-context";

export const PUBLIC_RECORDS_MAX = 100;

export type PublicService = {
  /** 08-08: the record id (not secret; React keys on the Services block). */
  id: string;
  name: string;
  description: string;
  price_display: string;
  price_cents: number | null;
  duration_minutes: number | null;
  sort_order: number;
};

export type PublicTeamMember = {
  /** 08-08: the record id (not secret; React keys on the Our team block). */
  id: string;
  name: string;
  role: string;
  bio: string;
  photo: string;
  sort_order: number;
};

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function publishedRowsIn(
  pb: PocketBase,
  orgId: string,
  collection: "services" | "team_members",
): Promise<Record<string, unknown>[]> {
  const spec = getCollectionSpec(collection);
  const rows = await pb
    .collection(collection)
    .getList<RecordModel>(1, PUBLIC_RECORDS_MAX, {
      filter: pb.filter("organization = {:org} && is_published = true", {
        org: orgId,
      }),
      sort: "sort_order",
      skipTotal: true,
    });
  // 08-08: the record id rides beside the registry projection (set explicitly, not spread).
  return rows.items.map((row) => {
    const out = projectPublic(spec, row);
    out.id = row.id;
    return out;
  });
}

function publishedRows(
  site: SiteContext,
  collection: "services" | "team_members",
): Promise<Record<string, unknown>[]> {
  return withSuperuser((pb) => publishedRowsIn(pb, site.orgId, collection));
}

function toService(r: Record<string, unknown>): PublicService {
  return {
    id: str(r.id, 50),
    name: str(r.name, 200),
    description: str(r.description, 1000),
    price_display: str(r.price_display, 100),
    price_cents: num(r.price_cents),
    duration_minutes: num(r.duration_minutes),
    sort_order: num(r.sort_order) ?? 0,
  };
}

/** The site's published services, in order. */
export async function readPublicServices(
  site: SiteContext,
): Promise<PublicService[]> {
  assertSiteContext(site);
  const rows = await publishedRows(site, "services");
  return rows.map(toService);
}

/**
 * 07-31: readPublicServices on a given client and bare org id.
 * Internal: index builder only (never in a barrel).
 */
export async function publicServicesIn(
  pb: PocketBase,
  orgId: string,
): Promise<PublicService[]> {
  const rows = await publishedRowsIn(pb, orgId, "services");
  return rows.map(toService);
}

/**
 * WR-C02: the same published projection for the builder preview, read with an OrgContext
 * and the content read permission (every org role, Viewer included). The owner lists
 * (listServices / listTeam) need business read, which a Viewer lacks.
 */
export async function listPublishedServices(
  ctx: OrgContext,
): Promise<PublicService[]> {
  requirePermission(ctx, "content", "read");
  const rows = await withSuperuser((pb) =>
    publishedRowsIn(pb, ctx.orgId, "services"),
  );
  return rows.map(toService);
}

/** WR-C02: published team members for the builder preview (content read). */
export async function listPublishedTeam(
  ctx: OrgContext,
): Promise<PublicTeamMember[]> {
  requirePermission(ctx, "content", "read");
  const rows = await withSuperuser((pb) =>
    publishedRowsIn(pb, ctx.orgId, "team_members"),
  );
  return rows.map(toMember);
}

/** The site's published team members, in order. */
export async function readPublicTeam(
  site: SiteContext,
): Promise<PublicTeamMember[]> {
  assertSiteContext(site);
  const rows = await publishedRows(site, "team_members");
  return rows.map(toMember);
}

function toMember(r: Record<string, unknown>): PublicTeamMember {
  return {
    id: str(r.id, 50),
    name: str(r.name, 200),
    role: str(r.role, 200),
    bio: str(r.bio, 2000),
    photo: str(r.photo, 200),
    sort_order: num(r.sort_order) ?? 0,
  };
}
