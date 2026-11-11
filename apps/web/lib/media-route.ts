// Shared helpers for the hub media routes (ONB-04; RESEARCH Pattern 4, Pitfall 1;
// T-06-63, T-06-64, T-06-66). Server-only: the session helper reads next/headers.
//
// Route handlers (not server actions) carry uploads so the browser can show real progress
// (XHR upload.onprogress) while serverActions.bodySizeLimit stays 2 MB. Every response is JSON
// with no-store; errors carry the UI-SPEC copy in `error`.
import type { OrgContext } from "@cds/db";
import { UPLOAD_COPY } from "@cds/db";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { AGREEMENT_GATE_COPY } from "./agreement-gate";
import { agreementBlocks, getHubSession } from "./session";

/** Multipart framing and the kind / alt fields on top of the 20 MB file. */
export const MULTIPART_OVERHEAD = 64 * 1024;

/** Slack on top of one 8 MiB chunk part (07-12 chunked audio/video uploads). */
export const CHUNK_OVERHEAD = 16 * 1024;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export const MEDIA_FORBIDDEN_COPY =
  "Only the site owner or an admin can add photos.";
export const MEDIA_KIND_COPY = "That kind of photo isn't supported.";

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * The signed-in member's org context; null when signed out; a ready 403
 * `agreement_required` response when the re-acceptance gate refuses the request (review
 * WR-C01: an outdated Owner cannot keep writing media through these route handlers).
 * Callers: `if (!ctx) return signedOut(); if (ctx instanceof Response) return ctx;`.
 */
export async function mediaContext(): Promise<OrgContext | Response | null> {
  const session = await getHubSession();
  if (!session) return null;
  if (await agreementBlocks(session)) return agreementRequired();
  return session.ctx;
}

/** ERR-GATE as a route answer; `error` is a sentence, so the media clients show it. */
export function agreementRequired(): Response {
  return Response.json(
    { error: AGREEMENT_GATE_COPY, code: "agreement_required" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function signedOut(): Response {
  return json(401, { error: "signed_out" });
}

/**
 * A browser POST from another origin is refused (defence in depth on top of the SameSite=Lax
 * session cookie). No Origin header (a non-browser client) is allowed: it carries no cookie
 * a third-party page could have attached.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const own = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
    .flatMap((h) => (h ? h.split(",").map((s) => s.trim()) : []))
    .filter((h) => h !== "");
  return own.includes(host);
}

type CodedError = { code?: unknown; reason?: unknown; message?: unknown };

/** Map a chokepoint error to a JSON response with the owner-facing copy. */
export function uploadErrorResponse(err: unknown): Response {
  const e = (typeof err === "object" && err !== null ? err : {}) as CodedError;
  const message = typeof e.message === "string" ? e.message : "";
  switch (e.code) {
    case "upload_rejected":
      return json(e.reason === "too_big" ? 413 : 400, {
        error: message,
        reason: e.reason,
      });
    case "allowance_exceeded":
      // USAGE-FULL (07-10/07-12, D278): the 2 GB allowance would be passed.
      return json(413, { error: message, reason: "allowance" });
    case "invalid_input":
      return json(400, { error: message || UPLOAD_COPY.failed });
    case "forbidden":
    case "impersonation_denied":
      return json(403, { error: MEDIA_FORBIDDEN_COPY });
    case "not_found":
      return json(404, { error: "not_found" });
    default:
      console.error("[media] upload failed", err);
      return json(500, { error: UPLOAD_COPY.failed });
  }
}

// ---- support uploads (12-07 choice 9) ----

/** Map a support upload error to JSON with the UI-SPEC copy for that file. */
export function supportUploadErrorResponse(
  err: unknown,
  fileName: string,
): Response {
  const e = (typeof err === "object" && err !== null ? err : {}) as CodedError;
  const name = fileName.slice(0, 120) || "This file";
  switch (e.code) {
    case "rate_limited":
      return json(429, {
        error: SUPPORT_UI_COPY.RATE_UPLOADS,
        reason: "rate_limited",
      });
    case "impersonation_denied":
      return json(403, {
        error: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT,
        reason: "impersonating",
      });
    case "forbidden":
      return json(403, {
        error: SUPPORT_UI_COPY.VIEWER_READONLY,
        reason: "forbidden",
      });
    case "file_too_big":
      return json(413, {
        error: SUPPORT_UI_COPY.FILE_TOO_BIG(name),
        reason: "too_big",
      });
    case "file_type":
      return json(415, {
        error: SUPPORT_UI_COPY.FILE_TYPE(name),
        reason: "type",
      });
    case "file_refused":
      return json(422, {
        error: SUPPORT_UI_COPY.FILE_REFUSED(name),
        reason: "refused",
      });
    case "invalid_input":
      return json(400, {
        error: SUPPORT_UI_COPY.FILE_FAILED(name),
        reason: "failed",
      });
    // Expected refusals are not server failures: no 500, no error log (review IN-B02).
    case "not_found":
      return json(404, {
        error: SUPPORT_UI_COPY.FILE_FAILED(name),
        reason: "not_found",
      });
    case "agreement_required":
      return agreementRequired();
    default:
      console.error(
        "[support] upload failed",
        err instanceof Error ? err.name : typeof err,
      );
      return json(500, {
        error: SUPPORT_UI_COPY.FILE_FAILED(name),
        reason: "failed",
      });
  }
}
