import { InvalidInput } from "@cds/core";
import { describe, expect, it } from "vitest";
import { TENANT_COLLECTIONS } from "./registry";
import { assertSafeFilter, assertSafeSort, readableFields } from "./repository";

// CR-02: caller filters run as superuser, so only allowlisted plain fields may appear.
const ALLOWED = ["id", "organization", "title", "created"];

describe("assertSafeFilter", () => {
  it.each([
    "title = 'x'",
    `title = "x" && created > '2026-01-01 00:00:00.000Z'`,
    "(title != 'a' || title ~ 'b%') && id != ''",
    "title = 'it\\'s' && created >= 3",
    "title ?= 'a' && title !~ 'b' && title = null && title != true",
    "title = '@collection._superusers.password'",
  ])("accepts %s", (f) => {
    expect(() => assertSafeFilter(f, ALLOWED)).not.toThrow();
  });

  it.each([
    `@collection._superusers.password ~ "$2a%"`,
    "title = 'x' && (@collection.users.tokenKey ~ 'a%')",
    "@request.auth.id != ''",
    "tokenKey ~ 'a%'",
    "password ~ '$2a%'",
    "user.password ~ '$2a%'",
    "organization.status = 'active'",
    "memberships_via_user.role = 'owner'",
    "title:lower = 'x'",
    "title:length > 1",
    "strftime('%Y', created) = '2026'",
    "title (",
    "title = 'x' // comment",
    "title = [1]",
    "title != '') || (title != ''",
    "(title = 'x'",
    "title = 'x",
    "title = 'x' ; drop",
  ])("rejects %s", (f) => {
    expect(() => assertSafeFilter(f, ALLOWED)).toThrow(InvalidInput);
  });
});

describe("assertSafeSort", () => {
  it.each(["title", "-created,+id", "id"])("accepts %s", (s) => {
    expect(() => assertSafeSort(s, ALLOWED)).not.toThrow();
  });

  it.each([
    "user.password",
    "-organization.name",
    "tokenKey",
    "@random",
    "title,",
    "",
    "title:lower",
  ])("rejects %s", (s) => {
    expect(() => assertSafeSort(s, ALLOWED)).toThrow(InvalidInput);
  });
});

// WR-A01: reads run as superuser and PB returns hidden fields to superusers, so tenantRepo
// strips every field outside the approved lists before a record leaves the chokepoint.
describe("readableFields", () => {
  it("never lists a hash, password, token or key field", () => {
    for (const spec of Object.values(TENANT_COLLECTIONS)) {
      for (const f of readableFields(spec)) {
        if (f === "password_protected") continue; // a boolean flag, not a secret
        // agreement_signatures.document_key: the storage object key of the signed PDF
        // (AGR-05), a path inside the tenant's own folder, not a credential.
        if (f === "document_key") continue;
        expect(f).not.toMatch(/hash|password|token|secret|key/i);
      }
    }
  });

  it("keeps pages.password_hash out and password_protected in", () => {
    const pages = readableFields(TENANT_COLLECTIONS.pages);
    expect(pages.has("password_hash")).toBe(false);
    expect(pages.has("password_protected")).toBe(true);
  });
});
