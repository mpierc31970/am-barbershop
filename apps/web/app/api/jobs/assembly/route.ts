// POST /api/jobs/assembly: the hourly assembly sweep trigger (08-17; TMPL-02, TMPL-04;
// CONTEXT A2-Q1, A2-Q4). A copy of the media-job route. Production runs it from a Coolify
// scheduled task inside the app container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/assembly
// Send to CDS enqueues assembly at once; this sweep is the safety net and the trigger for
// orgs that reach ready_for_build through fit approval or the quotes reconcile.
//
// T-08-17-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher. The heartbeat it writes is in .planning/design/MONITOR-APP-BRIEF.md
// check 25 (D174, D175). A failed org still returns 200 with the counts (no org ids); only a
// thrown runner gives 500.
import { createHash, timingSafeEqual } from "node:crypto";
import { runAssemblyJobs } from "@cds/db";
import { assemblyDeps } from "../../../../lib/assembly-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

function authorized(req: Request): boolean {
  // IN-C01: trimmed, so a token pasted with a trailing newline still matches.
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
    const result = await runAssemblyJobs({ deps: assemblyDeps() });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/assembly] run failed: ${err instanceof Error ? err.message : String(err)}`,
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
