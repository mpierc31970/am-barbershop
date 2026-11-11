// FitChecker keyword stand-in (ONB-12, D215; CONTEXT A1-Q5). Tests use the synthetic AUP
// terms so the real keyword lists can change without breaking them (RESEARCH Pitfall 10).
import { AUP_CATEGORIES, AUP_TEST_TERMS } from "@cds/core/onboarding";
import { afterEach, describe, expect, it } from "vitest";
import {
  fitDeclineNeedsRefund,
  getFitChecker,
  keywordFitChecker,
  type FitInput,
} from "./fit";

describe("fitDeclineNeedsRefund (CR-D02)", () => {
  const paid = (amountCents: number, refundedCents = 0) => ({
    status: "paid",
    amountCents,
    refundedCents,
  });
  it("unpaid org: a plain fit decline is allowed", () => {
    expect(fitDeclineNeedsRefund(null, [])).toBe(false);
    expect(
      fitDeclineNeedsRefund(null, [{ ...paid(100), status: "open" }]),
    ).toBe(false);
  });
  it("money held: refuses (declined through org:decline)", () => {
    expect(fitDeclineNeedsRefund("2026-10-01T00:00:00Z", [paid(150000)])).toBe(
      true,
    );
    expect(fitDeclineNeedsRefund(null, [paid(150000, 50000)])).toBe(true);
  });
  it("paid but no mirrored invoice yet: fails closed", () => {
    expect(fitDeclineNeedsRefund("2026-10-01T00:00:00Z", [])).toBe(true);
  });
  it("fully refunded: a plain fit decline is allowed", () => {
    expect(
      fitDeclineNeedsRefund("2026-10-01T00:00:00Z", [paid(150000, 150000)]),
    ).toBe(false);
  });
});

function input(p: Partial<FitInput> = {}): FitInput {
  return {
    businessType: "therapist",
    businessTypeOther: "",
    name: "Rivera Bakery",
    description: "Fresh bread and pastries every morning.",
    ...p,
  };
}

const firstNever = AUP_CATEGORIES.find((c) =>
  c.keywords.includes(AUP_TEST_TERMS.blocked),
)!;

describe("keywordFitChecker", () => {
  it("a plain bakery is clear", async () => {
    expect(await keywordFitChecker.check(input())).toEqual({
      verdict: "clear",
      reasons: [],
    });
  });

  it("a never-hosted keyword blocks with that category's name", async () => {
    const r = await keywordFitChecker.check(
      input({ description: `We sell ${AUP_TEST_TERMS.blocked} goods` }),
    );
    expect(r.verdict).toBe("blocked");
    expect(r.category).toBe(firstNever.name);
    expect(r.reasons).toContain(`keyword: ${AUP_TEST_TERMS.blocked}`);
  });

  it("a reviewed-first keyword gives review", async () => {
    const r = await keywordFitChecker.check(
      input({ name: `Shop ${AUP_TEST_TERMS.review}` }),
    );
    expect(r.verdict).toBe("review");
    expect(r.reasons).toContain(`keyword: ${AUP_TEST_TERMS.review}`);
  });

  it("a business type flagged review gives review with reason 'business type: <id>'", async () => {
    const r = await keywordFitChecker.check(
      input({ businessType: "cbd-shop" }),
    );
    expect(r.verdict).toBe("review");
    expect(r.reasons).toContain("business type: cbd-shop");
  });

  it("blocked wins over review", async () => {
    const r = await keywordFitChecker.check(
      input({
        businessType: "cbd-shop",
        description: `${AUP_TEST_TERMS.review} and ${AUP_TEST_TERMS.blocked}`,
      }),
    );
    expect(r.verdict).toBe("blocked");
  });

  it("matches whole words only, case-insensitively", async () => {
    expect(
      (await keywordFitChecker.check(input({ description: "scbdx tea" })))
        .verdict,
    ).toBe("clear");
    expect(
      (await keywordFitChecker.check(input({ description: "Organic CBD tea" })))
        .verdict,
    ).toBe("review");
  });

  it("screens the 'other' business type text too", async () => {
    const r = await keywordFitChecker.check(
      input({
        businessType: "other",
        businessTypeOther: `${AUP_TEST_TERMS.blocked} dealer`,
      }),
    );
    expect(r.verdict).toBe("blocked");
  });

  it("tolerates junk input as clear", async () => {
    const r = await keywordFitChecker.check({} as FitInput);
    expect(r.verdict).toBe("clear");
  });
});

describe("getFitChecker", () => {
  const prev = process.env.CDS_FIT_CHECKER;
  afterEach(() => {
    if (prev === undefined) delete process.env.CDS_FIT_CHECKER;
    else process.env.CDS_FIT_CHECKER = prev;
  });

  it("unset or 'keyword' gives the keyword stand-in", () => {
    delete process.env.CDS_FIT_CHECKER;
    expect(getFitChecker()).toBe(keywordFitChecker);
    process.env.CDS_FIT_CHECKER = "keyword";
    expect(getFitChecker()).toBe(keywordFitChecker);
  });

  it("any other value throws naming the variable", () => {
    process.env.CDS_FIT_CHECKER = "ai";
    expect(() => getFitChecker()).toThrow(/CDS_FIT_CHECKER/);
  });
});
