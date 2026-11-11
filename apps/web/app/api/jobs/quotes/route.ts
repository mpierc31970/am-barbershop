// POST /api/jobs/quotes: the hourly quote job trigger (ONB-08, D213, D290; PD-8; RESEARCH
// Pattern 8, Pitfall 5). The standalone Docker image has no scripts, so production runs the
// job through this route from a Coolify scheduled task inside the app container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/quotes
// Dev and tests use `npm run quotes:run` instead.
//
// T-06-42: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the monitor-endpoint convention:
// the route does not reveal it exists), so an unset token fails closed. Excluded from host
// routing by an exact-path middleware matcher, so the 127.0.0.1 Host works.
// The heartbeat it writes is in .planning/design/MONITOR-APP-BRIEF.md (D174, D175).
import { createHash, timingSafeEqual } from "node:crypto";
import { runQuoteJobs } from "@cds/db";

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
    const result = await runQuoteJobs();
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/quotes] run failed: ${err instanceof Error ? err.message : String(err)}`,
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
