// POST /api/jobs/review: the hourly review job trigger (13-29; STAFF-23, STAFF-22; D215, D248).
// A copy of the support-job route. The standalone Docker image has no scripts, so production
// runs the job through this route from a Coolify scheduled task (`0 * * * *`) inside the app
// container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/review
// Dev and staff use `npm run review:run [-- --dry-run]` instead.
//
// T-13-29-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher, so the 127.0.0.1 Host works. The heartbeat it writes is
// .planning/design/MONITOR-APP-BRIEF.md check 33 (D174, D175). The response is counts only
// (T-13-29-03: no org id). The Next invalidator drops a held page's and a suspended site's
// cached render.
import { createHash, timingSafeEqual } from "node:crypto";
// Add-ons register at load, so the job runs with the same add-on set as the app.
import "@cds/addon-registry/server";
import { runReviewJob } from "@cds/db";
import { nextInvalidator } from "../../../../lib/invalidator";

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
    return Response.json(await runReviewJob({ invalidator: nextInvalidator }), {
      headers: NO_STORE,
    });
  } catch (err) {
    console.error(
      `[jobs/review] run failed: ${err instanceof Error ? err.name : "Error"}`,
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
