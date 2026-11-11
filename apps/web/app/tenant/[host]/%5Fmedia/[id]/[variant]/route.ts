// GET/HEAD /_media/<asset-id>/<variant> on tenant hosts: the app-served media stand-in
// (CONT-19, CONT-20, CONT-33, D255; 07-09). The folder is `%5Fmedia` because `_media` would be
// a private App Router folder (RESEARCH Pitfall 2). The host is trusted only through
// siteForRoute; the @cds/db read is bound to that site's org and builds the object key from
// the database row, never from this URL. Every refusal is 404 (never a hint); 416 only for
// an unsatisfiable Range on a servable object. Range/206 lets browsers seek video.
import {
  noteMediaOriginError,
  openPublicMediaObject,
  parseRangeHeader,
} from "@cds/db";
import { siteForRoute } from "../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ host: string; id: string; variant: string }>;
};

function bare(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}

/**
 * WR-C01: asset ids are content-versioned (07-CONTEXT media choice 2), so image, video and
 * audio variants stay `immutable`. Captions and posters are replaced in place behind the
 * same URL, so they get a short public cache instead.
 */
function publicCacheControl(tokenized: boolean, variant: string): string {
  if (tokenized) return "private, max-age=3600";
  if (variant === "captions.vtt" || variant.startsWith("poster.")) {
    return "public, max-age=300";
  }
  return "public, max-age=31536000, immutable";
}

async function serve(
  req: Request,
  { params }: Params,
  withBody: boolean,
): Promise<Response> {
  const { host, id, variant } = await params;
  const site = await siteForRoute(host);
  if (!site) return bare(404);
  const q = new URL(req.url).searchParams;
  try {
    const obj = await openPublicMediaObject(site, {
      id,
      variant,
      w: q.get("w"),
      e: q.get("e"),
      t: q.get("t"),
    });
    const range = parseRangeHeader(req.headers.get("range"), obj.size);
    if (range === "unsatisfiable") {
      return bare(416, { "Content-Range": `bytes */${obj.size}` });
    }
    const headers: Record<string, string> = {
      "Content-Type": obj.mime,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Content-Disposition": "inline",
      "Cache-Control": publicCacheControl(obj.tokenized, variant),
    };
    if (obj.tokenized) headers["X-Robots-Tag"] = "noindex";
    let status = 200;
    if (range) {
      status = 206;
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${obj.size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
    } else {
      headers["Content-Length"] = String(obj.size);
    }
    const body = withBody ? await obj.read(range) : null;
    return new Response(body, { status, headers });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === "not_found" || code === "invalid_input") return bare(404);
    // Never log the key or token: the error carries neither (HTTP status only for S3).
    console.error("[media] public read failed", err);
    // 07-27: counted for the monitor's media.origin_errors_1h (counts only).
    noteMediaOriginError();
    return bare(500);
  }
}

export async function GET(req: Request, ctx: Params): Promise<Response> {
  return serve(req, ctx, true);
}

export async function HEAD(req: Request, ctx: Params): Promise<Response> {
  return serve(req, ctx, false);
}
