// Monthly "Your site this month" email job from the CLI (11-34; DASH-12, D189). Dev and staff
// run it here; production runs the same runMonthlyReports through POST /api/jobs/reports
// (bearer CDS_JOB_TOKEN) from a daily Coolify scheduled task, because the standalone image
// has no scripts.
//
// Usage:
//   npm run reports:monthly                     send what is due (first 7 days of a month)
//   npm run reports:monthly -- --dry-run        count what one run would do, touch nothing
//   npm run reports:monthly -- --org <id>       only this org
//   npm run reports:monthly -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_PLATFORM_URL (Site Report link), CDS_EMAIL_TRANSPORT (unset =
// logged-not-sent stand-in). Output is one counts line (UI-SPEC "Staff CLI output"); no
// email address or credential is printed. Exit 1 on failure or when an org failed.
import {
  CATCH_UP_DAYS,
  runMonthlyReports,
  type MonthlyReportResult,
} from "../src/reports/monthly";

const USAGE = `reports:monthly - monthly "Your site this month" email (DASH-12)

  npm run reports:monthly                    run once: on days 1-${CATCH_UP_DAYS} of a business month,
                                             each live site gets last month's report (five
                                             lines and one tip) once, sent to Owners and to
                                             members who keep the alert on. Skipped before
                                             launch and in the first partial month.
  npm run reports:monthly -- --dry-run       count what a run would do, touch nothing
  npm run reports:monthly -- --org <id>      only this org
  npm run reports:monthly -- --help          this text

Prod: POST /api/jobs/reports with CDS_JOB_TOKEN, once a day.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_PLATFORM_URL, CDS_EMAIL_TRANSPORT (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];

const DRY_RUN_STEPS = [
  `find live sites in days 1-${CATCH_UP_DAYS} of their business month without last month's report`,
  "skip sites not live yet and sites in their first partial month",
  "build five lines and one tip from last month's stats and SEO score",
  "claim platform_meta reports:monthly:<org>:<YYYY-MM>, then email each recipient",
  "write platform_meta job:reports:last_success and job:reports:last_counts",
];

const ORG_RE = /^[a-z0-9]{15}$/;

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

/** `Monthly reports · October · sent 12 · skipped before launch 3 · ...` (UI-SPEC). */
function formatResult(r: MonthlyReportResult): string {
  const parts = [
    `Monthly reports${r.dryRun ? " (dry run)" : ""}`,
    r.month,
    `sent ${r.emailsSent} (${r.orgsSent} ${r.orgsSent === 1 ? "site" : "sites"})`,
    `skipped before launch ${r.skippedBeforeLaunch}`,
    `skipped first partial month ${r.skippedFirstMonth}`,
    `already sent ${r.alreadySent}`,
    `nobody subscribed ${r.noRecipients}`,
    `failed ${r.sendFailures + r.failedOrgs}`,
  ];
  return parts.join(" · ");
}

function parseArgs(args: readonly string[]): { dryRun: boolean; org?: string } {
  let dryRun = false;
  let org: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--org") {
      const v = args[i + 1];
      if (!v || !ORG_RE.test(v)) fail("--org needs a 15-character org id");
      org = v;
      i += 1;
    } else fail(`unknown argument ${a}`);
  }
  return org ? { dryRun, org } : { dryRun };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { dryRun, org } = parseArgs(args);
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  if (dryRun) for (const step of DRY_RUN_STEPS) console.log(`DRY RUN ${step}`);

  const res = await runMonthlyReports({
    now: new Date(),
    dryRun,
    ...(org ? { org } : {}),
  });
  if (res.busy) {
    console.log("Another monthly reports run is in progress. Nothing done.");
    return;
  }
  console.log(formatResult(res));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedOrgs > 0) fail(`${res.failedOrgs} site(s) failed`);
}

main().catch((err: unknown) => fail(describeError(err)));
