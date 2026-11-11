// P8 (08-18): staff site assembly (CONTEXT A2-Q1, A4-Q1); super_admin or support_agent, MFA;
// audited via assembleSiteAsStaff. Runs, re-runs or previews (dry run) the assembly of one
// sent site and prints the slot report (UI-SPEC "Staff CLI output"; TMPL-04). The staff check
// (`site_assemble`) lives inside @cds/db, not only here (T-08-18-02); every write is audited
// as the staff member impersonating the owner (invariant 10, T-08-18-05).
//
// Usage:
//   npm run site:assemble -- --org <org-id> [--rerun] [--dry-run]
//   npm run site:assemble -- --help
// --dry-run still signs in (the report reads tenant data) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script), CDS_ENV, CDS_PREVIEW_HOST_SUFFIX, CDS_PREVIEW_PORT, CDS_STORAGE_DIR,
// WASABI_* (publish). Credentials and codes are never printed.
// Registers add-on collections and manifests before anything reads the registry (05-04).
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { TEMPLATES } from "@cds/templates";
import {
  alreadyAssembledLine,
  assembleSiteAsStaff,
  getCopyWriter,
  polishSummaryLine,
  previewUrl,
  reportRows,
  rerunLines,
  summaryLine,
  wouldAssembleLine,
  type AssemblyResult,
  type AssemblyRunDeps,
} from "../src/assembly";
import type { PlatformContext } from "../src/context";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
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

const USAGE = `site:assemble - build a sent site from its template and print the slot report (super_admin or support_agent, MFA)

  npm run site:assemble -- --org <org-id> [--rerun] [--dry-run]
  npm run site:assemble -- --help

--rerun    rebuild pages nobody has edited since they were assembled; edited pages are
           left alone and deleted pages are never recreated
--dry-run  sign in and print the slot report, without writing anything
Prompts for staff email, password and the emailed sign-in code.
Audited as you, acting for the site owner.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_ENV, CDS_PREVIEW_HOST_SUFFIX, CDS_PREVIEW_PORT, CDS_STORAGE_DIR, WASABI_* (optional)`;

const NOT_SENT =
  "This site hasn't been sent to CDS yet, so there's nothing to assemble.";
const BUSY =
  "Assembly is already running for this site. Try again in a few minutes.";
const ASSEMBLING = "Assembling…";

function notFound(org: string): CliFail {
  return new CliFail(`Org ${org} not found, or this account isn't CDS staff.`, {
    plain: true,
  });
}

function plain(message: string): CliFail {
  return new CliFail(message, { plain: true });
}

function deps(): AssemblyRunDeps {
  return {
    templates: TEMPLATES,
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    copy: getCopyWriter(),
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    registry: ADDON_REGISTRY,
  };
}

/** `Rivera Bakery · standard · standard-v1 (v1)`, then the slot table and the polish line. */
function printReport(result: AssemblyResult): void {
  const report = result.report!;
  const name = result.facts?.businessName ?? "";
  console.log(
    `${safeText(name || "-")} · ${safeText(result.facts?.path || "-")} · ${report.templateId} (v${report.templateVersion})`,
  );
  console.log(table(["PAGE", "SLOT", "RESULT", "NOTE"], reportRows(report)));
  console.log(safeText(polishSummaryLine(report)));
}

function failedLine(result: AssemblyResult, org: string): string {
  const code = result.ledger.error?.code ?? result.errorCode ?? "FAILED";
  const page = result.ledger.error?.page;
  return (
    `Assembly failed: ${code}${page ? ` on ${page}` : ""}. ` +
    `Look up the error code in the log, fix the cause, then run ` +
    `npm run site:assemble -- --org ${org}. It picks up where it stopped and never duplicates a page.`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), {
    known: ["--org", "--rerun", "--dry-run"],
    withValue: ["--org"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const rerun = args.has("--rerun");
  const dryRun = args.has("--dry-run");

  let ctx: PlatformContext;
  try {
    ctx = await signInStaffInteractive();
  } catch (err) {
    // A non-staff account never gets an MFA challenge: same copy as an unknown org, so the
    // CLI reveals nothing about which orgs exist (T-08-18-02).
    if (err instanceof Forbidden) throw notFound(org);
    throw err;
  }
  if (dryRun) console.log("Dry run: nothing was written.");
  else console.log(ASSEMBLING);

  let result: AssemblyResult;
  try {
    result = await assembleSiteAsStaff(ctx, org, { rerun, dryRun }, deps());
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(org);
    }
    throw err;
  }

  switch (result.status) {
    case "not_ready":
      throw plain(NOT_SENT);
    case "already":
      console.log(alreadyAssembledLine(result.ledger.assembled_at));
      return;
    case "busy":
      throw plain(BUSY);
    case "no_template":
      throw plain(
        `There is no template for the ${safeText(result.facts?.path || "site's")} path yet, so there's nothing to assemble.`,
      );
    case "failed":
      throw plain(failedLine(result, org));
    case "done":
      break;
  }
  if (!result.report) throw plain(failedLine(result, org));
  const report = result.report;
  printReport(result);

  if (dryRun) {
    if (rerun)
      for (const line of rerunLines(report).slice(0, -1)) console.log(line);
    console.log(wouldAssembleLine(report));
    return;
  }
  const preview = result.previewHost
    ? `Preview: ${previewUrl(result.previewHost, "/")}`
    : null;
  if (rerun) {
    if (preview) console.log(preview);
    for (const line of rerunLines(report)) console.log(line);
    return;
  }
  console.log(safeText(summaryLine(result.facts?.businessName ?? "", report)));
  if (preview) console.log(preview);
}

runMain(main);
