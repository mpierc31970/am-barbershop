// Video captions (07-13; CONT-18 captions, UI-SPEC UPL-CAPTIONS, choice 11; T-07-13-07).
// A .vtt file (UTF-8, `WEBVTT` header, at least one cue line, no NUL, at most 512 KB) on an own
// video. Stored privately as captions.vtt (`text/vtt; charset=utf-8`), `captions_path` set and
// `bytes` adjusted under the org lock with the audit row.
// After 07-12 has promoted a video (`public_at` set) captions can still change, so this writer
// also puts / deletes the PUBLIC captions.vtt and purges that key: the one public-store write
// outside promote (noted for 07-12 / 07-28).
import { NotFound } from "@cds/core";
import type { OrgContext } from "../../context";
import { commit, scopedGet } from "../../content/shared";
import { liveTag, siteTag, type Invalidator } from "../../content/ports";
import { assertId, requirePermission } from "../../repository";
import { getObjectStore, getPublicMediaStore } from "../../storage";
import { tenantPublicMediaKey } from "../../storage/keys";
import type { ObjectStore } from "../../storage/object-store";
import { assertAllowance } from "../cdn/usage";
import type { MediaDelivery } from "../ports";
import { UploadRejected } from "../pipeline";
import { getMediaDelivery } from "../library/delivery";
import { publicMediaMime } from "../store/range";
import { runContentWrite } from "../library/run";
import { VIDEO_COPY } from "./copy";
import { captionsBytes, captionsKey } from "./job";
import { checkVtt, VTT_MAX_BYTES } from "./vtt";

const COLLECTION = "media_assets";
const CAPTIONS = "captions.vtt";
const VTT_TYPE = "text/vtt; charset=utf-8";

export type CaptionsDeps = {
  store?: ObjectStore;
  publicStore?: ObjectStore;
  delivery?: MediaDelivery;
  invalidator?: Invalidator;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function publicKey(orgId: string, id: string): string {
  return tenantPublicMediaKey(orgId, "video", id, "captions.vtt");
}

async function afterPublic(key: string, deps: CaptionsDeps): Promise<void> {
  try {
    await (deps.delivery ?? getMediaDelivery()).purge([key]);
  } catch {
    console.error("[video] captions purge failed");
  }
}

function invalidate(orgId: string, deps: CaptionsDeps): void {
  try {
    deps.invalidator?.invalidate([siteTag(orgId), liveTag(orgId)]);
  } catch {
    // Cached renders expire on their own.
  }
}

/** Add or replace the captions of an own video. */
export async function uploadVideoCaptions(
  ctx: OrgContext,
  videoId: string,
  bytes: Uint8Array,
  deps: CaptionsDeps = {},
): Promise<{ captions: "captions.vtt" }> {
  requirePermission(ctx, "content", "write");
  assertId(videoId);
  if (!(bytes instanceof Uint8Array) || bytes.length > VTT_MAX_BYTES) {
    throw new UploadRejected("type", VIDEO_COPY.captions);
  }
  const checked = checkVtt(bytes);
  if (!checked.ok) throw new UploadRejected("type", VIDEO_COPY.captions);
  const body = new TextEncoder().encode(checked.text);
  const store = deps.store ?? getObjectStore();

  const promotedKey = await runContentWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, videoId);
    if (row.kind !== "video") throw new NotFound();
    const before = await captionsBytes(store, ctx.orgId, row);
    const delta = body.length - before;
    if (delta > 0) {
      await assertAllowance(ctx, delta);
    }
    const key = captionsKey(ctx.orgId, row.id);
    await store.put(key, body, VTT_TYPE);
    try {
      await commit(
        pb,
        ctx,
        [
          {
            collection: COLLECTION,
            op: "update",
            id: row.id,
            body: {
              captions_path: CAPTIONS,
              bytes: Math.max(0, num(row.bytes) + delta),
            },
          },
        ],
        {
          action: `${COLLECTION}.captions`,
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { action: "set" },
        },
      );
    } catch (err) {
      // A replaced file cannot be restored; a new one is removed.
      if (before === 0) await store.delete(key).catch(() => undefined);
      throw err;
    }
    if (str(row.public_at) === "") return null;
    const pub = publicKey(ctx.orgId, row.id);
    await (deps.publicStore ?? getPublicMediaStore()).put(
      pub,
      body,
      publicMediaMime("captions.vtt"),
    );
    return pub;
  });
  if (promotedKey) await afterPublic(promotedKey, deps);
  invalidate(ctx.orgId, deps);
  return { captions: CAPTIONS };
}

/** Remove the captions of an own video (idempotent when it has none). */
export async function removeVideoCaptions(
  ctx: OrgContext,
  videoId: string,
  deps: CaptionsDeps = {},
): Promise<void> {
  requirePermission(ctx, "content", "write");
  assertId(videoId);
  const store = deps.store ?? getObjectStore();
  const promotedKey = await runContentWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, videoId);
    if (row.kind !== "video") throw new NotFound();
    if (str(row.captions_path) === "") return null;
    const before = await captionsBytes(store, ctx.orgId, row);
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "update",
          id: row.id,
          body: {
            captions_path: "",
            bytes: Math.max(0, num(row.bytes) - before),
          },
        },
      ],
      {
        action: `${COLLECTION}.captions`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { action: "remove" },
      },
    );
    await store.delete(captionsKey(ctx.orgId, row.id)).catch(() => undefined);
    if (str(row.public_at) === "") return null;
    const pub = publicKey(ctx.orgId, row.id);
    await (deps.publicStore ?? getPublicMediaStore())
      .delete(pub)
      .catch(() => undefined);
    return pub;
  });
  if (promotedKey) await afterPublic(promotedKey, deps);
  invalidate(ctx.orgId, deps);
}
