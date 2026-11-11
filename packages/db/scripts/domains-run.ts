// Every-5-minutes domains job from the CLI (14-41; DOM-08, DOM-01, ONB-10, LIFE-01; P14-P18).
// Dev and staff run it here; production runs the same runDomainsJob through
// POST /api/jobs/domains (bearer CDS_JOB_TOKEN) from a Coolify scheduled task (`*/5 * * * *`),
// because the standalone image has no scripts.
//
// Usage:
//   npm run domains:run              run once: backfill, moves, sending, handbacks,
//                                    offboarding, health (once per UTC day after 06:00)
//   npm run domains:run -- --dry-run count what one run would do, touch nothing
//   npm run domains:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_DNS_PROVIDER (unset = fake outside production), CDS_SENDING_DOMAINS,
// CDS_EDGE_IPV4, CDS_STORAGE_DIR / object store env. Like the other job CLIs it signs in as the
// env superuser, not as staff. Output is one counts line (UI-SPEC "Staff CLI output"); no org
// name, host or credential is printed. Exit 1 on failure or when a step failed.
// Add-ons register at load, as in POST /api/jobs/domains.
import "@cds/addon-registry/server";
import {
  domainsHealthRanAt,
  runDomainsJob,
  type DomainsJobResult,
} from "../src/jobs/domains";

const USAGE = `domains:run - domains job: moves, sending identities, handbacks, offboarding, health (P14)

  npm run domains:run              run once: give hostless sites their preview address,
                                   advance domain moves, write and check sending identities,
                                   check DNS handbacks, act on ended notices, and (once per
                                   UTC day after 06:00) run domain health
  npm run domains:run -- --dry-run count what a run would do, touch nothing
  npm run domains:run -- --help    this text

Prod: POST /api/jobs/domains with CDS_JOB_TOKEN, every 5 minutes (*/5 * * * *).
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_DNS_PROVIDER, CDS_SENDING_DOMAINS, CDS_EDGE_IPV4 (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "backfill: give active sites without an address their preview address",
  "moves: advance domain moves that are due",
  "sending: write and check sending identities for sites on CDS DNS",
  "handbacks: check DNS handbacks for sites that are leaving",
  "offboarding: act on notices that have ended",
  "health: daily domain health (after 06:00 UTC, once a day)",
  "write platform_meta job:domains:last_success and job:domains:last_counts",
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

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

/**
 * `domains:run · moves 3 advanced, 1 waiting on owner · handbacks 0 · offboarding 0 ·
 * health skipped (ran 06:00) · 1.2s` (UI-SPEC line 948).
 */
function formatDomainsRun(
  r: DomainsJobResult,
  healthRanAt: Date | null,
): string {
  const moves =
    `moves ${r.movesAdvanced} advanced, ${r.movesWaitingOwner} waiting on owner` +
    (r.movesFailed > 0 ? `, ${r.movesFailed} failed` : "") +
    (r.movesExpired > 0 ? `, ${r.movesExpired} expired` : "");
  const health = r.healthRan
    ? r.dryRun
      ? "health would run"
      : "health ran"
    : healthRanAt
      ? `health skipped (ran ${hhmm(healthRanAt)})`
      : "health skipped";
  const parts = [
    `domains:run${r.dryRun ? " (dry run)" : ""}`,
    moves,
    `handbacks ${r.handbacksChecked}`,
    `offboarding ${r.offboardingsClosed}`,
    health,
  ];
  if (r.backfilled > 0) parts.push(`preview addresses ${r.backfilled}`);
  if (r.sendingUpdated > 0) parts.push(`sending ${r.sendingUpdated}`);
  if (r.failedSteps.length > 0) parts.push(`failed ${r.failedSteps.length}`);
  parts.push(`${(r.ms / 1000).toFixed(1)}s`);
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
  const res = await runDomainsJob({ now, dryRun });
  if (res.busy) {
    console.log("Another domains run is in progress. Nothing done.");
    return;
  }
  const ranAt = res.healthRan ? null : await domainsHealthRanAt(now);
  console.log(formatDomainsRun(res, ranAt));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
