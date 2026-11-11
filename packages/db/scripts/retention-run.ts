// Daily retention job from the CLI (09-21; LIFE-02, D283, D290; CONTEXT A4-Q3). Staff and
// dev run it here; production runs the same runRetentionJob through POST /api/jobs/retention
// (bearer CDS_JOB_TOKEN) from a daily Coolify scheduled task, because the standalone image
// has no scripts (RESEARCH Pitfall 5).
//
// Usage:
//   npm run retention:run              delete what is due, write the heartbeat
//   npm run retention:run -- --dry-run show what would be deleted, touch nothing
//   npm run retention:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script). Output is the UI-SPEC report; org names appear only here (choice 3), never in
// logs or the heartbeat. Exit 0 unless the job throws (failed steps are reported, exit 0;
// the heartbeat shows them to the monitor).
// Add-on collections must be registered before the job walks every tenant collection.
import "@cds/addon-registry/server";
import { runRetentionJob } from "../src/jobs/retention";
import { formatRetentionRun } from "../src/jobs/retention-format";

const USAGE = `retention:run - daily retention job: closed sites, old signatures, old audit rows (LIFE-02)

  npm run retention:run              run once: delete what is due, write the heartbeat
  npm run retention:run -- --dry-run show what would be deleted, touch nothing
  npm run retention:run -- --help    this text

Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

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

  const now = new Date();
  const result = await runRetentionJob({
    now,
    dryRun: args.includes("--dry-run"),
  });
  console.log(formatRetentionRun(result, now));
}

main().catch((err: unknown) => fail(describeError(err)));
