// Billing reconcile from the CLI (10-24; PAY-02, PAY-01, D244; CONTEXT A1; UI-SPEC "Staff CLI
// output"). Staff and dev run the hourly reconcile job here; production runs the same
// runBillingJob through POST /api/jobs/billing (bearer CDS_JOB_TOKEN) from an hourly Coolify
// scheduled task, because the standalone image has no scripts (RESEARCH Pitfall 12).
// A job CLI like retention:run: no staff sign-in.
//
// Usage:
//   npm run billing:reconcile                 re-read the provider since the last success
//   npm run billing:reconcile -- --since 24h  or --since 2d, or --since <ISO date>
//   npm run billing:reconcile -- --dry-run    print what would be recorded, change nothing
//   npm run billing:reconcile -- --help
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by the
// npm script), CDS_PAYMENTS (fake | stripe) and the Stripe keys when stripe. Exit 0, or 1 when
// a step failed (the report is still printed; the heartbeat is not written).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBillingGate } from "../src/addons/billing";
import type { AddonDeps } from "../src/addons/types";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import {
  parseBillingSince,
  runBillingJob,
  type BillingJobDeps,
  type BillingJobResult,
} from "../src/jobs/billing";
import { fakeSettled } from "../src/payments/fake/index";
import { registerPaymentAddonDeps } from "../src/payments/process";
import {
  CliFail,
  fail,
  parseArgs,
  requireEnv,
  runMain,
  wantsHelp,
} from "./staff-cli";

export const USAGE = `billing:reconcile - re-read CDS billing and Connect accounts and apply missed events

  npm run billing:reconcile                  since the last successful run (24 h on the first)
  npm run billing:reconcile -- --since 24h   look back 24 hours (or 2d, or an ISO date)
  npm run billing:reconcile -- --dry-run     show what would be recorded, change nothing
  npm run billing:reconcile -- --help        this text

Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

function addonDeps(): AddonDeps {
  return {
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    // No Next cache to invalidate from a CLI; the site's 60 s cache catches up.
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
    billing: getBillingGate(),
  };
}

/** "2026-10-08 05:00 UTC" */
function utc(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime())
    ? "unknown"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const LABEL = 24;
const NUM = 4;

function line(label: string, n: number, rest = ""): string {
  const head = `${label.padEnd(LABEL)}${String(n).padStart(NUM)}`;
  return rest ? `${head}   ${rest}` : head;
}

/** The UI-SPEC report: a header, then column-aligned counts per kind. */
export function formatBillingReconcile(r: BillingJobResult, now: Date): string {
  const verb = (live: string, n: number) =>
    r.dryRun ? `would record: ${n}` : `${live}: ${n}`;
  const k = r.kinds;
  const out: string[] = [];
  if (r.dryRun) out.push("Dry run: nothing was changed.");
  out.push(`Billing reconcile · ${utc(now)} · since ${utc(r.since)}`);
  out.push(
    line(
      "Subscriptions read:",
      k.subscription.read,
      verb("changed", k.subscription.applied),
    ),
  );
  out.push(
    line("Invoices read:", k.invoice.read, verb("new", k.invoice.applied)),
  );
  out.push(
    line(
      "Checkout sessions:",
      k.checkout.read,
      verb("completed but missed", k.checkout.applied),
    ),
  );
  const accounts = [`restricted: ${r.restricted}`];
  if (r.dryRun && k.account.applied > 0) {
    accounts.push(`would record: ${k.account.applied}`);
  } else if (!r.dryRun && k.account.applied > 0) {
    accounts.push(`changed: ${k.account.applied}`);
  }
  out.push(line("Stripe accounts:", r.accountsChecked, accounts.join("   ")));
  if (k.other.read > 0) {
    out.push(
      line("Other events:", k.other.read, verb("recorded", k.other.applied)),
    );
  }
  out.push(line("Events already handled:", r.duplicates, "(skipped)"));
  if (r.retried > 0) {
    out.push(
      line(
        "Failed events retried:",
        r.retried,
        r.dryRun ? "(would run again)" : "",
      ),
    );
  }
  if (r.failed > 0) {
    out.push(
      line("Events that failed:", r.failed, "(kept; the next run tries again)"),
    );
  }
  if (r.backlog > 0) {
    out.push(line("Waiting over 15 min:", r.backlog));
  }
  if (r.dryRun && r.planned.length > 0) {
    out.push("", "Would record:");
    const width = Math.max(...r.planned.map((p) => p.type.length));
    for (const p of r.planned) out.push(`  ${p.type.padEnd(width)}  ${p.ref}`);
  }
  if (r.failedSteps.length > 0) {
    out.push("", `Steps that failed: ${r.failedSteps.join(", ")}`);
  }
  return out.join("\n");
}

export type BillingCliOptions = {
  deps?: BillingJobDeps;
  now?: Date;
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  opts: BillingCliOptions = {},
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--since", "--dry-run"],
    withValue: ["--since"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const now = opts.now ?? new Date();
  const raw = args.get("--since");
  let since: Date | undefined;
  if (typeof raw === "string") {
    const parsed = parseBillingSince(raw, now);
    if (!parsed) {
      fail(
        `--since must be hours (24h), days (2d) or an ISO date, not "${raw.slice(0, 40)}"`,
      );
    }
    if (parsed.getTime() > now.getTime()) fail("--since is in the future");
    since = parsed;
  }
  requireEnv();

  // Paid add-ons install (and lapses pause them) only with add-on deps (10-23).
  if (!opts.deps?.addons) registerPaymentAddonDeps(addonDeps);
  const result = await runBillingJob(
    { dryRun: args.has("--dry-run"), now, ...(since ? { since } : {}) },
    opts.deps ?? {},
  );
  await fakeSettled();
  console.log(formatBillingReconcile(result, now));
  if (result.failedSteps.length > 0) {
    throw new CliFail(
      `${result.failedSteps.length} step(s) failed; the heartbeat was not written.`,
    );
  }
}

// Exported for tests; runs only when executed directly (node … billing-reconcile.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
