// Stuck and interrupted video jobs (07-13; CONTEXT resolution e; T-07-13-10).
//   - sweepStuckVideos: 07-27's `/api/jobs/media` calls it hourly. A `processing` video whose
//     start (or last update, when it never started) is older than max(30 min, 4 x duration)
//     is re-queued once (attempts < 2), else failed for good with its original deleted
//   - resumeVideoJobs: `apps/web/instrumentation.ts` calls it once at boot. Every `processing`
//     video not queued in this process is re-queued (attempts < 2) or failed, whatever its age
// Rows queued or running in this process are never touched. Both mint their own system
// context (the runQuoteJobs shape), catch per-row errors and log counts only.
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { assertSystemContext, mintSystemContext } from "../../context";
import { getObjectStore } from "../../storage";
import { stuckThresholdMs } from "./ffmpeg";
import {
  enqueueVideo,
  failFinalIn,
  isVideoActive,
  MAX_VIDEO_ATTEMPTS,
  type VideoJobDeps,
} from "./job";

const COLLECTION = "media_assets";

export type VideoSweepResult = { requeued: number; failed: number };

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseStamp(v: unknown): number | null {
  const s = str(v);
  if (s === "") return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

async function processingRows(): Promise<RecordModel[]> {
  return withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter('kind = "video" && status = {:s}', { s: "processing" }),
      fields:
        "id,organization,duration_s,video_attempts,processing_started_at,updated",
    }),
  );
}

async function requeueOrFail(
  row: RecordModel,
  deps: VideoJobDeps,
): Promise<"requeued" | "failed" | "skipped"> {
  const orgId = str(row.organization);
  const store = deps.store ?? getObjectStore();
  const outcome = await withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      // Re-read under the lock: the job may have moved on since the list.
      const found = await pb.collection(COLLECTION).getList(1, 1, {
        filter: pb.filter("id = {:id} && organization = {:org}", {
          id: row.id,
          org: orgId,
        }),
      });
      const cur = found.items[0];
      if (!cur || cur.status !== "processing" || isVideoActive(cur.id)) {
        return "skipped" as const;
      }
      if (num(cur.video_attempts) >= MAX_VIDEO_ATTEMPTS) {
        await failFinalIn(pb, store, orgId, cur);
        return "failed" as const;
      }
      await pb
        .collection(COLLECTION)
        .update(cur.id, { processing_started_at: "" });
      return "requeued" as const;
    }),
  );
  if (outcome === "requeued") enqueueVideo(orgId, row.id, deps);
  return outcome;
}

async function sweep(
  job: string,
  pick: (row: RecordModel) => boolean,
  deps: VideoJobDeps,
): Promise<VideoSweepResult> {
  const sys = mintSystemContext({ job });
  assertSystemContext(sys);
  const result: VideoSweepResult = { requeued: 0, failed: 0 };
  let rows: RecordModel[];
  try {
    rows = await processingRows();
  } catch {
    console.error(`[video] ${job}: listing failed`);
    return result;
  }
  for (const row of rows) {
    if (isVideoActive(row.id) || !pick(row)) continue;
    try {
      const outcome = await requeueOrFail(row, deps);
      if (outcome === "requeued") result.requeued += 1;
      else if (outcome === "failed") result.failed += 1;
    } catch {
      console.error(`[video] ${job}: row failed`, row.id);
    }
  }
  console.info(
    `[video] ${job}: ${result.requeued} requeued, ${result.failed} failed`,
  );
  return result;
}

/** Hourly (07-27): recover videos stuck past max(30 min, 4 x duration). */
export async function sweepStuckVideos(
  opts: { now?: Date; deps?: VideoJobDeps } = {},
): Promise<VideoSweepResult> {
  const now = (opts.now ?? new Date()).getTime();
  return sweep(
    "media-video",
    (row) => {
      const since =
        parseStamp(row.processing_started_at) ?? parseStamp(row.updated);
      if (since === null) return true;
      return now - since > stuckThresholdMs(num(row.duration_s));
    },
    opts.deps ?? {},
  );
}

/** Boot (instrumentation.ts): pick up every video that was waiting or running. */
export async function resumeVideoJobs(
  deps: VideoJobDeps = {},
): Promise<VideoSweepResult> {
  return sweep("media-video-resume", () => true, deps);
}
