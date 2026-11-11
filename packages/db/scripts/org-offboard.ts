// Staff offboarding (14-40; LIFE-01, D282; UI-SPEC "Staff CLI output"). Mirrors the console's
// Site › Offboarding: `status` prints the Leaving CDS checklist ([done] [open] [locked] per
// step), the notice end and the DNS handback; `start` and `cancel` print the case and ask
// y/N. start/cancel are super_admin only (`offboard`); status is open to both staff roles.
// Staff email, password and the emailed code first (MFA). Everything goes through
// @cds/db offboarding/staff.ts, which audits with the organization.
//
// Usage:
//   npm run org:offboard -- --org <org-id> status
//   npm run org:offboard -- --org <org-id> start --reason "<text>" [--dry-run] [--yes]
//   npm run org:offboard -- --org <org-id> cancel --reason "<text>" [--dry-run] [--yes]
//   npm run org:offboard -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import {
  staffCancelOffboarding,
  staffOffboardingView,
  staffStartOffboarding,
  type StaffOffboardingView,
} from "../src/offboarding/staff";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `org:offboard - start, inspect or cancel a site's Leaving CDS notice

  npm run org:offboard -- --org <org-id> status
  npm run org:offboard -- --org <org-id> start --reason "<text>" [--dry-run] [--yes]
  npm run org:offboard -- --org <org-id> cancel --reason "<text>" [--dry-run] [--yes]
  npm run org:offboard -- --help

status    the checklist with [done] [open] [locked] per step, the notice end and the DNS
          handback (super_admin or support_agent)
start     start the 30-day notice; the owner is emailed the checklist (super_admin)
cancel    cancel a running notice; the plan and price carry on (super_admin)
--org     the site's organization id
--reason  why (3-500 characters; required for start and cancel)
--dry-run sign in and print the case, without writing
--yes     skip the y/N confirm
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type OffboardCommand = "start" | "status" | "cancel";
const COMMANDS: readonly OffboardCommand[] = ["start", "status", "cancel"];
const WITH_VALUE = ["--org", "--reason"] as const;

/**
 * Take the one positional subcommand out of argv (a value after --org/--reason is never it).
 * Throws CliFail for none, two, or an unknown positional word.
 */
export function splitCommand(argv: readonly string[]): {
  command: OffboardCommand | null;
  rest: string[];
} {
  let command: OffboardCommand | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("-")) {
      rest.push(a);
      if (
        (WITH_VALUE as readonly string[]).includes(a) &&
        i + 1 < argv.length
      ) {
        rest.push(argv[++i]!);
      }
      continue;
    }
    if (!(COMMANDS as readonly string[]).includes(a)) {
      fail(`unknown command ${a.slice(0, 40)} (start, status or cancel)`);
    }
    if (command) fail("give one command: start, status or cancel");
    command = a as OffboardCommand;
  }
  return { command, rest };
}

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-11-14" in America/Chicago (business time). */
export function dayOf(iso: string | null): string {
  if (!iso) return "(none)";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "(none)" : DAY_FMT.format(d);
}

const WORD: Readonly<Record<string, string>> = {
  done: "[done]",
  open: "[open]",
  locked: "[locked]",
  not_applicable: "[n/a]",
};

const HANDBACK_WORDS: Readonly<Record<string, string>> = {
  open: "destination not chosen",
  checking: "checking",
  ready_to_switch: "ready to switch",
  waiting: "waiting for the nameserver change",
  done: "done",
  mismatch: "email records missing at the new DNS",
};

/** The status block (pure; the CLI prints it line by line). */
export function statusLines(v: StaffOffboardingView): string[] {
  const name = safeText(v.business);
  const o = v.offboarding;
  if (!o || o.status === "cancelled") {
    const lines = [P14_COPY.STAFF_NOT_LEAVING({ business: name })];
    if (o?.cancelledAt) lines.push(`Cancelled ${dayOf(o.cancelledAt)}.`);
    return lines;
  }
  const lines: string[] = [];
  const by = o.requestedByKind ? ` by ${o.requestedByKind}` : "";
  lines.push(
    o.status === "closed"
      ? `${name} · closed ${dayOf(o.closedAt)}`
      : `${name} · leaving · requested${by} ${dayOf(o.requestedAt)}`,
  );
  if (o.status === "notice") {
    lines.push(
      `Notice ends ${dayOf(o.noticeEndsAt)} (${o.daysLeft} ${o.daysLeft === 1 ? "day" : "days"})`,
    );
  }
  if (o.handbackOverdueAt) {
    lines.push(
      `Handback overdue since ${dayOf(o.handbackOverdueAt)}: nothing closes until the DNS moves.`,
    );
  }
  const width = Math.max(...Object.values(WORD).map((w) => w.length));
  for (const s of o.steps) {
    lines.push(
      `${(WORD[s.status] ?? `[${s.status}]`).padEnd(width)} ${s.title}`,
    );
  }
  for (const s of o.systemSteps ?? []) {
    lines.push(
      `${(WORD[s.status] ?? `[${s.status}]`).padEnd(width)} ${s.title} (system)`,
    );
  }
  for (const z of v.handback.zones) {
    const dest =
      z.destination === null
        ? ""
        : ` · to ${z.destination === "registrar" ? "the registrar's DNS" : "another host"} (${z.destinationNameservers.join(", ")})`;
    lines.push(
      `DNS handback ${z.domain} · ${HANDBACK_WORDS[z.status] ?? z.status}${dest}`,
    );
    if (z.status === "mismatch") {
      lines.push(
        `  ${z.emailMissing} email ${z.emailMissing === 1 ? "record" : "records"} missing · CDS nameservers ${z.cdsNameservers.join(", ")}`,
      );
    }
  }
  if (o.note) lines.push(`Note: "${safeText(o.note)}"`);
  return lines;
}

/** The Start offboarding case (UI-SPEC Staff › Offboarding CaseDialog). */
export function startCase(v: StaffOffboardingView): string[] {
  const name = safeText(v.business);
  return [
    `Start offboarding for ${name}?`,
    `Notice ends:     ${dayOf(v.noticeWouldEnd)}`,
    `DNS handback:    ${v.handbackNeeded ? "needed (CDS zone active)" : "not needed"}`,
    "Billing:         an annual prepay isn't refunded; the launch rate lock is removed",
    "The owner is emailed the checklist.",
  ];
}

function notFound(org: string): CliFail {
  return new CliFail(`Org ${org} not found, or this account can't see it.`, {
    plain: true,
  });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const { command, rest } = splitCommand(argv);
  const args = parseArgs(rest, {
    known: ["--org", "--reason", "--dry-run", "--yes"],
    withValue: ["--org", "--reason"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  if (!command) fail("give a command: start, status or cancel");
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  let reason = "";
  if (command !== "status") {
    const raw = args.get("--reason");
    if (typeof raw !== "string") fail('--reason "<text>" is required');
    reason = raw.trim();
    if (reason.length < 3 || reason.length > 500) {
      fail("--reason must be 3-500 characters");
    }
  }

  const ctx = await signInStaffInteractive();
  if (command !== "status" && ctx.staffRole !== "super_admin") {
    throw new CliFail(
      `Refused: ${command === "start" ? "starting" : "cancelling"} an offboarding needs super_admin.`,
      { plain: true },
    );
  }

  try {
    const view = await staffOffboardingView(ctx, org);
    if (command === "status") {
      for (const line of statusLines(view)) console.log(line);
      return;
    }
    const name = safeText(view.business);
    if (command === "start") {
      for (const line of startCase(view)) console.log(line);
      if (view.offboarding?.status === "notice") {
        throw new CliFail("Refused: Leaving CDS has already started.", {
          plain: true,
        });
      }
      if (args.has("--dry-run")) {
        console.log("DRY RUN would start offboarding; nothing changed");
        return;
      }
      if (!args.has("--yes")) {
        const answer = await ask("Start offboarding? [y/N] ");
        if (!/^y(es)?$/i.test(answer)) {
          console.log("Nothing changed.");
          return;
        }
      }
      await staffStartOffboarding(ctx, org, { reason });
      console.log("Offboarding started. The owner was emailed the checklist.");
      for (const line of statusLines(await staffOffboardingView(ctx, org))) {
        console.log(line);
      }
      return;
    }
    // cancel
    console.log(`Cancel ${name}'s offboarding? Their plan and price carry on.`);
    if (view.offboarding?.status !== "notice") {
      throw new CliFail(
        `Refused: ${P14_COPY.STAFF_NOT_LEAVING({ business: name })}`,
        { plain: true },
      );
    }
    if (args.has("--dry-run")) {
      console.log("DRY RUN would cancel the offboarding; nothing changed");
      return;
    }
    if (!args.has("--yes")) {
      const answer = await ask("Cancel offboarding? [y/N] ");
      if (!/^y(es)?$/i.test(answer)) {
        console.log("Nothing changed.");
        return;
      }
    }
    const res = await staffCancelOffboarding(ctx, org, reason);
    console.log(`Offboarding cancelled. ${res.message}`);
  } catch (err) {
    if (err instanceof CliFail) throw err;
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(org);
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … org-offboard.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
