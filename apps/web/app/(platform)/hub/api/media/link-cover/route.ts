// POST /hub/api/media/link-cover: copy a pasted video link's cover into the signed-in org's
// media library, once per video (07-23 choices 1-2; CONT-34, D119; T-07-23-01/02/03).
// Invariant 1: the org comes from the session only; the body may hold just
// { provider, provider_id, title } (strings), anything else in it is ignored. The fetch
// itself (fixed host, no redirects, capped) lives in @cds/db captureLinkCover.
//   200 { asset, thumbUrl }      the stored copy (new or reused)
//   200 { asset: null, reason }  none | unavailable | allowance (the editor shows helper copy)
// Every response is `Cache-Control: private, no-store`. Never logs ids or URLs.
import { captureLinkCover } from "@cds/db";
import {
  MEDIA_FORBIDDEN_COPY,
  mediaContext,
  sameOrigin,
} from "../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" } as const;
const BODY_MAX = 2 * 1024;
const PROVIDER = /^[a-z-]{1,32}$/;
const PROVIDER_ID_MAX = 200;
const TITLE_MAX = 500;
const FAILED_COPY = "We couldn't copy the cover. Try again.";

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function codeOf(err: unknown): unknown {
  return typeof err === "object" && err !== null
    ? (err as { code?: unknown }).code
    : undefined;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return reply(403, { error: "forbidden" });
  const ctx = await mediaContext();
  if (!ctx) return reply(401, { error: "signed_out" });
  if (ctx instanceof Response) return ctx;

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    return reply(413, { error: "too_large" });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return reply(400, { error: "bad_request" });
  }
  if (text.length > BODY_MAX) return reply(413, { error: "too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reply(400, { error: "bad_request" });
  }
  const { provider, provider_id, title } = body as {
    provider?: unknown;
    provider_id?: unknown;
    title?: unknown;
  };
  if (
    typeof provider !== "string" ||
    !PROVIDER.test(provider) ||
    typeof provider_id !== "string" ||
    provider_id.length > PROVIDER_ID_MAX ||
    (title !== undefined &&
      (typeof title !== "string" || title.length > TITLE_MAX))
  ) {
    return reply(400, { error: "bad_request" });
  }

  try {
    const res = await captureLinkCover(ctx, {
      provider,
      providerId: provider_id,
      title: typeof title === "string" ? title : "",
    });
    return res.ok
      ? reply(200, { asset: res.asset, thumbUrl: res.thumbUrl })
      : reply(200, { asset: null, reason: res.reason });
  } catch (err) {
    const code = codeOf(err);
    if (code === "forbidden" || code === "impersonation_denied") {
      return reply(403, { error: MEDIA_FORBIDDEN_COPY });
    }
    console.error("[media] link cover failed");
    return reply(500, { error: FAILED_COPY });
  }
}
