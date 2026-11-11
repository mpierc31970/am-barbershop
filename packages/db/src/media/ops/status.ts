// Media monitor status (07-27; D174, D175; CONTEXT lines 108-116; T-07-27-08). Monitor-safe:
// counts and enums only, never an org id, name, key, URL or address. The future
// `GET /api/monitor/status` puts this under `media` (MONITOR-APP-BRIEF.md §4, check 17).
// Every filter is bound through pb.filter; list reads are capped.
import { withSuperuser } from "../../client";
import { readPlatformMeta } from "../../platform-meta";
import { deliveryMode, readCdnDownSince } from "../cdn/mode";
import { getMediaDelivery } from "../library/delivery";
import type { MediaDelivery } from "../ports";
import { stuckThresholdMs } from "../video/ffmpeg";
import { mediaOriginErrorsSince } from "./counters";

export type MediaStatus = {
  cdn: "app" | "bunny";
  cdn_status: "ok" | "down";
  fallback_active: boolean;
  fallback_since: string | null;
  video_paused: boolean;
  origin_errors_1h: number;
  compress_failures_24h: number;
  stuck_videos: number;
  over_allowance: number;
  job_last_success: string | null;
};

const DAY = 24 * 3_600_000;
const STUCK_SCAN_MAX = 500;

function stamp(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const t = Date.parse(v.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

function overAllowanceFrom(raw: string | null): number {
  if (!raw) return 0;
  try {
    const v = (JSON.parse(raw) as { overAllowanceAlerted?: unknown })
      .overAllowanceAlerted;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}

export async function mediaStatus(
  opts: { now?: Date; delivery?: MediaDelivery } = {},
): Promise<MediaStatus> {
  const now = opts.now ?? new Date();
  const delivery = opts.delivery ?? getMediaDelivery();
  const cdn = delivery.name;
  const since = cdn === "bunny" ? await readCdnDownSince() : null;
  const mode = deliveryMode(now, since);

  const { compress, stuck } = await withSuperuser(async (pb) => {
    const failed = await pb.collection("media_assets").getList(1, 1, {
      filter: pb.filter(
        "kind = 'video' && status = 'failed' && updated >= {:since}",
        { since: new Date(now.getTime() - DAY) },
      ),
      fields: "id",
    });
    const processing = await pb
      .collection("media_assets")
      .getList(1, STUCK_SCAN_MAX, {
        filter: pb.filter("kind = 'video' && status = {:s}", {
          s: "processing",
        }),
        fields: "duration_s,processing_started_at,updated",
        skipTotal: true,
      });
    let n = 0;
    for (const row of processing.items) {
      const start =
        stamp(row.processing_started_at) ?? stamp(row.updated) ?? null;
      if (start === null) continue;
      const dur = typeof row.duration_s === "number" ? row.duration_s : 0;
      if (now.getTime() - start > stuckThresholdMs(dur)) n += 1;
    }
    return { compress: failed.totalItems, stuck: n };
  });

  return {
    cdn,
    cdn_status: since ? "down" : "ok",
    fallback_active: since !== null,
    fallback_since: since ? since.toISOString() : null,
    video_paused: mode === "origin-video-paused",
    origin_errors_1h: mediaOriginErrorsSince(now.getTime()),
    compress_failures_24h: compress,
    stuck_videos: stuck,
    over_allowance: overAllowanceFrom(
      await readPlatformMeta("job:media:last_counts"),
    ),
    job_last_success:
      (await readPlatformMeta("job:media:last_success")) || null,
  };
}
