// Hourly support job from the CLI (12-31; COMM-08, COMM-09, COMM-11, SUPPORT-02). Dev and staff
// run it here; production runs the same runSupportJobs through POST /api/jobs/support (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task, because the standalone image has no scripts.
//
// Usage:
//   npm run support:run              auto-close, SLA warnings, windows, rescans, prunes
//   npm run support:run -- --dry-run count what one run would do, touch nothing
//   npm run support:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_SUPPORT_EMAIL (SLA warnings; unset = none sent), CDS_EMAIL_TRANSPORT (unset
// = logged-not-sent stand-in), CDS_FILE_SCANNER (unset = no rescan). Like the other job CLIs it
// signs in as the env superuser, not as staff. Output is one counts line (UI-SPEC "Staff CLI
// output"); no email address, org name or credential is printed. Exit 1 on failure or when a
// step failed.
// Add-ons register at load (collections, alert types), as in POST /api/jobs/support.
import "@cds/addon-registry/server";
import { runSupportJobs, type SupportJobResult } from "../src/jobs/support";

const USAGE = `support:run - hourly support job: auto-close, SLA warnings, planned-work windows (COMM-09, SUPPORT-02, COMM-11)

  npm run support:run              run once: close tickets Resolved 7 days with no reply,
                                   email CDS support about tickets near or past their SLA
                                   (once each), alert sites when a planned-work window
                                   starts, clear ended windows, rescan pending attachments
                                   (when a scanner is set), prune held drafts and staged
                                   uploads
  npm run support:run -- --dry-run count what a run would do, touch nothing
  npm run support:run -- --help    this text

Prod: POST /api/jobs/support with CDS_JOB_TOKEN, hourly.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_SUPPORT_EMAIL, CDS_EMAIL_TRANSPORT, CDS_FILE_SCANNER (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "close tickets Resolved for 7 days with no tenant reply",
  "email CDS support once per ticket due within 4 business hours or past due",
  "alert sites once when a planned-work window starts",
  "clear planned-work windows that have ended",
  "rescan pending attachments (only when a scanner is configured)",
  "prune held drafts older than 30 days and staged uploads older than 24 hours",
  "write platform_meta job:support:last_success and job:support:last_counts",
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

/** `Support · 2026-10-13 14:00 UTC · closed after 7 days 1 · ...` (UI-SPEC CLI output). */
function formatSupportRun(r: SupportJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [
    `Support${r.dryRun ? " (dry run)" : ""}`,
    when,
    `closed after 7 days ${r.closed}`,
    `SLA warnings sent ${r.slaWarned}`,
    `windows started ${r.windowsStarted} (alerts ${r.noticeAlerts})`,
    `windows cleared ${r.windowsCleared}`,
    `held drafts pruned ${r.heldPruned}`,
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
  const res = await runSupportJobs({ now, dryRun });
  if (res.busy) {
    console.log("Another support run is in progress. Nothing done.");
    return;
  }
  console.log(formatSupportRun(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
