// ONB-12, D215: AUP_CATEGORIES shape checks. The CDS drift test against
// .planning/design/ACCEPTABLE-USE.md was dropped in the fork (no .planning here).
import { describe, expect, it } from "vitest";
import { AUP_CATEGORIES, AUP_TEST_TERMS } from "./index";

describe("AUP_CATEGORIES", () => {
  it("every category has lower-case keywords", () => {
    for (const c of AUP_CATEGORIES) {
      expect(c.keywords.length, c.name).toBeGreaterThan(0);
      for (const k of c.keywords) {
        expect(k, c.name).toBe(k.toLowerCase());
        expect(k.trim(), c.name).toBe(k);
      }
    }
  });

  it("carries the synthetic test terms in the first category of each verdict", () => {
    const firstNever = AUP_CATEGORIES.find((c) => c.verdict === "never");
    const firstReview = AUP_CATEGORIES.find((c) => c.verdict === "review");
    expect(firstNever?.keywords).toContain(AUP_TEST_TERMS.blocked);
    expect(firstReview?.keywords).toContain(AUP_TEST_TERMS.review);
    expect(AUP_TEST_TERMS).toEqual({
      blocked: "__cds_test_blocked__",
      review: "__cds_test_review__",
    });
  });
});
