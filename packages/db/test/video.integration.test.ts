// The video pipeline on the real PocketBase 0.39.11 binary with the fake transcoder (07-13;
// CONT-18, CONT-19, D220, CONTEXT resolution e; invariant 1; T-07-13-04, -06, -10): create from
// a chunked upload, the processing -> ready / failed state machine, retry-once, the original
// deleted after success, delete during a job, the stuck sweep and boot resume, captions
// (private and post-promotion public), the library cover and the tile states.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { recordingInvalidator } from "../src/content/ports";
import { UploadRejected } from "../src/media";
import { AllowanceExceeded, MEDIA_ALLOWANCE_BYTES } from "../src/media/cdn";
import { deleteMediaAsset } from "../src/media/library";
import { chunkUploadRoot } from "../src/media/library/chunks";
import type { MediaDelivery } from "../src/media/ports";
import { imageQueue } from "../src/media/queue";
import {
  createVideoFromUpload,
  removeVideoCaptions,
  resumeVideoJobs,
  retryVideo,
  setVideoCover,
  sweepStuckVideos,
  uploadVideoCaptions,
  VIDEO_COPY,
  videoStates,
  VTT_MAX_BYTES,
} from "../src/media/video";
import { createFakeTranscoder } from "../src/media/video/fake";
import { TranscoderUnavailable } from "../src/media/video/ffmpeg";
import { videoWorkRoot } from "../src/media/video/workdir";
import { LocalDiskStore } from "../src/storage/local-disk";
import type { ObjectStore } from "../src/storage/object-store";
import {
  tenantMediaDerivativeKey,
  tenantMediaKey,
  tenantPublicMediaKey,
} from "../src/storage/keys";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import {
  deferred,
  drainVideoQueue,
  fakeMp4Bytes,
  withFinishedUpload,
} from "./video-helpers";

const IP = "127.0.0.1";
const MIN = 60 * 1000;
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root = "";
let store: LocalDiskStore;
let publicRoot = "";
let publicStore: LocalDiskStore;
const registry = composeSectionRegistry(CORE_SECTIONS, []);

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<string> {
  return (
    await pb.collection("organizations").create({
      name: "Video Co",
      slug: `vid-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
}

const VTT = new TextEncoder().encode(
  "WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nHello there\r\n",
);

function originalOf(org: string, id: string): string {
  return tenantMediaKey(org, id, "original.mp4");
}

async function keysOf(org: string, id: string): Promise<string[]> {
  const prefix = tenantMediaKey(org, id, "web.webp").slice(
    0,
    -"web.webp".length,
  );
  return (await store.list(prefix)).map((o) => o.key.slice(prefix.length));
}

async function sizeOf(org: string, id: string): Promise<number> {
  const prefix = tenantMediaKey(org, id, "web.webp").slice(
    0,
    -"web.webp".length,
  );
  let total = 0;
  for (const o of await store.list(prefix)) {
    total += (await store.get(o.key))!.length;
  }
  return total;
}

/** Every private media object of one org (env prefix included). */
function orgMediaPrefix(org: string): string {
  const key = tenantMediaKey(org, "aaaaaaaaaaaaaaa", "web.webp");
  return key.slice(0, key.indexOf("/media/") + "/media/".length);
}

function chunkDirs(org: string): string[] {
  const dir = join(chunkUploadRoot(), org);
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** A processing video row seeded directly, with its original stored. */
async function seedProcessing(
  org: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const rec = await pb.collection("media_assets").create({
    organization: org,
    kind: "video",
    status: "processing",
    source: "library",
    original_ext: "mp4",
    mime: "video/mp4",
    storage_dir: `tenants/${org}/media/x`,
    bytes: 4096,
    duration_s: 60,
    video_attempts: 0,
    ...fields,
  });
  await store.put(originalOf(org, rec.id), fakeMp4Bytes(4096));
  return rec.id;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ");
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-video-"));
  store = new LocalDiskStore(root);
  publicRoot = mkdtempSync(join(tmpdir(), "cds-video-pub-"));
  publicStore = new LocalDiskStore(publicRoot);
});

afterEach(async () => {
  await drainVideoQueue();
});

afterAll(async () => {
  await drainVideoQueue();
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
  if (publicRoot) rmSync(publicRoot, { recursive: true, force: true });
});

describe("createVideoFromUpload (CONT-18, CONT-19)", () => {
  it("an Editor's finished upload becomes a processing video with its original stored", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "editor");
    const gate = deferred();
    const transcoder = createFakeTranscoder({
      gate: () => gate.promise,
      probe: () => ({
        hasVideoStream: true,
        durationS: 12.6,
        width: 1920,
        height: 1080,
      }),
    });
    const bytes = fakeMp4Bytes(20_000);
    const finished = await withFinishedUpload(ctx, bytes);
    const { asset, state } = await createVideoFromUpload(ctx, finished, {
      store,
      transcoder,
    });
    expect(["waiting", "optimizing"]).toContain(state);
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.kind).toBe("video");
    expect(row.source).toBe("library");
    expect(row.status).toBe("processing");
    expect(row.mime).toBe("video/mp4");
    expect(row.original_ext).toBe("mp4");
    expect(row.name).toBe("Holiday Clip.mp4");
    expect(row.duration_s).toBe(13);
    expect(row.bytes).toBe(bytes.length);
    expect(row.organization).toBe(org);
    expect(await store.get(originalOf(org, asset.id))).toEqual(bytes);
    expect(chunkDirs(org)).toEqual([]);
    gate.resolve();
  });

  it("with the fake transcoder the job ends ready: derivatives stored, original deleted, bytes = stored", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const transcoder = createFakeTranscoder({
      result: { durationS: 9.4, width: 1280, height: 720 },
    });
    const finished = await withFinishedUpload(ctx, fakeMp4Bytes(10_000));
    const { asset } = await createVideoFromUpload(ctx, finished, {
      store,
      transcoder,
    });
    await drainVideoQueue();
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("ready");
    expect(row.video_attempts).toBe(1);
    expect(row.processing_started_at).toBe("");
    expect(row.width).toBe(1280);
    expect(row.height).toBe(720);
    expect(row.duration_s).toBe(9);
    expect((await keysOf(org, asset.id)).sort()).toEqual([
      "poster.jpg",
      "poster.webp",
      "thumb.webp",
      "video.mp4",
    ]);
    expect(row.bytes).toBe(await sizeOf(org, asset.id));
    expect(existsSync(join(videoWorkRoot(), org, asset.id))).toBe(false);
    expect((await videoStates(ctx, [asset.id]))[asset.id]).toBe("ready");
  });

  it("refuses a file without ftyp with UPL-VIDEO-TYPE and leaves nothing behind", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const avi = new TextEncoder().encode(`RIFF....AVI LIST${"x".repeat(200)}`);
    const finished = await withFinishedUpload(ctx, avi);
    const err = await createVideoFromUpload(ctx, finished, {
      store,
      transcoder: createFakeTranscoder(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect((err as UploadRejected).message).toBe(VIDEO_COPY.type);
    expect(
      await pb
        .collection("media_assets")
        .getFullList({ filter: pb.filter("organization = {:o}", { o: org }) }),
    ).toEqual([]);
    expect(chunkDirs(org)).toEqual([]);
    expect(await store.list(orgMediaPrefix(org))).toEqual([]);
  });

  it("refuses an ftyp file where the probe finds no video stream", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const finished = await withFinishedUpload(ctx, fakeMp4Bytes(2048));
    await expect(
      createVideoFromUpload(ctx, finished, {
        store,
        transcoder: createFakeTranscoder({
          probe: () => ({
            hasVideoStream: false,
            durationS: 0,
            width: 0,
            height: 0,
          }),
        }),
      }),
    ).rejects.toThrow(VIDEO_COPY.type);
    expect(chunkDirs(org)).toEqual([]);
    expect(await store.list(orgMediaPrefix(org))).toEqual([]);
  });

  it("a non-video upload is InvalidInput, a Viewer is Forbidden, a missing ffprobe propagates", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const f1 = await withFinishedUpload(ctx, fakeMp4Bytes(2048));
    await expect(
      createVideoFromUpload(
        ctx,
        { ...f1, purpose: "audio" },
        { store, transcoder: createFakeTranscoder() },
      ),
    ).rejects.toThrow(InvalidInput);
    const f2 = await withFinishedUpload(ctx, fakeMp4Bytes(2048));
    await expect(
      createVideoFromUpload(ctxAs(org, "viewer"), f2, {
        store,
        transcoder: createFakeTranscoder(),
      }),
    ).rejects.toThrow(Forbidden);
    await f2.cleanup();
    const f3 = await withFinishedUpload(ctx, fakeMp4Bytes(2048));
    await expect(
      createVideoFromUpload(ctx, f3, {
        store,
        transcoder: {
          ...createFakeTranscoder(),
          probe: async () => {
            throw new TranscoderUnavailable();
          },
        },
      }),
    ).rejects.toThrow(TranscoderUnavailable);
    expect(chunkDirs(org)).toEqual([]);
    expect(await store.list(orgMediaPrefix(org))).toEqual([]);
  });

  it("re-checks the allowance under the lock (USAGE-FULL) and removes the stored original", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const bytes = fakeMp4Bytes(2 * 1024 * 1024);
    const finished = await withFinishedUpload(ctx, bytes);
    // A parallel upload lands between the first check and the row: the org is now nearly full.
    const racing: ObjectStore = {
      put: async (key, body) => {
        await pb.collection("media_assets").create({
          organization: org,
          kind: "library",
          status: "ready",
          source: "library",
          storage_dir: `tenants/${org}/media/x`,
          bytes: MEDIA_ALLOWANCE_BYTES - 1024 * 1024,
        });
        return store.put(key, body);
      },
      get: (k) => store.get(k),
      list: (p) => store.list(p),
      delete: (k) => store.delete(k),
    };
    await expect(
      createVideoFromUpload(ctx, finished, {
        store: racing,
        transcoder: createFakeTranscoder(),
      }),
    ).rejects.toThrow(AllowanceExceeded);
    const videos = await pb.collection("media_assets").getFullList({
      filter: pb.filter('organization = {:o} && kind = "video"', { o: org }),
    });
    expect(videos).toEqual([]);
    expect(await store.list(orgMediaPrefix(org))).toEqual([]);
    expect(chunkDirs(org)).toEqual([]);
  });
});

describe("the video queue (Pitfall 5, choice 2)", () => {
  it("one video at a time: optimizing then waiting; images still run meanwhile", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const gate = deferred();
    let first = true;
    const transcoder = createFakeTranscoder({
      gate: () => {
        if (!first) return Promise.resolve();
        first = false;
        return gate.promise;
      },
    });
    const a = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(3000)),
      { store, transcoder },
    );
    const b = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(3000)),
      { store, transcoder },
    );
    // Let the first job reach its gate.
    for (let i = 0; i < 50 && transcoder.transcodes === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await videoStates(ctx, [a.asset.id, b.asset.id])).toEqual({
      [a.asset.id]: "optimizing",
      [b.asset.id]: "waiting",
    });
    expect(await imageQueue.run(async () => "image ran")).toBe("image ran");
    gate.resolve();
    await drainVideoQueue();
    expect(await videoStates(ctx, [a.asset.id, b.asset.id])).toEqual({
      [a.asset.id]: "ready",
      [b.asset.id]: "ready",
    });
  });
});

describe("failure and retry (D220, choice 2)", () => {
  it("a first failure keeps the original; Try again compresses it and deletes the original", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "editor");
    const transcoder = createFakeTranscoder({ failTranscodes: 1 });
    const { asset } = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(5000)),
      { store, transcoder },
    );
    await drainVideoQueue();
    let row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("failed");
    expect((await videoStates(ctx, [asset.id]))[asset.id]).toBe("failed");
    expect(await keysOf(org, asset.id)).toEqual(["original.mp4"]);
    const { state } = await retryVideo(ctx, asset.id, { store, transcoder });
    expect(["waiting", "optimizing"]).toContain(state);
    await drainVideoQueue();
    row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("ready");
    expect(row.video_attempts).toBe(2);
    expect(await keysOf(org, asset.id)).not.toContain("original.mp4");
    await expect(
      retryVideo(ctx, asset.id, { store, transcoder }),
    ).rejects.toThrow(InvalidInput);
  });

  it("a second failure is final: the original goes, bytes drop to what is left, no third try", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const transcoder = createFakeTranscoder({ failTranscodes: 2 });
    const { asset } = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(5000)),
      { store, transcoder },
    );
    await drainVideoQueue();
    await retryVideo(ctx, asset.id, { store, transcoder });
    await drainVideoQueue();
    const row = await pb.collection("media_assets").getOne(asset.id);
    expect(row.status).toBe("failed");
    expect((await videoStates(ctx, [asset.id]))[asset.id]).toBe("failed-final");
    expect(await keysOf(org, asset.id)).toEqual([]);
    expect(row.bytes).toBe(0);
    await expect(
      retryVideo(ctx, asset.id, { store, transcoder }),
    ).rejects.toThrow(InvalidInput);
  });

  it("deleting the video while its job runs leaves no row and no objects", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const gate = deferred();
    const transcoder = createFakeTranscoder({ gate: () => gate.promise });
    const { asset } = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(4000)),
      { store, transcoder },
    );
    for (let i = 0; i < 50 && transcoder.transcodes === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const out = await deleteMediaAsset(ctx, asset.id, {
      sections: registry,
      invalidator: recordingInvalidator(),
      store,
      publicStore,
    });
    expect(out.outcome).toBe("hard");
    gate.resolve();
    await drainVideoQueue();
    await expect(
      pb.collection("media_assets").getOne(asset.id),
    ).rejects.toBeTruthy();
    expect(await keysOf(org, asset.id)).toEqual([]);
  });
});

describe("stuck sweep and boot resume (resolution e)", () => {
  it("re-queues a stuck video once, leaves a long one alone, fails one out of attempts", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const transcoder = createFakeTranscoder();
    const now = Date.now();
    const stuck = await seedProcessing(org, {
      duration_s: 60,
      video_attempts: 1,
      processing_started_at: stamp(now - 31 * MIN),
    });
    const long = await seedProcessing(org, {
      duration_s: 1200,
      video_attempts: 1,
      processing_started_at: stamp(now - 31 * MIN),
    });
    const spent = await seedProcessing(org, {
      duration_s: 60,
      video_attempts: 2,
      processing_started_at: stamp(now - 31 * MIN),
    });
    const res = await sweepStuckVideos({
      now: new Date(now),
      deps: { store, transcoder },
    });
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    expect(res.failed).toBeGreaterThanOrEqual(1);
    await drainVideoQueue();
    const states = await videoStates(ctx, [stuck, long, spent]);
    expect(states[stuck]).toBe("ready");
    expect(states[long]).toBe("optimizing");
    expect(states[spent]).toBe("failed-final");
    expect(await keysOf(org, spent)).toEqual([]);
    expect(await keysOf(org, stuck)).not.toContain("original.mp4");
    await pb.collection("media_assets").delete(long);
  });

  it("re-queues an old waiting row, never touches a video running in this process", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const waiting = await seedProcessing(org, { duration_s: 60 });
    const gate = deferred();
    const transcoder = createFakeTranscoder({ gate: () => gate.promise });
    const { asset } = await createVideoFromUpload(
      ctx,
      await withFinishedUpload(ctx, fakeMp4Bytes(3000)),
      { store, transcoder },
    );
    for (let i = 0; i < 50 && transcoder.transcodes === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const res = await sweepStuckVideos({
      now: new Date(Date.now() + 10 * 60 * MIN),
      deps: { store, transcoder },
    });
    expect(res).toEqual({ requeued: 1, failed: 0 });
    expect((await videoStates(ctx, [asset.id]))[asset.id]).toBe("optimizing");
    gate.resolve();
    await drainVideoQueue();
    expect(await videoStates(ctx, [waiting, asset.id])).toEqual({
      [waiting]: "ready",
      [asset.id]: "ready",
    });
    expect(transcoder.transcodes).toBe(2);
  });

  it("resume picks up every waiting or running video regardless of age, and is idempotent", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const transcoder = createFakeTranscoder();
    const fresh = await seedProcessing(org, {});
    const mid = await seedProcessing(org, {
      video_attempts: 1,
      processing_started_at: stamp(Date.now() - MIN),
    });
    const spent = await seedProcessing(org, {
      video_attempts: 2,
      processing_started_at: stamp(Date.now() - MIN),
    });
    const first = await resumeVideoJobs({ store, transcoder });
    const second = await resumeVideoJobs({ store, transcoder });
    expect(first).toEqual({ requeued: 2, failed: 1 });
    expect(second.failed).toBe(0);
    await drainVideoQueue();
    expect(await videoStates(ctx, [fresh, mid, spent])).toEqual({
      [fresh]: "ready",
      [mid]: "ready",
      [spent]: "failed-final",
    });
    expect(transcoder.transcodes).toBe(2);
  });
});

describe("captions (CONT-18, choice 11)", () => {
  async function readyVideo(org: string, fields: Record<string, unknown> = {}) {
    return (
      await pb.collection("media_assets").create({
        organization: org,
        kind: "video",
        status: "ready",
        source: "library",
        original_ext: "mp4",
        storage_dir: `tenants/${org}/media/x`,
        bytes: 1000,
        ...fields,
      })
    ).id;
  }

  it("adds, replaces and removes a .vtt file; bytes follow the file size", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "editor");
    const id = await readyVideo(org);
    const inv = recordingInvalidator();
    expect(
      await uploadVideoCaptions(ctx, id, VTT, { store, invalidator: inv }),
    ).toEqual({ captions: "captions.vtt" });
    const key = tenantMediaDerivativeKey(org, id, "captions.vtt");
    const stored = new TextDecoder().decode((await store.get(key))!);
    expect(stored).not.toContain("\r");
    let row = await pb.collection("media_assets").getOne(id);
    expect(row.captions_path).toBe("captions.vtt");
    expect(row.bytes).toBe(1000 + stored.length);
    expect(inv.tags.length).toBeGreaterThan(0);

    const longer = new TextEncoder().encode(
      "WEBVTT\n\n00:00.000 --> 00:02.000\nA much longer caption line here\n",
    );
    await uploadVideoCaptions(ctx, id, longer, { store });
    row = await pb.collection("media_assets").getOne(id);
    expect(row.bytes).toBe(1000 + longer.length);

    await removeVideoCaptions(ctx, id, { store });
    row = await pb.collection("media_assets").getOne(id);
    expect(row.captions_path).toBe("");
    expect(row.bytes).toBe(1000);
    expect(await store.get(key)).toBeNull();
  });

  it("refuses invalid and oversized files with UPL-CAPTIONS, and non-video assets with NotFound", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const id = await readyVideo(org);
    const srt = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nHi\n",
    );
    await expect(uploadVideoCaptions(ctx, id, srt, { store })).rejects.toThrow(
      VIDEO_COPY.captions,
    );
    const big = new Uint8Array(VTT_MAX_BYTES + 1).fill(0x41);
    big.set(new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\n"));
    await expect(uploadVideoCaptions(ctx, id, big, { store })).rejects.toThrow(
      VIDEO_COPY.captions,
    );
    const audio = (
      await pb.collection("media_assets").create({
        organization: org,
        kind: "audio",
        status: "ready",
        source: "library",
        storage_dir: `tenants/${org}/media/x`,
      })
    ).id;
    await expect(
      uploadVideoCaptions(ctx, audio, VTT, { store }),
    ).rejects.toThrow(NotFound);
    await expect(
      uploadVideoCaptions(ctxAs(org, "viewer"), id, VTT, { store }),
    ).rejects.toThrow(Forbidden);
  });

  it("on a promoted video the public captions are written, purged and removed too", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const id = await readyVideo(org, { public_at: stamp(Date.now()) });
    const purged: string[][] = [];
    const delivery = {
      purge: async (keys: string[]) => {
        purged.push(keys);
      },
    } as unknown as MediaDelivery;
    await uploadVideoCaptions(ctx, id, VTT, { store, publicStore, delivery });
    const pub = tenantPublicMediaKey(org, "video", id, "captions.vtt");
    expect(await publicStore.get(pub)).not.toBeNull();
    expect(purged).toEqual([[pub]]);
    await removeVideoCaptions(ctx, id, { store, publicStore, delivery });
    expect(await publicStore.get(pub)).toBeNull();
    expect(purged).toEqual([[pub], [pub]]);
  });
});

describe("cover and tile states (choice 12)", () => {
  it("setVideoCover takes an own ready image; refuses videos, audio, deleted and foreign images", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "owner");
    const make = (fields: Record<string, unknown>) =>
      pb
        .collection("media_assets")
        .create({
          organization: org,
          status: "ready",
          source: "library",
          storage_dir: `tenants/${org}/media/x`,
          ...fields,
        })
        .then((r) => r.id);
    const video = await make({ kind: "video" });
    const other = await make({ kind: "video" });
    const image = await make({ kind: "library" });
    const audio = await make({ kind: "audio" });
    const gone = await make({ kind: "library", deleted_at: stamp(Date.now()) });
    const foreign = (
      await pb.collection("media_assets").create({
        organization: seed.B.org,
        kind: "library",
        status: "ready",
        source: "library",
        storage_dir: `tenants/${seed.B.org}/media/x`,
      })
    ).id;
    await setVideoCover(ctx, video, image);
    expect(
      (await pb.collection("media_assets").getOne(video)).poster_asset,
    ).toBe(image);
    for (const bad of [other, audio, gone, foreign]) {
      await expect(setVideoCover(ctx, video, bad)).rejects.toThrow(NotFound);
    }
    await expect(setVideoCover(ctx, image, image)).rejects.toThrow(NotFound);
    await setVideoCover(ctx, video, null);
    expect(
      (await pb.collection("media_assets").getOne(video)).poster_asset,
    ).toBe("");
  });

  it("videoStates returns own video ids only", async (t) => {
    if (!inst) return t.skip();
    const org = await bareOrg();
    const ctx = ctxAs(org, "viewer");
    const v = await seedProcessing(org, {});
    const img = (
      await pb.collection("media_assets").create({
        organization: org,
        kind: "library",
        status: "ready",
        source: "library",
        storage_dir: `tenants/${org}/media/x`,
      })
    ).id;
    const foreign = await seedProcessing(seed.B.org, {});
    expect(await videoStates(ctx, [v, v, img, foreign, "not an id"])).toEqual({
      [v]: "waiting",
    });
    await pb.collection("media_assets").delete(v);
    await pb.collection("media_assets").delete(foreign);
  });
});
