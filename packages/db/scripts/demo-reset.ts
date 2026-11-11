// Nightly demo reset from the CLI (13-31; STAFF-18, D293, P13-P13). Dev and staff run it here;
// production runs the same runDemoResetJob through POST /api/jobs/demo (bearer CDS_JOB_TOKEN)
// from an hourly Coolify scheduled task, because the standalone image has no scripts.
//
// Usage:
//   npm run demo:reset                   reset the demo tenant if it is 3 am America/Chicago and
//                                        it has not been reset today (otherwise nothing happens)
//   npm run demo:reset -- --now          reset it now, whatever the hour (creates it if missing)
//   npm run demo:reset -- --dry-run      count what a reset would delete, touch nothing
//   npm run demo:reset -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the npm
// script). Like the other job CLIs it signs in as the env superuser, not as staff. Output is one
// counts line; no org id, owner email or password is printed (the demo owner's password is
// random and never shown anywhere). Exit 1 on failure or when a step failed. The CLI has no Next
// cache to drop; the app's cached render of the demo site expires on its own.
// A database whose "demo" slug belongs to a real (non-demo) org is refused, writing nothing.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { recordingInvalidator } from "../src/content/ports";
import { runDemoResetJob, type DemoJobResult } from "../src/jobs/demo";

const USAGE = `demo:reset - reset the permanent demo tenant "Bella's Salon" (STAFF-18)

  npm run demo:reset              reset it if it is 3 am America/Chicago and it has not been
                                  reset today; any other time nothing happens
  npm run demo:reset -- --now     reset it now, whatever the hour (creates the demo tenant the
                                  first time)
  npm run demo:reset -- --dry-run count what a reset would delete, touch nothing
  npm run demo:reset -- --help    this text

Only the demo tenant's own records are deleted and seeded again; its address stays the same.
Prod: POST /api/jobs/demo with CDS_JOB_TOKEN, hourly (30 * * * *).
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];
const FLAGS = new Set(["--now", "--dry-run"]);

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

/** `Demo reset · 2026-10-16 08:30 UTC · reset 1 · rows deleted 120 · rows seeded 118 · failed 0` */
function formatDemoRun(r: DemoJobResult, now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [
    `Demo reset${r.dryRun ? " (dry run)" : ""}`,
    when,
    `reset ${r.reset}`,
    `rows deleted ${r.rowsDeleted}`,
    `rows seeded ${r.rowsSeeded}`,
    `failed ${r.failedSteps.length}`,
  ].join(" · ");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((a) => !FLAGS.has(a));
  if (unknown.length > 0) fail(`unknown argument ${unknown[0]}`);
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }

  const dryRun = args.includes("--dry-run");
  const force = args.includes("--now");
  const now = new Date();
  const res = await runDemoResetJob({
    addons: ADDON_REGISTRY,
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    invalidator: recordingInvalidator(),
    now,
    dryRun,
    force,
  });
  if (res.busy) {
    console.log("Another demo reset is in progress. Nothing done.");
    return;
  }
  if (res.skippedHour > 0) {
    console.log(
      "Not 3 am in America/Chicago, or the demo was already reset today. Nothing done. Use --now to reset anyway.",
    );
    return;
  }
  console.log(formatDemoRun(res, now));
  if (dryRun) console.log("DRY RUN nothing written");
  if (res.failedSteps.length > 0) {
    fail(`steps failed: ${res.failedSteps.join(", ")}`);
  }
}

main().catch((err: unknown) => fail(describeError(err)));
