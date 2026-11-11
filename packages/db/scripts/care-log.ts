// Staff Care Plan time log (10-27; BILL-19; CONTEXT A4; D298, D299; UI-SPEC "Staff CLI
// output"). Logs minutes against an org's included hour through logCareTime: the same
// chokepoint P12/P13 tickets will use. super_admin or support_agent (care_log), after a CDS
// staff sign-in with the emailed code; every entry is audited (T-10-27-01, T-10-27-02).
//
// Usage:
//   npm run care:log -- --org <org-id> --minutes 30 --note "<text>" [--ticket <ref>] [--dry-run]
//   npm run care:log -- --help
// --dry-run still signs in (logging is staff-only) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { CARE_PLAN_MINUTES } from "@cds/core/payments";
import { logCareTime } from "../src/payments/care-time";
import { staffCareTicketRef } from "../src/support/paid";
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

const USAGE = `care:log - log Care Plan time against a site (super_admin or support_agent)

  npm run care:log -- --org <org-id> --minutes <1-600> --note "<text>" [--ticket <ref>] [--dry-run]
  npm run care:log -- --help

--org      the site's organization id
--minutes  whole minutes spent (1-600)
--note     what was done (1-500 characters); the owner sees it in Settings > Billing
--ticket   optional ticket: a support ticket number of that site (e.g. 1042, checked), or a
           free-text reference (letters, digits, . _ - # :; up to 64)
--dry-run  sign in and print what would be logged, without writing
The Care Plan includes ${CARE_PLAN_MINUTES} minutes a month (business time zone, no rollover).
Past that the entry is refused: send a polish quote instead (work:quote --kind polish).
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const NOTE_MAX = 500;
const MINUTES_MAX = 600;

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--org", "--minutes", "--note", "--ticket", "--dry-run"],
    withValue: ["--org", "--minutes", "--note", "--ticket"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const rawMinutes = args.get("--minutes");
  if (typeof rawMinutes !== "string") fail("--minutes <1-600> is required");
  if (!/^\d{1,3}$/.test(rawMinutes)) {
    fail(`--minutes must be a whole number 1-${MINUTES_MAX}`);
  }
  const minutes = Number(rawMinutes);
  if (minutes < 1 || minutes > MINUTES_MAX) {
    fail(`--minutes must be a whole number 1-${MINUTES_MAX}`);
  }
  const rawNote = args.get("--note");
  if (typeof rawNote !== "string") fail('--note "<text>" is required');
  const note = rawNote.trim();
  if (note === "" || note.length > NOTE_MAX) {
    fail(`--note must be 1-${NOTE_MAX} characters`);
  }
  const ticket = args.get("--ticket");
  let ticketRef = typeof ticket === "string" ? ticket : undefined;

  const ctx = await signInStaffInteractive();
  if (ticketRef !== undefined) {
    // 12-23: a ticket number must be one of this org's tickets; other refs stay free text.
    try {
      ticketRef = await staffCareTicketRef(ctx, org, ticketRef);
    } catch (err) {
      if (err instanceof InvalidInput) {
        throw new CliFail(`Refused: ${err.message}`, { plain: true });
      }
      if (err instanceof Forbidden) {
        throw new CliFail(
          `Org ${org} not found, or this account can't log Care Plan time.`,
          { plain: true },
        );
      }
      throw err;
    }
  }
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would log ${minutes} min to org ${org}: ${safeText(note)}${ticketRef ? ` (ticket ${safeText(ticketRef)})` : ""}; nothing changed`,
    );
    return;
  }
  try {
    const r = await logCareTime(ctx, { orgId: org, minutes, note, ticketRef });
    console.log(
      `Logged ${minutes} min. ${r.monthLabel}: ${r.usedMinutes} of ${CARE_PLAN_MINUTES} minutes used.`,
    );
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw new CliFail(
        `Org ${org} not found, or this account can't log Care Plan time.`,
        { plain: true },
      );
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … care-log.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
