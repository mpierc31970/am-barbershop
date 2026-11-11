// /hub/api/media/audio: chunked MP3 upload into the media library (07-12; CONT-19, CONT-27;
// RESEARCH finding 1, Pitfall 1). A 50 MB MP3 cannot pass the 22 MB middleware body limit,
// and that limit is never raised: the browser sends the file in parts of at most 8 MiB.
// One protocol on one URL:
//   POST   { size, filename }            -> 200 { uploadId, partBytes, parts }
//   PUT    ?upload=<id>&part=<n>  bytes  -> 200 { received, parts }
//   POST   ?upload=<id>&complete=1       -> 200 { asset }
//   DELETE ?upload=<id>                  -> 204 (stop; idempotent)
// Every method: same origin (403) and a hub session (401). Errors carry the UI-SPEC copy.
import {
  abortChunkedUpload,
  appendChunk,
  CHUNK_PART_BYTES,
  finishChunkedUpload,
  startChunkedUpload,
  UPLOAD_COPY,
  uploadLibraryAudio,
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
      const result = await uploadLibraryAudio(ctx, finished);
      return json(200, result);
    } catch (err) {
      return uploadErrorResponse(err);
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
      purpose: "audio",
      size: input.size as number,
      filename: typeof input.filename === "string" ? input.filename : "",
    });
    return json(200, started);
  } catch (err) {
    return uploadErrorResponse(err);
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
