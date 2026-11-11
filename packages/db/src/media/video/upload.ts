// A finished chunked upload becomes a video (07-13; CONT-18, CONT-19, D278, RESEARCH Pitfall
// 1, choices 3-4; PATTERNS G12 order: permission -> checks -> allowance -> object -> lock + row
// + audit -> cleanup on failure). The upload itself came through 07-12's chunks.ts
// (FinishedUpload, purpose "video"): this module never appends parts.
//   - MP4 by magic bytes (`ftyp`), then ffprobe must see a video stream (UPL-VIDEO-TYPE)
//   - the org's allowance (2 GB + packs, mediaAllowance via mediaUsage; 10-33): assertAllowance
//     first and again under the org lock
//   - the assembled file is stored durably as the PRIVATE original.mp4 (a retry or a restart
//     never depends on /tmp), then moved into the job's work dir as its input
//   - the row is `processing` at once; enqueueVideo runs after it commits
// No orphan objects: a failure after the put deletes the original. The temp folder always goes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInput } from "@cds/core";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../../context";
import { commit } from "../../content/shared";
import { newRecordId, requirePermission } from "../../repository";
import { getObjectStore } from "../../storage";
import type { ObjectStore } from "../../storage/object-store";
import { assertAllowance } from "../cdn/usage";
import type { VideoTranscoder } from "../ports";
import { UploadRejected } from "../pipeline";
import { cleanFileName } from "../library/alt";
import type { FinishedUpload } from "../library/chunks";
import { runContentWrite } from "../library/run";
import { VIDEO_COPY, VIDEO_MAX_BYTES } from "./copy";
import {
  enqueueVideo,
  originalKey,
  videoJobState,
  type VideoJobState,
} from "./job";
import { readHead, sniffMp4 } from "./mp4";
import { getVideoTranscoder } from "./transcoder";
import { ensureWorkDir, moveInto, removeWorkDir } from "./workdir";

const COLLECTION = "media_assets";

export type VideoAsset = {
  id: string;
  kind: "video";
  name: string;
  status: string;
  bytes: number;
  width: number;
  height: number;
  durationS: number;
  url: string;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function toVideoAsset(row: RecordModel): VideoAsset {
  return {
    id: row.id,
    kind: "video",
    name: str(row.name),
    status: str(row.status),
    bytes: num(row.bytes),
    width: num(row.width),
    height: num(row.height),
    durationS: num(row.duration_s),
    url: `/hub/media/${row.id}/thumb`,
  };
}

export type VideoUploadDeps = {
  store?: ObjectStore;
  transcoder?: VideoTranscoder;
};

/** One finished chunked MP4 upload into the private store as a `processing` video. */
export async function createVideoFromUpload(
  ctx: OrgContext,
  finished: FinishedUpload,
  deps: VideoUploadDeps = {},
): Promise<{ asset: VideoAsset; state: VideoJobState }> {
  requirePermission(ctx, "content", "write");
  try {
    if (!finished || finished.purpose !== "video") {
      throw new InvalidInput("not a video upload");
    }
    if (
      !Number.isSafeInteger(finished.size) ||
      finished.size <= 0 ||
      finished.size > VIDEO_MAX_BYTES
    ) {
      throw new UploadRejected("type", VIDEO_COPY.type);
    }
    if (!sniffMp4(await readHead(finished.path))) {
      throw new UploadRejected("type", VIDEO_COPY.type);
    }
    const transcoder = deps.transcoder ?? getVideoTranscoder();
    const probe = await transcoder.probe(finished.path);
    if (!probe.hasVideoStream) {
      throw new UploadRejected("type", VIDEO_COPY.type);
    }
    await assertAllowance(ctx, finished.size);

    const store = deps.store ?? getObjectStore();
    const id = newRecordId();
    const key = originalKey(ctx.orgId, id);
    const bytes = new Uint8Array(await readFile(finished.path));
    if (bytes.length !== finished.size) {
      throw new UploadRejected("type", VIDEO_COPY.type);
    }
    await store.put(key, bytes, "video/mp4");

    let row: RecordModel;
    try {
      row = await runContentWrite(ctx, async (pb) => {
        await assertAllowance(ctx, bytes.length);
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
                kind: "video",
                storage_dir: `tenants/${ctx.orgId}/media/${id}`,
                original_ext: "mp4",
                width: Math.max(0, Math.round(probe.width)),
                height: Math.max(0, Math.round(probe.height)),
                web_width: 0,
                web_height: 0,
                bytes: bytes.length,
                mime: "video/mp4",
                alt: "",
                name: cleanFileName(finished.filename),
                source: "library",
                status: "processing",
                duration_s: Math.max(0, Math.round(probe.durationS)),
                video_attempts: 0,
                processing_started_at: "",
                sort_order: 0,
              },
            },
          ],
          {
            action: `${COLLECTION}.create`,
            targetCollection: COLLECTION,
            targetId: id,
            meta: { kind: "video", bytes: bytes.length },
          },
        );
        return pb.collection(COLLECTION).getOne(id);
      });
    } catch (err) {
      await store.delete(key).catch(() => undefined);
      throw err;
    }

    // Hand the assembled file to the job as its input (saves a read of the original).
    try {
      const dir = await ensureWorkDir(ctx.orgId, id);
      await moveInto(finished.path, join(dir, "input.mp4"));
    } catch {
      await removeWorkDir(ctx.orgId, id).catch(() => undefined);
    }
    enqueueVideo(ctx.orgId, id, deps);
    return { asset: toVideoAsset(row), state: videoJobState(row) };
  } finally {
    await finished?.cleanup().catch(() => undefined);
  }
}
