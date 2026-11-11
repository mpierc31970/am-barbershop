// POST /hub/api/media: one image upload from the hub (ONB-04, ONB-05; RESEARCH Pattern 4,
// Pitfall 1; T-06-63, T-06-64). multipart/form-data { file, kind, alt? } sent by XHR so the
// owner sees upload progress. Order matters for a 1 GB container:
//   session -> Content-Length cap (before the body is parsed) -> formData -> real file size ->
//   uploadImage (bytes verified, oriented, stripped and resized in @cds/db).
// Stays inside the middleware matcher (it strips TENANT_HOST_HEADER); next.config sets
// middlewareClientMaxBodySize 22mb so a 20 MB body reaches here whole.
// 07-12: kind=library is a media library photo (content write: Owner / Admin / Editor, via
// uploadLibraryImage); the intake kinds keep business write through uploadImage. Both count
// against the 2 GB allowance (413 { reason: "allowance" }).
import {
  isMediaKind,
  MAX_UPLOAD_BYTES,
  UPLOAD_COPY,
  uploadImage,
  uploadLibraryImage,
} from "@cds/db";
import {
  json,
  MEDIA_KIND_COPY,
  mediaContext,
  MULTIPART_OVERHEAD,
  sameOrigin,
  signedOut,
  uploadErrorResponse,
} from "../../../../../lib/media-route";
import { nextInvalidator } from "../../../../../lib/invalidator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;

  const declared = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD
  ) {
    return json(413, {
      error: UPLOAD_COPY.tooBig(declared - MULTIPART_OVERHEAD),
      reason: "too_big",
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: UPLOAD_COPY.failed });
  }
  const kind = form.get("kind");
  if (kind !== "library" && !isMediaKind(kind))
    return json(400, { error: MEDIA_KIND_COPY });
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return json(400, { error: UPLOAD_COPY.type, reason: "type" });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json(413, {
      error: UPLOAD_COPY.tooBig(file.size),
      reason: "too_big",
    });
  }
  const alt = form.get("alt");
  const filename = file instanceof File ? file.name : undefined;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const opts = {
      ...(typeof alt === "string" ? { alt } : {}),
      ...(filename ? { filename } : {}),
    };
    const result =
      kind === "library"
        ? await uploadLibraryImage(ctx, bytes, opts)
        : // WR-C06: a logo upload regenerates the icons and drops their cached `v`.
          await uploadImage(ctx, bytes, kind, {
            ...opts,
            invalidator: nextInvalidator,
          });
    return json(200, result);
  } catch (err) {
    return uploadErrorResponse(err);
  }
}
