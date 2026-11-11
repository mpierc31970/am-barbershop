// /hub/api/media/captions: a video's .vtt captions file (07-13; CONT-18 captions, UI-SPEC
// UPL-CAPTIONS; T-07-13-07). At most 512 KB, so one plain request (well inside the 22 MB
// middleware limit, which is never raised).
//   PUT    ?asset=<id>  bytes  -> 200 { captions: "captions.vtt" }
//   DELETE ?asset=<id>         -> 204
// A declared length over the limit is refused before the body is read. Foreign or unknown ids
// are 404. Every method: same origin (403) and a hub session (401).
import {
  removeVideoCaptions,
  uploadVideoCaptions,
  VIDEO_COPY,
  VTT_MAX_BYTES,
} from "@cds/db";
import { nextInvalidator } from "../../../../../../lib/invalidator";
import {
  json,
  mediaContext,
  sameOrigin,
  signedOut,
  uploadErrorResponse,
} from "../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[a-z0-9]{15}$/;
const SLACK = 4 * 1024;

function assetParam(req: Request): string | null {
  const v = new URL(req.url).searchParams.get("asset");
  return v !== null && ID_RE.test(v) ? v : null;
}

function tooBig(): Response {
  return json(413, { error: VIDEO_COPY.captions, reason: "too_big" });
}

export async function PUT(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const asset = assetParam(req);
  if (!asset) return json(404, { error: "not_found" });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > VTT_MAX_BYTES + SLACK) {
    return tooBig();
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json(400, { error: VIDEO_COPY.captions });
  }
  if (bytes.length > VTT_MAX_BYTES) return tooBig();
  try {
    return json(
      200,
      await uploadVideoCaptions(ctx, asset, bytes, {
        invalidator: nextInvalidator,
      }),
    );
  } catch (err) {
    return uploadErrorResponse(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const asset = assetParam(req);
  if (!asset) return json(404, { error: "not_found" });
  try {
    await removeVideoCaptions(ctx, asset, { invalidator: nextInvalidator });
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return uploadErrorResponse(err);
  }
}
