// GET /api/edge/ask?domain=<host>: the Caddy on_demand_tls "ask" endpoint (14-17; DOM-06, D13,
// P14-P7). The documented alternative to the Traefik route list (/api/edge/routes): before Caddy
// issues a certificate for a name it asks here, and only a 2xx lets it proceed.
//
// "The control plane decides; the edge asks." The answer is `edgeAllowed(domain)` from @cds/db:
// an exact org_hosts match (preview row, or a custom/redirect row with verified_at, on an active
// org). No DNS lookup and no network call happen here. T-14-17-01: anyone can call this, so it
// answers 404 by default and a database error answers 503 (Caddy treats any non-2xx as deny,
// so a blip never issues a certificate). WR-A11: Caddy is the only caller, so there is no
// per-IP bucket. `edgeAskAllowed` answers from an allowed-host snapshot (one read per 30 s),
// so known hosts are always answered; only asks for names that are not allowed are limited,
// per registrable domain (429). Nothing is logged but an error class name. Excluded from host
// routing by a middleware matcher (14-18).
import { beginEdgeAskMiss, edgeAskAllowed } from "@cds/db";
import { normalizeHost } from "@cds/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_DOMAIN = 253;

function answer(body: string, status: number): Response {
  return new Response(body, { status, headers: NO_STORE });
}

export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("domain") ?? "";
  if (raw.length === 0 || raw.length > MAX_DOMAIN) {
    return answer("Not Found", 404);
  }
  const domain = normalizeHost(raw);
  if (!domain) return answer("Not Found", 404);
  try {
    if (await edgeAskAllowed(domain)) return answer("ok", 200);
    try {
      beginEdgeAskMiss(domain);
    } catch {
      return answer("Too Many Requests", 429);
    }
    return answer("Not Found", 404);
  } catch (err) {
    console.error(
      `[edge/ask] check failed: ${err instanceof Error ? err.name : "Error"}`,
    );
    return answer("Service Unavailable", 503);
  }
}

function absent(): Response {
  return answer("Not Found", 404);
}

/** Only GET asks; any other method reads as absent. */
export { absent as POST, absent as PUT, absent as PATCH, absent as DELETE };
