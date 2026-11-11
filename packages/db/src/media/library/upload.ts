// Media library uploads (07-12; CONT-14, CONT-19, CONT-27, D255, D278, D-UI-P7-5; RESEARCH
// Pitfall 10, resolution d). Library photos and MP3s are website content: `"content", "write"`
// (Owner / Admin / Editor); intake kinds keep business write in assets.ts.
//   - every object goes to the PRIVATE store; publish promotes what a public page uses
//   - `bytes` is the stored footprint (original + every derivative), counted once
//   - the org's allowance (2 GB + packs, mediaAllowance via mediaUsage; 10-33): assertAllowance
//     before decoding and again under the lock
//   - a photo without a description lands flagged `needsDescription` (the describe list
//     backfills it; D280)
//   - 13-11 (STAFF-23, STAFF-25): every library photo goes through the ImageModerator
//     (moderate.ts, 2 s timeout) before its row commits; held -> status `held` + flag, an
//     outage -> flag `queued`; the stand-in returns `skipped` and never blocks
// No orphan objects: a failure after a put deletes what was written.
import { readFile } from "node:fs/promises";
import { InvalidInput } from "@cds/core";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../../context";
import type { ImageModerator } from "../../content/ports";
import { commit } from "../../content/shared";
import { newRecordId, requirePermission } from "../../repository";
import { getObjectStore, type ObjectStore } from "../../storage";
import { tenantMediaDerivativeKey, tenantMediaKey } from "../../storage/keys";
import {
  cleanAlt,
  removeKeys,
  storeImageObjects,
  type MediaAsset,
} from "../assets";
import { assertAllowance } from "../cdn/usage";
import {
  MAX_UPLOAD_BYTES,
  originalFile,
  processImage,
  UPLOAD_COPY,
  UploadRejected,
} from "../pipeline";
import { cleanFileName } from "./alt";
import { AUDIO_COPY, AUDIO_MAX_BYTES, type FinishedUpload } from "./chunks";
import { moderateImage } from "./moderate";
import { mp3Info } from "./mp3";
import { runContentWrite } from "./run";

export { AUDIO_COPY, AUDIO_MAX_BYTES } from "./chunks";

const COLLECTION = "media_assets";

export type LibraryAsset = Omit<MediaAsset, "kind"> & {
  kind: "library" | "audio";
  name: string;
  status: string;
  durationS: number;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toLibraryAsset(row: RecordModel): LibraryAsset {
  const audio = row.kind === "audio";
  return {
    id: row.id,
    kind: audio ? "audio" : "library",
    width: num(row.width),
    height: num(row.height),
    webWidth: num(row.web_width),
    webHeight: num(row.web_height),
    bytes: num(row.bytes),
    mime: str(row.mime),
    alt: str(row.alt),
    sortOrder: num(row.sort_order),
    url: audio
      ? `/hub/media/${row.id}/audio.mp3`
      : `/hub/media/${row.id}/thumb`,
    name: str(row.name),
    status: str(row.status),
    durationS: num(row.duration_s),
  };
}

/** One library photo into the private store, flagged when it has no description. */
export async function uploadLibraryImage(
  ctx: OrgContext,
  bytes: Uint8Array,
  opts: {
    alt?: string;
    filename?: string;
    store?: ObjectStore;
    /** 07-23: "link" for a cover copied from a pasted video link. */
    source?: "library" | "link";
    /** 13-11: defaults to getImageModerator() (stand-in: skipped). */
    moderator?: ImageModerator;
    moderationTimeoutMs?: number;
  } = {},
): Promise<{ asset: LibraryAsset; needsDescription: boolean }> {
  requirePermission(ctx, "content", "write");
  const source = opts.source ?? "library";
  if (source !== "library" && source !== "link") {
    throw new InvalidInput("That media source isn't allowed.");
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new UploadRejected("type", UPLOAD_COPY.type);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected("too_big", UPLOAD_COPY.tooBig(bytes.length));
  }
  const alt = cleanAlt(opts.alt);
  const name = cleanFileName(opts.filename ?? "");
  const store = opts.store ?? getObjectStore();
  await assertAllowance(ctx, bytes.length);

  const img = await processImage(bytes);
  const { ext, mime } = originalFile(img.format);
  const id = newRecordId();

  // 13-11: moderate the web variant before taking the org lock (a slow provider waits at most
  // the timeout, never inside the lock). The flag commits with the asset row.
  const moderation = await moderateImage(
    ctx,
    { id, url: tenantMediaKey(ctx.orgId, id, "web.webp"), bytes: img.web.data },
    {
      ...(opts.moderator ? { moderator: opts.moderator } : {}),
      ...(opts.moderationTimeoutMs
        ? { timeoutMs: opts.moderationTimeoutMs }
        : {}),
    },
  );

  return runContentWrite(ctx, async (pb) => {
    const stored = await storeImageObjects(
      store,
      ctx.orgId,
      id,
      img,
      ext,
      mime,
    );
    try {
      await assertAllowance(ctx, stored.footprint);
      await commit(
        pb,
        ctx,
        [
          {
            collection: COLLECTION,
            op: "create",
            id,
            body: {
              organization: ctx.orgId,
              kind: "library",
              storage_dir: `tenants/${ctx.orgId}/media/${id}`,
              original_ext: ext,
              width: img.width,
              height: img.height,
              web_width: img.web.width,
              web_height: img.web.height,
              bytes: stored.footprint,
              mime,
              alt,
              name,
              source,
              status: moderation.held ? "held" : "ready",
              sort_order: 0,
            },
          },
          ...(moderation.flag
            ? [
                {
                  collection: "content_flags",
                  op: "create" as const,
                  id: newRecordId(),
                  body: moderation.flag,
                },
              ]
            : []),
        ],
        {
          action: `${COLLECTION}.create`,
          targetCollection: COLLECTION,
          targetId: id,
          meta: {
            kind: "library",
            bytes: stored.footprint,
            ...(moderation.held ? { held: true } : {}),
          },
        },
      );
    } catch (err) {
      await removeKeys(store, stored.keys);
      throw err;
    }
    const row = await pb.collection(COLLECTION).getOne(id);
    return { asset: toLibraryAsset(row), needsDescription: alt === "" };
  });
}

/** A finished chunked MP3 upload into the private store as an `audio` asset. */
export async function uploadLibraryAudio(
  ctx: OrgContext,
  finished: FinishedUpload,
  opts: { store?: ObjectStore } = {},
): Promise<{ asset: LibraryAsset }> {
  requirePermission(ctx, "content", "write");
  try {
    if (finished.purpose !== "audio" || finished.size > AUDIO_MAX_BYTES) {
      throw new UploadRejected("type", AUDIO_COPY);
    }
    const bytes = new Uint8Array(await readFile(finished.path));
    if (bytes.length !== finished.size || bytes.length > AUDIO_MAX_BYTES) {
      throw new UploadRejected("type", AUDIO_COPY);
    }
    const info = mp3Info(bytes);
    if (!info) throw new UploadRejected("type", AUDIO_COPY);
    const store = opts.store ?? getObjectStore();
    const id = newRecordId();
    const key = tenantMediaDerivativeKey(ctx.orgId, id, "audio.mp3");

    return await runContentWrite(ctx, async (pb) => {
      await assertAllowance(ctx, bytes.length);
      await store.put(key, bytes, "audio/mpeg");
      try {
        await commit(
          pb,
          ctx,
          [
            {
              collection: COLLECTION,
              op: "create",
              id,
              body: {
                organization: ctx.orgId,
                kind: "audio",
                storage_dir: `tenants/${ctx.orgId}/media/${id}`,
                original_ext: "mp3",
                width: 0,
                height: 0,
                web_width: 0,
                web_height: 0,
                bytes: bytes.length,
                mime: "audio/mpeg",
                alt: "",
                name: cleanFileName(finished.filename),
                source: "library",
                status: "ready",
                duration_s: info.durationS,
                sort_order: 0,
              },
            },
          ],
          {
            action: `${COLLECTION}.create`,
            targetCollection: COLLECTION,
            targetId: id,
            meta: { kind: "audio", bytes: bytes.length },
          },
        );
      } catch (err) {
        await removeKeys(store, [key]);
        throw err;
      }
      const row = await pb.collection(COLLECTION).getOne(id);
      return { asset: toLibraryAsset(row) };
    });
  } finally {
    await finished.cleanup().catch(() => undefined);
  }
}
