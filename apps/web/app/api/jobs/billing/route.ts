// POST /api/jobs/billing: the hourly billing reconcile trigger (10-21; PAY-01, PAY-02,
// PAY-03, D244; CONTEXT A1). A copy of the retention-job route. The standalone Docker image
// has no scripts (RESEARCH Pitfall 12), so production runs the job through this route from
// an hourly Coolify scheduled task inside the app container:
//   wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/billing
// Dev and staff use `npm run billing:reconcile` (10-24) instead.
//
// T-10-21-01: the bearer is compared with CDS_JOB_TOKEN timing-safe (sha256 digests, equal
// length). A missing, wrong or unconfigured token gets 404 (the route does not reveal it
// exists), so an unset token fails closed. Excluded from host routing by an exact-path
// middleware matcher, so the 127.0.0.1 Host works. The heartbeat it writes is
// .planning/design/MONITOR-APP-BRIEF.md check 27 (D174, D175). An optional JSON body
// `{ "dryRun": true }` runs a dry run; anything else in the body is ignored. The response
// is counts only (T-10-21-03): the dry run's `planned` list stays out of the log.
import { createHash, timingSafeEqual } from "node:crypto";
import { billingCounts, runBillingJob } from "@cds/db";
import { ensurePaymentAddonDeps } from "../../../../lib/payment-deps";

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

/** `{ dryRun: true }` only; an empty, malformed or other body is a normal run. */
async function dryRunOf(req: Request): Promise<boolean> {
  try {
    const text = await req.text();
    if (text.trim() === "") return false;
    const body: unknown = JSON.parse(text);
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { dryRun?: unknown }).dryRun === true
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return notFound();
  try {
    const dryRun = await dryRunOf(req);
    // Paid add-ons install (and lapses pause them) only with the app's add-on deps (10-23).
    ensurePaymentAddonDeps();
    const result = await runBillingJob({ dryRun });
    return Response.json(billingCounts(result), { headers: NO_STORE });
  } catch (err) {
    console.error(
      `[jobs/billing] run failed: ${err instanceof Error ? err.message : String(err)}`,
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
