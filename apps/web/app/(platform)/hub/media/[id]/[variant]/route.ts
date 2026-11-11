// GET /hub/media/<id>/<variant>: a private media read for the hub (ONB-04, CONT-19; T-06-64,
// T-06-66, T-07-12-01). The session's org is checked in the @cds/db chokepoint (another org's id
// is NotFound, never a hint). The MIME type comes from the stored variant, never the upload,
// and nosniff stops a browser second-guessing it. Cached privately for 5 minutes only.
//   - original | web | thumb: P6 intake reads through readMediaVariant (unchanged)
//   - w480 | w960 | w1600 | w2560 | video.mp4 | poster.jpg | poster.webp | captions.vtt |
//     audio.mp3: media library private derivatives through openHubMediaObject, with Range
//     (206 / 416) so audio and video can seek (07-12 choice 15)
import {
  isHubMediaVariant,
  isMediaVariant,
  openHubMediaObject,
  parseRangeHeader,
  readMediaVariant,
} from "@cds/db";
import {
  json,
  mediaContext,
  signedOut,
} from "../../../../../../lib/media-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; variant: string }> };

const PRIVATE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=300",
  "Content-Security-Policy": "default-src 'none'",
} as const;

function failure(err: unknown): Response {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "not_found" || code === "invalid_input") {
    return json(404, { error: "not_found" });
  }
  if (code === "forbidden") return json(403, { error: "forbidden" });
  console.error("[media] read failed", err);
  return json(500, { error: "failed" });
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const ctx = await mediaContext();
  if (!ctx) return signedOut();
  if (ctx instanceof Response) return ctx;
  const { id, variant } = await params;
  if (isMediaVariant(variant)) {
    try {
      const { bytes, mime } = await readMediaVariant(ctx, id, variant);
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(bytes.length),
          ...PRIVATE_HEADERS,
        },
      });
    } catch (err) {
      return failure(err);
    }
  }
  if (!isHubMediaVariant(variant)) return json(404, { error: "not_found" });
  try {
    const obj = await openHubMediaObject(ctx, id, variant);
    const range = parseRangeHeader(req.headers.get("range"), obj.size);
    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${obj.size}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const headers: Record<string, string> = {
      "Content-Type": obj.mime,
      "Accept-Ranges": "bytes",
      ...PRIVATE_HEADERS,
    };
    let status = 200;
    if (range) {
      status = 206;
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${obj.size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
    } else {
      headers["Content-Length"] = String(obj.size);
    }
    return new Response(await obj.read(range), { status, headers });
  } catch (err) {
    return failure(err);
  }
}
