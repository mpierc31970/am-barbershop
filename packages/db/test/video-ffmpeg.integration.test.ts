// The real ffmpeg round trip (07-13; CONT-18, choices 5-8; T-07-13-02, -05). Runs only where
// ffmpeg and ffprobe are installed (the Docker image; CI images with ffmpeg); skipped, never
// failed, elsewhere. A lavfi test clip goes through createVideoFromUpload with the selector's
// ffmpeg transcoder; the stored video.mp4 is then checked with ffprobe: H.264 High, AAC,
// yuv420p, at most 30 fps, at most 1920x1080 (portrait stays portrait), +faststart (moov
// before mdat) and no location / creation_time tags.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { createVideoFromUpload, getVideoTranscoder } from "../src/media/video";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantMediaDerivativeKey } from "../src/storage/keys";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import {
  drainVideoQueue,
  hasFfmpeg,
  makeTestClip,
  withFinishedUpload,
} from "./video-helpers";

const FFPROBE = process.env.CDS_FFPROBE_PATH || "ffprobe";
const enabled = hasFfmpeg();

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let work = "";
let store: LocalDiskStore;

function ctxFor(org: string): OrgContext {
  return mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

type Probe = {
  streams: {
    codec_type: string;
    codec_name: string;
    profile?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
  }[];
  format: { tags?: Record<string, string> };
};

function ffprobe(path: string): Probe {
  const r = spawnSync(
    FFPROBE,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      path,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(r.stdout) as Probe;
}

function boxOffset(bytes: Uint8Array, type: string): number {
  let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (name === type) return at;
    if (size < 8) return -1;
    at += size;
  }
  return -1;
}

async function roundTrip(w: number, h: number): Promise<{ file: string }> {
  const org = (
    await pb.collection("organizations").create({
      name: "FF Co",
      slug: `ff-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  const ctx = ctxFor(org);
  const clip = makeTestClip(work, { w, h, seconds: 3 });
  const finished = await withFinishedUpload(
    ctx,
    new Uint8Array(readFileSync(clip)),
  );
  const { asset } = await createVideoFromUpload(ctx, finished, {
    store,
    transcoder: getVideoTranscoder(),
  });
  await drainVideoQueue();
  const row = await pb.collection("media_assets").getOne(asset.id);
  expect(row.status).toBe("ready");
  const bytes = await store.get(
    tenantMediaDerivativeKey(org, asset.id, "video.mp4"),
  );
  expect(bytes).not.toBeNull();
  const file = join(work, `out-${asset.id}.mp4`);
  writeFileSync(file, bytes!);
  return { file };
}

describe.skipIf(!enabled)("real ffmpeg round trip (CONT-18)", () => {
  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    resetClientForTests();
    pb = await superuser();
    seed = await seedTwoOrgs(pb);
    root = mkdtempSync(join(tmpdir(), "cds-ffvideo-"));
    work = mkdtempSync(join(tmpdir(), "cds-ffwork-"));
    store = new LocalDiskStore(root);
  }, 60_000);

  afterAll(async () => {
    await drainVideoQueue();
    await inst?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("compresses to faststart H.264 High / AAC / yuv420p, <= 30 fps, metadata stripped", async (t) => {
    if (!inst) return t.skip();
    const { file } = await roundTrip(640, 360);
    const p = ffprobe(file);
    const v = p.streams.find((s) => s.codec_type === "video")!;
    const a = p.streams.find((s) => s.codec_type === "audio")!;
    expect(v.codec_name).toBe("h264");
    expect(v.profile).toBe("High");
    expect(v.pix_fmt).toBe("yuv420p");
    const [num, den] = (v.avg_frame_rate ?? "0/1").split("/").map(Number);
    expect(num! / den!).toBeLessThanOrEqual(30.01);
    expect(a.codec_name).toBe("aac");
    const bytes = new Uint8Array(readFileSync(file));
    const moov = boxOffset(bytes, "moov");
    const mdat = boxOffset(bytes, "mdat");
    expect(moov).toBeGreaterThan(-1);
    expect(moov).toBeLessThan(mdat);
    const tags = p.format.tags ?? {};
    expect(tags.location).toBeUndefined();
    expect(tags.creation_time).toBeUndefined();
  }, 120_000);

  it("a 2560x1440 clip comes out 1920x1080", async (t) => {
    if (!inst) return t.skip();
    const { file } = await roundTrip(2560, 1440);
    const v = ffprobe(file).streams.find((s) => s.codec_type === "video")!;
    expect([v.width, v.height]).toEqual([1920, 1080]);
  }, 180_000);

  it("a portrait 1080x1920 clip stays portrait", async (t) => {
    if (!inst) return t.skip();
    const { file } = await roundTrip(1080, 1920);
    const v = ffprobe(file).streams.find((s) => s.codec_type === "video")!;
    expect(v.height!).toBeGreaterThan(v.width!);
    expect(v.height!).toBeLessThanOrEqual(1920);
  }, 180_000);
});
