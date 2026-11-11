// PAY-09, BILL-07, D52, D66: the payment ports are pure types with no fee field anywhere.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORE_ENTITLEMENTS,
  PaymentsUnavailable,
  WebhookSignatureInvalid,
} from "./index";
import type { NormalisedEvent } from "./index";

const dir = import.meta.dirname;

/** Source text with block and line comments removed. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function assertNever(x: never): never {
  throw new Error(`unhandled ${String(x)}`);
}

/** Compile-time exhaustiveness: adding a variant without handling it fails typecheck. */
function describeEvent(e: NormalisedEvent): string {
  switch (e.type) {
    case "checkout.completed":
    case "checkout.expired":
      return e.sessionId;
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
    case "invoice.voided":
      return e.invoiceId;
    case "subscription.updated":
    case "subscription.deleted":
    case "subscription.pending_update_applied":
    case "subscription.pending_update_expired":
      return e.subscriptionId;
    case "account.updated":
    case "account.deauthorized":
      return e.accountId;
    case "charge.refunded":
      return e.customerId;
    case "ignored":
      return e.originalType;
    default:
      return assertNever(e);
  }
}

describe("@cds/core/payments types (PAY-09, BILL-07)", () => {
  it("types.ts has no fee field outside comments (BILL-07, D52)", () => {
    const src = codeOnly(readFileSync(path.join(dir, "types.ts"), "utf8"));
    expect(src.match(/fee/gi) ?? []).toEqual([]);
  });

  it("no payments file imports node:, stripe or the db package", () => {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["']node:/);
      expect(src, f).not.toMatch(/from\s+["']stripe["']/);
      expect(src, f).not.toMatch(/@cds\/db/);
    }
  });

  it("narrows every NormalisedEvent variant", () => {
    const base = {
      id: "evt_1",
      provider: "fake" as const,
      account: null,
      orgId: "org1",
      createdAt: "2026-10-09T00:00:00.000Z",
    };
    expect(
      describeEvent({ ...base, type: "invoice.paid", invoiceId: "in_1" }),
    ).toBe("in_1");
    expect(
      describeEvent({ ...base, type: "ignored", originalType: "foo.bar" }),
    ).toBe("foo.bar");
  });

  it("errors carry stable names and copy", () => {
    const w = new WebhookSignatureInvalid();
    expect(w).toBeInstanceOf(Error);
    expect(w.name).toBe("WebhookSignatureInvalid");
    const p = new PaymentsUnavailable();
    expect(p).toBeInstanceOf(Error);
    expect(p.name).toBe("PaymentsUnavailable");
    expect(p.message).toBe("Payments open soon");
  });

  it("core entitlement keys", () => {
    expect([...CORE_ENTITLEMENTS]).toEqual(["care-plan", "media-pack"]);
  });
});
