// Staff fit review (ONB-12, D215; CONTEXT A1-Q5; UI-SPEC "Staff CLI output"). Prints the
// held org's case (name, business type, description, matched reasons), then approves or
// declines it through approveFit / declineFit: the same chokepoint the P13 console will use.
// super_admin only (fit_review), after a CDS staff MFA sign-in; audited with the reason, and
// the owner is emailed (T-06-47, T-06-48, T-06-50).
//
// Usage:
//   npm run fit:review -- --org <org-id> --approve|--decline --reason "<text>" [--dry-run]
//   npm run fit:review -- --help
// --dry-run still signs in (reading the case is staff-only) but changes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { Forbidden, NotFound } from "@cds/core";
import type { PlatformContext } from "../src/context";
import { approveFit, declineFit, describeFitCase } from "../src/fit";
import {
  ask,
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  reasonArg,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `fit:review - clear or decline a site held for review (super_admin, MFA)

  npm run fit:review -- --org <org-id> --approve --reason "<text>" [--dry-run] [--yes]
  npm run fit:review -- --org <org-id> --decline --reason "<text>" [--dry-run] [--yes]
  npm run fit:review -- --help

--approve  clear the site: setup continues (checkout once it opens); the owner is emailed.
           Only the case printed in this run is approved; if the owner changed it since,
           nothing is approved and you run fit:review again
--decline  hold the site; the owner is emailed
--reason   why (1-500 characters), written to the audit log
--dry-run  sign in and print the case, without acting
--yes      skip the y/N confirm after the case is printed
--override-blocked  approve a case that matches a never-hosted category (D215)
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const APPROVED = "Approved. The owner can go to checkout when it opens.";
const DECLINED = "Declined. The owner was emailed and the site is held.";

function assemblyHint(org: string): string {
  return `Assembly runs within the hour. To run it now: npm run site:assemble -- --org ${org}`;
}

/** True when the approved org now waits on assembly (best effort: a failed read prints nothing). */
async function stageAfter(ctx: PlatformContext, org: string): Promise<boolean> {
  try {
    return (await describeFitCase(ctx, org)).stage === "ready_for_build";
  } catch {
    return false;
  }
}

function notFound(org: string): CliFail {
  return new CliFail(`Org ${org} not found, or this account isn't CDS staff.`, {
    plain: true,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: [
      "--org",
      "--approve",
      "--decline",
      "--reason",
      "--dry-run",
      "--yes",
      "--override-blocked",
    ],
    withValue: ["--org", "--reason"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const approve = args.has("--approve");
  const decline = args.has("--decline");
  if (approve === decline) fail("give exactly one of --approve or --decline");
  const reason = reasonArg(args);

  const ctx = await signInStaffInteractive();
  let c;
  try {
    c = await describeFitCase(ctx, org);
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden)
      throw notFound(org);
    throw err;
  }
  // Every screened field is owner-written: printed through safeText (A-WR-10). All of them
  // are shown, since the check reads all of them (R2-CR-01).
  console.log(`Org:           ${safeText(c.name)} (${c.orgId})`);
  console.log(`Stage:         ${c.stage || "-"}`);
  console.log(`Verdict:       ${c.verdict}`);
  console.log(
    `Matched:       ${c.reasons.length ? safeText(c.reasons.join(", ")) : "nothing (the fit check no longer holds it)"}`,
  );
  console.log("Screened fields:");
  for (const f of c.fields) {
    console.log(`  ${`${f.field}:`.padEnd(21)} ${safeText(f.text)}`);
  }
  if (c.fields.length === 0) console.log("  -");

  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would ${approve ? "approve" : "decline"} org ${c.orgId}; nothing changed`,
    );
    return;
  }
  if (approve && c.verdict === "blocked" && !args.has("--override-blocked")) {
    fail(
      "this matches a never-hosted category; pass --override-blocked to approve it",
    );
  }
  if (!args.has("--yes")) {
    const answer = await ask(
      `${approve ? "Approve" : "Decline"} this site? [y/N] `,
    );
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  if (approve) {
    // Bound to the case printed above: a change since then is refused (R2-CR-01).
    await approveFit(ctx, c.orgId, reason, {
      reviewed: c.fingerprint,
      overrideBlocked: args.has("--override-blocked"),
    });
    console.log(APPROVED);
    // P8 (08-18 choice 2): an org whose intake was already sent lands on ready_for_build;
    // the hourly sweep assembles it (no enqueue from the CLI, 08-17 choice 2).
    if (await stageAfter(ctx, c.orgId)) console.log(assemblyHint(c.orgId));
  } else {
    await declineFit(ctx, c.orgId, reason);
    console.log(DECLINED);
  }
}

runMain(main);
