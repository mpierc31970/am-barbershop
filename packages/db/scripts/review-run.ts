// Hourly review job from the CLI (13-29; STAFF-23, STAFF-22; D215, D248). Dev and staff run it
// here; production runs the same runReviewJob through POST /api/jobs/review (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task, because the standalone image has no scripts.
//
// Usage:
//   npm run review:run              rescan queued scans, suspend at fix-by, Monday spot checks
//   npm run review:run -- --dry-run count what one run would do, touch nothing
//   npm run review:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_CONTENT_SCANNER / CDS_IMAGE_MODERATOR (unset = stand-ins), CDS_EMAIL_TRANSPORT
// (unset = logged-not-sent stand-in). Like the other job CLIs it signs in as the env superuser,
// not as staff. Output is one counts line (UI-SPEC "Staff CLI output"); no org name, id or
// credential is printed. Exit 1 on failure or when a step failed. The CLI has no Next cache to
// drop; the app's cached render of a held page or a suspended site expires on its own.
// Add-ons register at load (collections, alert types), as in POST /api/jobs/review.
import "@cds/addon-registry/server";
import { runReviewJob, type ReviewJobResult } from "../src/jobs/review";

const USAGE = `review:run - hourly review job: queued rescans, auto-suspend, Monday spot checks (STAFF-23, STAFF-22)

  npm run review:run              run once: rescan content saved during a scanner outage,
                                  take sites offline when a hosting notice passes its fix-by
                                  time, and on Mondays (America/Chicago) open spot checks for
                                  5 live sites (once a week)
  npm run review:run -- --dry-run count what a run would do, touch nothing
  npm run review:run -- --help    this text

Prod: POST /api/jobs/review with CDS_JOB_TOKEN, hourly.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_EMAIL_TRANSPORT and the scanner settings (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "rescan content flags queued during a scanner outage",
  "suspend sites whose hosting notice passed its fix-by time",
  "on Mondays (America/Chicago), open spot checks for 5 live sites once a week",
  "read the held-page gauges",
  "write platform_meta job:review:last_success and job:review:last_counts",
];

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

/** `Review · 2026-10-12 22:00 UTC · rescanned 2 · still queued 1 · ...` (UI-SPEC CLI output). */
function formatReviewRun(r: ReviewJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [
    `Review${r.dryRun ? " (dry run)" : ""}`,
    when,
    `rescanned ${r.rescanned}`,
    `still queued ${r.stillQueued}`,
    `suspended at fix-by ${r.autoSuspended}`,
    `spot checks opened ${r.spotChecksOpened}`,
    `held past promise ${r.heldPastPromise}`,
    `failed ${r.failedSteps.length}`,
  ].join(" · ");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length > 0) fail(`unknown argument ${unknown[0]}`);
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }

  const dryRun = args.includes("--dry-run");
  if (dryRun) for (const step of DRY_RUN_STEPS) console.log(`DRY RUN ${step}`);

  const now = new Date();
  const res = await runReviewJob({ now, dryRun });
  if (res.busy) {
    console.log("Another review run is in progress. Nothing done.");
    return;
  }
  console.log(formatReviewRun(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
