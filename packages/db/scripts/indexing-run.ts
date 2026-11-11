// Weekly indexing job from the CLI (13-19; STAFF-17, D190). Dev and staff run it here;
// production runs the same runIndexingJob through POST /api/jobs/indexing (bearer
// CDS_JOB_TOKEN) from a Coolify scheduled task (Sundays 06:00 UTC), because the standalone
// image has no scripts.
//
// Usage:
//   npm run indexing:run              resubmit every live, non-demo site and check sitemaps
//   npm run indexing:run -- --dry-run count what one run would do, touch nothing
//   npm run indexing:run -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_SEARCH_PINGER (unset = logging stand-in), CDS_STORAGE_DIR / object store
// env (index.json reads). Like the other job CLIs it signs in as the env superuser, not as
// staff. Output is one counts line (UI-SPEC "Staff CLI output"); no org name, host or
// credential is printed. Exit 1 on failure or when a step failed.
// Add-ons register at load, as in POST /api/jobs/indexing.
import "@cds/addon-registry/server";
import { runIndexingJob, type IndexingJobResult } from "../src/jobs/indexing";

const USAGE = `indexing:run - weekly indexing job: resubmit live sites, check sitemaps (STAFF-17, D190)

  npm run indexing:run              run once: ping every live, non-demo site through the
                                    search pinger (logged stand-in until IndexNow), check
                                    each site's sitemap, record both per site
  npm run indexing:run -- --dry-run count what a run would do, touch nothing
  npm run indexing:run -- --help    this text

Prod: POST /api/jobs/indexing with CDS_JOB_TOKEN, Sundays 06:00 UTC.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_SEARCH_PINGER (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  "resubmit every live site that is not the demo site (search pinger)",
  "check each of those sites' sitemap (at least one page)",
  "write platform_meta job:indexing:last_success and job:indexing:last_counts",
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

/** `Indexing · 2026-10-18 06:00 UTC · resubmitted 14 · demo skipped 1 · ...`. */
function formatIndexingRun(r: IndexingJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [
    `Indexing${r.dryRun ? " (dry run)" : ""}`,
    when,
    `resubmitted ${r.resubmitted}`,
    `demo skipped ${r.skippedDemo}`,
    `sitemap errors ${r.sitemapErrors}`,
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
  const res = await runIndexingJob({ now, dryRun });
  if (res.busy) {
    console.log("Another indexing run is in progress. Nothing done.");
    return;
  }
  console.log(formatIndexingRun(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
