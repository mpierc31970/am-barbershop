// Staff media usage (07-27; CONT-19, D221 / D225; CONTEXT Area 1 row 5). Prints storage per
// site (and delivery, "not tracked yet" until Bunny stats exist) after a CDS staff MFA
// sign-in (media_usage: super_admin or support_agent). Read-only; nothing is written.
//
// Usage:
//   npm run media:usage [-- --over] [-- --org <org-id>]
//   npm run media:usage -- --dry-run | --help
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { formatGb } from "../src/media/cdn/usage";
import {
  listMediaUsage,
  type MediaUsageRow,
} from "../src/media/ops/usage-report";
import {
  fail,
  ORG_RE,
  parseArgs,
  runMain,
  signInStaffInteractive,
  table,
  wantsHelp,
} from "./staff-cli";

const USAGE = `media:usage - media storage per site (super_admin or support_agent, MFA)

  npm run media:usage [-- --over] [-- --org <org-id>]
  npm run media:usage -- --dry-run
  npm run media:usage -- --help

--over     only sites at 80 % of their 2 GB allowance or more
--org      only this site
--dry-run  check the arguments and print what would be listed, without signing in
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const HEADER = [
  "ORG",
  "NAME",
  "STORAGE",
  "USED",
  "FILES",
  "DELIVERY (MONTH)",
] as const;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "{n} sites · {x} GB stored · {w} at 80 % or more · {f} full" */
function summaryLine(rows: readonly MediaUsageRow[]): string {
  const stored = rows.reduce((s, r) => s + r.usedBytes, 0);
  const warn = rows.filter((r) => r.level !== "ok").length;
  const full = rows.filter((r) => r.level === "full").length;
  return `${plural(rows.length, "site", "sites")} · ${formatGb(stored)} stored · ${warn} at 80 % or more · ${full} full`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: ["--over", "--org", "--dry-run"],
    withValue: ["--org"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (org !== undefined) {
    if (typeof org !== "string" || !ORG_RE.test(org)) {
      fail("--org is not a valid organization id");
    }
  }
  if (args.has("--dry-run")) {
    console.log("DRY RUN would list media storage per site; nothing read");
    return;
  }

  const ctx = await signInStaffInteractive();
  const rows = await listMediaUsage(ctx, {
    over: args.has("--over"),
    ...(typeof org === "string" ? { orgId: org } : {}),
  });
  if (rows.length === 0) {
    console.log("No sites store media yet.");
    return;
  }
  console.log(
    table(
      HEADER,
      rows.map((r) => [
        r.orgId,
        r.name || "-",
        r.label,
        `${Math.round(r.ratio * 100)}%`,
        String(r.assets),
        r.deliveryBytes === null
          ? "not tracked yet"
          : formatGb(r.deliveryBytes),
      ]),
    ),
  );
  console.log(summaryLine(rows));
}

runMain(main);
