// Shared helpers for the ticket staff CLIs (12-28: support:list, support:show, support:reply,
// support:open, support:sla). Argument checks that run before sign-in, the --body-file and
// --file readers, and the plain-text cells (age, SLA, status) the UI-SPEC "Staff CLI output"
// lists. Tenant text is printed through safeText (T-12-28-03).
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import {
  PAID_CATEGORY_KEYS,
  type PaidCategory,
  type SlaState,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import {
  detectSupportFileType,
  SUPPORT_FILE_MAX_BYTES,
  SUPPORT_FILES_PER_MESSAGE,
} from "../src/support/files";
import { MESSAGE_BODY_MAX } from "../src/support/shared";
import { CliFail, fail, type ParsedArgs } from "./staff-cli";

export const BODY_FILE_MAX = 64 * 1024;
export const SUBJECT_MAX = 80;

/** CLI status words: `waiting` is Waiting on you. */
const STATUS_WORDS: Record<string, TicketStatus> = {
  open: "open",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  waiting: "waiting_on_you",
  waiting_on_you: "waiting_on_you",
  resolved: "resolved",
  closed: "closed",
};
export const STATUS_HELP = "open, in_progress, waiting, resolved or closed";

export function statusArg(raw: string, flag = "--status"): TicketStatus {
  const s = STATUS_WORDS[raw.trim().toLowerCase()];
  if (!s) fail(`${flag} must be ${STATUS_HELP}`);
  return s;
}

export const TYPES: readonly TicketType[] = [
  "problem",
  "change",
  "question",
  "billing",
  "suggestion",
];

/** Short type words for terminal columns (UI-SPEC CLI output): "Problem", "Change" … */
export function typeWord(t: TicketType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** `1042` or `#1042` (≥ 1001); anything else fails before sign-in. */
export function ticketArg(args: ParsedArgs): number {
  const raw = args.get("--ticket");
  if (typeof raw !== "string") fail("--ticket <number> is required");
  const s = raw.trim().replace(/^#/, "");
  if (!/^[1-9]\d{0,9}$/.test(s) || Number(s) < 1001) {
    fail("--ticket must be a ticket number such as 1042");
  }
  return Number(s);
}

/** `--paid design` / `page-building` → a paid category key. */
export function paidArg(raw: string): PaidCategory {
  const key = raw.trim().toLowerCase().replace(/-/g, "_");
  if (!(PAID_CATEGORY_KEYS as readonly string[]).includes(key)) {
    fail(`--paid must be one of ${PAID_CATEGORY_KEYS.join(", ")}`);
  }
  return key as PaidCategory;
}

/**
 * Takes every `--name value` / `--name=value` out of argv (a repeatable flag; parseArgs keeps
 * only the last). Returns the values and the rest of argv.
 */
export function takeRepeated(
  argv: readonly string[],
  name: string,
): { values: string[]; rest: string[] } {
  const values: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === name) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) fail(`${name} needs a value`);
      values.push(v);
      i++;
    } else if (arg.startsWith(`${name}=`)) {
      const v = arg.slice(name.length + 1);
      if (v === "") fail(`${name} needs a value`);
      values.push(v);
    } else {
      rest.push(arg);
    }
  }
  return { values, rest };
}

/** The message body from --body or --body-file (one of them; at most 5,000 characters). */
export function bodyArg(args: ParsedArgs, required: boolean): string {
  const inline = args.get("--body");
  const file = args.get("--body-file");
  if (inline !== undefined && file !== undefined) {
    fail("use --body or --body-file, not both");
  }
  let body = "";
  if (typeof inline === "string") body = inline;
  else if (typeof file === "string") {
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) fail(`--body-file ${file} is not a file`);
      size = st.size;
    } catch (err) {
      if (err instanceof CliFail) throw err;
      fail(`--body-file ${file} could not be read`);
    }
    if (size > BODY_FILE_MAX) fail("--body-file is larger than 64 KB");
    body = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    if (body.trim() === "") fail("--body-file is empty");
  }
  body = body.trim();
  if (required && body === "")
    fail('--body "<text>" or --body-file <md> is required');
  if (body.length > MESSAGE_BODY_MAX) {
    fail(
      `the message must be at most ${MESSAGE_BODY_MAX.toLocaleString("en-US")} characters`,
    );
  }
  return body;
}

export type CliFile = { name: string; bytes: Uint8Array };

/** Reads --file paths: at most 5, each ≤ 10 MB, of a type support accepts (checked by content). */
export function readFiles(paths: readonly string[]): CliFile[] {
  if (paths.length > SUPPORT_FILES_PER_MESSAGE) {
    fail(`at most ${SUPPORT_FILES_PER_MESSAGE} files per message`);
  }
  return paths.map((p) => {
    let size: number;
    try {
      const st = statSync(p);
      if (!st.isFile()) fail(`--file ${p} is not a file`);
      size = st.size;
    } catch (err) {
      if (err instanceof CliFail) throw err;
      fail(`--file ${p} could not be read`);
    }
    if (size > SUPPORT_FILE_MAX_BYTES) fail(`--file ${p} is larger than 10 MB`);
    const bytes = new Uint8Array(readFileSync(p));
    const name = basename(p);
    if (!detectSupportFileType(name, bytes)) {
      fail(
        `--file ${p}: only png, jpg, webp, gif, pdf, txt, csv, docx, xlsx or pptx (name and content must agree)`,
      );
    }
    return { name, bytes };
  });
}

/** "4h", "2d", "35m". */
export function ageCell(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "due in 11h", "met", "missed", "—" (no SLA). */
export function slaCell(
  sla: SlaState,
  dueAt: string | null,
  now: Date,
): string {
  if (sla === "met") return "met";
  if (sla === "missed") return "missed";
  if (sla === "none" || !dueAt) return "—";
  const due = Date.parse(dueAt.replace(" ", "T"));
  if (!Number.isFinite(due)) return "—";
  return `due in ${ageCell(due - now.getTime())}`;
}

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2026-10-12 15:00 UTC" from a PocketBase or ISO date. */
export function stamp(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v.replace(" ", "T"));
  if (!Number.isFinite(t)) return "—";
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Maps a db refusal to the plain staff sentence; other errors pass through. */
export function ticketRefusal(
  err: unknown,
  number: number,
  doing: string,
): never {
  if (err instanceof NotFound || err instanceof Forbidden) {
    throw new CliFail(
      `Ticket #${number} not found, or this account can't ${doing}.`,
      { plain: true },
    );
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}
