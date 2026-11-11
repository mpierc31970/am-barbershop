// POST /api/m on tenant hosts: the cookieless site metrics beacon (DASH-11, DASH-15, DASH-32;
// 11-31 choice 4; RESEARCH Pattern 11, Pitfalls 10-11).
//
// The site comes only from the middleware's tenant header via siteForRoute (unknown host =
// 404, T-11-31-04). Order: content type (text/plain from sendBeacon, or application/json; else
// 415) -> body capped at 2 KB before parsing (413) -> bot UA (Lighthouse, HeadlessChrome) ->
// per-IP sliding window (60/min) -> preview host (D170) -> org live (DASH-32) -> JSON parse
// and clamp -> ingestBeacon (in-memory; flushed every 60 s by startBeaconFlusher). Every drop
// answers the same 204, so a visitor learns nothing. The IP is used only as a rate-limit key:
// never stored, never logged; logs carry only the error class (T-11-31-03). No GET export.
import {
  MAX_BEACON_BYTES,
  ingestBeacon,
  orgIsLive,
  parseBeacon,
  startBeaconFlusher,
  takeBeaconSlot,
} from "@cds/db";
import { isBot } from "@cds/core/analytics";
import { readCappedText } from "../../../../../lib/capped-body";
import { clientIp } from "../../../../../lib/session";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ host: string }> };

function status(code: number): Response {
  return new Response(null, { status: code, headers: NO_STORE });
}

export async function POST(
  req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return status(404);

  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("text/plain") && !type.startsWith("application/json")) {
    return status(415);
  }
  let text: string | null;
  try {
    text = await readCappedText(req, MAX_BEACON_BYTES);
  } catch {
    return status(204);
  }
  if (text === null) return status(413);

  if (isBot(req.headers.get("user-agent"))) return status(204);
  if (!takeBeaconSlot(await clientIp())) return status(204);
  if (site.hostKind === "preview") return status(204);

  try {
    if (!(await orgIsLive(site.orgId))) return status(204);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return status(204);
    }
    const event = parseBeacon(raw);
    if (!event) return status(204);
    startBeaconFlusher();
    await ingestBeacon(site, event);
  } catch (err) {
    console.error(
      "[site] beacon failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
  return status(204);
}
