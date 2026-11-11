// Video test helpers (07-13). Synthetic MP4 headers for the fake transcoder, real lavfi clips
// for the ffmpeg round trip (only when ffmpeg is installed), and a driver that pushes bytes
// through 07-12's chunk functions to get a real FinishedUpload.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { OrgContext } from "../src/context";
import {
  appendChunk,
  CHUNK_PART_BYTES,
  finishChunkedUpload,
  startChunkedUpload,
  type FinishedUpload,
} from "../src/media/library/chunks";

export { drainVideoQueue } from "../src/media/video/job";

const FFMPEG = process.env.CDS_FFMPEG_PATH || "ffmpeg";

/** ffmpeg (and so the real round trip) is available on this machine. */
export function hasFfmpeg(): boolean {
  try {
    const r = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** A valid `ftyp isom` box followed by a `free` box padding the file to `size` bytes. */
export function fakeMp4Bytes(size = 4096): Uint8Array {
  const total = Math.max(size, 32);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const ascii = (s: string, at: number) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  view.setUint32(0, 24);
  ascii("ftyp", 4);
  ascii("isom", 8);
  view.setUint32(12, 0x200);
  ascii("isom", 16);
  ascii("mp41", 20);
  view.setUint32(24, total - 24);
  ascii("free", 28);
  for (let i = 32; i < total; i += 1) out[i] = i % 251;
  return out;
}

/** A short lavfi test clip with a GPS-like metadata tag (needs ffmpeg). Returns its path. */
export function makeTestClip(
  dir: string,
  opts: { w: number; h: number; seconds: number; name?: string },
): string {
  const out = join(dir, opts.name ?? `clip-${opts.w}x${opts.h}.mp4`);
  const r = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${opts.w}x${opts.h}:rate=60:duration=${opts.seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${opts.seconds}`,
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-metadata",
      "location=+40.7128-074.0060/",
      "-metadata",
      "creation_time=2026-01-01T00:00:00Z",
      out,
    ],
    { stdio: "ignore" },
  );
  if (r.status !== 0) throw new Error("could not make the test clip");
  return out;
}

/** Drive bytes through start / append / finish to get a real FinishedUpload. */
export async function withFinishedUpload(
  ctx: OrgContext,
  bytes: Uint8Array,
  filename = "Holiday Clip.mp4",
): Promise<FinishedUpload> {
  const { uploadId, parts } = await startChunkedUpload(ctx, {
    purpose: "video",
    size: bytes.length,
    filename,
  });
  for (let i = 0; i < parts; i += 1) {
    await appendChunk(
      ctx,
      uploadId,
      i,
      bytes.subarray(i * CHUNK_PART_BYTES, (i + 1) * CHUNK_PART_BYTES),
    );
  }
  return finishChunkedUpload(ctx, uploadId);
}

/** A promise the test resolves by hand (holds a fake transcode mid-run). */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
