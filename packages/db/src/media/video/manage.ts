// Owner-side video actions (07-13; CONT-18, choices 2 and 12; invariant 1, T-07-13-06, -09).
//   - retryVideo: "Try again" on a `failed` video that still has its original (the second and
//     last attempt); anything else is InvalidInput, another org's id NotFound
//   - setVideoCover: a library-level cover (poster_asset) from an own ready, non-deleted image
//   - videoStates: the tile states 07-17 polls (waiting / optimizing / ready / failed /
//     failed-final), own video ids only
// Rows are always read with `organization = ctx.orgId` (scopedGet / bound filters).
import { InvalidInput, NotFound } from "@cds/core";
import type { OrgContext } from "../../context";
import { commit, scopedGet } from "../../content/shared";
import { assertId, requirePermission } from "../../repository";
import { getObjectStore } from "../../storage";
import type { ObjectStore } from "../../storage/object-store";
import type { VideoTranscoder } from "../ports";
import { IMAGE_ROW_KINDS } from "../library/list";
import { runContentRead, runContentWrite } from "../library/run";
import {
  enqueueVideo,
  MAX_VIDEO_ATTEMPTS,
  originalKey,
  videoJobState,
  type VideoJobState,
} from "./job";

const COLLECTION = "media_assets";
const ID_RE = /^[a-z0-9]{15}$/;
export const VIDEO_STATES_MAX = 200;

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const NO_RETRY = "This video can't be tried again. Upload it again as MP4.";

async function hasObject(store: ObjectStore, key: string): Promise<boolean> {
  const list = await store.list(key);
  return list.some((o) => o.key === key);
}

/** "Try again" on a failed video (the second, last attempt). */
export async function retryVideo(
  ctx: OrgContext,
  id: string,
  deps: { store?: ObjectStore; transcoder?: VideoTranscoder } = {},
): Promise<{ state: VideoJobState }> {
  requirePermission(ctx, "content", "write");
  assertId(id);
  const store = deps.store ?? getObjectStore();
  const state = await runContentWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (row.kind !== "video") throw new NotFound();
    if (
      row.status !== "failed" ||
      num(row.video_attempts) >= MAX_VIDEO_ATTEMPTS ||
      !(await hasObject(store, originalKey(ctx.orgId, row.id)))
    ) {
      throw new InvalidInput(NO_RETRY);
    }
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "update",
          id: row.id,
          body: { status: "processing", processing_started_at: "" },
        },
      ],
      {
        action: `${COLLECTION}.retry`,
        targetCollection: COLLECTION,
        targetId: row.id,
      },
    );
    return videoJobState({ ...row, status: "processing" });
  });
  enqueueVideo(ctx.orgId, id, deps);
  return { state };
}

/** Set (or clear with null) a video's library cover from an own ready image. */
export async function setVideoCover(
  ctx: OrgContext,
  videoId: string,
  imageId: string | null,
): Promise<void> {
  requirePermission(ctx, "content", "write");
  assertId(videoId);
  if (imageId !== null) assertId(imageId);
  await runContentWrite(ctx, async (pb) => {
    const video = await scopedGet(pb, ctx, COLLECTION, videoId);
    if (video.kind !== "video") throw new NotFound();
    if (imageId !== null) {
      const image = await scopedGet(pb, ctx, COLLECTION, imageId);
      if (
        !(IMAGE_ROW_KINDS as readonly string[]).includes(str(image.kind)) ||
        image.status !== "ready" ||
        str(image.deleted_at) !== ""
      ) {
        throw new NotFound();
      }
    }
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "update",
          id: video.id,
          body: { poster_asset: imageId ?? "" },
        },
      ],
      {
        action: `${COLLECTION}.cover`,
        targetCollection: COLLECTION,
        targetId: video.id,
        meta: { cover: imageId ?? "" },
      },
    );
  });
}

/** Tile states for own video ids (other kinds and foreign ids are absent). */
export async function videoStates(
  ctx: OrgContext,
  ids: readonly string[],
): Promise<Record<string, VideoJobState>> {
  requirePermission(ctx, "content", "read");
  const wanted = [
    ...new Set(
      (Array.isArray(ids) ? ids : []).filter(
        (i): i is string => typeof i === "string" && ID_RE.test(i),
      ),
    ),
  ].slice(0, VIDEO_STATES_MAX);
  if (wanted.length === 0) return {};
  return runContentRead(ctx, async (pb) => {
    const params: Record<string, string> = { org: ctx.orgId };
    const ors = wanted.map((id, i) => {
      params[`i${i}`] = id;
      return `id = {:i${i}}`;
    });
    // Only bound placeholders ({:iN}) are joined; every value goes through pb.filter params.
    const expr =
      'organization = {:org} && kind = "video" && (' + ors.join(" || ") + ")";
    const rows = await pb.collection(COLLECTION).getFullList({
      filter: pb.filter(expr, params),
      fields: "id,status,video_attempts,processing_started_at",
    });
    const out: Record<string, VideoJobState> = {};
    for (const r of rows) out[r.id] = videoJobState(r);
    return out;
  });
}
