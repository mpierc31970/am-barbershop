// Staff decline of a paid customer (10-28; BILL-09; D214; CONTEXT A4; UI-SPEC "Staff CLI
// output"). Prints the case (org, paid date, business days since, build started, charges to
// refund), asks y/N, then refunds every CDS charge, cancels the subscription and remaining
// installments, closes the site as declined and emails the owner through declinePaidOrg: the
// same chokepoint the P13 staff-console button will use. super_admin only (org_decline),
// after a CDS staff sign-in with the emailed code; audited with the reason (T-10-28-01,
// T-10-28-03).
//
// Usage:
//   npm run org:decline -- --org <org-id> --reason-category <fit|capacity|scope|other> [--note "…"] [--dry-run] [--yes]
//   npm run org:decline -- --help
// --dry-run still signs in (the case is staff-only) but changes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { DECLINE_WINDOW_BUSINESS_DAYS } from "@cds/core/payments";
import { formatCentsExact } from "@cds/core/pricing";
import {
  DECLINE_NOTE_MAX,
  DECLINE_REASON_CATEGORIES,
  declineCase,
  declineDay,
  DeclineRefused,
  declinePaidOrg,
  type DeclineReasonCategory,
} from "../src/payments/decline";
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

const USAGE = `org:decline - decline a paid site and refund it in full (super_admin, MFA)

  npm run org:decline -- --org <org-id> --reason-category <fit|capacity|scope|other> [--note "<text>"] [--dry-run] [--yes]
  npm run org:decline -- --help

--org              the site's organization id
--reason-category  fit | capacity | scope | other: picks the sentence the owner reads
--note             one sentence (up to ${DECLINE_NOTE_MAX} characters); required for other,
                   where the owner reads it as the reason
--dry-run          sign in and print the case, without acting
--yes              skip the y/N confirm after the case is printed
Only within ${DECLINE_WINDOW_BUSINESS_DAYS} business days of payment and before build work starts.
Refunds every CDS charge, cancels the subscription and remaining installments, takes the
preview down and deletes the site's data after 30 days. Agreements and invoices are kept.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

function notFound(org: string): CliFail {
  return new CliFail(
    `Org ${org} not found, or this account can't decline sites.`,
    { plain: true },
  );
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--org", "--reason-category", "--note", "--dry-run", "--yes"],
    withValue: ["--org", "--reason-category", "--note"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const category = args.get("--reason-category");
  if (typeof category !== "string") {
    fail("--reason-category <fit|capacity|scope|other> is required");
  }
  if (!(DECLINE_REASON_CATEGORIES as readonly string[]).includes(category)) {
    fail("--reason-category must be fit, capacity, scope or other");
  }
  const rawNote = args.get("--note");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > DECLINE_NOTE_MAX) {
    fail(`--note must be at most ${DECLINE_NOTE_MAX} characters`);
  }
  if (/[\r\n]/.test(note)) fail("--note must be one sentence");
  if (category === "other" && note === "") {
    fail('--reason-category other needs --note "<one sentence>"');
  }

  const ctx = await signInStaffInteractive();
  let c;
  try {
    c = await declineCase(ctx, org);
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(org);
    }
    throw err;
  }
  const paid = c.paidAt ? declineDay(new Date(c.paidAt)) : "-";
  console.log(`Org:            ${safeText(c.orgName)} (${c.orgId})`);
  console.log(`Paid:           ${paid}`);
  console.log(`Business days:  ${c.paidAt ? c.businessDaysSince : "-"}`);
  console.log(
    `Build started:  ${c.buildStartedAt ? `yes, ${declineDay(new Date(c.buildStartedAt))}` : "no"}`,
  );
  console.log(
    `To refund:      ${c.invoices} charge${c.invoices === 1 ? "" : "s"}, ${formatCentsExact(c.refundableCents)}`,
  );
  console.log(
    `Reason:         ${category}${note ? `: ${safeText(note)}` : ""}`,
  );
  if (c.refusal) throw new CliFail(c.refusal, { plain: true });
  if (c.resuming) {
    console.log(
      "Resuming:       an earlier run stopped part way; this one finishes it",
    );
  }

  const amount = formatCentsExact(c.refundableCents);
  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would decline org ${c.orgId} and refund ${amount}; nothing changed`,
    );
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask(`Decline and refund ${amount}? [y/N] `);
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  try {
    const r = await declinePaidOrg(ctx, org, {
      reasonCategory: category as DeclineReasonCategory,
      note: note === "" ? null : note,
    });
    console.log(
      `Declined and refunded ${formatCentsExact(r.refundedCents)}. ${r.emailed ? "Owner emailed." : "Owner email not sent (logged)."} Site data deletes on ${r.deleteOn}.`,
    );
  } catch (err) {
    if (err instanceof DeclineRefused) {
      throw new CliFail(err.message, { plain: true });
    }
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(org);
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … org-decline.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
