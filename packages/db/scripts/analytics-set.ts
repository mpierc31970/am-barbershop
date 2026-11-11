// Staff analytics ids (11-32; DASH-13, D196; UI-SPEC "Staff CLI output"). Records an org's GA4
// measurement id (loaded on the tenant site after statistics consent), GA4 property id and
// Search Console site (read by the Site Report), and who owns the property (cds | tenant),
// through setOrgAnalytics: super_admin or support_agent (analytics_set), after a CDS staff
// sign-in with the emailed code; every change is audited as org.analytics_set (T-11-32-04).
// Runbook: docs/ops/ga4-search-console.md.
//
// Usage:
//   npm run analytics:set -- --org <id> [--ga4-measurement G-XXXX] [--ga4-property <n>]
//        [--gsc-site <url|sc-domain:host>] [--owner cds|tenant] [--clear] [--dry-run]
//   npm run analytics:set -- --help
// --dry-run still signs in (reading ids is staff-only) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import {
  setOrgAnalytics,
  staffOrgAnalytics,
  validateAnalyticsInput,
  type OrgAnalyticsIds,
  type SetOrgAnalyticsInput,
} from "../src/reports/analytics";
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

const USAGE = `analytics:set - record a site's Google Analytics 4 and Search Console ids (super_admin or support_agent)

  npm run analytics:set -- --org <org-id> [--ga4-measurement <G-...>] [--ga4-property <n>]
       [--gsc-site <https-url|sc-domain:host>] [--owner <cds|tenant>] [--clear] [--dry-run]
  npm run analytics:set -- --help

--org              the site's organization id
--ga4-measurement  GA4 web stream measurement id (G-XXXXXXX); the site loads GA4 only after
                   a visitor accepts statistics cookies. "none" removes it
--ga4-property     GA4 property id (digits) for the Site Report. "none" removes it
--gsc-site         Search Console property: https://example.com/ or sc-domain:example.com.
                   "none" removes it
--owner            who owns the Google properties: cds (CDS created them) or tenant
--clear            remove every id first (then apply any others given)
--dry-run          sign in and print old -> new, without writing
Fields not named are kept. Runbook: docs/ops/ga4-search-console.md
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const LABELS: Record<keyof OrgAnalyticsIds, string> = {
  ga4_measurement_id: "GA4 measurement",
  ga4_property_id: "GA4 property",
  gsc_site_url: "Search Console",
  owner: "Owner",
};

function valueArg(
  args: Map<string, string | true>,
  flag: string,
): string | null | undefined {
  const v = args.get(flag);
  if (v === undefined) return undefined;
  if (v === true) fail(`${flag} needs a value`);
  return v.trim().toLowerCase() === "none" ? null : v;
}

/** One line per field that changes: "GA4 measurement  G-OLD -> G-NEW". */
export function diffLines(
  before: OrgAnalyticsIds,
  after: OrgAnalyticsIds,
): string[] {
  const keys = Object.keys(LABELS) as (keyof OrgAnalyticsIds)[];
  const width = Math.max(...keys.map((k) => LABELS[k].length));
  return keys
    .filter((k) => (before[k] ?? null) !== (after[k] ?? null))
    .map(
      (k) =>
        `${LABELS[k].padEnd(width)}  ${safeText(before[k] ?? "(none)")} -> ${safeText(after[k] ?? "(none)")}`,
    );
}

function apply(
  before: OrgAnalyticsIds,
  input: SetOrgAnalyticsInput,
): OrgAnalyticsIds {
  const next: OrgAnalyticsIds = input.clear ? {} : { ...before };
  const named = validateAnalyticsInput(input);
  if (input.ga4MeasurementId === null) delete next.ga4_measurement_id;
  if (input.ga4PropertyId === null) delete next.ga4_property_id;
  if (input.gscSiteUrl === null) delete next.gsc_site_url;
  if (input.owner === null) delete next.owner;
  return { ...next, ...named };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--org",
      "--ga4-measurement",
      "--ga4-property",
      "--gsc-site",
      "--owner",
      "--clear",
      "--dry-run",
    ],
    withValue: [
      "--org",
      "--ga4-measurement",
      "--ga4-property",
      "--gsc-site",
      "--owner",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");

  const input: SetOrgAnalyticsInput = {};
  const m = valueArg(args, "--ga4-measurement");
  if (m !== undefined) input.ga4MeasurementId = m;
  const p = valueArg(args, "--ga4-property");
  if (p !== undefined) input.ga4PropertyId = p;
  const g = valueArg(args, "--gsc-site");
  if (g !== undefined) input.gscSiteUrl = g;
  const o = valueArg(args, "--owner");
  if (o !== undefined) {
    if (o !== null && o !== "cds" && o !== "tenant") {
      fail("--owner must be cds or tenant");
    }
    input.owner = o;
  }
  if (args.has("--clear")) input.clear = true;
  if (Object.keys(input).length === 0) {
    fail(
      "nothing to set: give --ga4-measurement, --ga4-property, --gsc-site, --owner or --clear",
    );
  }
  // Refuse bad ids before anyone signs in.
  try {
    validateAnalyticsInput(input);
  } catch (err) {
    if (err instanceof InvalidInput) fail(err.message);
    throw err;
  }

  const ctx = await signInStaffInteractive();
  try {
    if (args.has("--dry-run")) {
      const cur = await staffOrgAnalytics(ctx, org);
      const after = apply(cur.analytics, input);
      const lines = diffLines(cur.analytics, after);
      console.log(safeText(cur.orgName || org));
      for (const line of lines) console.log(line);
      console.log(
        lines.length === 0
          ? "DRY RUN nothing would change"
          : "DRY RUN nothing changed",
      );
      return;
    }
    const r = await setOrgAnalytics(ctx, org, input);
    const name = safeText(r.orgName || org);
    console.log(name);
    const lines = diffLines(r.before, r.after);
    for (const line of lines) console.log(line);
    if (!r.changed) {
      console.log("Nothing changed.");
      return;
    }
    console.log(
      `Saved. ${name}'s Site Report shows Google data from tomorrow.`,
    );
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw new CliFail(
        `Org ${org} not found, or this account can't set analytics ids.`,
        { plain: true },
      );
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … analytics-set.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
