// Every-5-minutes health job from the CLI (13-44; STAFF-13, STAFF-14, D154). Dev and staff run
// it here; production runs the same runHealthJob through POST /api/jobs/health (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task (`*/5 * * * *`), because the standalone image
// has no scripts.
//
// Usage:
//   npm run health:run              evaluate thresholds, email staff once per incident, pull
//                                   fail-safe requests, prune old staff sessions
//   npm run health:run -- --dry-run count what one run would do, touch nothing
//   npm run health:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_STAFF_ALERT_EMAIL (else CDS_SUPPORT_EMAIL; unset = alerts skipped),
// CDS_FAILSAFE (unset = not deployed). Like the other job CLIs it signs in as the env
// superuser, not as staff. Output is one counts line; no address, org or credential is
// printed. Exit 1 on failure or when a step failed.
// Add-ons register at load, as in POST /api/jobs/health.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { runHealthJob, type HealthJobResult } from "../src/jobs/health";

const USAGE = `health:run - every-5-minutes health job: staff alerts, fail-safe pull, session prune (STAFF-13, STAFF-14)

  npm run health:run              run once: evaluate the monitor thresholds and email staff
                                  once per incident (open, critical, resolved), pull
                                  fail-safe requests, delete staff sessions older than 30 days
  npm run health:run -- --dry-run count what a run would do, touch nothing
  npm run health:run -- --help    this text

Prod: POST /api/jobs/health with CDS_JOB_TOKEN, every 5 minutes.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_STAFF_ALERT_EMAIL, CDS_FAILSAFE (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "evaluate every health check and count incidents that would open or close (no email)",
  "skip the fail-safe pull",
  "count staff sessions older than 30 days",
  "write nothing (no incident row, no heartbeat)",
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

/** `Health · 2026-10-16 12:05 UTC · checks 20 · opened 1 · closed 0 · emails 1 · ...`. */
function formatHealthRun(r: HealthJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [
    `Health${r.dryRun ? " (dry run)" : ""}`,
    when,
    `checks ${r.checks}`,
    `opened ${r.opened}`,
    `escalated ${r.escalated}`,
    `closed ${r.closed}`,
    `emails ${r.emailsSent}`,
    `skipped ${r.emailSkipped}`,
    `fail-safe pulled ${r.failsafePulled}`,
    `sessions pruned ${r.sessionsPruned}`,
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
  const res = await runHealthJob({
    now,
    dryRun,
    manifests: ADDON_REGISTRY.list(),
  });
  if (res.busy) {
    console.log("Another health run is in progress. Nothing done.");
    return;
  }
  console.log(formatHealthRun(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
