// P7 media video attacks. Owner 07-13: real writer attacks (TEN-03, invariant 1, T-07-13-06).
// Org A gets one ready video (a private object, captions set), one image and a video chunk
// upload; every video function is then driven with org B's context and org A's ids: each is
// NotFound (or empty), and A's row, captions, cover and objects are unchanged afterwards. The
// read-only half stays: the generic repo has no create/update/delete for media_assets.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  abortChunkedUpload,
  appendChunk,
  finishChunkedUpload,
  startChunkedUpload,
} from "../../src/media/library";
import {
  removeVideoCaptions,
  retryVideo,
  setVideoCover,
  uploadVideoCaptions,
  videoStates,
} from "../../src/media/video";
import { tenantMediaDerivativeKey } from "../../src/storage/keys";
import { LocalDiskStore } from "../../src/storage/local-disk";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

const VTT = new TextEncoder().encode(
  "WEBVTT\n\n00:00.000 --> 00:01.000\npwned\n",
);

export function attacks(env: AttackEnv): AttackMap {
  return {
    "media_assets:media-video": async () => {
      await readOnlyAttack(env, "media_assets")();
      const seed = env.seed();
      const pb = env.pb();
      const A = seed.ctxA;
      const B = seed.ctxB;
      const dir = mkdtempSync(join(tmpdir(), "cds-attack-video-"));
      const store = new LocalDiskStore(dir);
      const base = { status: "ready", source: "library" };
      const made: string[] = [];
      try {
        const video = (
          await pb.collection("media_assets").create({
            ...base,
            organization: seed.A.org,
            kind: "video",
            original_ext: "mp4",
            storage_dir: `tenants/${seed.A.org}/media/attack`,
            captions_path: "captions.vtt",
            bytes: 100,
          })
        ).id;
        const imageA = (
          await pb.collection("media_assets").create({
            ...base,
            organization: seed.A.org,
            kind: "library",
            storage_dir: `tenants/${seed.A.org}/media/attack`,
          })
        ).id;
        const videoB = (
          await pb.collection("media_assets").create({
            ...base,
            organization: seed.B.org,
            kind: "video",
            storage_dir: `tenants/${seed.B.org}/media/attack`,
          })
        ).id;
        const imageB = (
          await pb.collection("media_assets").create({
            ...base,
            organization: seed.B.org,
            kind: "library",
            storage_dir: `tenants/${seed.B.org}/media/attack`,
          })
        ).id;
        made.push(video, imageA, videoB, imageB);
        const key = tenantMediaDerivativeKey(seed.A.org, video, "video.mp4");
        const capKey = tenantMediaDerivativeKey(
          seed.A.org,
          video,
          "captions.vtt",
        );
        await store.put(key, new TextEncoder().encode("org A video"));
        await store.put(capKey, new TextEncoder().encode("org A captions"));
        const { uploadId } = await startChunkedUpload(A, {
          purpose: "video",
          size: 10,
        });

        await expect(retryVideo(B, video, { store })).rejects.toThrow(NotFound);
        await expect(
          uploadVideoCaptions(B, video, VTT, { store, publicStore: store }),
        ).rejects.toThrow(NotFound);
        await expect(
          removeVideoCaptions(B, video, { store, publicStore: store }),
        ).rejects.toThrow(NotFound);
        await expect(setVideoCover(B, videoB, imageA)).rejects.toThrow(
          NotFound,
        );
        await expect(setVideoCover(B, video, imageB)).rejects.toThrow(NotFound);
        await expect(setVideoCover(B, video, null)).rejects.toThrow(NotFound);
        await expect(
          appendChunk(B, uploadId, 0, new Uint8Array(10)),
        ).rejects.toThrow(NotFound);
        await expect(finishChunkedUpload(B, uploadId)).rejects.toThrow(
          NotFound,
        );
        expect(await videoStates(B, [video])).toEqual({});

        const row = await pb.collection("media_assets").getOne(video);
        expect(row.organization).toBe(seed.A.org);
        expect(row.captions_path).toBe("captions.vtt");
        expect(row.poster_asset).toBe("");
        expect(row.bytes).toBe(100);
        expect(row.status).toBe("ready");
        expect(
          (await pb.collection("media_assets").getOne(videoB)).poster_asset,
        ).toBe("");
        expect(new TextDecoder().decode((await store.get(key))!)).toBe(
          "org A video",
        );
        expect(new TextDecoder().decode((await store.get(capKey))!)).toBe(
          "org A captions",
        );
        await abortChunkedUpload(A, uploadId);
      } finally {
        for (const id of made) {
          await pb
            .collection("media_assets")
            .delete(id)
            .catch(() => undefined);
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
