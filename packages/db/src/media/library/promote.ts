// Publish-time promote, private -> public (07-12 choices 4 and 9; CONT-33, resolution d,
// D255; T-07-12-02, -06, -10). Not in the barrel: publish.ts calls it after the locked
// publish commits, outside the lock, only for a public, non-protected page.
//   - only own `ready` rows with no public_at are promoted (idempotent: a second publish
//     copies nothing and never moves public_at)
//   - image: every imageWidthCandidates variant + thumb; a P6 photo with no w480/w960/w1600
//     yet gets them derived from its private original first (deriveWidths), written
//     privately, then copied. Originals are never copied
//   - video: video.mp4 (required), poster.jpg, poster.webp, thumb, captions.vtt (when set),
//     each only if the private object exists; audio: audio.mp3
//   - copies run one object at a time through a process-wide queue of one (a 250 MB video
//     is at most one buffer on the 1 GB container); an asset joins the public_at batch only
//     when every copy for it succeeded
//   - failures log a fixed message and the asset id only (never keys)
import { emptyRefs, type SectionRegistry } from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { popupRefs, rowsRefs } from "../../content/references";
import { commit, type Op } from "../../content/shared";
import type { OrgContext } from "../../context";
import { getObjectStore, getPublicMediaStore } from "../../storage";
import {
  PUBLIC_VARIANTS_BY_KIND,
  tenantMediaDerivativeKey,
  tenantMediaKey,
  tenantPublicMediaKey,
  type MediaObjectName,
} from "../../storage/keys";
import type { ObjectStore } from "../../storage/object-store";
import { deriveWidths, type LibraryWidthVariant } from "../pipeline";
import type {
  MediaDelivery,
  PublicMediaKind,
  PublicMediaVariant,
} from "../ports";
import { createQueue } from "../queue";
import { publicMediaMime } from "../store/range";
import { publicKindForRow } from "../store/serve";
import { getMediaDelivery } from "./delivery";
import { runContentWrite } from "./run";
import { imageWidthCandidates } from "./srcset";

const COLLECTION = "media_assets";
const ID_RE = /^[a-z0-9]{15}$/;
const CHUNK = 50;

/** Process-wide: one promote copy at a time. */
const promoteQueue = createQueue();

export type PromoteDeps = { store?: ObjectStore; publicStore?: ObjectStore };

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ");
}

async function ownRows(
  pb: PocketBase,
  orgId: string,
  ids: readonly string[],
  extra: string,
): Promise<RecordModel[]> {
  const out: RecordModel[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const params: Record<string, string> = { org: orgId };
    const expr = ids
      .slice(i, i + CHUNK)
      .map((id, j) => {
        params[`i${j}`] = id;
        return `id = {:i${j}}`;
      })
      .join(" || ");
    out.push(
      ...(await pb.collection(COLLECTION).getFullList({
        filter: pb.filter(
          "organization = {:org}" + extra + " && (" + expr + ")",
          params,
        ),
      })),
    );
  }
  return out;
}

/**
 * Media a published page uses: its sections' media, the media of the pop-ups those
 * sections open, and each referenced video's cover (poster_asset).
 */
export async function mediaIdsForPromotion(
  pb: PocketBase,
  ctx: OrgContext,
  sections: readonly { section_type: string; content: unknown }[],
  registry: SectionRegistry,
): Promise<string[]> {
  const refs = rowsRefs(sections, registry);
  const media = new Set(refs.media);
  const popupIds = refs.popups.filter((id) => ID_RE.test(id));
  if (popupIds.length > 0) {
    for (let i = 0; i < popupIds.length; i += CHUNK) {
      const params: Record<string, string> = { org: ctx.orgId };
      const expr = popupIds
        .slice(i, i + CHUNK)
        .map((id, j) => {
          params[`p${j}`] = id;
          return `id = {:p${j}}`;
        })
        .join(" || ");
      const rows = await pb.collection("popups").getFullList({
        filter: pb.filter("organization = {:org} && (" + expr + ")", params),
        fields: "id,content",
      });
      for (const r of rows) {
        for (const m of (popupRefs(r.content) ?? emptyRefs()).media) {
          media.add(m);
        }
      }
    }
  }
  const ids = [...media].filter((id) => ID_RE.test(id));
  if (ids.length > 0) {
    const videos = await ownRows(pb, ctx.orgId, ids, " && kind = 'video'");
    for (const v of videos) {
      const p = str(v.poster_asset);
      if (ID_RE.test(p)) media.add(p);
    }
  }
  return [...media].filter((id) => ID_RE.test(id));
}

type Copy = { variant: PublicMediaVariant; required: boolean };

function copiesFor(row: RecordModel, kind: PublicMediaKind): Copy[] {
  if (kind === "image") {
    return [
      ...imageWidthCandidates(num(row.width), num(row.web_width)).map(
        ([variant]) => ({ variant, required: true }),
      ),
      { variant: "thumb", required: true },
    ];
  }
  if (kind === "video") {
    const list: Copy[] = [
      { variant: "video.mp4", required: true },
      { variant: "poster.jpg", required: false },
      { variant: "poster.webp", required: false },
      { variant: "thumb", required: false },
    ];
    if (row.captions_path === "captions.vtt") {
      list.push({ variant: "captions.vtt", required: true });
    }
    return list;
  }
  return [{ variant: "audio.mp3", required: true }];
}

/** P6 photos: derive any missing w480/w960/w1600 from the private original (choice 4). */
async function backfillWidths(
  store: ObjectStore,
  orgId: string,
  row: RecordModel,
  copies: readonly Copy[],
): Promise<void> {
  const missing: LibraryWidthVariant[] = [];
  for (const c of copies) {
    if (c.variant === "w480" || c.variant === "w960" || c.variant === "w1600") {
      const have = await store.get(
        tenantMediaDerivativeKey(orgId, row.id, c.variant),
      );
      if (!have) missing.push(c.variant);
    }
  }
  if (missing.length === 0) return;
  const ext = str(row.original_ext) || "png";
  const original = await store.get(
    tenantMediaKey(orgId, row.id, `original.${ext}` as MediaObjectName),
  );
  if (!original) return; // the copy below fails for this asset
  const derived = await deriveWidths(original, num(row.width));
  for (const v of missing) {
    const sized = derived[v];
    if (!sized) continue;
    await store.put(
      tenantMediaDerivativeKey(orgId, row.id, v),
      sized.data,
      "image/webp",
    );
  }
}

/** Copy one asset's derivatives; true when every required copy succeeded. */
async function promoteOne(
  store: ObjectStore,
  publicStore: ObjectStore,
  orgId: string,
  row: RecordModel,
): Promise<boolean> {
  const kind = publicKindForRow(row.kind);
  if (kind === null) return false;
  const copies = copiesFor(row, kind);
  if (kind === "image") await backfillWidths(store, orgId, row, copies);
  for (const c of copies) {
    const ok = await promoteQueue.run(async () => {
      const bytes = await store.get(
        tenantMediaDerivativeKey(orgId, row.id, c.variant),
      );
      if (!bytes) return !c.required;
      await publicStore.put(
        tenantPublicMediaKey(orgId, kind, row.id, c.variant),
        bytes,
        publicMediaMime(c.variant),
      );
      return true;
    });
    if (!ok) return false;
  }
  return true;
}

export type DemoteDeps = PromoteDeps & { delivery?: MediaDelivery };

/**
 * The mirror of promoteMedia (WR-A09): `ids` (own, public) go private again. public_at is
 * cleared first, in one audited batch, so the public route refuses them at once (the
 * resolver tokenizes unpromoted media, so no page breaks); then their public objects are
 * removed and the CDN purged, best effort, logging the asset id only. Returns the ids
 * demoted by this call.
 */
export async function demoteMedia(
  ctx: OrgContext,
  ids: readonly string[],
  deps: DemoteDeps = {},
): Promise<{ demoted: string[] }> {
  const wanted = [...new Set(ids)].filter(
    (id) => typeof id === "string" && ID_RE.test(id),
  );
  if (wanted.length === 0) return { demoted: [] };
  const rows = await withSuperuser((pb) =>
    ownRows(pb, ctx.orgId, wanted, " && public_at != ''"),
  );
  if (rows.length === 0) return { demoted: [] };
  await runContentWrite(ctx, async (pb) => {
    const ops: Op[] = rows.map((r) => ({
      collection: COLLECTION,
      op: "update",
      id: r.id,
      body: { public_at: "" },
    }));
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.demote`,
      targetCollection: COLLECTION,
      targetId: rows.length === 1 ? rows[0]!.id : "",
      meta: { count: rows.length },
    });
  });
  const publicStore = deps.publicStore ?? getPublicMediaStore();
  const purge: string[] = [];
  for (const row of rows) {
    const kind = publicKindForRow(row.kind);
    if (kind === null) continue;
    for (const v of PUBLIC_VARIANTS_BY_KIND[kind]) {
      const key = tenantPublicMediaKey(ctx.orgId, kind, row.id, v);
      purge.push(key);
      await publicStore.delete(key).catch(() => {
        console.error("[media] demote object removal failed", row.id);
      });
    }
  }
  if (purge.length > 0) {
    try {
      await (deps.delivery ?? getMediaDelivery()).purge(purge);
    } catch {
      console.error("[media] demote purge failed");
    }
  }
  return { demoted: rows.map((r) => r.id) };
}

/**
 * Promote `ids` (own, ready, not yet public) to the public store and set public_at once.
 * Returns the ids promoted by this call.
 */
export async function promoteMedia(
  ctx: OrgContext,
  ids: readonly string[],
  deps: PromoteDeps = {},
): Promise<{ promoted: string[] }> {
  const wanted = [...new Set(ids)].filter(
    (id) => typeof id === "string" && ID_RE.test(id),
  );
  if (wanted.length === 0) return { promoted: [] };
  const rows = await withSuperuser((pb) =>
    ownRows(pb, ctx.orgId, wanted, " && status = 'ready' && public_at = ''"),
  );
  if (rows.length === 0) return { promoted: [] };
  const store = deps.store ?? getObjectStore();
  const publicStore = deps.publicStore ?? getPublicMediaStore();
  const promoted: string[] = [];
  for (const row of rows) {
    try {
      if (await promoteOne(store, publicStore, ctx.orgId, row)) {
        promoted.push(row.id);
      }
    } catch (err) {
      console.error(
        "[media] promote failed",
        row.id,
        err instanceof Error ? err.name : "error",
      );
    }
  }
  if (promoted.length === 0) return { promoted };
  const at = nowStamp();
  await runContentWrite(ctx, async (pb) => {
    const ops: Op[] = promoted.map((id) => ({
      collection: COLLECTION,
      op: "update",
      id,
      body: { public_at: at },
    }));
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.promote`,
      targetCollection: COLLECTION,
      targetId: promoted.length === 1 ? promoted[0]! : "",
      meta: { count: promoted.length },
    });
  });
  return { promoted };
}
