// GET /api/edge/routes: the Traefik HTTP-provider dynamic config (14-17; DOM-06, D13, P14-P7).
// The Coolify proxy polls it (providers.http.endpoint, every 10 s) with
// `Authorization: Bearer $CDS_EDGE_TOKEN`; wiring is docs/ops/edge-wiring.md (HUMAN-CHECK).
//
// T-14-17-02: the list names every tenant domain, so the bearer is compared with CDS_EDGE_TOKEN
// timing-safe (sha256 digests, equal length, copied from the job routes). A missing, wrong or
// unconfigured token gets 404 (the route does not reveal it exists), so an unset token fails
// closed. T-14-17-03: when the read fails (PocketBase down, CDS_EDGE_SERVICE unset) the answer
// is a 500, never an empty 200 config: Traefik keeps its last good config on an error, while an
// empty config would drop every tenant route. Excluded from host routing by a middleware
// matcher (14-18), so the container-internal Host works.
import { createHash, timingSafeEqual } from "node:crypto";
import { edgeRoutes } from "@cds/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

function authorized(req: Request): boolean {
  // Trimmed, so a token pasted with a trailing newline still matches.
  const expected = process.env.CDS_EDGE_TOKEN?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!), digest(expected));
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return notFound();
  let config: Awaited<ReturnType<typeof edgeRoutes>>;
  try {
    config = await edgeRoutes();
  } catch (err) {
    console.error(
      `[edge/routes] read failed: ${err instanceof Error ? err.name : "Error"}`,
    );
    return Response.json(
      { error: "routes unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
  return Response.json(config, { status: 200, headers: NO_STORE });
}

/** Only GET answers; any other method reads as absent. */
export {
  notFound as POST,
  notFound as PUT,
  notFound as PATCH,
  notFound as DELETE,
};
