// POST /hub/api/support/upload: one support attachment per request (COMM-08, D94; 12-07
// choice 9; RESEARCH Pattern 6, Pitfall 5). The Server Action body cap is 2 MB, so the
// composer sends each file here by XHR (progress), gets a signed staging token back, and
// passes up to 5 tokens with the message (attachStagedUploads in the send path).
// Order: same origin -> session -> support:write and not impersonating (before the body is
// read) -> capped body read (declared and real length, WR-C03) -> real file size -> stageSupportUpload (type by
// extension AND magic bytes, the 50/day/org limiter, the scan, the private staging key).
// Errors answer with the UI-SPEC copy: 429 RATE-UPLOADS, 403 IMPERSONATING-SUPPORT,
// 413 FILE-TOO-BIG, 415 FILE-TYPE. Nothing here logs a file name, bytes or a key.
import { can } from "@cds/core";
import { SUPPORT_FILE_MAX_BYTES, stageSupportUpload } from "@cds/db";
import {
  json,
  mediaContext,
  MULTIPART_OVERHEAD,
  sameOrigin,
  signedOut,
  supportUploadErrorResponse,
} from "../../../../../../lib/media-route";
import { readCappedFormData } from "../../../../../../lib/capped-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ImpersonationDenied = { code: "impersonation_denied" };
const Forbidden = { code: "forbidden" };
const TooBig = { code: "file_too_big" };
const BadType = { code: "file_type" };

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  if (ctx.impersonator)
    return supportUploadErrorResponse(ImpersonationDenied, "");
  if (!can(ctx, "support", "write")) {
    return supportUploadErrorResponse(Forbidden, "");
  }

  // WR-C03: the declared length is checked AND the body is read with a hard byte cap, so a
  // chunked body with no Content-Length is never buffered whole before the size check.
  let form: FormData | null;
  try {
    form = await readCappedFormData(
      req,
      SUPPORT_FILE_MAX_BYTES + MULTIPART_OVERHEAD,
    );
  } catch {
    return supportUploadErrorResponse({ code: "invalid_input" }, "");
  }
  if (form === null) return supportUploadErrorResponse(TooBig, "");
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return supportUploadErrorResponse(BadType, "");
  }
  const name = file instanceof File ? file.name : "";
  if (file.size > SUPPORT_FILE_MAX_BYTES) {
    return supportUploadErrorResponse(TooBig, name);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const staged = await stageSupportUpload(ctx, { name, bytes });
    return json(200, staged);
  } catch (err) {
    return supportUploadErrorResponse(err, name);
  }
}
