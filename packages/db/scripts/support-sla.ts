// Staff SLA month report (12-28; SUPPORT-02; UI-SPEC "Staff CLI output"). First-reply hits and
// misses for Problem and Question tickets created in one business month, through
// staffSlaReport (support_read: super_admin or support_agent) after a CDS staff sign-in with
// the emailed code. Read-only.
//
// Usage:
//   npm run support:sla [-- --month 2026-10] [--org <id>]
//   npm run support:sla -- --dry-run | --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput } from "@cds/core";
import {
  slaReportLine,
  staffSlaReport,
  type SlaMonthReport,
} from "../src/support/sla-report";
import {
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

export const USAGE = `support:sla - first-reply SLA hits and misses for one month (super_admin or support_agent)

  npm run support:sla [-- --month 2026-10] [--org <org-id>]
  npm run support:sla -- --dry-run
  npm run support:sla -- --help

--month    the business month, YYYY-MM (default: this month, America/Chicago)
--org      only this site's tickets
--dry-run  check the arguments and print what would be reported, without signing in
Counts Problem and Question tickets created that month (tickets CDS opened are left out):
met = first CDS reply within 2 business days; missed = late or still unanswered past due.
Read-only. Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  clock: () => Date = () => new Date(),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--month", "--org", "--dry-run"],
    withValue: ["--month", "--org"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const month = args.get("--month");
  if (
    month !== undefined &&
    (typeof month !== "string" || !MONTH_RE.test(month))
  ) {
    fail("--month must look like 2026-10");
  }
  const org = args.get("--org");
  if (org !== undefined && (typeof org !== "string" || !ORG_RE.test(org))) {
    fail("--org is not a valid organization id");
  }
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would report first-reply SLA for ${typeof month === "string" ? month : "this month"}; nothing read`,
    );
    return;
  }

  const ctx = await signInStaffInteractive();
  let report: SlaMonthReport;
  try {
    report = await staffSlaReport(ctx, {
      month: typeof month === "string" ? month : undefined,
      orgId: typeof org === "string" ? org : undefined,
      now: clock(),
    });
  } catch (err) {
    if (err instanceof Forbidden) {
      throw new CliFail("Refused: this account can't read support tickets.", {
        plain: true,
      });
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
  console.log(slaReportLine(report));
  for (const m of report.missedTickets) {
    console.log(
      `  #${m.number}  ${safeText(m.orgName || m.orgId)}  ${m.answered ? "answered late" : "still unanswered"}`,
    );
  }
}

// Exported for tests; runs only when executed directly (node … support-sla.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
