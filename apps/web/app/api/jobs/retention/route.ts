// POST /api/jobs/retention: the daily retention job trigger (09-21; LIFE-02, D283, D290;
// CONTEXT A4-Q3). A copy of the quotes-job route. The standalone Docker image has no
// scripts, so production runs the job through this route from a daily Coolify scheduled
// task inside the app container (04:30 UTC suggested):
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/retention
// Dev and staff use `npm run retention:run [-- --dry-run]` instead.
//
// T-09-21-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher (RESEARCH Pitfall 11), so the 127.0.0.1 Host works. The heartbeat it
// writes is .planning/design/MONITOR-APP-BRIEF.md check 26 (D174, D175). The response is
// counts only: deletedOrgs (ids and names) is dropped, because the scheduled task's output
// is a log (T-09-21-03; org names appear only in the staff CLI).
import { createHash, timingSafeEqual } from "node:crypto";
// Add-on collections must be registered before the job walks every tenant collection.
import "@cds/addon-registry/server";
import { runRetentionJob } from "@cds/db";

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
    const result = await runRetentionJob();
    const counts = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== "deletedOrgs"),
    );
    return Response.json(counts, { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/retention] run failed: ${err instanceof Error ? err.message : String(err)}`,
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
