// The video job (07-13; CONT-18, D220, CONTEXT resolution e, choices 2 and 6-8; RESEARCH
// Pitfall 5). The only writer of video job state. One video at a time runs on `videoQueue`
// (separate from imageQueue, so photo uploads never wait behind a video).
//
//   start    -> under the org lock: video_attempts + 1, processing_started_at = now
//   compress -> transcode to out.mp4, take a frame, sharp posters; derivatives go to the
//               PRIVATE store only (07-12 promote copies them at the first public publish)
//   success  -> under the lock: status ready, real size/duration, bytes = stored footprint;
//               then the private original.mp4 is deleted (D220)
//   failure  -> partial derivatives removed; attempts < 2: `failed`, original kept for one
//               retry; attempts >= 2: `failed` for good, original deleted, bytes = captions
//   row gone -> (deleted mid-job) every written object and the original are removed; no row
//               is written
// A missing ffmpeg (TranscoderUnavailable) does not consume the attempt: the row goes back to
// waiting, and the sweep / boot resume pick it up once the binary is there.
// Logs carry a fixed message and the asset id only: never keys, paths or ffmpeg stderr.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { getObjectStore } from "../../storage";
import { tenantMediaDerivativeKey, tenantMediaKey } from "../../storage/keys";
import type { ObjectStore } from "../../storage/object-store";
import type { VideoTranscoder } from "../ports";
import { videoQueue } from "../queue";
import {
  FRAME_TIMEOUT_MS,
  posterAtSeconds,
  TranscoderUnavailable,
  transcodeTimeoutMs,
} from "./ffmpeg";
import { makeVideoPosters } from "./poster";
import { getVideoTranscoder } from "./transcoder";
import { ensureWorkDir, removeWorkDir } from "./workdir";

const COLLECTION = "media_assets";
export const MAX_VIDEO_ATTEMPTS = 2;

export type VideoJobDeps = {
  store?: ObjectStore;
  transcoder?: VideoTranscoder;
};

export type VideoJobState =
  "waiting" | "optimizing" | "ready" | "failed" | "failed-final";

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ");
}

/** The UI state of one video row (choice 2). */
export function videoJobState(
  row: Readonly<Record<string, unknown>>,
): VideoJobState {
  const status = str(row.status);
  if (status === "ready") return "ready";
  if (status === "failed") {
    return num(row.video_attempts) >= MAX_VIDEO_ATTEMPTS
      ? "failed-final"
      : "failed";
  }
  return str(row.processing_started_at) !== "" ? "optimizing" : "waiting";
}

export function originalKey(orgId: string, id: string): string {
  return tenantMediaKey(orgId, id, "original.mp4");
}

export function captionsKey(orgId: string, id: string): string {
  return tenantMediaDerivativeKey(orgId, id, "captions.vtt");
}

/** Size of the private captions file (0 when none). Captions are at most 512 KB. */
export async function captionsBytes(
  store: ObjectStore,
  orgId: string,
  row: RecordModel,
): Promise<number> {
  if (str(row.captions_path) === "") return 0;
  const b = await store.get(captionsKey(orgId, row.id)).catch(() => null);
  return b ? b.length : 0;
}

// ------------------------------------------------------------------ in-process bookkeeping
const active = new Set<string>(); // queued or running in this process
const running = new Set<string>();
const inflight = new Set<Promise<void>>();

/** Queued or running in this process (the sweep and resume skip these). */
export function isVideoActive(id: string): boolean {
  return active.has(id);
}

/** Compressing right now in this process. */
export function isVideoRunning(id: string): boolean {
  return running.has(id);
}

/** Schedule one video on videoQueue; never awaited by the caller, never throws. */
export function enqueueVideo(
  orgId: string,
  id: string,
  deps: VideoJobDeps = {},
): void {
  if (active.has(id)) return;
  active.add(id);
  const job = videoQueue.run(() => runVideoJob(orgId, id, deps));
  const p: Promise<void> = job
    .catch(() => {
      console.error("[video] job failed", id);
    })
    .finally(() => {
      active.delete(id);
      inflight.delete(p);
    });
  inflight.add(p);
}

/** Tests and the exit seed only (import by path): wait until no video job is queued. */
export async function drainVideoQueue(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.all([...inflight]);
  }
}

async function loadRow(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<RecordModel | null> {
  const found = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id,
      org: orgId,
    }),
  });
  return found.items[0] ?? null;
}

function locked<T>(orgId: string, fn: (pb: PocketBase) => Promise<T>) {
  return withOrgLock(orgId, () => withSuperuser(fn));
}

async function removeAll(
  store: ObjectStore,
  keys: readonly string[],
): Promise<void> {
  await Promise.all(keys.map((k) => store.delete(k).catch(() => undefined)));
}

/**
 * Mark a video failed for good: the original is deleted and `bytes` is what is left (the
 * captions file or 0). Used by the job, the sweep and resume. Runs inside the caller's lock.
 */
export async function failFinalIn(
  pb: PocketBase,
  store: ObjectStore,
  orgId: string,
  row: RecordModel,
): Promise<void> {
  const left = await captionsBytes(store, orgId, row);
  await pb.collection(COLLECTION).update(row.id, {
    status: "failed",
    video_attempts: MAX_VIDEO_ATTEMPTS,
    processing_started_at: "",
    bytes: left,
  });
  await store.delete(originalKey(orgId, row.id)).catch(() => undefined);
}

/** Compress one video. Exported by path for tests; production goes through enqueueVideo. */
export async function runVideoJob(
  orgId: string,
  id: string,
  deps: VideoJobDeps = {},
): Promise<void> {
  const store = deps.store ?? getObjectStore();
  running.add(id);
  try {
    const started = await locked(orgId, async (pb) => {
      const row = await loadRow(pb, orgId, id);
      if (!row || row.kind !== "video" || row.status !== "processing") {
        return null;
      }
      const attempts = num(row.video_attempts) + 1;
      if (attempts > MAX_VIDEO_ATTEMPTS) {
        await failFinalIn(pb, store, orgId, row);
        return null;
      }
      await pb.collection(COLLECTION).update(id, {
        video_attempts: attempts,
        processing_started_at: nowStamp(),
      });
      return { row, attempts };
    });
    if (!started) return;
    const transcoder = deps.transcoder ?? getVideoTranscoder();

    const written: string[] = [];
    let footprint = 0;
    let result: { durationS: number; width: number; height: number };
    try {
      const dir = await ensureWorkDir(orgId, id);
      const input = join(dir, "input.mp4");
      if (!existsSync(input)) {
        const original = await store.get(originalKey(orgId, id));
        if (!original) throw new Error("original missing");
        await writeFile(input, original);
      }
      const out = join(dir, "out.mp4");
      const frame = join(dir, "frame.jpg");
      const t = await transcoder.transcode({
        inputPath: input,
        outputPath: out,
        timeoutMs: transcodeTimeoutMs(num(started.row.duration_s)),
      });
      await transcoder.extractFrame({
        inputPath: out,
        outputPath: frame,
        atSeconds: posterAtSeconds(t.durationS),
        timeoutMs: FRAME_TIMEOUT_MS,
      });
      const posters = await makeVideoPosters(
        new Uint8Array(await readFile(frame)),
      );
      const video = new Uint8Array(await readFile(out));
      const puts: [string, Uint8Array, string][] = [
        [tenantMediaDerivativeKey(orgId, id, "video.mp4"), video, "video/mp4"],
        [
          tenantMediaDerivativeKey(orgId, id, "poster.jpg"),
          posters.jpg,
          "image/jpeg",
        ],
        [
          tenantMediaDerivativeKey(orgId, id, "poster.webp"),
          posters.webp,
          "image/webp",
        ],
        [
          tenantMediaDerivativeKey(orgId, id, "thumb"),
          posters.thumb,
          "image/webp",
        ],
      ];
      for (const [key, body, type] of puts) {
        written.push(key);
        await store.put(key, body, type);
        footprint += body.length;
      }
      result = { durationS: t.durationS, width: t.width, height: t.height };
    } catch (err) {
      await removeAll(store, written);
      await locked(orgId, async (pb) => {
        const row = await loadRow(pb, orgId, id);
        if (!row) {
          await store.delete(originalKey(orgId, id)).catch(() => undefined);
          return;
        }
        if (err instanceof TranscoderUnavailable) {
          // Not the video's fault: give the attempt back and wait for the binary.
          await pb.collection(COLLECTION).update(id, {
            video_attempts: Math.max(0, started.attempts - 1),
            processing_started_at: "",
          });
          return;
        }
        if (started.attempts >= MAX_VIDEO_ATTEMPTS) {
          await failFinalIn(pb, store, orgId, row);
        } else {
          await pb.collection(COLLECTION).update(id, {
            status: "failed",
            processing_started_at: "",
          });
        }
      });
      console.error("[video] compression failed", id);
      return;
    }

    const kept = await locked(orgId, async (pb) => {
      const row = await loadRow(pb, orgId, id);
      if (!row) return false;
      const captions = await captionsBytes(store, orgId, row);
      await pb.collection(COLLECTION).update(id, {
        status: "ready",
        width: result.width,
        height: result.height,
        duration_s: Math.round(result.durationS),
        processing_started_at: "",
        bytes: footprint + captions,
      });
      return true;
    });
    if (!kept) {
      // Deleted while compressing: discard everything this job wrote.
      await removeAll(store, [...written, originalKey(orgId, id)]);
      return;
    }
    await store.delete(originalKey(orgId, id)).catch(() => undefined);
  } finally {
    running.delete(id);
    await removeWorkDir(orgId, id).catch(() => undefined);
  }
}
