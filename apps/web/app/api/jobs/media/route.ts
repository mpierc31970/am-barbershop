// POST /api/jobs/media: the hourly media job trigger (07-27; CONT-19, CONT-20, D278). A copy
// of the quote-job route. Production runs it from a Coolify scheduled task inside the app
// container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/media
// There is no CLI runner: this route is the one trigger (dev uses the same line with curl/wget).
//
// T-07-27-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher (07-02). The heartbeat it writes is in
// .planning/design/MONITOR-APP-BRIEF.md (D174, D175). A failed step still returns 200 with
// its counts (the monitor alerts on heartbeat age); only a thrown runner gives 500.
// 07-28: passes the composed section registry and the Next invalidator to step 6 (soft-delete GC).
import { createHash, timingSafeEqual } from "node:crypto";
import { runMediaJobs } from "@cds/db";
import { nextInvalidator } from "../../../../lib/invalidator";
import { SECTION_REGISTRY } from "../../../../lib/section-registry";

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
    const result = await runMediaJobs({
      deps: {
        gc: { sections: SECTION_REGISTRY, invalidator: nextInvalidator },
      },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/media] run failed: ${err instanceof Error ? err.message : String(err)}`,
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
