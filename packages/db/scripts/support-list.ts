// Staff ticket list (12-28; SUPPORT-02; UI-SPEC "Staff CLI output"). Tickets across every site
// with type, status, age, time to SLA and the at-risk / missed flags, through staffListTickets
// (support_read: super_admin or support_agent) after a CDS staff sign-in with the emailed code.
// Read-only: nothing is written. Tenant text is printed through table()/safeText.
//
// Usage:
//   npm run support:list [-- --org <id>] [--status <status>] [--type <type>] [--sla at-risk|missed]
//   npm run support:list -- --dry-run | --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput } from "@cds/core";
import { SUPPORT_COPY, statusLabel, type TicketType } from "@cds/core/support";
import {
  staffListTickets,
  type StaffListInput,
  type StaffTicketRow,
} from "../src/support/staff-tickets";
import {
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  signInStaffInteractive,
  table,
  wantsHelp,
} from "./staff-cli";
import {
  ageCell,
  slaCell,
  statusArg,
  STATUS_HELP,
  typeWord,
  TYPES,
} from "./support-cli-kit";

export const USAGE = `support:list - support tickets across sites, most urgent first (super_admin or support_agent)

  npm run support:list [-- --org <org-id>] [--status <status>] [--type <type>] [--sla at-risk|missed]
  npm run support:list -- --dry-run
  npm run support:list -- --help

--org      only this site's tickets
--status   ${STATUS_HELP}, or all (default: everything but closed)
--type     ${TYPES.join(", ")}
--sla      at-risk (first reply due within 4 business hours) or missed
--dry-run  check the arguments and print what would be listed, without signing in
Read-only. Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export const HEADER = [
  "#",
  "Org",
  "Type",
  "Status",
  "Age",
  "SLA",
  "Assignee",
  "",
] as const;

export function rowCells(r: StaffTicketRow, now: Date): string[] {
  return [
    String(r.number),
    r.orgName || r.orgId,
    typeWord(r.type),
    statusLabel(r.status),
    ageCell(r.ageMs),
    slaCell(r.sla, r.dueAt, now),
    r.assignee ? r.assignee.toLowerCase() : "—",
    r.paid
      ? `paid: ${SUPPORT_COPY.PAID_CATEGORY_LABELS[r.paid.category].toLowerCase()}`
      : "",
  ];
}

/** "3 tickets · 1 at risk · 0 missed" */
export function footer(rows: readonly StaffTicketRow[]): string {
  const risk = rows.filter((r) => r.sla === "due_soon").length;
  const missed = rows.filter((r) => r.sla === "missed").length;
  return `${rows.length} ticket${rows.length === 1 ? "" : "s"} · ${risk} at risk · ${missed} missed`;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  clock: () => Date = () => new Date(),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--org", "--status", "--type", "--sla", "--dry-run"],
    withValue: ["--org", "--status", "--type", "--sla"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const input: StaffListInput = {};
  const org = args.get("--org");
  if (org !== undefined) {
    if (typeof org !== "string" || !ORG_RE.test(org)) {
      fail("--org is not a valid organization id");
    }
    input.orgId = org;
  }
  const status = args.get("--status");
  if (typeof status === "string") {
    input.status =
      status.trim().toLowerCase() === "all" ? "all" : statusArg(status);
  }
  const type = args.get("--type");
  if (typeof type === "string") {
    const t = type.trim().toLowerCase();
    if (!(TYPES as readonly string[]).includes(t)) {
      fail(`--type must be ${TYPES.join(", ")}`);
    }
    input.type = t as TicketType;
  }
  const sla = args.get("--sla");
  if (typeof sla === "string") {
    if (sla !== "at-risk" && sla !== "missed") {
      fail("--sla must be at-risk or missed");
    }
    input.sla = sla;
  }
  if (args.has("--dry-run")) {
    console.log(
      "DRY RUN would list support tickets with these filters; nothing read",
    );
    return;
  }

  const ctx = await signInStaffInteractive();
  const now = clock();
  let rows: StaffTicketRow[];
  try {
    rows = await staffListTickets(ctx, { ...input, now });
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
  if (rows.length > 0) {
    console.log(
      table(
        HEADER,
        rows.map((r) => rowCells(r, now)),
      ),
    );
  } else {
    console.log("No tickets match.");
  }
  console.log(footer(rows));
}

// Exported for tests; runs only when executed directly (node … support-list.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
