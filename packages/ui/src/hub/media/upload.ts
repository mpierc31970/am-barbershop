// The browser side of every media library upload (07-17; CONT-18, CONT-19, CONT-27; RESEARCH
// Pitfall 1, 07-12 choice 7, 07-13 "Route protocol"). Never one body past 8 MiB: photos go in
// one multipart POST (20 MB cap, under the 22 MB middleware limit); MP4 and MP3 go in parts
// through the one-URL chunk protocol of 07-12/07-13:
//   POST   <url>  { size, filename }      -> { uploadId, partBytes, parts }
//   PUT    <url>?upload=<id>&part=<n>     -> raw bytes, one part (≤ 8 MiB)
//   POST   <url>?upload=<id>&complete=1   -> { asset } (video: { asset, state })
//   DELETE <url>?upload=<id>              -> Stop / give up (idempotent)
// Client checks are UX only: the routes and the chokepoint re-check every byte (T-07-17-05).
// Parts go one at a time; each part is retried once on a network error (choice 3; 07-12 makes
// parts idempotent per index). Never logs file names or upload ids (T-07-17-08).
import { UPL_COPY } from "./p6-copy";
import {
  MEDIA_COPY,
  MEDIA_LIMITS,
  videoTooBigCopy,
  type MediaKind,
  type VideoStateView,
} from "./copy";
import { AbortError, NetworkError, sendXhr, type XhrResult } from "./xhr";

export const MEDIA_UPLOAD_URL = "/hub/api/media";
export const CHUNK_URLS = Object.freeze({
  audio: "/hub/api/media/audio",
  video: "/hub/api/media/video",
});

/** The largest part the routes accept (07-12 CHUNK_PART_BYTES). */
export const MAX_PART_BYTES = 8 * 1024 * 1024;

export type MediaCheck = { kind: MediaKind } | { error: string };

export type UploadResult =
  | { ok: true; assetId: string; state?: VideoStateView }
  | { ok: false; message: string; aborted?: boolean };

export type UploadOptions = {
  /** Fraction 0..1 of the file sent, monotonic. */
  onProgress?(fraction: number): void;
  signal?: AbortSignal;
};

type FileLike = Pick<File, "name" | "size" | "type">;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ext = (name: string) =>
  (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

/** The instant client check: which kind a file is, or the UI-SPEC copy that refuses it. */
export function checkMediaFile(file: FileLike): MediaCheck {
  const type = (file.type || "").toLowerCase();
  const e = ext(file.name || "");
  let kind: MediaKind | null = null;
  if (IMAGE_TYPES.has(type) || ["jpg", "jpeg", "png", "webp"].includes(e)) {
    kind = "image";
  } else if (/^image\/hei[cf]$/.test(type) || e === "heic" || e === "heif") {
    return { error: UPL_COPY.heic };
  } else if (type === "video/mp4" || e === "mp4") {
    kind = "video";
  } else if (type === "audio/mpeg" || type === "audio/mp3" || e === "mp3") {
    kind = "audio";
  } else if (type.startsWith("video/") || e === "mov") {
    return { error: MEDIA_COPY.videoType };
  } else if (type.startsWith("audio/")) {
    return { error: MEDIA_COPY.audio };
  } else {
    return { error: UPL_COPY.type };
  }
  if (!(file.size > 0)) return { error: UPL_COPY.failed };
  if (kind === "image" && file.size > MEDIA_LIMITS.image) {
    return { error: UPL_COPY.tooBig(file.size) };
  }
  if (kind === "video" && file.size > MEDIA_LIMITS.video) {
    return { error: videoTooBigCopy(file.size) };
  }
  if (kind === "audio" && file.size > MEDIA_LIMITS.audio) {
    return { error: MEDIA_COPY.audio };
  }
  return { kind };
}

/** Route errors are either a sentence for the owner or a bare code ("signed_out"). */
const isSentence = (s: string) => s.includes(" ");

/** The owner-facing sentence for a failed answer (server copy when it is a sentence). */
export function failureMessage(res: XhrResult): string {
  const error = typeof res.json.error === "string" ? res.json.error : "";
  if (res.status === 503) return UPL_COPY.failed;
  if (isSentence(error)) return error;
  if (res.status === 401) return MEDIA_COPY.signedOut;
  return UPL_COPY.failed;
}

const ok2xx = (r: XhrResult) => r.status >= 200 && r.status < 300;
const ID = /^[a-z0-9]{1,32}$/i;

function assetIdOf(json: Record<string, unknown>): string | null {
  const asset = json.asset;
  if (typeof asset !== "object" || asset === null) return null;
  const id = (asset as { id?: unknown }).id;
  return typeof id === "string" && ID.test(id) ? id : null;
}

const STATES = new Set<string>([
  "waiting",
  "optimizing",
  "ready",
  "failed",
  "failed-final",
]);

/** One library photo in one multipart POST (kind=library, alt "", D-UI-P7-5: lands flagged). */
export async function uploadImageFile(
  file: File,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", "library");
  body.append("alt", "");
  body.append("filename", file.name);
  let res: XhrResult;
  try {
    res = await sendXhr({
      method: "POST",
      url: MEDIA_UPLOAD_URL,
      body,
      ...(opts.signal ? { signal: opts.signal } : {}),
      onProgress: (loaded, total) =>
        opts.onProgress?.(Math.min(1, loaded / total)),
      onUploaded: () => opts.onProgress?.(1),
    });
  } catch (err) {
    if (err instanceof AbortError) {
      return { ok: false, message: "", aborted: true };
    }
    return { ok: false, message: UPL_COPY.failed };
  }
  const id = ok2xx(res) ? assetIdOf(res.json) : null;
  if (id) return { ok: true, assetId: id };
  return { ok: false, message: failureMessage(res) };
}

function chunkUrl(base: string, pairs: [string, string][]): string {
  return `${base}?${new URLSearchParams(pairs).toString()}`;
}

/** Fire-and-forget Stop: the route removes the temp folder (07-27 sweeps leftovers). */
function abandon(base: string, uploadId: string): void {
  void sendXhr({
    method: "DELETE",
    url: chunkUrl(base, [["upload", uploadId]]),
  }).catch(() => {});
}

/** An MP4 or MP3 in parts of at most 8 MiB (RESEARCH Pitfall 1). */
export async function uploadChunkedFile(
  file: File,
  kind: "video" | "audio",
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const base = CHUNK_URLS[kind];
  const signal = opts.signal;
  const withSignal = signal ? { signal } : {};
  const aborted = (): UploadResult => ({
    ok: false,
    message: "",
    aborted: true,
  });

  // 1. Start.
  let start: XhrResult;
  try {
    start = await sendXhr({
      method: "POST",
      url: base,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: file.size, filename: file.name }),
      ...withSignal,
    });
  } catch (err) {
    if (err instanceof AbortError) return aborted();
    return { ok: false, message: UPL_COPY.failed };
  }
  if (!ok2xx(start)) return { ok: false, message: failureMessage(start) };
  const uploadId = start.json.uploadId;
  const partBytes = start.json.partBytes;
  const parts = start.json.parts;
  if (
    typeof uploadId !== "string" ||
    !ID.test(uploadId) ||
    typeof partBytes !== "number" ||
    partBytes <= 0 ||
    partBytes > MAX_PART_BYTES ||
    typeof parts !== "number" ||
    parts !== Math.ceil(file.size / partBytes)
  ) {
    return { ok: false, message: UPL_COPY.failed };
  }

  // 2. Parts, one at a time; progress = (bytes done + current part's loaded) / size.
  let best = 0;
  const report = (sent: number) => {
    const f = Math.min(1, sent / file.size);
    if (f > best) {
      best = f;
      opts.onProgress?.(f);
    }
  };
  for (let n = 0; n < parts; n += 1) {
    const from = n * partBytes;
    const blob = file.slice(from, Math.min(file.size, from + partBytes));
    let res: XhrResult | null = null;
    for (let attempt = 0; attempt < 2 && res === null; attempt += 1) {
      try {
        res = await sendXhr({
          method: "PUT",
          url: chunkUrl(base, [
            ["upload", uploadId],
            ["part", String(n)],
          ]),
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
          ...withSignal,
          onProgress: (loaded) => report(from + Math.min(loaded, blob.size)),
        });
      } catch (err) {
        if (err instanceof AbortError) {
          abandon(base, uploadId);
          return aborted();
        }
        if (!(err instanceof NetworkError) || attempt === 1) {
          abandon(base, uploadId);
          return { ok: false, message: UPL_COPY.failed };
        }
      }
    }
    if (!res || !ok2xx(res)) {
      abandon(base, uploadId);
      return {
        ok: false,
        message: res ? failureMessage(res) : UPL_COPY.failed,
      };
    }
    report(from + blob.size);
  }

  // 3. Complete.
  let done: XhrResult;
  try {
    done = await sendXhr({
      method: "POST",
      url: chunkUrl(base, [
        ["upload", uploadId],
        ["complete", "1"],
      ]),
      ...withSignal,
    });
  } catch (err) {
    abandon(base, uploadId);
    if (err instanceof AbortError) return aborted();
    return { ok: false, message: UPL_COPY.failed };
  }
  const id = ok2xx(done) ? assetIdOf(done.json) : null;
  if (!id) {
    abandon(base, uploadId);
    return { ok: false, message: failureMessage(done) };
  }
  const state = done.json.state;
  return typeof state === "string" && STATES.has(state)
    ? { ok: true, assetId: id, state: state as VideoStateView }
    : { ok: true, assetId: id };
}
