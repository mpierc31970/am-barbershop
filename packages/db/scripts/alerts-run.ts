// Every-5-minutes alert job from the CLI (11-23; DASH-35, DASH-36, D313). Dev and staff run it
// here; production runs the same runAlertJobs through POST /api/jobs/alerts (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task, because the standalone image has no scripts.
//
// Usage:
//   npm run alerts:run              release held pushes, collapse, retry, 7am summary, prune
//   npm run alerts:run -- --dry-run count what one run would do, touch nothing
//   npm run alerts:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_PLATFORM_URL (summary links), CDS_EMAIL_TRANSPORT (unset = logged-not-sent
// stand-in), VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (unset = fake push sender).
// Output is one counts line (UI-SPEC "Staff CLI output"); no email address, endpoint or
// credential is printed. Exit 1 on failure or when a step failed.
// Add-ons register at load (collections, alert types), as in POST /api/jobs/alerts (11-50).
import "@cds/addon-registry/server";
import { runAlertJobs, type AlertJobResult } from "../src/alerts/jobs";

const USAGE = `alerts:run - every-5-minutes alert job: held pushes, collapse, morning summary (DASH-35, DASH-36)

  npm run alerts:run              run once: release held pushes after quiet hours (one per
                                  person), collapse bursts, retry failed pushes once, send the
                                  7am morning summary (skipped when empty), prune old alerts
  npm run alerts:run -- --dry-run count what a run would do, touch nothing
  npm run alerts:run -- --help    this text

Prod: POST /api/jobs/alerts with CDS_JOB_TOKEN, every 5 minutes.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_PLATFORM_URL, CDS_EMAIL_TRANSPORT, VAPID_* (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "release held pushes for people past their quiet hours (one push each; bursts collapse)",
  "retry pushes that failed in the last 30 minutes, once",
  "send the 7am morning summary to people with summary alerts (skipped when empty)",
  "prune read alerts older than 90 days and any alert older than 180 days",
  "write platform_meta job:alerts:last_success and job:alerts:last_counts",
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

/** `Alerts · 2026-10-11 07:00 UTC · push sent 4 · collapsed 2 · ...` (UI-SPEC CLI output). */
function formatResult(r: AlertJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const parts = [
    `Alerts${r.dryRun ? " (dry run)" : ""}`,
    when,
    `push sent ${r.pushSent}`,
    `collapsed ${r.collapsed}`,
    `held for quiet hours ${r.heldQuiet}`,
    `held to collapse ${r.heldCollapse}`,
    `retried ${r.retried}`,
    `morning summaries ${r.digestsSent} (skipped empty ${r.digestsSkippedEmpty})`,
    `pruned ${r.pruned}`,
    `failed ${r.pushFailed + r.digestFailures}`,
  ];
  return parts.join(" · ");
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
  const res = await runAlertJobs({ now, dryRun });
  if (res.busy) {
    console.log("Another alerts run is in progress. Nothing done.");
    return;
  }
  console.log(formatResult(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
