// Read-only table of the hub's competitor claims (15-08; HUB-06, A2-Q5, P15-P8). Staff run it
// to see which claims are due for their 6-month re-check (health check 51 warns over 150
// days, critical over 183). Static data from `CLAIMS` in @cds/core/marketing: no sign-in, no
// database, nothing is ever written.
//
// Usage:
//   npm run hub:claims
//   npm run hub:claims -- --json
//   npm run hub:claims -- --help
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, oldestVerifiedDays, type Claim } from "@cds/core/marketing";
import { parseArgs, runMain, table, wantsHelp } from "./staff-cli";

export const USAGE = `hub:claims - read-only table of the hub's competitor claims (HUB-06)

  npm run hub:claims               id, competitor, verified on, age (days), status
  npm run hub:claims -- --json     the same rows as JSON
  npm run hub:claims -- --help     this text

Re-check each claim every 6 months (health check 51: warning over 150 days,
critical over 183). See docs/how-to/staff-hub-claims.md. No sign-in.
Nothing is written anywhere.`;

const READ_ONLY = "Read-only: nothing was written.";
const DAY_MS = 86_400_000;

export type ClaimRowOut = {
  id: string;
  competitor: string;
  verified_on: string;
  age_days: number;
  status: Claim["status"];
};

/** Whole days since a claim's `verifiedOn` (UTC midnight). */
export function claimAgeDays(claim: Claim, now: Date): number {
  const t = Date.parse(`${claim.verifiedOn}T00:00:00Z`);
  return Math.floor((now.getTime() - t) / DAY_MS);
}

export function claimRows(all: readonly Claim[], now: Date): ClaimRowOut[] {
  return all.map((c) => ({
    id: c.id,
    competitor: c.competitor,
    verified_on: c.verifiedOn,
    age_days: claimAgeDays(c, now),
    status: c.status,
  }));
}

/** "9 claims · 0 verified · 9 draft · oldest verified none" */
export function claimsFooter(all: readonly Claim[], now: Date): string {
  const verified = all.filter((c) => c.status === "verified").length;
  const draft = all.filter((c) => c.status === "draft").length;
  const oldest = oldestVerifiedDays(all, now);
  const n = all.length;
  return `${n} claim${n === 1 ? "" : "s"} · ${verified} verified · ${draft} draft · oldest verified ${
    oldest === null ? "none" : `${oldest} days`
  }`;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  now: Date = new Date(),
  all: readonly Claim[] = CLAIMS,
): Promise<void> {
  const args = parseArgs(argv, { known: ["--json"], withValue: [] });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const rows = claimRows(all, now);
  if (args.has("--json")) {
    console.log(
      JSON.stringify(
        { claims: rows, oldest_verified_days: oldestVerifiedDays(all, now) },
        null,
        2,
      ),
    );
  } else {
    console.log(
      table(
        ["id", "competitor", "verified on", "age (days)", "status"],
        rows.map((r) => [
          r.id,
          r.competitor,
          r.verified_on,
          String(r.age_days),
          r.status,
        ]),
      ),
    );
    console.log("");
    console.log(claimsFooter(all, now));
  }
  console.log(READ_ONLY);
}

// Exported for tests; runs only when executed directly (node … hub-claims.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
