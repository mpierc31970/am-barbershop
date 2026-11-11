// Staff work delivery (10-26; BILL-20, BILL-16; CONTEXT A4; D263, D299; UI-SPEC "Staff CLI
// output"). Delivers paid work through deliverWorkOrder: for add-on quotes it invoices the
// balance, adds the monthly maintenance to the one subscription (from the next bill) and
// installs the add-on through the staff path. super_admin only (work_deliver), after a CDS
// staff sign-in with the emailed code; audited. No paid work starts before acceptance: a
// quote that isn't accepted and paid is refused.
// Review WR-A04: the case (org, kind, status, balance, maintenance, add-on) is printed first
// and a wrong status is refused before anything moves; then it asks y/N (--yes skips).
//
// Usage:
//   npm run work:deliver -- --quote <id> [--dry-run] [--yes]
//   npm run work:deliver -- --help
// --dry-run still signs in (delivery is staff-only), prints the case and changes nothing.
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script). Credentials and codes are never printed.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { formatCents, formatCentsExact } from "@cds/core/pricing";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { getBillingGate } from "../src/addons/billing";
import type { AddonDeps } from "../src/addons/types";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import { fakeSettled } from "../src/payments/fake/index";
import { registerPaymentAddonDeps } from "../src/payments/process";
import {
  deliverCase,
  deliverWorkOrder,
  type DeliverCase,
  type DeliverResult,
  type WorkOrderKind,
} from "../src/payments/work-orders";
import {
  ask,
  CliFail,
  fail,
  parseArgs,
  runMain,
  safeText,
  signInStaffInteractive,
  wantsHelp,
} from "./staff-cli";

const USAGE = `work:deliver - deliver paid work on a quote (super_admin)

  npm run work:deliver -- --quote <id> [--dry-run] [--yes]
  npm run work:deliver -- --help

--quote    the work order id (printed by work:quote)
--dry-run  sign in and print the case, without acting
--yes      skip the y/N confirm after the case is printed
Add-on quotes: invoices the balance, adds the monthly maintenance to the owner's bill from
the next bill, and installs the add-on. Polish and custom blocks were paid in full on
acceptance; delivering records the date. A quote that isn't accepted and paid is refused.
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)`;

const ID_RE = /^[a-z0-9]{15}$/;

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
});

const KIND_LABEL: Record<WorkOrderKind, string> = {
  polish: "Design polish",
  custom_block: "Custom block",
  private_addon: "Private add-on",
  premium_addon: "Premium add-on",
};

/** The case printed before anything moves (review WR-A04). */
export function printDeliverCase(c: DeliverCase): void {
  console.log(`Quote ${c.id} for ${safeText(c.orgName)} (${c.orgId})`);
  console.log(`Kind:         ${KIND_LABEL[c.kind]}`);
  console.log(`Title:        ${safeText(c.title)}`);
  console.log(`Status:       ${c.status}`);
  if (c.balanceCents > 0) {
    console.log(
      `Balance:      ${formatCentsExact(c.balanceCents)}${c.balanceInvoiced ? " (already invoiced; reused)" : " (invoiced to the card on file)"}`,
    );
  }
  if (c.maintenanceCents > 0) {
    console.log(
      `Maintenance:  ${formatCents(c.maintenanceCents)}/mo from the next bill`,
    );
  }
  if (c.addonSlug !== null) console.log(`Add-on:       ${c.addonSlug}`);
  if (c.balanceCents === 0 && c.maintenanceCents === 0) {
    console.log("Paid in full on acceptance: delivering records the date.");
  }
}

function confirmPrompt(c: DeliverCase): string {
  return c.balanceCents > 0 && !c.balanceInvoiced
    ? `Invoice ${formatCentsExact(c.balanceCents)} and deliver? [y/N] `
    : "Deliver? [y/N] ";
}

function notFound(quote: string): CliFail {
  return new CliFail(
    `Quote ${quote} not found, or this account isn't CDS staff.`,
    { plain: true },
  );
}

function deps(): AddonDeps {
  return {
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    // No Next cache to invalidate from a CLI; the site's 60 s cache catches up.
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
    // Staff installs are approved with no hub charge: the quote is the charge.
    billing: getBillingGate(),
  };
}

/** UI-SPEC: "Balance invoice sent: $2,000.00. Maintenance $50/mo added from 1 Nov. Add-on installed: <slug>." */
export function deliveredLine(r: DeliverResult): string {
  const parts: string[] = [];
  if (r.balanceInvoiceUrl !== null) {
    parts.push(`Balance invoice sent: ${formatCentsExact(r.balanceCents)}.`);
  }
  if (r.maintenanceFrom !== null) {
    const d = new Date(r.maintenanceFrom);
    const from = Number.isNaN(d.getTime())
      ? ""
      : ` from ${DAY_MONTH.format(d)}`;
    parts.push(
      `Maintenance ${formatCents(r.maintenanceCents)}/mo added${from}.`,
    );
  }
  if (r.installed !== null) parts.push(`Add-on installed: ${r.installed}.`);
  return parts.length > 0
    ? parts.join(" ")
    : "Delivered. It was paid in full on acceptance; nothing more to invoice.";
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(argv, {
    known: ["--quote", "--dry-run", "--yes"],
    withValue: ["--quote"],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  const quote = args.get("--quote");
  if (typeof quote !== "string") fail("--quote <id> is required");
  if (!ID_RE.test(quote)) fail("--quote is not a valid quote id");

  const ctx = await signInStaffInteractive();
  let c: DeliverCase;
  try {
    c = await deliverCase(ctx, quote);
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(quote);
    }
    throw err;
  }
  printDeliverCase(c);
  if (c.refusal !== null) {
    throw new CliFail(`Refused: ${c.refusal}`, { plain: true });
  }
  if (args.has("--dry-run")) {
    console.log(`DRY RUN would deliver quote ${quote}; nothing changed`);
    return;
  }
  if (!args.has("--yes")) {
    const answer = await ask(confirmPrompt(c));
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Nothing changed.");
      return;
    }
  }
  // Payment events the fake adapter emits in this process install paid add-ons too.
  registerPaymentAddonDeps(deps);
  try {
    const r = await deliverWorkOrder(ctx, quote, { addons: deps() });
    await fakeSettled();
    console.log(deliveredLine(r));
  } catch (err) {
    if (err instanceof NotFound || err instanceof Forbidden) {
      throw notFound(quote);
    }
    if (err instanceof InvalidInput) {
      throw new CliFail(`Refused: ${err.message}`, { plain: true });
    }
    throw err;
  }
}

// Exported for tests; runs only when executed directly (node … work-deliver.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
