// Hourly quote job from the CLI (ONB-08, D213, D290; RESEARCH Pattern 8). Dev and tests run
// it here; production runs the same runQuoteJobs through POST /api/jobs/quotes (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task, because the standalone image has no scripts
// (RESEARCH Pitfall 5, PD-8).
//
// Usage:
//   npm run quotes:run              reminders (day 1, day 3), expiry, purges, heartbeat
//   npm run quotes:run -- --dry-run print what one run does, touch nothing
//   npm run quotes:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_LINK_SECRET / CDS_PLATFORM_URL (reminder links), CDS_EMAIL_TRANSPORT
// (unset = logged-not-sent stand-in). Output is PASS / FAIL lines only; no email address or
// credential is printed. Exit 1 on failure.
import { runQuoteJobs, type QuoteJobResult } from "../src/jobs/quotes";

const USAGE = `quotes:run - hourly quote job: reminders, expiry, purges (ONB-08)

  npm run quotes:run              run once: reminders (day 1, day 3), expiry, purges, heartbeat
  npm run quotes:run -- --dry-run print what a run does, touch nothing
  npm run quotes:run -- --help    this text

Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_LINK_SECRET, CDS_PLATFORM_URL, CDS_EMAIL_TRANSPORT (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "reminder 1 to saved quotes >= 24 h after saving (skip if changed in the last 12 h)",
  "reminder 2 to saved quotes >= 72 h after saving (the last reminder)",
  "purge drafts untouched for 30 days",
  "flip saved/draft quotes past expiry to expired",
  "purge expired/blocked quotes 90 days after expiry",
  "delete unverified users older than 24 h with no membership",
  "write platform_meta job:quotes:last_success and job:quotes:last_counts",
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

function formatResult(r: QuoteJobResult): string {
  return [
    `reminded ${r.reminded1 + r.reminded2} (day 1: ${r.reminded1}, day 3: ${r.reminded2})`,
    `skipped active ${r.skippedActive}`,
    `suppressed ${r.suppressed}`,
    `send failures ${r.sendFailures}`,
    `expired ${r.expired}`,
    `purged drafts ${r.purgedDrafts}`,
    `purged leads ${r.purgedLeads}`,
    `purged users ${r.purgedUsers}`,
    `reconciled ${r.reconciled}`,
  ].join(", ");
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

  if (args.includes("--dry-run")) {
    for (const step of DRY_RUN_STEPS) console.log(`DRY RUN ${step}`);
    console.log("DRY RUN nothing written");
    return;
  }

  const res = await runQuoteJobs();
  console.log(`PASS ${formatResult(res)}`);
}

main().catch((err: unknown) => fail(describeError(err)));
