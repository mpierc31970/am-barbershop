// Media delete (07-12 choices 12-14; CONT-33, CONT-36, D275; UI-SPEC delete dialogs;
// T-07-12-08, -09, -10, -11). The D275 rule:
//   - referenced -> SOFT delete: deleted_at is set; the asset is hidden from the library,
//     the pickers and P6 listMedia, but still resolves and serves, so no live page breaks.
//     Referenced = any page's draft rows, any page's kept versions (version_refs), any
//     pop-up's items, another video's cover (poster_asset), or an active intake slot (P6
//     logo / hero / gallery / team / moodboard with removed_at empty)
//   - unreferenced -> HARD delete: the row (and its audit row) go first in one batch, then
//     its public and private objects are removed, the CDN purged for its public keys and
//     the site's cached renders invalidated. Each step after the row is best effort and
//     logs the asset id only, never keys; a leftover object is unreachable (no row: 404)
// Permission: content write for library / video / audio; business write for intake kinds.
// removeMediaObjects is exported by path (not the barrel) for 07-27 takedown and 07-28 GC.
// 07-28: the referenced check is content/soft-delete.ts isReferenced (one rule, three kinds).
import type { SectionRegistry } from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { findRefHolders } from "../../content/references";
import { liveTag, siteTag, type Invalidator } from "../../content/ports";
import { commit, scopedGet } from "../../content/shared";
import { isReferenced } from "../../content/soft-delete";
import { assertOrgContext, type OrgContext } from "../../context";
import { assertId } from "../../repository";
import { getObjectStore, getPublicMediaStore } from "../../storage";
import {
  PUBLIC_VARIANTS_BY_KIND,
  tenantMediaKey,
  tenantPublicMediaKey,
} from "../../storage/keys";
import type { ObjectStore } from "../../storage/object-store";
import type { MediaDelivery } from "../ports";
import { publicKindForRow } from "../store/serve";
import { getMediaDelivery } from "./delivery";
import { runContentRead, runFeatureWrite } from "./run";

const COLLECTION = "media_assets";
const INTAKE_KINDS = new Set(["logo", "hero", "gallery", "team", "moodboard"]);

export type DeleteMediaDeps = {
  sections: SectionRegistry;
  invalidator: Invalidator;
  delivery?: MediaDelivery;
  store?: ObjectStore;
  publicStore?: ObjectStore;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ");
}

type Usage = {
  holders: Awaited<ReturnType<typeof findRefHolders>>;
  asCover: boolean;
  intakeSlot: boolean;
};

async function usageOf(
  pb: PocketBase,
  ctx: OrgContext,
  row: RecordModel,
  registry: SectionRegistry,
  store: ObjectStore | undefined,
): Promise<Usage> {
  const holders = await findRefHolders(pb, ctx, registry, "media", row.id, {
    ...(store ? { store } : {}),
  });
  const covers = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && poster_asset = {:id} && id != {:id}",
      { org: ctx.orgId, id: row.id },
    ),
    fields: "id",
  });
  return {
    holders,
    asCover: covers.items.length > 0,
    intakeSlot: INTAKE_KINDS.has(str(row.kind)) && str(row.removed_at) === "",
  };
}

/**
 * Remove every object of a deleted asset: its public keys (only when it was promoted) and
 * every private object under tenants/<org>/media/<asset>/, then purge the CDN for the public
 * keys. Best effort; logs the asset id only.
 */
export async function removeMediaObjects(
  orgId: string,
  row: RecordModel,
  deps: {
    store?: ObjectStore;
    publicStore?: ObjectStore;
    delivery?: MediaDelivery;
  } = {},
): Promise<{ publicKeys: string[] }> {
  const kind = publicKindForRow(row.kind);
  const publicKeys =
    kind !== null && str(row.public_at) !== ""
      ? PUBLIC_VARIANTS_BY_KIND[kind].map((v) =>
          tenantPublicMediaKey(orgId, kind, row.id, v),
        )
      : [];
  if (publicKeys.length > 0) {
    try {
      const pub = deps.publicStore ?? getPublicMediaStore();
      for (const k of publicKeys) await pub.delete(k).catch(() => undefined);
    } catch {
      console.error("[media] public object removal failed", row.id);
    }
  }
  try {
    const store = deps.store ?? getObjectStore();
    const prefix = tenantMediaKey(orgId, row.id, "web.webp").slice(
      0,
      -"web.webp".length,
    );
    for (const o of await store.list(prefix)) {
      await store.delete(o.key).catch(() => undefined);
    }
  } catch {
    console.error("[media] private object removal failed", row.id);
  }
  if (publicKeys.length > 0) {
    try {
      await (deps.delivery ?? getMediaDelivery()).purge(publicKeys);
    } catch {
      console.error("[media] purge failed", row.id);
    }
  }
  return { publicKeys };
}

/** D275 delete: soft when referenced, else hard + objects + purge + invalidation. */
export async function deleteMediaAsset(
  ctx: OrgContext,
  id: string,
  deps: DeleteMediaDeps,
): Promise<{ outcome: "soft" | "hard" }> {
  assertOrgContext(ctx);
  assertId(id);
  // The row's kind decides the permission; the read is bound to the context's org.
  const first = await withSuperuser((pb) => scopedGet(pb, ctx, COLLECTION, id));
  const feature = INTAKE_KINDS.has(str(first.kind)) ? "business" : "content";
  const decided = await runFeatureWrite(ctx, feature, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    // The one D275 rule (07-28, content/soft-delete.ts).
    const used = await isReferenced(pb, ctx, deps.sections, "media", row.id, {
      ...(deps.store ? { store: deps.store } : {}),
    });
    if (used) {
      if (str(row.deleted_at) === "") {
        await commit(
          pb,
          ctx,
          [
            {
              collection: COLLECTION,
              op: "update",
              id: row.id,
              body: { deleted_at: nowStamp() },
            },
          ],
          {
            action: `${COLLECTION}.soft_delete`,
            targetCollection: COLLECTION,
            targetId: row.id,
          },
        );
      }
      return { outcome: "soft" as const, row };
    }
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "delete", id: row.id }],
      {
        action: `${COLLECTION}.delete`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { kind: str(row.kind) },
      },
    );
    return { outcome: "hard" as const, row };
  });
  if (decided.outcome === "hard") {
    await removeMediaObjects(ctx.orgId, decided.row, deps);
    try {
      deps.invalidator.invalidate([siteTag(ctx.orgId), liveTag(ctx.orgId)]);
    } catch {
      // Cached renders expire on their own.
    }
  }
  return { outcome: decided.outcome };
}

export type MediaUsedOn = {
  pages: { id: string; title: string }[];
  inVersions: boolean;
  inPopups: boolean;
  asCover: boolean;
  intakeSlot: boolean;
};

/** Where an asset is used, for the drawer's "Used on" and the delete dialog (content read). */
export async function mediaUsedOn(
  ctx: OrgContext,
  id: string,
  registry: SectionRegistry,
  deps: { store?: ObjectStore } = {},
): Promise<MediaUsedOn> {
  assertId(id);
  return runContentRead(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    const u = await usageOf(pb, ctx, row, registry, deps.store);
    return {
      pages: u.holders.draftPages,
      inVersions: u.holders.versionPages.length > 0,
      inPopups: u.holders.popups.length > 0,
      asCover: u.asCover,
      intakeSlot: u.intakeSlot,
    };
  });
}
