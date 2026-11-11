// Staff work quote (10-26; BILL-20, BILL-19; CONTEXT A4; D297, D298, D299; UI-SPEC "Staff
// CLI output"). Prices a quote for paid work, prints it as the owner will see it, then (on
// yes) creates and sends it through createWorkOrder / sendWorkOrder: the same chokepoint the
// P13 console will use. super_admin or support_agent (work_quote), after a CDS staff sign-in
// with the emailed code; create and send are audited. Over-the-hour Care Plan edits are
// quoted here with --kind polish (D298).
//
// Usage:
//   npm run work:quote -- --org <org-id> --kind polish --blocks 1 --title "<text>" --scope-file <md> [--ticket <n>]
//   npm run work:quote -- --help
// --ticket <n> (12-23, SUPPORT-03) links the quote to a support ticket of that org marked as a
// paid service: the ticket's panel shows View quote, and accepting the quote starts the work.
// --dry-run still signs in (pricing reads the org) but writes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { renderLegalMarkdown } from "@cds/core/legal";
import { formatCents } from "@cds/core/pricing";
import {
  createWorkOrder,
  previewWorkOrder,
  sendWorkOrder,
  type CreateWorkOrderInput,
  type WorkOrderKind,
  type WorkOrderPreview,
} from "../src/payments/work-orders";
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

const USAGE = `work:quote - quote paid work for a site and send it to the owner (super_admin or support_agent)

  npm run work:quote -- --org <org-id> --kind polish --blocks <1-10> --title "<text>" --scope-file <md> [--rate-cents <11000-13500>]
  npm run work:quote -- --org <org-id> --kind custom_block --total-cents <cents> --title "<text>" --scope-file <md> [--ticket <n>]
  npm run work:quote -- --org <org-id> --kind private_addon --addon <slug> --total-cents <cents> --maintenance-cents <2500-7500> --title "<text>" --scope-file <md>
  npm run work:quote -- --org <org-id> --kind premium_addon [--addon <slug>] --total-cents <cents> --maintenance-cents <7500-15000> --title "<text>" --scope-file <md>
  npm run work:quote -- --help

--kind               polish (3-hour blocks at the hourly rate; over-the-hour Care Plan edits),
                     custom_block (fixed price), private_addon or premium_addon (50% deposit,
                     the balance on delivery, plus monthly maintenance on the owner's bill)
--blocks             polish: how many 3-hour blocks (1-10)
--rate-cents         polish: the hourly rate in cents, only while the catalog rate is unset
--total-cents        custom_block and add-ons: the price in cents
--maintenance-cents  add-ons: the monthly maintenance in cents
--addon              the add-on to install on delivery (required for private_addon)
--title              what the owner sees (1-120 characters)
--scope-file         a markdown file: what CDS will do (headings, lists, **bold**)
--ticket             the support ticket this quote answers (e.g. 1042): it must be a ticket of
                     that site marked as a paid service; the ticket then shows View quote
--dry-run            sign in and print the quote, without creating or sending it
--yes                skip the y/N confirm after the quote is printed
The owner accepts in Settings > Billing; no paid work starts before acceptance.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const KINDS: readonly WorkOrderKind[] = [
  "polish",
  "custom_block",
  "private_addon",
  "premium_addon",
];
const KIND_LABEL: Record<WorkOrderKind, string> = {
  polish: "Design polish",
  custom_block: "Custom block",
  private_addon: "Private add-on",
  premium_addon: "Premium add-on",
};
const SCOPE_FILE_MAX = 64 * 1024;
const TITLE_MAX = 120;
export const SENT_LINE =
  "Sent. The owner sees it in Settings › Billing and by email.";

function notFound(org: string): CliFail {
  return new CliFail(`Org ${org} not found, or this account isn't CDS staff.`, {
    plain: true,
  });
}

function intArg(
  args: ReturnType<typeof parseArgs>,
  name: string,
): number | undefined {
  const v = args.get(name);
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^\d{1,9}$/.test(v)) {
    fail(`${name} must be a whole number`);
  }
  return Number(v);
}

/**
 * Staff markdown to HTML: the escape-first legal subset, headings as bold paragraphs (the
 * stored scope keeps the P3 rich-text allowlist, which the work-order chokepoint enforces).
 */
export function scopeHtmlFromMarkdown(md: string): string {
  const html = renderLegalMarkdown(md.replace(/\{\{/g, "{ {"));
  return html.replace(
    /<(h2|h3)>([\s\S]*?)<\/\1>/g,
    "<p><strong>$2</strong></p>",
  );
}

function readScope(path: string): string {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) fail(`--scope-file ${path} is not a file`);
    size = st.size;
  } catch (err) {
    if (err instanceof CliFail) throw err;
    fail(`--scope-file ${path} could not be read`);
  }
  if (size > SCOPE_FILE_MAX) fail("--scope-file is larger than 64 KB");
  const md = readFileSync(path, "utf8");
  if (md.trim() === "") fail("--scope-file is empty");
  return scopeHtmlFromMarkdown(md);
}

function plain(html: string): string {
  return html
    .replace(/<\/(p|li)>/g, "\n")
    .replace(/<li>/g, "  - ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** The quote as the owner will see it (UI-SPEC "Price" rows by kind). */
export function printQuote(p: WorkOrderPreview): void {
  console.log(`Quote for ${safeText(p.orgName)} (${p.orgId})`);
  console.log(`Kind:     ${KIND_LABEL[p.kind]}`);
  console.log(`Title:    ${safeText(p.title)}`);
  if (p.ticket > 0) console.log(`Ticket:   #${p.ticket}`);
  if (p.addonSlug) console.log(`Add-on:   ${p.addonSlug}`);
  console.log("What CDS will do:");
  for (const line of plain(p.scopeHtml).split("\n")) {
    console.log(`  ${safeText(line)}`);
  }
  console.log("Price:");
  const width = Math.max(...p.priceRows.map((r) => r.label.length));
  for (const r of p.priceRows) {
    console.log(`  ${r.label.padEnd(width)}  ${r.amountLabel}`);
  }
  console.log(
    `Pay now:  ${formatCents(p.payNowCents)} (plus sales tax where applicable)`,
  );
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: [
      "--org",
      "--kind",
      "--title",
      "--scope-file",
      "--blocks",
      "--rate-cents",
      "--total-cents",
      "--maintenance-cents",
      "--addon",
      "--ticket",
      "--dry-run",
      "--yes",
    ],
    withValue: [
      "--org",
      "--kind",
      "--title",
      "--scope-file",
      "--blocks",
      "--rate-cents",
      "--total-cents",
      "--maintenance-cents",
      "--addon",
      "--ticket",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const kind = args.get("--kind");
  if (typeof kind !== "string" || !KINDS.includes(kind as WorkOrderKind)) {
    fail(`--kind must be one of ${KINDS.join(", ")}`);
  }
  const rawTitle = args.get("--title");
  if (typeof rawTitle !== "string") fail('--title "<text>" is required');
  const title = rawTitle.trim();
  if (title === "" || title.length > TITLE_MAX) {
    fail(`--title must be 1-${TITLE_MAX} characters`);
  }
  const scopeFile = args.get("--scope-file");
  if (typeof scopeFile !== "string") fail("--scope-file <md> is required");
  const scope = readScope(scopeFile);
  const addon = args.get("--addon");

  const input: CreateWorkOrderInput = {
    orgId: org,
    kind: kind as WorkOrderKind,
    title,
    scope,
  };
  const blocks = intArg(args, "--blocks");
  const rateCents = intArg(args, "--rate-cents");
  const totalCents = intArg(args, "--total-cents");
  const maintenanceCents = intArg(args, "--maintenance-cents");
  if (blocks !== undefined) input.blocks = blocks;
  if (rateCents !== undefined) input.rateCents = rateCents;
  if (totalCents !== undefined) input.totalCents = totalCents;
  if (maintenanceCents !== undefined) input.maintenanceCents = maintenanceCents;
  if (typeof addon === "string") input.addonSlug = addon;
  const ticket = args.get("--ticket");
  if (ticket !== undefined) {
    if (typeof ticket !== "string" || !/^#?[1-9]\d{0,9}$/.test(ticket)) {
      fail("--ticket must be a ticket number");
    }
    input.ticket = Number(ticket.replace(/^#/, ""));
  }

  const ctx = await signInStaffInteractive();
  try {
    const preview = await previewWorkOrder(ctx, input);
    printQuote(preview);
    if (args.has("--dry-run")) {
      console.log(
        `DRY RUN would create and send this quote to org ${org}; nothing changed`,
      );
      return;
    }
    if (!args.has("--yes")) {
      const answer = await ask("Send to the owner? [y/N] ");
      if (!/^y(es)?$/i.test(answer)) {
        console.log("Nothing changed.");
        return;
      }
    }
    const { id } = await createWorkOrder(ctx, input);
    const sent = await sendWorkOrder(ctx, id);
    console.log(`Quote ${id}, valid until ${sent.validUntil.slice(0, 10)}.`);
    if (!sent.emailed) {
      console.log("The email didn't go out; the owner still sees the quote.");
    }
    console.log(SENT_LINE);
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden)
      throw notFound(org);
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … work-quote.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
