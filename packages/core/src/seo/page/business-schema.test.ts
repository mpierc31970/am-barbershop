// 07-30 choice 4: every business type maps to a schema.org type (drift test).
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES } from "../../onboarding/business-types";
import { SCHEMA_TYPE_BY_BUSINESS, schemaTypeFor } from "./business-schema";

describe("schemaTypeFor (CONT-13)", () => {
  it("maps every BUSINESS_TYPES id", () => {
    for (const t of BUSINESS_TYPES) {
      expect(Object.hasOwn(SCHEMA_TYPE_BY_BUSINESS, t.id), t.id).toBe(true);
    }
  });

  it("maps known types and falls back to LocalBusiness", () => {
    expect(schemaTypeFor("hair-salon")).toBe("HairSalon");
    expect(schemaTypeFor("bakery")).toBe("Bakery");
    expect(schemaTypeFor("other")).toBe("LocalBusiness");
    expect(schemaTypeFor("no-such-type")).toBe("LocalBusiness");
    expect(schemaTypeFor("__proto__")).toBe("LocalBusiness");
    expect(schemaTypeFor(42)).toBe("LocalBusiness");
  });
});
