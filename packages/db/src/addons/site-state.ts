// Visitor-side add-on reads (ADDON-05, ADDON-08; D253; RESEARCH Patterns 6 and 9, Pitfall 7;
// T-05-24). SiteContext only; every query is built here with bound params.
//   - readAddonSiteState: the active slugs plus the page ids to hide (seeded.page.id of
//     disabled rows). The seeded ledger itself never leaves @cds/db.
//   - readPublicAddonRecords: nothing unless the add-on is active; otherwise published,
//     not-held records, public fields only (deny by default), sorted sort_order,id.
import { ADDON_SLUG_RE } from "@cds/core/addons";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import {
  getCollectionSpec,
  projectPublic,
  type CollectionSpec,
} from "../registry";
import { openHeldIds } from "./addon-repo";
import { readOrgAddon, seededOf } from "./entitlements";
import type { AddonRecord } from "./types";

export type AddonSiteState = { active: string[]; hiddenPageIds: string[] };

export async function readAddonSiteState(
  site: SiteContext,
): Promise<AddonSiteState> {
  assertSiteContext(site);
  return withSuperuser((pb) => addonSiteStateIn(pb, site.orgId));
}

/**
 * 07-31: the body of readAddonSiteState on a given client and bare org id.
 * Internal: index builder only (never in a barrel).
 */
export async function addonSiteStateIn(
  pb: PocketBase,
  orgId: string,
): Promise<AddonSiteState> {
  const rows = await pb.collection("org_addons").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "addon,status,seeded",
    sort: "addon,id",
  });
  const active: string[] = [];
  const hidden: string[] = [];
  for (const r of rows) {
    if (r.status === "active") {
      if (typeof r.addon === "string" && r.addon !== "") active.push(r.addon);
      continue;
    }
    const id = seededOf(r.seeded).page?.id;
    if (id) hidden.push(id);
  }
  return { active, hiddenPageIds: hidden };
}

function specOf(collection: unknown): CollectionSpec | null {
  if (typeof collection !== "string") return null;
  try {
    return getCollectionSpec(collection);
  } catch {
    return null;
  }
}

function pick(
  spec: CollectionSpec,
  r: RecordModel,
  fields: readonly string[],
): AddonRecord {
  // Owner-gated fields (publicWhen) read as null unless the row's gate is on (B-WR-04).
  return { ...projectPublic(spec, r, fields), id: r.id };
}

export async function readPublicAddonRecords(
  site: SiteContext,
  slug: string,
  collection: string,
): Promise<AddonRecord[]> {
  assertSiteContext(site);
  return withSuperuser((pb) =>
    publicAddonRecordsIn(pb, site.orgId, slug, collection),
  );
}

/**
 * 07-31: the body of readPublicAddonRecords on a given client and bare org id.
 * Internal: index builder only (never in a barrel).
 */
export async function publicAddonRecordsIn(
  pb: PocketBase,
  orgId: string,
  slug: string,
  collection: string,
): Promise<AddonRecord[]> {
  if (typeof slug !== "string" || !ADDON_SLUG_RE.test(slug)) return [];
  const spec = specOf(collection);
  // Only a collection the add-on itself owns, and only fields marked public.
  if (!spec || spec.feature !== `addon:${slug}`) return [];
  const fields = spec.public ?? [];
  if (fields.length === 0) return [];
  // The filter and sort below need both fields; compose refuses a public collection
  // without them (A-WR-09), and this read stays safe even so (never a PB 400 at render).
  const exported: readonly string[] =
    spec.export === "never" ? [] : spec.export;
  if (!exported.includes("is_published") || !exported.includes("sort_order")) {
    return [];
  }
  const row = await readOrgAddon(pb, orgId, slug);
  if (!row || row.status !== "active") return [];
  const rows = await pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:org} && is_published = true", {
      org: orgId,
    }),
    sort: "sort_order,id",
  });
  const held = await openHeldIds(pb, orgId, collection);
  return rows.filter((r) => !held.has(r.id)).map((r) => pick(spec, r, fields));
}
