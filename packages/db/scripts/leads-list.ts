// Staff leads list (ONB-07; PD-7; UI-SPEC "Staff CLI output"). Prints saved quotes and sites
// still in setup (P8 R-6: sent and being-built sites too, with an ASSEMBLED column), newest
// first, after a CDS staff MFA sign-in; 15-07: hub /contact inquiries too (KIND inquiry, TYPE
// = business or name, STATUS = topic · about; never the message) (leads_list: super_admin or support_agent). Read-only; nothing is written or exported (T-06-49).
//
// Usage:
//   npm run leads:list [-- --since 7d]
//   npm run leads:list -- --dry-run | --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { leadsSummaryLine, listLeads } from "../src/leads";
import {
  fail,
  parseArgs,
  runMain,
  signInStaffInteractive,
  table,
  wantsHelp,
} from "./staff-cli";

const USAGE = `leads:list - saved quotes, sites still in setup and contact inquiries (super_admin or support_agent, MFA)

  npm run leads:list [-- --since 7d]
  npm run leads:list -- --dry-run
  npm run leads:list -- --help

--since    only leads changed in the last N days (for example 7d)
--dry-run  check the arguments and print what would be listed, without signing in
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const SINCE_RE = /^([1-9]\d{0,3})d$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEADER = [
  "KIND",
  "EMAIL",
  "PATH",
  "TYPE",
  "ITEMS",
  "STATUS",
  "ASSEMBLED",
  "LAST CHANGE",
] as const;

function stamp(d: Date): string {
  return d.getTime() === 0
    ? "-"
    : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: ["--since", "--dry-run"],
    withValue: ["--since"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  let days: number | null = null;
  const sinceRaw = args.get("--since");
  if (typeof sinceRaw === "string") {
    const m = SINCE_RE.exec(sinceRaw);
    if (!m) fail("--since must look like 7d (1-9999 days)");
    days = Number(m[1]);
  }
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would list leads${days ? ` changed in the last ${days} day(s)` : ""}; nothing read`,
    );
    return;
  }

  const ctx = await signInStaffInteractive();
  const since = days ? new Date(Date.now() - days * DAY_MS) : undefined;
  const leads = await listLeads(ctx, { since });
  if (leads.length === 0) {
    console.log("No leads.");
  } else {
    console.log(
      table(
        HEADER,
        leads.map((l) => [
          l.kind,
          l.email || "-",
          l.path || "-",
          l.businessType || "-",
          String(l.items),
          l.status,
          l.assembled,
          stamp(l.lastChange),
        ]),
      ),
    );
  }
  console.log(leadsSummaryLine(leads));
}

runMain(main);
