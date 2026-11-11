// Staff open a ticket on a site's behalf (12-28; D210; UI-SPEC "Staff CLI output"). The ticket
// shows "Opened by CDS", its first message is CDS-authored and public, and it is already
// answered for SLA. Through staffOpenTicket (support_open: super_admin or support_agent) after
// a CDS staff sign-in with the emailed code; audited support.ticket_opened_by_cds with the staff
// actor. Prints what Owners and Admins will see and asks "Open? [y/N]" (--yes skips; --dry-run
// changes nothing).
//
// Usage:
//   npm run support:open -- --org <id> --type problem|change|question|billing --subject "<text>"
//        (--body "<text>" | --body-file <md>) [--target page:<id>|addon:<slug>|part:<key>]
//        [--file <path>]... [--yes] [--dry-run]
//   npm run support:open -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type { TicketType } from "@cds/core/support";
import type { EmailTransport } from "../src/email/transport";
import type { ObjectStore } from "../src/storage";
import { staffSupportSignature } from "../src/support/sla-report";
import { staffGetTicket, staffOpenTicket } from "../src/support/staff-tickets";
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
import {
  bodyArg,
  bytesLabel,
  readFiles,
  SUBJECT_MAX,
  takeRepeated,
  typeWord,
} from "./support-cli-kit";

const OPEN_TYPES: readonly TicketType[] = [
  "problem",
  "change",
  "question",
  "billing",
];
const TARGET_RE = /^(site|page|addon|part):[A-Za-z0-9_-]{1,64}$/;

export const USAGE = `support:open - open a ticket on a site's behalf, shown as Opened by CDS (super_admin or support_agent)

  npm run support:open -- --org <org-id> --type <type> --subject "<text>" (--body "<text>" | --body-file <md>)
       [--target page:<id>|addon:<slug>|part:<key>] [--file <path>]... [--yes] [--dry-run]
  npm run support:open -- --help

--org        the site's organization id
--type       ${OPEN_TYPES.join(", ")}
--subject    one line, up to ${SUBJECT_MAX} characters
--body       the first message (up to 5,000 characters); or --body-file <md>
--target     what it is about: page:<page-id>, addon:<slug> or part:header|footer|menus
             (default: the whole site; it must be one of that site's own pages or add-ons)
--file       attach a file (repeat for more, up to 5; 10 MB each)
--yes        skip the y/N confirm
--dry-run    sign in and print the ticket as the owner will see it, without opening it
The ticket counts as already answered for the reply SLA. Owners and Admins are alerted
(bell and email). Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export type OpenDeps = {
  store?: ObjectStore;
  transport?: EmailTransport;
  now?: () => Date;
};

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  deps: OpenDeps = {},
): Promise<void> {
  const { values: filePaths, rest } = takeRepeated(argv, "--file");
  const args = parseArgs(rest, {
    known: [
      "--org",
      "--type",
      "--subject",
      "--body",
      "--body-file",
      "--target",
      "--yes",
      "--dry-run",
    ],
    withValue: [
      "--org",
      "--type",
      "--subject",
      "--body",
      "--body-file",
      "--target",
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
  const rawType = args.get("--type");
  if (typeof rawType !== "string") {
    fail(`--type is required: ${OPEN_TYPES.join(", ")}`);
  }
  const type = rawType.trim().toLowerCase() as TicketType;
  if (!OPEN_TYPES.includes(type)) {
    fail(`--type must be ${OPEN_TYPES.join(", ")}`);
  }
  const rawSubject = args.get("--subject");
  if (typeof rawSubject !== "string") fail('--subject "<text>" is required');
  if (/[\r\n]/.test(rawSubject)) fail("--subject must be one line");
  const subject = rawSubject.replace(/\s+/g, " ").trim();
  if (subject === "" || subject.length > SUBJECT_MAX) {
    fail(`--subject must be 1-${SUBJECT_MAX} characters`);
  }
  const body = bodyArg(args, true);
  const target = args.get("--target");
  if (target !== undefined) {
    if (typeof target !== "string" || !TARGET_RE.test(target)) {
      fail("--target must be page:<id>, addon:<slug> or part:<key>");
    }
  }
  const files = readFiles(filePaths);

  const ctx = await signInStaffInteractive();
  const now = (deps.now ?? (() => new Date()))();
  let signature: string;
  try {
    signature = await staffSupportSignature(ctx);
  } catch (err) {
    if (err instanceof Forbidden) {
      throw new CliFail("Refused: this account can't open support tickets.", {
        plain: true,
      });
    }
    throw err;
  }

  const preview = [
    `New ${typeWord(type)} ticket for org ${org} · Opened by CDS`,
    `  ${safeText(subject)}`,
    `  About: ${typeof target === "string" ? safeText(target) : "Whole site"}`,
    "",
    "First message as the owner will see it:",
    `  ${safeText(signature)}`,
    ...body.split("\n").map((l) => `  ${safeText(l)}`),
    ...files.map(
      (f) =>
        `  Attachment: ${safeText(f.name)} (${bytesLabel(f.bytes.length)})`,
    ),
    "",
    "Recipients: Owners and Admins (bell and email). Already answered for SLA.",
  ];
  for (const line of preview) console.log(line);
  if (args.has("--dry-run")) {
    console.log("DRY RUN would open this ticket; nothing changed");
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask("Open? [y/N] ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }

  let opened: Awaited<ReturnType<typeof staffOpenTicket>>;
  try {
    opened = await staffOpenTicket(
      ctx,
      {
        orgId: org,
        type,
        subject,
        body,
        ...(typeof target === "string" ? { target } : {}),
        files,
      },
      {
        store: deps.store,
        transport: deps.transport,
        clock: { now: () => now },
      },
    );
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw new CliFail(
        `Org ${org} not found, or this account can't open support tickets.`,
        { plain: true },
      );
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
  const detail = await staffGetTicket(ctx, opened.number, { now }).catch(
    () => null,
  );
  console.log(
    `Ticket #${opened.number} opened for ${safeText(detail?.orgName || org)} (Opened by CDS). Already answered for SLA.`,
  );
}

// Exported for tests; runs only when executed directly (node … support-open.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
