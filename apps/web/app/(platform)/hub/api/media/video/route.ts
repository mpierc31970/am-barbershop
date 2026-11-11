// /hub/api/media/video: chunked MP4 upload into the media library (07-13; CONT-18, CONT-19;
// RESEARCH Pitfall 1). A 250 MB video cannot pass the 22 MB middleware body limit, and that
// limit is never raised: the browser sends the file in parts of at most 8 MiB through 07-12's
// shared chunk module (the same protocol as /hub/api/media/audio).
//   POST   { size, filename }            -> 200 { uploadId, partBytes, parts }
//   PUT    ?upload=<id>&part=<n>  bytes  -> 200 { received, parts }
//   POST   ?upload=<id>&complete=1       -> 200 { asset, state }
//   DELETE ?upload=<id>                  -> 204 (stop; idempotent)
// A missing ffmpeg / ffprobe (TranscoderUnavailable) is 503 { reason: "unavailable" } with the
// UPL-FAILED copy. Every method: same origin (403) and a hub session (401).
import {
  abortChunkedUpload,
  appendChunk,
  CHUNK_PART_BYTES,
  finishChunkedUpload,
  startChunkedUpload,
  UPLOAD_COPY,
  createVideoFromUpload,
} from "@cds/db";
import {
  CHUNK_OVERHEAD,
  json,
  mediaContext,
  sameOrigin,
  signedOut,
  uploadErrorResponse,
} from "../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const START_MAX_BYTES = 4 * 1024;
const ID_RE = /^[a-z0-9]{15}$/;

/** ffmpeg missing (503) first; everything else through the shared upload mapping. */
function videoErrorResponse(err: unknown): Response {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "transcoder_unavailable") {
    return json(503, { error: UPLOAD_COPY.failed, reason: "unavailable" });
  }
  return uploadErrorResponse(err);
}

function uploadParam(req: Request): string | null {
  const v = new URL(req.url).searchParams.get("upload");
  return v !== null && ID_RE.test(v) ? v : null;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const params = new URL(req.url).searchParams;

  if (params.has("upload")) {
    const id = uploadParam(req);
    if (!id || params.get("complete") !== "1") {
      return json(400, { error: UPLOAD_COPY.failed });
    }
    try {
      const finished = await finishChunkedUpload(ctx, id);
      const result = await createVideoFromUpload(ctx, finished);
      return json(200, result);
    } catch (err) {
      return videoErrorResponse(err);
    }
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > START_MAX_BYTES) {
    return json(400, { error: UPLOAD_COPY.failed });
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > START_MAX_BYTES) {
      return json(400, { error: UPLOAD_COPY.failed });
    }
    body = JSON.parse(text);
  } catch {
    return json(400, { error: UPLOAD_COPY.failed });
  }
  const input = (
    typeof body === "object" && body !== null ? body : {}
  ) as Record<string, unknown>;
  try {
    const started = await startChunkedUpload(ctx, {
      purpose: "video",
      size: input.size as number,
      filename: typeof input.filename === "string" ? input.filename : "",
    });
    return json(200, started);
  } catch (err) {
    return videoErrorResponse(err);
  }
}

export async function PUT(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const id = uploadParam(req);
  const part = new URL(req.url).searchParams.get("part");
  if (!id || part === null || !/^\d{1,4}$/.test(part)) {
    return json(400, { error: UPLOAD_COPY.failed });
  }
  const declared = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > CHUNK_PART_BYTES + CHUNK_OVERHEAD
  ) {
    return json(413, { error: UPLOAD_COPY.failed, reason: "too_big" });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json(400, { error: UPLOAD_COPY.failed });
  }
  if (bytes.length > CHUNK_PART_BYTES) {
    return json(413, { error: UPLOAD_COPY.failed, reason: "too_big" });
  }
  try {
    return json(200, await appendChunk(ctx, id, Number(part), bytes));
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const id = uploadParam(req);
  if (!id) return json(400, { error: UPLOAD_COPY.failed });
  try {
    await abortChunkedUpload(ctx, id);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return uploadErrorResponse(err);
  }
}
