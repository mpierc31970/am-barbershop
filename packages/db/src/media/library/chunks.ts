// Chunked uploads (07-12 choice 7; CONT-19, CONT-27; RESEARCH finding 1 and Pitfall 1:
// never raise the 22 MB middleware body limit). A large file arrives in parts of at most
// 8 MiB, appended in order to a temp file under `chunkUploadRoot()/<org>/<uploadId>/`.
// Shared by audio (07-12) and video (07-13 reuses it; do not write a second module).
//
//   start  -> meta.json { orgId, actor, purpose, size, filename, received, parts, created }
//   append -> part `index` must be the next one (a re-sent earlier part is a no-op); every
//             part but the last is exactly CHUNK_PART_BYTES, the last is exactly the rest
//   finish -> FinishedUpload { path, size, ... } only once every byte arrived
//   abort  -> removes the folder (idempotent)
//
// Invariant 1: the upload id is bound to the org in meta.json; another org's id (or a
// missing one) is NotFound, never a hint. Paths are built from validated segments only.
// 07-27's temp sweep deletes folders under chunkUploadRoot() older than 24 h.
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import type { OrgContext } from "../../context";
import { newRecordId, requirePermission } from "../../repository";
import { assertAllowance } from "../cdn/usage";
import { UploadRejected } from "../pipeline";
import { cleanFileName } from "./alt";

export const CHUNK_PART_BYTES = 8 * 1024 * 1024;

const MB = 1024 * 1024;

export const AUDIO_MAX_BYTES = 50 * MB;
/** UPL-AUDIO (07-UI-SPEC copy table). */
export const AUDIO_COPY =
  "This isn't an MP3 file, or it's over 50 MB. Export an MP3 under 50 MB and try again.";

export const VIDEO_MAX_BYTES = 250 * MB;

export type ChunkPurpose = "audio" | "video";

export const CHUNK_LIMITS: Readonly<
  Record<ChunkPurpose, { maxBytes: number; tooBig: (size: number) => string }>
> = Object.freeze({
  audio: { maxBytes: AUDIO_MAX_BYTES, tooBig: () => AUDIO_COPY },
  video: {
    maxBytes: VIDEO_MAX_BYTES,
    // UPL-VIDEO-TOO-BIG (07-UI-SPEC copy table).
    tooBig: (size: number) =>
      `This video is ${Math.max(251, Math.ceil(size / MB))} MB. The limit is 250 MB: export a shorter or smaller copy, or upload it to YouTube and paste the link.`,
  },
});

export type FinishedUpload = {
  uploadId: string;
  purpose: ChunkPurpose;
  /** The assembled file on local disk. */
  path: string;
  size: number;
  filename: string;
  /** Removes the temp folder; callers run it in `finally`. */
  cleanup(): Promise<void>;
};

type Meta = {
  orgId: string;
  actor: string;
  purpose: ChunkPurpose;
  size: number;
  filename: string;
  received: number;
  parts: number;
  created: string;
};

const SEGMENT_RE = /^[a-z0-9_-]{1,64}$/;
const UPLOAD_ID_RE = /^[a-z0-9]{15}$/;
const PART_COPY =
  "That upload part isn't the next one. Start the upload again.";

export function chunkUploadRoot(): string {
  return join(tmpdir(), "cds-uploads");
}

export function partCount(size: number): number {
  return Math.ceil(size / CHUNK_PART_BYTES);
}

function dirFor(orgId: string, uploadId: string): string {
  if (!SEGMENT_RE.test(orgId) || !UPLOAD_ID_RE.test(uploadId)) {
    throw new NotFound();
  }
  return join(chunkUploadRoot(), orgId, uploadId);
}

function isPurpose(v: unknown): v is ChunkPurpose {
  return v === "audio" || v === "video";
}

async function readMeta(
  ctx: OrgContext,
  uploadId: unknown,
): Promise<{
  dir: string;
  meta: Meta;
}> {
  if (typeof uploadId !== "string") throw new NotFound();
  const dir = dirFor(ctx.orgId, uploadId);
  let raw: string;
  try {
    raw = await readFile(join(dir, "meta.json"), "utf8");
  } catch {
    throw new NotFound();
  }
  let meta: Meta;
  try {
    meta = JSON.parse(raw) as Meta;
  } catch {
    throw new NotFound();
  }
  if (!meta || meta.orgId !== ctx.orgId || !isPurpose(meta.purpose)) {
    throw new NotFound();
  }
  return { dir, meta };
}

// One append at a time per upload (parts of one upload never interleave).
const chains = new Map<string, Promise<unknown>>();

function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

export async function startChunkedUpload(
  ctx: OrgContext,
  input: { purpose: ChunkPurpose; size: number; filename?: unknown },
): Promise<{ uploadId: string; partBytes: number; parts: number }> {
  requirePermission(ctx, "content", "write");
  const { purpose, size } = input;
  if (!isPurpose(purpose)) throw new InvalidInput("invalid upload purpose");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    throw new InvalidInput("invalid upload size");
  }
  const limit = CHUNK_LIMITS[purpose];
  if (size > limit.maxBytes) {
    throw new UploadRejected("too_big", limit.tooBig(size));
  }
  await assertAllowance(ctx, size);
  const uploadId = newRecordId();
  const dir = dirFor(ctx.orgId, uploadId);
  await mkdir(dir, { recursive: true });
  const meta: Meta = {
    orgId: ctx.orgId,
    actor: ctx.actor,
    purpose,
    size,
    filename: cleanFileName(input.filename ?? ""),
    received: 0,
    parts: 0,
    created: new Date().toISOString(),
  };
  await writeFile(join(dir, "data.part"), new Uint8Array(0));
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta));
  return { uploadId, partBytes: CHUNK_PART_BYTES, parts: partCount(size) };
}

export async function appendChunk(
  ctx: OrgContext,
  uploadId: string,
  index: number,
  bytes: Uint8Array,
): Promise<{ received: number; parts: number }> {
  requirePermission(ctx, "content", "write");
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
    throw new InvalidInput(PART_COPY);
  }
  if (!(bytes instanceof Uint8Array)) throw new InvalidInput(PART_COPY);
  // Fail fast on a missing or foreign id before queueing.
  await readMeta(ctx, uploadId);
  return serial(`${ctx.orgId}/${uploadId}`, async () => {
    const { dir, meta } = await readMeta(ctx, uploadId);
    const total = partCount(meta.size);
    if (index < meta.parts)
      return { received: meta.received, parts: meta.parts };
    if (index > meta.parts || index >= total) throw new InvalidInput(PART_COPY);
    if (bytes.length > CHUNK_PART_BYTES) {
      throw new InvalidInput("Upload parts are at most 8 MB.");
    }
    const last = index === total - 1;
    const expected = last ? meta.size - meta.received : CHUNK_PART_BYTES;
    if (bytes.length !== expected) throw new InvalidInput(PART_COPY);
    await appendFile(join(dir, "data.part"), bytes);
    const next: Meta = {
      ...meta,
      received: meta.received + bytes.length,
      parts: meta.parts + 1,
    };
    // Write-then-rename is not needed: meta is rewritten whole after the append, and a
    // crash in between leaves an upload the owner restarts.
    await writeFile(join(dir, "meta.json"), JSON.stringify(next));
    return { received: next.received, parts: next.parts };
  });
}

export async function finishChunkedUpload(
  ctx: OrgContext,
  uploadId: string,
): Promise<FinishedUpload> {
  requirePermission(ctx, "content", "write");
  return serial(`${ctx.orgId}/${uploadId}`, async () => {
    const { dir, meta } = await readMeta(ctx, uploadId);
    const path = join(dir, "data.part");
    const st = await stat(path).catch(() => null);
    if (meta.received !== meta.size || !st || st.size !== meta.size) {
      throw new InvalidInput(
        "The upload didn't finish. Check your connection and try again.",
      );
    }
    return {
      uploadId,
      purpose: meta.purpose,
      path,
      size: meta.size,
      filename: meta.filename,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  });
}

export async function abortChunkedUpload(
  ctx: OrgContext,
  uploadId: string,
): Promise<void> {
  requirePermission(ctx, "content", "write");
  let dir: string;
  try {
    dir = (await readMeta(ctx, uploadId)).dir;
  } catch (err) {
    if (err instanceof NotFound) return; // idempotent; never a hint about other orgs
    throw err;
  }
  await rm(dir, { recursive: true, force: true });
}
