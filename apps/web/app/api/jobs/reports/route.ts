// POST /api/jobs/reports: the daily trigger of the monthly "Your site this month" email job
// (11-34; DASH-12, D189). A copy of the alerts-job route. The job acts only in the first
// days of each business month and sends each org once per month, so a daily trigger is
// safe and a missed day heals itself. The standalone Docker image has no scripts, so
// production runs it from a Coolify scheduled task once a day (`30 13 * * *`, morning in US
// time zones) inside the app container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/reports
// Dev and staff use `npm run reports:monthly [-- --dry-run]` instead.
//
// T-11-34-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher, so the 127.0.0.1 Host works. The heartbeat it writes is
// .planning/design/MONITOR-APP-BRIEF.md check 31 (D174, D175). The response is counts only.
import { createHash, timingSafeEqual } from "node:crypto";
// Add-ons register at load, so the job runs with the same add-on set as the app.
import "@cds/addon-registry/server";
import { runMonthlyReports } from "@cds/db";

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
    return Response.json(await runMonthlyReports(), { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/reports] run failed: ${err instanceof Error ? err.name : "Error"}`,
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
