// Incidents from the terminal (12-30; COMM-12; D103; UI-SPEC "Staff CLI output"). `open` a
// known problem, `link` a ticket from any site to it, `resolve` it (every linked open ticket
// moves to Resolved and its people are alerted) and `list` them, through staffOpenIncident /
// staffLinkTicketToIncident / staffResolveIncident / staffListIncidents (`incident_run`:
// super_admin or support_agent) after a CDS staff sign-in with the emailed code. Every step is
// audited with the staff actor (12-21). Resolve asks "Resolve? [y/N]" (--yes skips).
//
// Usage:
//   npm run incident:run -- open --title "<text>" --public "<text>" [--dry-run]
//   npm run incident:run -- link --incident I-3 --ticket 1042 [--dry-run]
//   npm run incident:run -- resolve --incident I-3 [--message "<text>"] [--yes] [--dry-run]
//   npm run incident:run -- list [--all] [--dry-run]
//   npm run incident:run -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { EmailTransport } from "../src/email/transport";
import {
  staffLinkTicketToIncident,
  staffListIncidents,
  staffOpenIncident,
  staffResolveIncident,
  type StaffIncidentRow,
} from "../src/support/incidents";
import { MESSAGE_BODY_MAX } from "../src/support/shared";
import { staffSupportLabels } from "../src/support/staff-labels";
import {
  ask,
  CliFail,
  fail,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  table,
  wantsHelp,
  type ParsedArgs,
} from "./staff-cli";
import { stamp, ticketArg } from "./support-cli-kit";
import type { PlatformContext } from "../src/context";

const TITLE_MAX = 80;
const PUBLIC_MAX = 2000;

export const USAGE = `incident:run - known problems that affect many sites (super_admin or support_agent)

  npm run incident:run -- open --title "<text>" --public "<text>" [--dry-run]
  npm run incident:run -- link --incident I-3 --ticket 1042 [--dry-run]
  npm run incident:run -- resolve --incident I-3 [--message "<text>"] [--yes] [--dry-run]
  npm run incident:run -- list [--all] [--dry-run]
  npm run incident:run -- --help

open      --title (up to ${TITLE_MAX}, CDS only) and --public (up to ${PUBLIC_MAX.toLocaleString("en-US")}): the
          text owners see in the Known problem box on a linked ticket
link      link a ticket from any site (the owner sees "Linked to a known problem")
resolve   every linked ticket that is not Resolved or Closed moves to Resolved; each
          ticket's people are alerted. --message adds a public CDS reply to each ticket
          first. Asks "Resolve? [y/N]" (--yes skips). Safe to run again.
list      open incidents, with how many tickets are linked; --all includes resolved
--dry-run open, link and resolve: sign in and print what would change, without writing;
          list: check the arguments only
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type IncidentCliDeps = {
  now?: () => Date;
  transport?: EmailTransport;
};

function refusal(err: unknown, doing: string): never {
  if (err instanceof NotFound || err instanceof Forbidden) {
    throw new CliFail(`Not found, or this account can't ${doing}.`, {
      plain: true,
    });
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}

function textArg(args: ParsedArgs, flag: string, max: number): string {
  const raw = args.get(flag);
  if (typeof raw !== "string") fail(`${flag} "<text>" is required`);
  const v = raw.trim();
  if (v === "" || v.length > max) {
    fail(`${flag} must be 1-${max.toLocaleString("en-US")} characters`);
  }
  return v;
}

/** `I-3` (case-insensitive) → "I-3". */
function incidentArg(args: ParsedArgs): string {
  const raw = args.get("--incident");
  if (typeof raw !== "string") fail("--incident I-3 is required");
  const m = /^I-([1-9]\d{0,8})$/i.exec(raw.trim());
  if (!m) fail("--incident must be an incident code such as I-3");
  return `I-${m[1]}`;
}

async function findIncident(
  ctx: PlatformContext,
  code: string,
): Promise<StaffIncidentRow> {
  let rows: StaffIncidentRow[];
  try {
    rows = await staffListIncidents(ctx, { includeResolved: true });
  } catch (err) {
    refusal(err, "run incidents");
  }
  const hit = rows.find((r) => r.code === code);
  if (!hit)
    throw new CliFail(`Not found: no incident ${code}.`, { plain: true });
  return hit;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function open(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--title", "--public", "--dry-run"],
    withValue: ["--title", "--public"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const title = textArg(args, "--title", TITLE_MAX).replace(/\s+/g, " ");
  const publicText = textArg(args, "--public", PUBLIC_MAX);
  const ctx = await signInStaffInteractive();
  console.log(`New incident: ${safeText(title)}`);
  console.log(`  Owners see: ${safeText(publicText)}`);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would open this incident; nothing changed");
    return;
  }
  try {
    const r = await staffOpenIncident(ctx, { title, publicText });
    console.log(
      `Opened ${r.code}. Link tickets with: npm run incident:run -- link --incident ${r.code} --ticket <n>`,
    );
  } catch (err) {
    refusal(err, "open incidents");
  }
}

async function link(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--incident", "--ticket", "--dry-run"],
    withValue: ["--incident", "--ticket"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const code = incidentArg(args);
  const number = ticketArg(args);
  const ctx = await signInStaffInteractive();
  const incident = await findIncident(ctx, code);
  if (incident.status === "resolved") {
    throw new CliFail(`Refused: ${code} is already resolved.`, { plain: true });
  }
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would link ticket #${number} to ${code} (${safeText(incident.title)}); nothing changed`,
    );
    return;
  }
  let r: Awaited<ReturnType<typeof staffLinkTicketToIncident>>;
  try {
    r = await staffLinkTicketToIncident(ctx, { incident: code, number });
  } catch (err) {
    if (err instanceof NotFound) {
      throw new CliFail(`Ticket #${number} not found.`, { plain: true });
    }
    refusal(err, "link tickets");
  }
  const labels = await staffSupportLabels(ctx, { orgIds: [r.orgId] });
  const business = safeText(labels.orgs[r.orgId] || r.orgId);
  console.log(
    r.linked
      ? `Linked #${r.number} (${business}) to ${r.code}. The owner sees "Linked to a known problem" and the public text.`
      : `#${r.number} (${business}) was already linked to ${r.code}; nothing changed.`,
  );
}

async function resolveVerb(
  argv: readonly string[],
  deps: IncidentCliDeps,
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--incident", "--message", "--yes", "--dry-run"],
    withValue: ["--incident", "--message"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const code = incidentArg(args);
  const rawMessage = args.get("--message");
  let message: string | undefined;
  if (typeof rawMessage === "string") {
    message = textArg(args, "--message", MESSAGE_BODY_MAX);
  }
  const ctx = await signInStaffInteractive();
  const incident = await findIncident(ctx, code);
  console.log(
    `Resolve ${code}: ${safeText(incident.title)} · ${plural(incident.linked, "linked ticket")}${incident.status === "resolved" ? " · already resolved (sweeps any left over)" : ""}`,
  );
  if (message) console.log(`  Reply on each ticket: ${safeText(message)}`);
  console.log(
    "  Each linked ticket not yet Resolved or Closed moves to Resolved; its people are alerted.",
  );
  if (args.has("--dry-run")) {
    console.log("DRY RUN would resolve this incident; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Resolve? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  const now = (deps.now ?? (() => new Date()))();
  try {
    const r = await staffResolveIncident(
      ctx,
      { incident: code, ...(message ? { message } : {}) },
      { clock: { now: () => now }, transport: deps.transport },
    );
    console.log(
      `Resolved ${r.code}. ${plural(r.moved, "linked ticket")} moved to Resolved, ${plural(r.alerts, "alert")} raised.`,
    );
    if (r.skipped > 0) {
      console.log(
        `${plural(r.skipped, "ticket")} could not move (see support:list); run resolve again after fixing.`,
      );
    }
  } catch (err) {
    refusal(err, "resolve incidents");
  }
}

async function list(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--all", "--dry-run"],
    withValue: [],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  if (args.has("--dry-run")) {
    console.log("DRY RUN arguments are fine; nothing read");
    return;
  }
  const ctx = await signInStaffInteractive();
  let rows: StaffIncidentRow[];
  try {
    rows = await staffListIncidents(ctx, {
      includeResolved: args.has("--all"),
    });
  } catch (err) {
    refusal(err, "run incidents");
  }
  if (rows.length === 0) {
    console.log(args.has("--all") ? "No incidents." : "No open incidents.");
    return;
  }
  console.log(
    table(
      ["Incident", "Status", "Linked", "Opened", "Title"],
      rows.map((r) => [
        r.code,
        r.status,
        String(r.linked),
        stamp(r.created),
        r.title,
      ]),
    ),
  );
  console.log(plural(rows.length, "incident"));
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: IncidentCliDeps = {},
): Promise<void> {
  const verb = argv[0];
  if (verb === undefined || verb === "--help" || verb === "-h") {
    console.log(USAGE);
    if (verb === undefined) fail("give a verb: open, link, resolve or list");
    return;
  }
  const rest = argv.slice(1);
  if (verb === "open") return open(rest);
  if (verb === "link") return link(rest);
  if (verb === "resolve") return resolveVerb(rest, deps);
  if (verb === "list") return list(rest);
  console.log(USAGE);
  fail(`unknown verb ${verb.slice(0, 40)}: use open, link, resolve or list`);
}

// Exported for tests; runs only when executed directly (node … incident-run.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
