// /hub/api/media/stock: Free photos for the media picker (07-30 choices 9, 10; CONT-28,
// D-UI-P7-11; T-07-30-06, T-07-30-07, T-07-30-08). The org comes from the session only.
//   GET                    -> { available }            (no source configured -> false)
//   GET ?q=&page=          -> { photos, hasMore }       (content write; 60 per org per hour)
//   POST { use: { id } }   -> { ok: true }              (Unsplash's required download ping)
// Keys never leave the server; upstream errors are never forwarded. Without a source every
// search is 404 and the picker never shows the tab.
import { Forbidden } from "@cds/core";
import {
  STOCK_ID_RE,
  STOCK_PAGE_MAX,
  STOCK_QUERY_MAX,
  STOCK_RATE_COPY,
  getStockPhotoSource,
  requirePermission,
  takeStockSearch,
  type OrgContext,
} from "@cds/db";
import { readCappedText } from "../../../../../../lib/capped-body";
import { mediaContext, sameOrigin } from "../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" } as const;
const BODY_MAX = 4 * 1024;

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function canWrite(ctx: OrgContext): boolean {
  try {
    requirePermission(ctx, "content", "write");
    return true;
  } catch (err) {
    if (err instanceof Forbidden) return false;
    throw err;
  }
}

export async function GET(req: Request): Promise<Response> {
  const ctx = await mediaContext();
  if (!ctx) return reply(401, { error: "signed_out" });
  if (ctx instanceof Response) return ctx;
  const source = getStockPhotoSource();
  const sp = new URL(req.url).searchParams;
  if (!sp.has("q")) return reply(200, { available: source !== null });
  if (!source) return reply(404, { error: "not_available" });
  if (!canWrite(ctx)) return reply(403, { error: "forbidden" });
  const q = (sp.get("q") ?? "").trim().slice(0, STOCK_QUERY_MAX);
  if (q === "") return reply(200, { photos: [], hasMore: false });
  const raw = sp.get("page") ?? "1";
  const page = /^\d{1,3}$/.test(raw)
    ? Math.min(STOCK_PAGE_MAX, Math.max(1, Number(raw)))
    : 1;
  if (!takeStockSearch(ctx.orgId)) {
    return reply(429, { error: "rate_limited", message: STOCK_RATE_COPY });
  }
  try {
    const result = await source.search(q, page);
    return reply(200, { photos: result.photos, hasMore: result.hasMore });
  } catch {
    console.error("[stock] search failed");
    return reply(502, { error: "unavailable" });
  }
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await mediaContext();
  if (!ctx) return reply(401, { error: "signed_out" });
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(req)) return reply(403, { error: "forbidden" });
  const source = getStockPhotoSource();
  if (!source) return reply(404, { error: "not_available" });
  if (!canWrite(ctx)) return reply(403, { error: "forbidden" });
  // WR-C05: capped read, so a chunked body with no Content-Length is never buffered whole.
  let text: string | null;
  try {
    text = await readCappedText(req, BODY_MAX);
  } catch {
    return reply(400, { error: "invalid" });
  }
  if (text === null) return reply(413, { error: "too_large" });
  let id: unknown;
  try {
    const body = JSON.parse(text) as { use?: { id?: unknown } };
    id = body?.use?.id;
  } catch {
    return reply(400, { error: "invalid" });
  }
  if (typeof id !== "string" || !STOCK_ID_RE.test(id)) {
    return reply(400, { error: "invalid" });
  }
  try {
    await source.registerUse?.(id);
  } catch {
    // The ping is best effort; the photo is already chosen.
  }
  return reply(200, { ok: true });
}
