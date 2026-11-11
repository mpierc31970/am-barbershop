// Staff post to one site (12-30; COMM-02, COMM-04; UI-SPEC "Staff CLI output"). A CDS message
// (public, or an internal note), a CDS note (optionally pinned) or a shared document, through
// staffPostConversationMessage / staffPostNote / staffShareDocument (`cds_post`: super_admin or
// support_agent) after a CDS staff sign-in with the emailed code. Prints the item as the owner
// will see it, naming the business, then asks "Post? [y/N]" (--yes skips; --dry-run changes
// nothing, T-12-30-02). Every post is audited with the staff actor and the org.
//
// Usage:
//   npm run cds:post -- --org <id> (--message "<text>" | --message-file <md>) [--internal]
//   npm run cds:post -- --org <id> (--note "<text>" | --note-file <md>) --title "<text>" [--pin]
//   npm run cds:post -- --org <id> --document <path> --title "<text>" [--doc-note "<text>"]
//   (each with [--yes] [--dry-run]); npm run cds:post -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { EmailTransport } from "../src/email/transport";
import type { ObjectStore } from "../src/storage";
import { staffPostConversationMessage } from "../src/support/messages";
import {
  CDS_DOCUMENT_NOTE_MAX,
  CDS_DOCUMENT_TITLE_MAX,
  CDS_NOTE_BODY_MAX,
  CDS_NOTE_TITLE_MAX,
  staffPostNote,
  staffShareDocument,
} from "../src/support/notes-docs";
import { MESSAGE_BODY_MAX } from "../src/support/shared";
import { staffSupportLabels } from "../src/support/staff-labels";
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
  type ParsedArgs,
} from "./staff-cli";
import {
  BODY_FILE_MAX,
  bytesLabel,
  readFiles,
  type CliFile,
} from "./support-cli-kit";

export const USAGE = `cds:post - post a CDS message, note or document to one site (super_admin or support_agent)

  npm run cds:post -- --org <org-id> (--message "<text>" | --message-file <md>) [--internal]
  npm run cds:post -- --org <org-id> (--note "<text>" | --note-file <md>) --title "<text>" [--pin]
  npm run cds:post -- --org <org-id> --document <path> --title "<text>" [--doc-note "<text>"]
  each with [--yes] [--dry-run]
  npm run cds:post -- --help

--org           the site (organizations id)
--message       a message in the site's CDS conversation (up to 5,000 characters);
                or --message-file <md> to read it from a file
--internal      with --message: an internal note on the conversation; CDS staff only,
                the owner never sees it, nobody is alerted
--note          a CDS note (up to 5,000 characters; --note-file <md> reads a file),
                with --title (up to 80) and optionally --pin to pin it to the top
--document      share a file (10 MB; png, jpg, webp, gif, pdf, txt, csv, docx, xlsx,
                pptx) with --title (up to 120) and optionally --doc-note (up to 500)
--yes           skip the y/N confirm
--dry-run       sign in and print the item as the owner will see it, without posting
A message, note or document alerts the site's Owners, Admins and Editors (bell and email).
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type PostDeps = {
  store?: ObjectStore;
  transport?: EmailTransport;
  now?: () => Date;
};

type Item =
  | { kind: "message"; body: string; internal: boolean }
  | { kind: "note"; title: string; body: string; pinned: boolean }
  | { kind: "document"; title: string; note: string; file: CliFile };

/** Inline text or a file (not both), trimmed, at most `max` characters. */
function textArg(
  args: ParsedArgs,
  inlineFlag: string,
  fileFlag: string,
  max: number,
): string {
  const inline = args.get(inlineFlag);
  const file = args.get(fileFlag);
  if (inline !== undefined && file !== undefined) {
    fail(`use ${inlineFlag} or ${fileFlag}, not both`);
  }
  let text = "";
  if (typeof inline === "string") text = inline;
  else if (typeof file === "string") {
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) fail(`${fileFlag} ${file} is not a file`);
      size = st.size;
    } catch (err) {
      if (err instanceof CliFail) throw err;
      fail(`${fileFlag} ${file} could not be read`);
    }
    if (size > BODY_FILE_MAX) fail(`${fileFlag} is larger than 64 KB`);
    text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  }
  text = text.trim();
  if (text === "")
    fail(`${inlineFlag} "<text>" or ${fileFlag} <md> must not be empty`);
  if (text.length > max) {
    fail(
      `${inlineFlag} must be at most ${max.toLocaleString("en-US")} characters`,
    );
  }
  return text;
}

function titleArg(args: ParsedArgs, max: number): string {
  const raw = args.get("--title");
  if (typeof raw !== "string") fail('--title "<text>" is required');
  const title = raw.replace(/\s+/g, " ").trim();
  if (title === "" || title.length > max) {
    fail(`--title must be 1-${max} characters`);
  }
  return title;
}

const ONLY: Record<string, Item["kind"]> = {
  "--internal": "message",
  "--pin": "note",
  "--doc-note": "document",
};

/** The item as the owner will see it. */
export function previewLines(business: string, item: Item): string[] {
  const out: string[] = [];
  const body = (text: string) => {
    for (const line of text.split("\n")) out.push(`  ${safeText(line)}`);
  };
  if (item.kind === "message") {
    out.push(
      item.internal
        ? `Internal note on ${business}'s CDS conversation (CDS staff only; the owner never sees it):`
        : `Message to ${business} in Support → Messages, as the owner will see it:`,
    );
    body(item.body);
    out.push(
      `Recipients: ${item.internal ? "nobody" : "Owners, Admins and Editors (bell and email)"}`,
    );
  } else if (item.kind === "note") {
    out.push(
      `${item.pinned ? "Pinned note" : "Note"} to ${business}, as the owner will see it:`,
      `  ${safeText(item.title)}`,
    );
    body(item.body);
    out.push("Recipients: Owners, Admins and Editors (bell and email)");
  } else {
    out.push(
      `Document for ${business} in Support → Documents:`,
      `  ${safeText(item.title)}`,
      `  File: ${safeText(item.file.name)} (${bytesLabel(item.file.bytes.length)})`,
    );
    if (item.note) body(item.note);
    out.push("Recipients: Owners, Admins and Editors (bell and email)");
  }
  return out;
}

function refusal(err: unknown, org: string): never {
  if (err instanceof NotFound || err instanceof Forbidden) {
    throw new CliFail(
      `Org ${org} not found, or this account can't post to sites.`,
      { plain: true },
    );
  }
  if (err instanceof InvalidInput) {
    throw new CliFail(`Refused: ${err.message}`, { plain: true });
  }
  throw err;
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: PostDeps = {},
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--org",
      "--message",
      "--message-file",
      "--internal",
      "--note",
      "--note-file",
      "--title",
      "--pin",
      "--document",
      "--doc-note",
      "--yes",
      "--dry-run",
    ],
    withValue: [
      "--org",
      "--message",
      "--message-file",
      "--note",
      "--note-file",
      "--title",
      "--document",
      "--doc-note",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }

  // Everything is checked before anyone signs in.
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const kinds: Item["kind"][] = [];
  if (args.has("--message") || args.has("--message-file"))
    kinds.push("message");
  if (args.has("--note") || args.has("--note-file")) kinds.push("note");
  if (args.has("--document")) kinds.push("document");
  if (kinds.length !== 1) {
    fail("give exactly one of --message, --note or --document");
  }
  const kind = kinds[0]!;
  for (const [flag, owner] of Object.entries(ONLY)) {
    if (args.has(flag) && owner !== kind) fail(`${flag} goes with --${owner}`);
  }
  if (kind === "message" && args.has("--title")) {
    fail("--title goes with --note or --document");
  }
  let item: Item;
  if (kind === "message") {
    item = {
      kind,
      body: textArg(args, "--message", "--message-file", MESSAGE_BODY_MAX),
      internal: args.has("--internal"),
    };
  } else if (kind === "note") {
    item = {
      kind,
      title: titleArg(args, CDS_NOTE_TITLE_MAX),
      body: textArg(args, "--note", "--note-file", CDS_NOTE_BODY_MAX),
      pinned: args.has("--pin"),
    };
  } else {
    const path = args.get("--document");
    if (typeof path !== "string") fail("--document <path> needs a file");
    const raw = args.get("--doc-note");
    const note = typeof raw === "string" ? raw.trim() : "";
    if (note.length > CDS_DOCUMENT_NOTE_MAX) {
      fail(`--doc-note must be at most ${CDS_DOCUMENT_NOTE_MAX} characters`);
    }
    item = {
      kind,
      title: titleArg(args, CDS_DOCUMENT_TITLE_MAX),
      note,
      file: readFiles([path])[0]!,
    };
  }

  const ctx = await signInStaffInteractive();
  let business: string;
  try {
    const labels = await staffSupportLabels(ctx, { orgIds: [org] });
    if (!(org in labels.orgs)) throw new NotFound();
    business = safeText(labels.orgs[org] || org);
  } catch (err) {
    refusal(err, org);
  }

  for (const line of previewLines(business, item)) console.log(line);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would post this; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Post? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }

  const now = (deps.now ?? (() => new Date()))();
  const clock = { now: () => now };
  let raised = 0;
  try {
    if (item.kind === "message") {
      const r = await staffPostConversationMessage(
        ctx,
        { orgId: org, body: item.body, internal: item.internal },
        { clock, transport: deps.transport, store: deps.store },
      );
      raised = r.raised;
    } else if (item.kind === "note") {
      const r = await staffPostNote(
        ctx,
        { orgId: org, title: item.title, body: item.body, pinned: item.pinned },
        { clock, transport: deps.transport },
      );
      raised = r.raised;
    } else {
      const r = await staffShareDocument(
        ctx,
        {
          orgId: org,
          title: item.title,
          ...(item.note ? { note: item.note } : {}),
          filename: item.file.name,
          bytes: item.file.bytes,
        },
        { clock, transport: deps.transport, store: deps.store },
      );
      raised = r.raised;
    }
  } catch (err) {
    refusal(err, org);
  }
  if (item.kind === "message" && item.internal) {
    console.log("Saved as an internal note. The owner never sees it.");
    return;
  }
  console.log(`Posted. Bell and email (logged) for ${people(raised)}.`);
}

// Exported for tests; runs only when executed directly (node … cds-post.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
