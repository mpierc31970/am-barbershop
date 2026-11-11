// Contact lists and visibility (CONTACTS-02, D266, RESEARCH Pitfall 11; invariant 1).
// The house list = everyone the site touched: every touch, manual add and import adds to it.
// Owner / Admin / Staff read through the house list. A renter reads only the renter lists whose
// owner_member is their own membership, and nothing else. resolveListScope is the ONLY place
// visibility is decided; every contacts read calls it first.
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../context";
import { scopedGet } from "../content/shared";
import { newRecordId } from "../repository";
import {
  isRefused,
  projectList,
  runContactsRead,
  type ContactList,
} from "./shared";

async function houseListId(
  pb: PocketBase,
  orgId: string,
): Promise<string | null> {
  const res = await pb.collection("contact_lists").getList(1, 1, {
    filter: pb.filter('organization = {:org} && kind = "house"', {
      org: orgId,
    }),
    sort: "created,id",
    fields: "id",
  });
  return res.items[0]?.id ?? null;
}

/**
 * The org's house list id, created on first use (internal; callers hold the org lock). The
 * partial unique index (one house list per org, 07-01) is the backstop: a refused create
 * re-reads.
 */
export async function ensureHouseList(
  pb: PocketBase,
  orgId: string,
): Promise<string> {
  const found = await houseListId(pb, orgId);
  if (found) return found;
  try {
    const id = newRecordId();
    await pb
      .collection("contact_lists")
      .create({ id, organization: orgId, name: "Everyone", kind: "house" });
    return id;
  } catch (err) {
    if (!isRefused(err)) throw err;
    const again = await houseListId(pb, orgId);
    if (again) return again;
    throw err;
  }
}

/** The reader's membership id in the org, or null. */
async function membershipOf(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<string | null> {
  const res = await pb.collection("memberships").getList(1, 1, {
    filter: pb.filter("user = {:actor} && organization = {:org}", {
      actor: ctx.actor,
      org: ctx.orgId,
    }),
    fields: "id",
  });
  return res.items[0]?.id ?? null;
}

/** The lists the reader may see, house first (never creates one: reads never write). */
async function visibleLists(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<ContactList[]> {
  if (ctx.role === "renter") {
    const member = await membershipOf(pb, ctx);
    if (!member) return [];
    const rows = await pb.collection("contact_lists").getFullList({
      filter: pb.filter(
        'organization = {:org} && kind = "renter" && owner_member = {:m}',
        { org: ctx.orgId, m: member },
      ),
      sort: "name,id",
    });
    return rows.map(projectList);
  }
  const rows = await pb.collection("contact_lists").getFullList({
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    sort: "name,id",
  });
  const lists = rows.map(projectList);
  return [
    ...lists.filter((l) => l.kind === "house"),
    ...lists.filter((l) => l.kind !== "house"),
  ];
}

/** The lists the member can read (07-16 shows the List filter only for 2+, D-UI-P7-21). */
export function listContactLists(ctx: OrgContext): Promise<ContactList[]> {
  return runContactsRead(ctx, (pb) => visibleLists(pb, ctx));
}

/** Internal: visible list ids for a reader (getContact's "lists" field). */
export async function visibleListIds(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<Set<string>> {
  return new Set((await visibleLists(pb, ctx)).map((l) => l.id));
}

/**
 * The one list to read through, or null when the reader can see nothing (internal).
 *   - an explicit list must be this org's (scopedGet: foreign = absent = NotFound); a renter
 *     must also own it
 *   - otherwise: non-renters read the house list, renters their first own renter list
 */
export async function resolveListScope(
  pb: PocketBase,
  ctx: OrgContext,
  listId?: unknown,
): Promise<string | null> {
  if (listId !== undefined && listId !== null && listId !== "") {
    const list = await scopedGet(pb, ctx, "contact_lists", listId);
    if (ctx.role === "renter") {
      const member = await membershipOf(pb, ctx);
      if (!member || list.kind !== "renter" || list.owner_member !== member) {
        throw new NotFound();
      }
    }
    return list.id;
  }
  if (ctx.role === "renter") {
    return (await visibleLists(pb, ctx))[0]?.id ?? null;
  }
  return houseListId(pb, ctx.orgId);
}
