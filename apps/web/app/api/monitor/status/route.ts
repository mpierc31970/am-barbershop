// GET /api/monitor/status: the monitor app's read-only status document (13-40; STAFF-16, D175,
// D290, P13-P28; MONITOR-APP-BRIEF.md §4). A copy of the job-route auth with its own token:
//   curl -H "Authorization: Bearer $MONITOR_TOKEN" https://<platform-host>/api/monitor/status
//
// T-13-40-02/03: the bearer is compared with MONITOR_TOKEN timing-safe (sha256 digests). A
// missing, wrong or unconfigured token gets 404, and so does every other method, so the route
// never reveals it exists (never 405). T-13-40-04: a 15 s module memo (lib/monitor-memo). The
// body is ids, names, counts, timestamps and states only (monitorStatus allowlist). Excluded
// from host routing by an exact-path middleware matcher, so any Host works.
import { createHash, timingSafeEqual } from "node:crypto";
// Add-ons register at load: premium[] enumerates the same registry as the app (Invariant 4).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { monitorStatus } from "@cds/db";
import { memoizedMonitor } from "../../../../lib/monitor-memo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

function authorized(req: Request): boolean {
  const expected = process.env.MONITOR_TOKEN?.trim();
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
  try {
    const doc = await memoizedMonitor(() =>
      monitorStatus({ manifests: ADDON_REGISTRY.list() }),
    );
    return Response.json(doc, { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[monitor/status] failed: ${err instanceof Error ? err.name : "Error"}`,
    );
    return Response.json(
      { error: "status unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** Only GET answers; every other method reads as absent (never 405). */
export function POST(): Response {
  return notFound();
}
export function PUT(): Response {
  return notFound();
}
export function PATCH(): Response {
  return notFound();
}
export function DELETE(): Response {
  return notFound();
}
export function OPTIONS(): Response {
  return notFound();
}
export function HEAD(): Response {
  return notFound();
}
