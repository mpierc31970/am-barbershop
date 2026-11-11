import { describe, expect, it } from "vitest";
import { CLAIMS } from "./claims";
import {
  CALC_BOUNDS,
  CALC_DEFAULTS,
  compareCosts,
  inCalcBounds,
  parseCountInput,
  parseMoneyInput,
  processingCents,
} from "./compare";
import {
  calcLiveLine,
  calcLiveLineNoPlan,
  calcProcessingLabel,
  MK_COPY,
} from "./copy";

// Built, so the marketing price-literal rule (e) never sees a dollar sign before a digit.
const D = "$";

const run = (o: Partial<Parameters<typeof compareCosts>[0]> = {}) =>
  compareCosts({
    salesCents: CALC_DEFAULTS.salesCents,
    avgCents: CALC_DEFAULTS.avgCents,
    appClients: CALC_DEFAULTS.appClients,
    planMonthlyCents: 9900,
    claims: CLAIMS,
    ...o,
  });

describe("processingCents", () => {
  it("is percentage of sales plus a fixed fee per transaction", () => {
    // 500000 * 3.6% = 18000; 500000 / 6000 = 83.33 -> 83 transactions * 30 = 2490
    expect(processingCents(500000, 6000, { pct: 3.6, fixedCents: 30 })).toBe(
      20490,
    );
    // 3.65% has no float drift: 18250 + 83 * 15
    expect(processingCents(500000, 6000, { pct: 3.65, fixedCents: 15 })).toBe(
      19495,
    );
  });

  it("is 0 with no sales, and no fixed fees with no average", () => {
    expect(processingCents(0, 6000, { pct: 2.9, fixedCents: 30 })).toBe(0);
    expect(processingCents(10000, 0, { pct: 2.9, fixedCents: 30 })).toBe(290);
  });
});

describe("compareCosts on the defaults (D296, D300, P15-P16)", () => {
  it("defaults are 5000 dollars of sales, a 60 dollar average, 0 app clients", () => {
    expect(CALC_DEFAULTS).toEqual({
      salesCents: 500000,
      avgCents: 6000,
      appClients: 0,
    });
  });

  it("worked numbers in cents", () => {
    const r = run();
    expect(r.elsewhere.processing).toEqual({ lo: 19495, hi: 20490 });
    expect(r.elsewhere.marketplace).toBeNull();
    expect(r.elsewhere.stack).toBe(5000);
    expect(r.elsewhere.total).toEqual({ lo: 24495, hi: 25490 });
    expect(r.cds).toEqual({
      gatewayCents: 16990,
      platformCutCents: 0,
      planCents: 9900,
      total: 16990 + 9900,
    });
  });

  it("WR-B08: both totals are what the owner pays, so card fees count on both sides", () => {
    const r = run({ planMonthlyCents: 4900 });
    // CDS side: the owner's Stripe fees (paid to Stripe, not CDS) plus the plan.
    expect(r.cds.total).toBe(r.cds.gatewayCents + 4900);
    expect(r.cds.platformCutCents).toBe(0);
    // Elsewhere: the card processing they pay is in their total too.
    expect(r.elsewhere.total.lo).toBe(
      r.elsewhere.processing.lo + r.elsewhere.stack,
    );
    // With no sales, both sides are just the monthly fixed costs.
    const none = run({ salesCents: 0, planMonthlyCents: 4900 });
    expect(none.cds.total).toBe(4900);
    expect(none.elsewhere.total).toEqual({ lo: 5000, hi: 5000 });
  });
});

describe("marketplace fees", () => {
  it("are null at 0 app clients", () => {
    expect(run({ appClients: 0 }).elsewhere.marketplace).toBeNull();
  });

  it("Fresha 20% to Booksy Boost 30% of the first visit, per client", () => {
    const r = run({ appClients: 10 });
    expect(r.elsewhere.marketplace).toEqual({ lo: 12000, hi: 18000 });
    expect(r.elsewhere.total).toEqual({
      lo: 19495 + 12000 + 5000,
      hi: 20490 + 18000 + 5000,
    });
  });

  it("the Fresha minimum applies at a low average", () => {
    // 20% of a 20 dollar average is 4 dollars, under the 6 dollar minimum
    const r = run({ avgCents: 2000, appClients: 5 });
    expect(r.elsewhere.marketplace?.lo).toBe(3000);
  });

  it("lo never exceeds hi", () => {
    for (const avgCents of [100, 2000, 6000, 50000, 1000000]) {
      const m = run({ avgCents, appClients: 3 }).elsewhere.marketplace!;
      expect(m.lo).toBeLessThanOrEqual(m.hi);
    }
  });
});

describe("labels match the maths (WR-B08, D182)", () => {
  it("the processing range names the two rates it is built from", () => {
    const label = calcProcessingLabel("3.60% + 30¢", "3.65% + 15¢");
    expect(label).toContain("Mindbody and Boulevard");
    expect(label).toContain("online");
  });

  it("both totals are labelled as what the owner pays, never what a platform keeps", () => {
    expect(MK_COPY.CALC.KEEPS).toBe("What you pay a month");
    expect(MK_COPY.CALC.PLAN).toContain("before add-ons");
    const line = calcLiveLine("A", "B");
    expect(line).toContain("you pay A");
    expect(line).toContain("you pay B");
    expect(line).not.toMatch(/keeps?/);
  });
});

describe("honesty (D296)", () => {
  it("the unpriced live line names the plan as coming soon, never a price (WR-C01)", () => {
    const line = calcLiveLineNoPlan("A");
    expect(line).toContain("you pay A");
    expect(line).toContain("coming soon");
    expect(line).not.toMatch(/Price coming soon/);
  });

  it("a null plan makes the CDS total null, never just the gateway fees or 0", () => {
    const r = run({ planMonthlyCents: null });
    expect(r.cds.planCents).toBeNull();
    expect(r.cds.total).toBeNull();
  });

  it("platformCutCents is always 0 and gatewayCents > 0 for any sales", () => {
    for (const salesCents of [100, 500000, 100000000]) {
      const r = run({ salesCents });
      expect(r.cds.platformCutCents).toBe(0);
      expect(r.cds.gatewayCents).toBeGreaterThan(0);
    }
  });

  it("results are integer cents", () => {
    const r = run({ salesCents: 123457, avgCents: 3333, appClients: 7 });
    const nums = [
      r.elsewhere.processing.lo,
      r.elsewhere.processing.hi,
      r.elsewhere.marketplace!.lo,
      r.elsewhere.marketplace!.hi,
      r.elsewhere.total.lo,
      r.elsewhere.total.hi,
      r.cds.gatewayCents,
      r.cds.total!,
    ];
    for (const n of nums) expect(Number.isInteger(n)).toBe(true);
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["5000", 500000],
    ["5,000", 500000],
    [`${D}5,000`, 500000],
    ["5000.50", 500050],
    [" $ 60 ", 6000],
    ["0", 0],
    ["0.5", 50],
  ])("accepts %j -> %d cents", (raw, cents) => {
    expect(parseMoneyInput(raw)).toBe(cents);
  });

  it.each(["", "abc", "-5", "5.123", "5e3", "1.2.3", "$", "5000x"])(
    "rejects %j",
    (raw) => {
      expect(parseMoneyInput(raw)).toBeNull();
    },
  );
});

describe("parseCountInput", () => {
  it("accepts whole numbers; empty is 0", () => {
    expect(parseCountInput("12")).toBe(12);
    expect(parseCountInput(" 1,000 ")).toBe(1000);
    expect(parseCountInput("")).toBe(0);
    expect(parseCountInput("   ")).toBe(0);
  });

  it("rejects fractions, signs and text", () => {
    for (const raw of ["1.5", "-1", "abc", `${D}5`, "2e2"])
      expect(parseCountInput(raw)).toBeNull();
  });
});

describe("CALC_BOUNDS", () => {
  it("matches the UI-SPEC validation ranges", () => {
    expect(CALC_BOUNDS).toEqual({
      salesCents: { min: 0, max: 100000000 },
      avgCents: { min: 100, max: 1000000 },
      appClients: { min: 0, max: 1000 },
    });
  });

  it("inCalcBounds checks the edges", () => {
    expect(inCalcBounds("salesCents", 0)).toBe(true);
    expect(inCalcBounds("salesCents", 100000000)).toBe(true);
    expect(inCalcBounds("salesCents", 100000001)).toBe(false);
    expect(inCalcBounds("avgCents", 99)).toBe(false);
    expect(inCalcBounds("avgCents", 100)).toBe(true);
    expect(inCalcBounds("appClients", 1000)).toBe(true);
    expect(inCalcBounds("appClients", 1001)).toBe(false);
    expect(inCalcBounds("appClients", 2.5)).toBe(false);
  });
});
