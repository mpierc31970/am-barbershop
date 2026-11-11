import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// BILL-17, D263: the billing-model spec exists and keeps its structure.
const repoRoot = path.resolve(import.meta.dirname, "..");
const doc = readFileSync(
  path.join(repoRoot, "docs", "billing", "BILLING-MODEL.md"),
  "utf8",
).replace(/\r\n/g, "\n");

const HEADINGS = [
  "Scope and roles",
  "The billing_accounts record",
  "Subscription items",
  "Booking tiers and Studio inclusions",
  "Cadence and the yearly two-step",
  "Build fee installments",
  "Charges on the saved card",
  "Webhook to state table",
  "Discounts",
  "Tax",
  "Metered usage",
  "Stand-in adapter",
  "Open items",
];

function section(name: string): string {
  const parts = doc.split(`\n## ${name}\n`);
  expect(parts.length, name).toBe(2);
  return parts[1]!.split("\n## ")[0]!;
}

describe("docs/billing/BILLING-MODEL.md (BILL-17)", () => {
  it("has every heading once, in order", () => {
    const found = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(found).toEqual(HEADINGS);
  });

  it.each(["D161", "D167", "D207", "price_locked_until", "max_period_end"])(
    "mentions %s",
    (term) => {
      expect(doc).toContain(term);
    },
  );

  it("Booking tiers and Studio inclusions carries the tier prices (BILL-10, D180)", () => {
    const s = section("Booking tiers and Studio inclusions");
    for (const term of [
      "studio-booking-solo",
      "$49",
      "$99",
      "$179",
      "10,000",
      "D180",
    ]) {
      expect(s, term).toContain(term);
    }
  });

  it("the webhook table covers the core events", () => {
    const s = section("Webhook to state table");
    for (const ev of [
      "checkout.completed",
      "invoice.paid",
      "invoice.payment_failed",
      "account.updated",
      "account.deauthorized",
    ]) {
      expect(s, ev).toContain(ev);
    }
  });
});
