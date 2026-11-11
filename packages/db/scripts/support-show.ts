// Staff ticket view (12-28; SUPPORT-02; UI-SPEC "Staff CLI output"). One ticket of any site with
// its header block (org, type, status, target, opened by, context) and the full thread in time
// order: internal notes prefixed [internal], attachments with their scan state. --download
// saves one attachment (pending files too, for triage) through staffOpenSupportFile.
// support_read (super_admin or support_agent) after a CDS staff sign-in with the emailed code.
// Read-only except the --out file. Tenant text is printed through safeText (T-12-28-03).
//
// Usage:
//   npm run support:show -- --ticket <n> [--download <file-id> --out <path>]
//   npm run support:show -- --dry-run | --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { NotFound } from "@cds/core";
import { SUPPORT_COPY, statusLabel } from "@cds/core/support";
import type { ObjectStore } from "../src/storage";
import { staffOpenSupportFile } from "../src/support/files";
import type { StaffThreadMessage } from "../src/support/messages";
import {
  staffGetTicket,
  type StaffTicketDetail,
} from "../src/support/staff-tickets";
import {
  CliFail,
  fail,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";
import {
  ageCell,
  bytesLabel,
  slaCell,
  stamp,
  ticketArg,
  ticketRefusal,
  typeWord,
} from "./support-cli-kit";

export const USAGE = `support:show - one support ticket with its full thread, internal notes included (super_admin or support_agent)

  npm run support:show -- --ticket <n> [--download <file-id> --out <path>]
  npm run support:show -- --dry-run
  npm run support:show -- --help

--ticket    the ticket number (1042 or #1042)
--download  save one attachment (its id is listed under the message); files still being
            checked can be saved for triage: open them with care
--out       where to save it (a new file; an existing file is never overwritten)
--dry-run   check the arguments and print what would be shown, without signing in
Read-only. Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const FILE_ID_RE = /^[a-z0-9]{15}$/;

const SCAN_LABEL = {
  clean: "clean",
  pending: "checking (not scanned yet)",
  staff: "CDS file",
} as const;

function indent(text: string, pad = "  "): string[] {
  return text.split("\n").map((l) => `${pad}${safeText(l)}`);
}

function authorOf(m: StaffThreadMessage): string {
  if (m.authorKind === "system") return "System";
  if (m.authorKind === "staff") {
    return m.authorName && m.authorName !== "CDS"
      ? `${m.authorName} · CDS`
      : "CDS";
  }
  return m.authorName || "Team member";
}

/** The header block and thread, one string per line. */
export function ticketLines(t: StaffTicketDetail, now: Date): string[] {
  const out = [
    `Ticket #${t.number} · ${safeText(t.subject)}`,
    `Org:        ${safeText(t.orgName || "—")} (${t.orgId})`,
    `Type:       ${typeWord(t.type)}`,
    `Status:     ${statusLabel(t.status)}`,
    `Priority:   ${t.priority}`,
    `Assignee:   ${t.assignee ? safeText(t.assignee) : "—"}`,
    `Age:        ${ageCell(t.ageMs)} (opened ${stamp(t.created)})`,
    `SLA:        ${slaCell(t.sla, t.dueAt, now)}${t.firstRepliedAt ? ` (first reply ${stamp(t.firstRepliedAt)})` : ""}`,
    `Target:     ${safeText(t.target.label)}${t.target.kind === "site" ? "" : ` (${t.target.kind}:${safeText(t.target.id)})`}`,
    `Opened by:  ${t.openedBy.cds ? `Opened by CDS · ${safeText(t.openedBy.name.replace(/^CDS · /, ""))}` : safeText(t.openedBy.name)}`,
  ];
  if (t.context) {
    out.push(
      `Context:    ${safeText(t.context.url ?? "no page")} · ${safeText(t.context.browser ?? "unknown browser")} · ${stamp(t.context.captured_at)}`,
    );
  }
  if (t.paid) {
    const p = t.paid;
    const steps = [
      `marked ${stamp(p.marked_at)}`,
      p.quote_requested_at ? "quote requested" : "",
      p.quote_sent_at ? "quote sent" : "",
      p.accepted_at ? "quote accepted" : "",
      p.care_chosen_at ? "Care hour chosen" : "",
    ].filter(Boolean);
    out.push(
      `Paid:       ${SUPPORT_COPY.PAID_CATEGORY_LABELS[p.category]} (${steps.join(", ")})`,
    );
  }
  if (t.incident) out.push(`Incident:   ${safeText(t.incident)}`);
  if (t.resolvedAt) out.push(`Resolved:   ${stamp(t.resolvedAt)}`);
  if (t.closedAt) out.push(`Closed:     ${stamp(t.closedAt)}`);
  out.push("", `Thread (${t.messages.length})`);
  for (const m of t.messages) {
    const tag = m.visibility === "internal" ? "[internal] " : "";
    if (m.authorKind === "system") {
      out.push(`${tag}${stamp(m.created)} · ${safeText(m.event || m.body)}`);
      continue;
    }
    out.push(`${tag}${stamp(m.created)} · ${safeText(authorOf(m))}`);
    if (m.body) out.push(...indent(m.body));
    for (const a of m.attachments) {
      out.push(
        `  Attachment: ${safeText(a.name)} (${bytesLabel(a.size)}, ${SCAN_LABEL[a.scan]}) id ${a.id}`,
      );
    }
  }
  return out;
}

export type ShowDeps = { store?: ObjectStore; now?: () => Date };

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: ShowDeps = {},
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--ticket", "--download", "--out", "--dry-run"],
    withValue: ["--ticket", "--download", "--out"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const number = ticketArg(args);
  const download = args.get("--download");
  const out = args.get("--out");
  if (download !== undefined || out !== undefined) {
    if (typeof download !== "string" || !FILE_ID_RE.test(download)) {
      fail("--download <file-id> needs a file id from the thread");
    }
    if (typeof out !== "string" || out.trim() === "") {
      fail("--out <path> is required with --download");
    }
  }
  if (args.has("--dry-run")) {
    console.log(
      typeof download === "string"
        ? `DRY RUN would save file ${download} of ticket #${number} to ${String(out)}; nothing read`
        : `DRY RUN would show ticket #${number}; nothing read`,
    );
    return;
  }

  const ctx = await signInStaffInteractive();
  const now = (deps.now ?? (() => new Date()))();
  let ticket: StaffTicketDetail;
  try {
    ticket = await staffGetTicket(ctx, number, { now });
  } catch (err) {
    ticketRefusal(err, number, "read support tickets");
  }

  if (typeof download === "string" && typeof out === "string") {
    const listed = ticket.messages.some((m) =>
      m.attachments.some((a) => a.id === download),
    );
    if (!listed) {
      throw new CliFail(`File ${download} is not on ticket #${number}.`, {
        plain: true,
      });
    }
    let opened: Awaited<ReturnType<typeof staffOpenSupportFile>>;
    try {
      opened = await staffOpenSupportFile(ctx, download, { store: deps.store });
    } catch (err) {
      if (err instanceof NotFound) {
        throw new CliFail(
          `File ${download} could not be opened (missing from storage).`,
          { plain: true },
        );
      }
      throw err;
    }
    try {
      await pipeline(
        Readable.fromWeb(opened.stream as WebReadableStream<Uint8Array>),
        createWriteStream(out, { flags: "wx" }),
      );
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "EEXIST"
      ) {
        throw new CliFail(`${out} already exists. Choose a new --out path.`, {
          plain: true,
        });
      }
      throw err;
    }
    console.log(
      `Saved ${safeText(opened.filename)} (${bytesLabel(opened.size)}) to ${out}.`,
    );
    return;
  }

  for (const line of ticketLines(ticket, now)) console.log(line);
}

// Exported for tests; runs only when executed directly (node … support-show.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
