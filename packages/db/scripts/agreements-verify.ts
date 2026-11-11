// Staff agreements:verify (09-14; AGR-01, AGR-04, AGR-05; D81; CONTEXT A2-Q4 and Specifics;
// RESEARCH Pattern 6; UI-SPEC "Staff CLI output", D-UI-P9-21). Re-derives both hashes of
// every signing of one org and prints MATCH or MISMATCH per signing; any failure or missing
// object exits 1. super_admin or support_agent (agreements_verify), after a staff MFA
// sign-in; the run writes one `agreement.verify` audit row and changes nothing else.
//
// Usage:
//   npm run agreements:verify -- --org <org-id>
//   npm run agreements:verify -- --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials, codes, emails and storage keys are never printed.
import "@cds/addon-registry/server";
import { Forbidden, NotFound } from "@cds/core";
import { verifySignatures, type SigningCheck } from "../src/legal/verify";
import {
  CliFail,
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  table,
  wantsHelp,
} from "./staff-cli";

const USAGE = `agreements:verify - prove a site's signed agreements (super_admin or support_agent, MFA)

  npm run agreements:verify -- --org <org-id>
  npm run agreements:verify -- --help

--org   the site whose signings to check
For every signing: recomputes the evidence and document hashes, checks the evidence is
canonical and agrees with the record, that every policy it cites still hashes the same,
and that its audit record carries the same hashes. Reads only; the run is audited.
Exit 0 when every signing verifies, 1 on any MISMATCH or missing copy.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)

Policy codes: SA Service Agreement · AUP Acceptable Use · TOS Terms of Service · SUB Subscription terms · DPA Data Processing Agreement · ESC e-sign consent`;

const HEADER = [
  "SIGNED (UTC)",
  "SIGNER",
  "KIND",
  "POLICIES",
  "IP",
  "EVIDENCE",
  "DOCUMENT",
] as const;

const notFoundCopy = (org: string) =>
  `Org ${org} not found, or this account isn't CDS staff.`;

/** "2026-10-08 19:14:03" from an ISO string, "-" when unreadable. */
function utc(iso: string): string {
  return iso === "" ? "-" : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function row(c: SigningCheck): string[] {
  return [
    utc(c.signedAt),
    c.signerName || "-",
    c.kind || "-",
    c.codes || "-",
    c.ip || "-",
    c.evidence,
    c.document,
  ];
}

const plural = (n: number) => (n === 1 ? "signing" : "signings");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: ["--org"],
    withValue: ["--org"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");

  const ctx = await signInStaffInteractive();
  let result;
  try {
    result = await verifySignatures(ctx, org);
  } catch (err) {
    if (err instanceof Forbidden || err instanceof NotFound) {
      throw new CliFail(notFoundCopy(org), { plain: true });
    }
    throw err;
  }
  const { orgName, orgDeleted, checks } = result;
  const n = checks.length;
  if (n === 0) {
    console.log("No signings recorded for this org.");
    return;
  }
  const gone = orgDeleted ? " (site deleted; signings kept)" : "";
  console.log(
    `${safeText(orgName || "-")} · org ${org}${gone} · ${n} ${plural(n)}`,
  );
  console.log(table(HEADER, checks.map(row)));
  for (const c of checks) {
    const day = c.signedAt === "" ? "----------" : c.signedAt.slice(0, 10);
    for (const p of c.problems) console.log(`${day} signing: ${safeText(p)}.`);
  }
  const failed = checks.filter((c) => c.problems.length > 0).length;
  if (failed > 0) {
    throw new CliFail(
      `${failed} of ${n} signings failed. Don't change anything; tell the CDS owner.`,
      { plain: true },
    );
  }
  console.log(`All ${n} ${plural(n)} verified.`);
}

runMain(main);
