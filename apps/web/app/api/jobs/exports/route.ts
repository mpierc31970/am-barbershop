// POST /api/jobs/exports: the nightly tenant export trigger (milestone audit; TEN-12, D171,
// D187). A copy of the retention-job route. The standalone Docker image has no scripts, so
// production runs the export through this route from a daily Coolify scheduled task inside
// the app container (04:10 UTC suggested):
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/exports
// Dev and staff use `npm run tenants:export [-- --dry-run]` instead.
//
// The bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal length). A
// missing, wrong or unconfigured token gets 404 (the route does not reveal it exists), so an
// unset token fails closed. Excluded from host routing by an exact-path middleware matcher,
// so the 127.0.0.1 Host works. The heartbeat it writes (`job:exports:last_success`) is
// .planning/design/MONITOR-APP-BRIEF.md check 6 (D174, D175). The response is counts only:
// org ids and export keys stay out of the scheduled task's log.
import { createHash, timingSafeEqual } from "node:crypto";
// Add-on collections must be registered before the job walks every tenant collection.
import "@cds/addon-registry/server";
import { runNightlyExports } from "@cds/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

function authorized(req: Request): boolean {
  // Trimmed, so a token pasted with a trailing newline still matches.
  const expected = process.env.CDS_JOB_TOKEN?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!), digest(expected));
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return notFound();
  try {
    const result = await runNightlyExports();
    const counts = {
      exported: result.exported.length,
      pruned: result.pruned.length,
      failed: result.failed.length,
    };
    // A failed org is a partial run: 500, so the scheduled task shows it (no heartbeat).
    return Response.json(counts, {
      status: counts.failed > 0 ? 500 : 200,
      headers: NO_STORE,
    });
  } catch (err) {
    console.error(
      `[jobs/exports] run failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return Response.json(
      { error: "job failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** Only POST runs the job; any other method reads as absent. */
export function GET(): Response {
  return notFound();
}
