// Read-only domain check from the CLI (14-13; DOM-05, DOM-04). Sales and support run it
// before selling or moving a domain: it asks the domain's own nameservers (public DNS) and
// RDAP, then prints the snapshot summary and the gate report (G2-G6). No sign-in, no
// database, no object store: nothing is ever written, and CDS never buys, renews or
// transfers a domain (D56).
//
// Usage:
//   npm run domains:check -- --domain riverabakery.com
//   npm run domains:check -- --domain riverabakery.com --json
//   npm run domains:check -- --help
//
// Exit 1 on a bad domain or when the DNS cannot be read.
import { parseDomainInput } from "@cds/core/dns";
import { checkDomainPublic, formatCheckReport } from "../src/dns/check";

const USAGE = `domains:check - read-only check of a domain's DNS before a move (DOM-05)

  npm run domains:check -- --domain <domain>          snapshot summary + gate report
  npm run domains:check -- --domain <domain> --json   the raw report as JSON
  npm run domains:check -- --help                     this text

Reads public DNS (the domain's own nameservers) and RDAP only. No sign-in.
Nothing is written anywhere.`;

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): { domain: string | null; json: boolean } {
  let domain: string | null = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--json") json = true;
    else if (a === "--domain") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) fail("--domain needs a value");
      domain = v;
      i++;
    } else if (a.startsWith("--domain=")) domain = a.slice("--domain=".length);
    else fail(`unknown argument ${a}`);
  }
  return { domain, json };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { domain: raw, json } = parseArgs(args);
  if (!raw) fail("--domain is required (see --help)");
  const parsed = parseDomainInput(raw, new Set<string>());
  if (!parsed.ok) fail(`not a domain we can check (${parsed.code})`);
  const domain = parsed.domain;

  let report;
  try {
    report = await checkDomainPublic(domain);
  } catch {
    fail(`could not read ${domain}'s DNS`);
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    console.log("Read-only: nothing was written.");
    return;
  }
  for (const line of formatCheckReport(report)) console.log(line);
}

main().catch((err: unknown) =>
  fail(err instanceof Error ? err.name : "unknown error"),
);
