// Staff ticket reply (12-28; COMM-09, COMM-10, SUPPORT-03; UI-SPEC "Staff CLI output"). A public
// reply or an internal note on any site's ticket, plus status, assignee, priority, staff files
// and the paid-service mark, through staffReplyToTicket and staffMarkPaidService
// (support_reply: super_admin or support_agent) after a CDS staff sign-in with the emailed code.
// Prints the reply as the owner will see it, the status move and who is alerted, then asks
// "Send? [y/N]" (--yes skips; --dry-run changes nothing, T-12-28-04). Every send is audited
// with the staff actor (support.staff_reply, support.paid_marked; T-12-28-02).
//
// Usage:
//   npm run support:reply -- --ticket <n> (--body "<text>" | --body-file <md>) [--internal]
//        [--status <status>] [--assign <staff>] [--priority <p>] [--paid <category>]
//        [--file <path>]... [--yes] [--dry-run]
//   npm run support:reply -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAID_CATEGORY_KEYS,
  SUPPORT_COPY,
  statusLabel,
  type PaidCategory,
  type Priority,
  type TicketStatus,
} from "@cds/core/support";
import type { EmailTransport } from "../src/email/transport";
import type { ObjectStore } from "../src/storage";
import { staffMarkPaidService } from "../src/support/paid";
import { staffSupportSignature } from "../src/support/sla-report";
import {
  staffGetTicket,
  staffReplyToTicket,
  type StaffReplyInput,
  type StaffTicketDetail,
} from "../src/support/staff-tickets";
import {
  ask,
  CliFail,
  fail,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";
import {
  bodyArg,
  bytesLabel,
  paidArg,
  readFiles,
  statusArg,
  STATUS_HELP,
  takeRepeated,
  ticketArg,
  ticketRefusal,
  typeWord,
  type CliFile,
} from "./support-cli-kit";

const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];

export const USAGE = `support:reply - answer a support ticket, add an internal note or change the ticket (super_admin or support_agent)

  npm run support:reply -- --ticket <n> (--body "<text>" | --body-file <md>) [--internal]
       [--status <status>] [--assign <staff>] [--priority <p>] [--paid <category>]
       [--file <path>]... [--yes] [--dry-run]
  npm run support:reply -- --help

--ticket     the ticket number (1042 or #1042)
--body       the reply (up to 5,000 characters); or --body-file <md> to read it from a file
--internal   an internal note: CDS staff only, the owner never sees it, nobody is alerted
--status     move the ticket: ${STATUS_HELP}
--assign     a staff member's email or users id, me, or none to unassign
--priority   ${PRIORITIES.join(", ")}
--paid       mark a Change request a paid service (moves it to Waiting on you; the owner
             chooses a quote or the Care hour): ${PAID_CATEGORY_KEYS.join(", ")}
--file       attach a file (repeat for more, up to 5; 10 MB each; png, jpg, webp, gif,
             pdf, txt, csv, docx, xlsx, pptx)
--yes        skip the y/N confirm
--dry-run    sign in and print the reply as the owner will see it, without sending
A reply needs at least one of --body, --file, --status, --assign, --priority or --paid.
A public reply or a status move alerts the person who filed it, Owners and Admins (bell
and email). Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type ReplyDeps = {
  store?: ObjectStore;
  transport?: EmailTransport;
  now?: () => Date;
};

type Plan = {
  number: number;
  body: string;
  internal: boolean;
  status?: TicketStatus;
  assign?: string;
  priority?: Priority;
  paid?: PaidCategory;
  files: CliFile[];
};

function alerts(n: number): string {
  return `${n} alert${n === 1 ? "" : "s"} raised`;
}

/** The reply as the owner will see it, the moves and who is alerted. */
export function previewLines(
  t: StaffTicketDetail,
  plan: Plan,
  signature: string,
): string[] {
  const out = [
    `Ticket #${t.number} · ${safeText(t.orgName || t.orgId)} · ${typeWord(t.type)} · ${statusLabel(t.status)}`,
    `  ${safeText(t.subject)}`,
    "",
  ];
  if (plan.body || plan.files.length > 0) {
    out.push(
      plan.internal
        ? "Internal note (CDS staff only; the owner never sees it):"
        : "Reply as the owner will see it:",
      `  ${safeText(signature)}`,
    );
    for (const line of plan.body.split("\n")) {
      if (plan.body) out.push(`  ${safeText(line)}`);
    }
    for (const f of plan.files) {
      out.push(
        `  Attachment: ${safeText(f.name)} (${bytesLabel(f.bytes.length)})`,
      );
    }
    out.push("");
  }
  const moveTo = plan.paid ? "waiting_on_you" : plan.status;
  if (moveTo && moveTo !== t.status) {
    out.push(`Status:     ${statusLabel(t.status)} → ${statusLabel(moveTo)}`);
  }
  if (plan.assign !== undefined) {
    out.push(
      `Assign:     ${plan.assign === "" || plan.assign === "none" ? "nobody (unassign)" : safeText(plan.assign)}`,
    );
  }
  if (plan.priority) out.push(`Priority:   ${t.priority} → ${plan.priority}`);
  if (plan.paid) {
    out.push(
      `Paid:       ${SUPPORT_COPY.PAID_CATEGORY_LABELS[plan.paid]} (the owner chooses a quote or the Care hour)`,
    );
  }
  const alerted =
    ((plan.body || plan.files.length > 0) && !plan.internal) ||
    (moveTo !== undefined && moveTo !== t.status) ||
    plan.paid !== undefined;
  out.push(
    `Recipients: ${alerted ? "the person who filed it, Owners and Admins (bell and email)" : "nobody (nothing the owner sees changes)"}`,
  );
  return out;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: ReplyDeps = {},
): Promise<void> {
  const { values: filePaths, rest } = takeRepeated(argv, "--file");
  const args = parseArgs(rest, {
    known: [
      "--ticket",
      "--body",
      "--body-file",
      "--internal",
      "--status",
      "--assign",
      "--priority",
      "--paid",
      "--yes",
      "--dry-run",
    ],
    withValue: [
      "--ticket",
      "--body",
      "--body-file",
      "--status",
      "--assign",
      "--priority",
      "--paid",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }

  // Everything is checked before anyone signs in.
  const number = ticketArg(args);
  const plan: Plan = {
    number,
    body: bodyArg(args, false),
    internal: args.has("--internal"),
    files: [],
  };
  const status = args.get("--status");
  if (typeof status === "string") plan.status = statusArg(status);
  const assign = args.get("--assign");
  if (typeof assign === "string") {
    const a = assign.trim();
    if (a.length > 200) fail("--assign must be a staff email or users id");
    plan.assign = a.toLowerCase() === "none" ? "" : a;
  }
  const priority = args.get("--priority");
  if (typeof priority === "string") {
    const p = priority.trim().toLowerCase();
    if (!(PRIORITIES as readonly string[]).includes(p)) {
      fail(`--priority must be ${PRIORITIES.join(", ")}`);
    }
    plan.priority = p as Priority;
  }
  const paid = args.get("--paid");
  if (typeof paid === "string") {
    plan.paid = paidArg(paid);
    if (plan.status !== undefined) {
      fail("--paid moves the ticket to Waiting on you; leave out --status");
    }
  }
  plan.files = readFiles(filePaths);
  if (
    !plan.body &&
    plan.files.length === 0 &&
    plan.status === undefined &&
    plan.assign === undefined &&
    plan.priority === undefined &&
    plan.paid === undefined
  ) {
    fail(
      'nothing to send: add --body "<text>", --body-file, --file, --status, --assign, --priority or --paid',
    );
  }
  if (plan.internal && !plan.body && plan.files.length === 0) {
    fail("--internal needs --body, --body-file or --file");
  }

  const ctx = await signInStaffInteractive();
  if (plan.assign?.toLowerCase() === "me") plan.assign = ctx.actor;
  const now = (deps.now ?? (() => new Date()))();
  let ticket: StaffTicketDetail;
  let signature: string;
  try {
    ticket = await staffGetTicket(ctx, number, { now });
    signature = await staffSupportSignature(ctx);
  } catch (err) {
    ticketRefusal(err, number, "reply to support tickets");
  }
  if (ticket.status === "closed") {
    throw new CliFail(
      `Refused: ticket #${number} is closed. Open a new one with support:open.`,
      { plain: true },
    );
  }
  if (plan.paid) {
    if (ticket.type !== "change") {
      throw new CliFail(
        `Refused: only a Change request can be a paid service (ticket #${number} is ${typeWord(ticket.type)}).`,
        { plain: true },
      );
    }
    if (ticket.paid) {
      throw new CliFail(
        `Refused: ticket #${number} is already a paid service.`,
        { plain: true },
      );
    }
    if (ticket.status === "resolved") {
      throw new CliFail(
        `Refused: ticket #${number} is resolved; reopen it first.`,
        { plain: true },
      );
    }
  }

  for (const line of previewLines(ticket, plan, signature)) console.log(line);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would send this; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Send? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }

  const clock = { now: () => now };
  let raised = 0;
  let moved: { from: TicketStatus; to: TicketStatus } | null = null;
  const hasReply =
    plan.body !== "" ||
    plan.files.length > 0 ||
    plan.status !== undefined ||
    plan.assign !== undefined ||
    plan.priority !== undefined;
  if (hasReply) {
    const input: StaffReplyInput = { number, internal: plan.internal };
    if (plan.body) input.body = plan.body;
    if (plan.files.length > 0) input.files = plan.files;
    if (plan.status !== undefined) input.status = plan.status;
    if (plan.assign !== undefined) input.assign = plan.assign;
    if (plan.priority !== undefined) input.priority = plan.priority;
    try {
      const r = await staffReplyToTicket(ctx, input, {
        store: deps.store,
        transport: deps.transport,
        clock,
      });
      raised += r.raised;
      if (r.statusTo !== r.statusFrom) {
        moved = { from: r.statusFrom, to: r.statusTo };
      }
    } catch (err) {
      ticketRefusal(err, number, "reply to support tickets");
    }
  }
  if (plan.paid) {
    try {
      const r = await staffMarkPaidService(
        ctx,
        { number, category: plan.paid },
        // After the reply, so the paid line sorts after it.
        {
          transport: deps.transport,
          clock: { now: () => new Date(now.getTime() + 2) },
        },
      );
      raised += r.raised;
      moved = { from: moved?.from ?? ticket.status, to: "waiting_on_you" };
    } catch (err) {
      if (hasReply) {
        console.log("The reply was sent, but marking the paid service failed:");
      }
      ticketRefusal(err, number, "mark paid services");
    }
  }

  const business = safeText(ticket.orgName || "The owner");
  if (plan.internal) {
    console.log("Saved as an internal note. The owner never sees it.");
    if (moved || plan.paid) {
      console.log(
        `${moved ? `Status ${statusLabel(moved.from)} → ${statusLabel(moved.to)}; ` : ""}${alerts(raised)}.`,
      );
    }
    return;
  }
  if (!plan.body && plan.files.length === 0 && !moved && !plan.paid) {
    console.log(
      "Updated. Assignee and priority are CDS-only; nobody was alerted.",
    );
    return;
  }
  console.log(
    `${plan.body || plan.files.length > 0 ? "Sent" : "Updated"}. ${business} sees it in the hub; ${alerts(raised)}.`,
  );
}

// Exported for tests; runs only when executed directly (node … support-reply.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
