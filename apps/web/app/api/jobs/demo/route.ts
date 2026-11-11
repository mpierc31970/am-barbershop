// POST /api/jobs/demo: the hourly demo reset trigger (13-31; STAFF-18, D293, P13-P13). A copy of
// the review-job route. The standalone Docker image has no scripts, so production runs the job
// through this route from a Coolify scheduled task (`30 * * * *`) inside the app container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/demo
// The job acts only at 3 am America/Chicago, once a day; every other hour it answers
// `skippedHour: 1`. Dev and staff use `npm run demo:reset [-- --now] [-- --dry-run]` instead.
//
// T-13-31-04: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher, so the 127.0.0.1 Host works. The heartbeat it writes is
// .planning/design/MONITOR-APP-BRIEF.md check 36 (D174, D175). The response is counts only (no
// org id). The seed needs the add-on registry and the composed section registry, which only the
// app may import (P13-P7); the Next invalidator drops the demo site's cached render.
import { createHash, timingSafeEqual } from "node:crypto";
// Add-ons register at load, so the job runs with the same add-on set as the app.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { runDemoResetJob } from "@cds/db";
import { nextInvalidator } from "../../../../lib/invalidator";
import { SECTION_REGISTRY } from "../../../../lib/section-registry";

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
    return Response.json(
      await runDemoResetJob({
        addons: ADDON_REGISTRY,
        sections: SECTION_REGISTRY,
        invalidator: nextInvalidator,
      }),
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error(
      `[jobs/demo] run failed: ${err instanceof Error ? err.name : "Error"}`,
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
