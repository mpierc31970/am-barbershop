// BILL-05, D42: deny-by-default browser projection and the classification check.
import { describe, expect, it } from "vitest";
import {
  BROWSER_FIELDS,
  toBrowser,
  unclassifiedFields,
  type BrowserFieldSpec,
} from "./browser-fields";
import { InvalidInput } from "./errors";

describe("toBrowser", () => {
  it("keeps allowed and system fields, drops provider ids and unknown keys", () => {
    const out = toBrowser("billing_invoices", {
      id: "inv1",
      number: "CDS-0001",
      amount_cents: 1200,
      provider_invoice_id: "in_123",
      hosted_url: "https://pay.example/inv",
      surprise: "x",
    });
    expect(out).toEqual({
      id: "inv1",
      number: "CDS-0001",
      amount_cents: 1200,
      hosted_url: "https://pay.example/inv",
    });
  });

  it("never returns billing account provider ids or the checkout draft", () => {
    const out = toBrowser("billing_accounts", {
      id: "a1",
      status: "active",
      customer_id: "cus_1",
      subscription_id: "sub_1",
      checkout_session_id: "cs_1",
      checkout_draft: { addons: [] },
    });
    expect(Object.keys(out).sort()).toEqual(["id", "status"]);
  });

  it("drops auth system fields unless listed", () => {
    const out = toBrowser("users", {
      id: "u1",
      name: "Ann",
      email: "a@example.com",
      tokenKey: "k",
      password: "p",
      verified: true,
    });
    expect(out).toEqual({ id: "u1", name: "Ann" });
  });

  it("throws for a collection with no entry (deny by default)", () => {
    expect(() => toBrowser("nope", { id: "x" })).toThrow(InvalidInput);
    expect(() => toBrowser("toString", { id: "x" })).toThrow(InvalidInput);
  });
});

describe("BROWSER_FIELDS", () => {
  it("no field is in both allow and serverOnly", () => {
    for (const [name, spec] of Object.entries(BROWSER_FIELDS)) {
      const both = spec.allow.filter((f) => spec.serverOnly.includes(f));
      expect(both, name).toEqual([]);
    }
  });

  it("provider ids, tokens and evidence are serverOnly", () => {
    const server = (c: string) => BROWSER_FIELDS[c]!.serverOnly;
    expect(server("billing_accounts")).toEqual(
      expect.arrayContaining([
        "customer_id",
        "subscription_id",
        "checkout_session_id",
        "checkout_draft",
      ]),
    );
    expect(server("billing_invoices")).toContain("provider_invoice_id");
    expect(server("gateway_accounts")).toContain("account_id");
    expect(server("quotes")).toContain("token_hash");
    expect(server("pages")).toContain("password_hash");
    expect(server("agreement_signatures")).toEqual(
      expect.arrayContaining(["ip", "user_agent", "evidence_sha256"]),
    );
    expect(BROWSER_FIELDS.payment_events!.allow).toEqual([]);
    expect(BROWSER_FIELDS.payment_fake_objects!.allow).toEqual([]);
  });
});

describe("unclassifiedFields", () => {
  const map: Record<string, BrowserFieldSpec> = {
    things: { allow: ["name"], serverOnly: ["secret_id"] },
    members: { allow: ["name"], serverOnly: [] },
  };

  it("is empty when every field is classified", () => {
    expect(
      unclassifiedFields(
        {
          things: { fields: ["id", "name", "secret_id", "created", "updated"] },
          members: {
            type: "auth",
            fields: ["id", "password", "tokenKey", "email", "verified", "name"],
          },
        },
        map,
      ),
    ).toEqual([]);
  });

  it("fails when a migration adds a field without classifying it", () => {
    expect(
      unclassifiedFields(
        {
          things: { fields: ["id", "name", "secret_id", "new_token"] },
          members: { type: "auth", fields: ["id", "name"] },
        },
        map,
      ),
    ).toEqual(["things.new_token: unclassified"]);
  });

  it("an auth system field on a base collection must be classified", () => {
    expect(
      unclassifiedFields(
        {
          things: { fields: ["id", "name", "secret_id", "email"] },
          members: { type: "auth", fields: ["id", "name"] },
        },
        map,
      ),
    ).toEqual(["things.email: unclassified"]);
  });

  it("reports missing entries, stale entries, stale fields and overlaps", () => {
    expect(
      unclassifiedFields(
        {
          things: { fields: ["id", "name"] },
          extra: { fields: ["id"] },
        },
        {
          ...map,
          things: { allow: ["name", "secret_id"], serverOnly: ["secret_id"] },
        },
      ),
    ).toEqual([
      "extra: no BROWSER_FIELDS entry",
      "members: entry for a collection that does not exist",
      "things.secret_id: in both allow and serverOnly",
      "things.secret_id: listed but not live",
    ]);
  });
});
