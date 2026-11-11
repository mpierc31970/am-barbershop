// Staff domain move (14-37; DOM-08, D169; UI-SPEC "Staff CLI output"). Moves a LIVE site from
// its custom domain to a new one through staffStartMove (the same @cds/db function the staff
// console calls): a `move` move runs snapshot -> zone -> gate -> the owner's nameserver step
// and later cuts over; the old domain then redirects for as long as it stays on CDS DNS.
// Never a launch: a site that isn't live goes live through Approve launch (14-36).
// super_admin only (domain_move, T-14-37-01); staff email, password and the emailed code
// first (T-14-37-02); a 10-500 character reason is audited (T-14-37-03).
//
// Usage:
//   npm run domains:move -- --org <org-id> --to <domain> --reason "<text>" [--dry-run] [--yes]
//   npm run domains:move -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { staffDomainView, staffStartMove } from "../src/dns/staff";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  REASON_MAX,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `domains:move - move a live site to a new domain

  npm run domains:move -- --org <org-id> --to <domain> --reason "<text>" [--dry-run] [--yes]
  npm run domains:move -- --help

--org      the site's organization id (the site must be live on its own domain)
--to       the new domain, e.g. riverabakery.net
--reason   why (10-${REASON_MAX} characters; audited)
--dry-run  sign in and print the case, without starting anything
--yes      skip the "Start move? [y/N]" confirm
super_admin only. Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

export const REFUSED_ROLE = "Refused: moving a domain needs super_admin.";
const REASON_MIN = 10;

/** The consequence lines (MoveDomainDialog copy, UI-SPEC staff Domain). */
export function moveCaseLines(
  business: string,
  from: string,
  to: string,
): string[] {
  return [
    `Move ${business} to ${to}?`,
    `Domain: ${from} -> ${to}`,
    `The site stays on ${from} until the move finishes. The old domain then sends visitors to the new one, for as long as it stays on CDS DNS.`,
    `The owner is asked to connect ${to}: CDS copies its records, then the owner changes its nameservers.`,
  ];
}

/** The line printed once the move has started. */
export function startedLine(code: string): string {
  return `Move ${code} started · step 1 snapshot · owner emailed.`;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--org", "--to", "--reason", "--dry-run", "--yes"],
    withValue: ["--org", "--to", "--reason"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const rawTo = args.get("--to");
  if (typeof rawTo !== "string" || rawTo.trim() === "") {
    fail("--to <domain> is required");
  }
  const to = rawTo.trim().toLowerCase();
  const rawReason = args.get("--reason");
  if (typeof rawReason !== "string") fail('--reason "<text>" is required');
  const reason = rawReason.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    fail(`--reason must be ${REASON_MIN}-${REASON_MAX} characters`);
  }

  const ctx = await signInStaffInteractive();
  if (ctx.staffRole !== "super_admin") {
    throw new CliFail(REFUSED_ROLE, { plain: true });
  }

  try {
    const view = await staffDomainView(ctx, org);
    const business = safeText(view.business || org);
    const custom = view.hosts.find((h) => h.primary && h.kind === "custom");
    const from = safeText(custom?.host ?? view.summary.primaryHost ?? "(none)");
    for (const line of moveCaseLines(business, from, safeText(to))) {
      console.log(line);
    }
    if (!view.live) {
      throw new CliFail(
        "Refused: this site isn't live. It connects its domain with a launch (Approve launch).",
        { plain: true },
      );
    }
    if (!custom) {
      throw new CliFail(
        "Refused: this site has no custom domain yet. It connects one with a launch.",
        { plain: true },
      );
    }
    const open = view.move;
    if (open && open.status !== "done" && open.status !== "cancelled") {
      throw new CliFail(
        `Refused: ${open.code} (${open.kind}) is still open. Finish or cancel it first.`,
        { plain: true },
      );
    }
    if (args.has("--dry-run")) {
      console.log("DRY RUN would start the move; nothing changed");
      return;
    }
    if (!args.has("--yes")) {
      const answer = await ask("Start move? [y/N] ");
      if (!/^y(es)?$/i.test(answer)) {
        console.log("Nothing changed.");
        return;
      }
    }
    const r = await staffStartMove(ctx, org, { domain: to, reason });
    console.log(startedLine(r.move.code));
    console.log(safeText(r.message));
  } catch (err) {
    if (err instanceof CliFail) throw err;
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw new CliFail(
        `Org ${org} not found, or this account can't move its domain.`,
        { plain: true },
      );
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${safeText(err.message)}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … domains-move.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
