// CR-B02: the one tel: helper splits an intake extension into `;ext=`.
import { describe, expect, it } from "vitest";
import { safeHref } from "./validate";
import { telHref } from "./tel";

describe("telHref", () => {
  it("keeps digits and one leading +", () => {
    expect(telHref("(512) 555-0100")).toBe("tel:5125550100");
    expect(telHref("+1 (512) 555-0100")).toBe("tel:+15125550100");
    expect(telHref("512+555 0100")).toBe("tel:5125550100");
  });

  it("splits every extension form the intake validator accepts", () => {
    for (const p of [
      "(512) 555-0100 ext. 42",
      "(512) 555-0100 ext 42",
      "(512) 555-0100 x 42",
      "(512) 555-0100x42",
    ]) {
      expect(telHref(p), p).toBe("tel:5125550100;ext=42");
    }
  });

  it("the href passes safeHref unchanged", () => {
    const href = telHref("(512) 555-0100 ext. 42");
    expect(safeHref(href)).toBe(href);
  });

  it("no digits or not a string gives empty", () => {
    expect(telHref("call us")).toBe("");
    expect(telHref("ext 42")).toBe("");
    expect(telHref(undefined)).toBe("");
  });
});
