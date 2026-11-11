// Owner: 15-04 (P15-P1). compareCosts() for the cost calculator.
// HUB-06, D296, D300, P15-P16. Pure, integer cents. Every rate comes from CLAIMS by id; the CDS plan
// comes from the catalog (null = "Price coming soon", so the CDS total is null, never 0).
// WR-B08 (D182 accuracy): both totals are what the owner pays a month, like for like. Elsewhere:
// online card processing at Mindbody and Boulevard (the range is labelled with those two names),
// marketplace fees and the add-on stack. With CDS: the owner's own Stripe fees (paid to Stripe,
// never to CDS; the platform cut is 0) plus the plan before add-ons.

import {
  CLAIMS,
  claimById,
  type Claim,
  type ClaimRate,
  type ClaimShare,
} from "./claims";

export type CentsRange = { lo: number; hi: number };

export type CompareInput = {
  salesCents: number;
  avgCents: number;
  appClients: number;
  planMonthlyCents: number | null;
  claims?: readonly Claim[];
};

export type CompareResult = {
  elsewhere: {
    processing: CentsRange;
    marketplace: CentsRange | null;
    stack: number;
    /** What the owner pays a month elsewhere: processing + marketplace + stack. */
    total: CentsRange;
  };
  cds: {
    gatewayCents: number;
    platformCutCents: 0;
    planCents: number | null;
    /** What the owner pays a month with CDS: Stripe fees + plan; null when the plan is unpriced. */
    total: number | null;
  };
};

/** Default calculator inputs (D-UI-P15-18): 5000 dollars of sales, 60 dollar average, no app clients. */
export const CALC_DEFAULTS = {
  salesCents: 500000,
  avgCents: 6000,
  appClients: 0,
} as const;

/** Validation bounds (UI-SPEC "Calculator"), inclusive. */
export const CALC_BOUNDS = {
  salesCents: { min: 0, max: 100000000 },
  avgCents: { min: 100, max: 1000000 },
  appClients: { min: 0, max: 1000 },
} as const;

export type CalcField = keyof typeof CALC_BOUNDS;

export function inCalcBounds(field: CalcField, value: number): boolean {
  const b = CALC_BOUNDS[field];
  return Number.isInteger(value) && value >= b.min && value <= b.max;
}

// Percent as integer hundredths of a percent, so 3.65 never drifts in float maths.
const bps = (pct: number): number => Math.round(pct * 100);

/** Card processing for a month: pct of sales plus the fixed fee per transaction (sales / average). */
export function processingCents(
  salesCents: number,
  avgCents: number,
  rate: ClaimRate,
): number {
  const txns = avgCents > 0 ? Math.round(salesCents / avgCents) : 0;
  return (
    Math.round((salesCents * bps(rate.pct)) / 10000) + txns * rate.fixedCents
  );
}

function shareCents(avgCents: number, s: ClaimShare): number {
  let v = Math.round((avgCents * bps(s.pct)) / 10000);
  if (s.minCents !== undefined) v = Math.max(v, s.minCents);
  if (s.maxCents !== undefined) v = Math.min(v, s.maxCents);
  return v;
}

function need<T>(v: T | undefined, id: string, what: string): T {
  if (v === undefined) throw new Error(`Claim ${id} has no ${what}`);
  return v;
}

const range = (a: number, b: number): CentsRange => ({
  lo: Math.min(a, b),
  hi: Math.max(a, b),
});

export function compareCosts(input: CompareInput): CompareResult {
  const all = input.claims ?? CLAIMS;
  const rate = (id: string) => need(claimById(id, all).rate, id, "rate");
  const share = (id: string) => need(claimById(id, all).share, id, "share");

  const processing = range(
    processingCents(input.salesCents, input.avgCents, rate("mindbody-online")),
    processingCents(input.salesCents, input.avgCents, rate("boulevard-online")),
  );

  const marketplace =
    input.appClients > 0
      ? range(
          shareCents(input.avgCents, share("fresha-marketplace")) *
            input.appClients,
          shareCents(input.avgCents, share("booksy-boost")) * input.appClients,
        )
      : null;

  const stack = need(
    claimById("vagaro-stack", all).monthlyCents,
    "vagaro-stack",
    "monthlyCents",
  );

  const total: CentsRange = {
    lo: processing.lo + (marketplace?.lo ?? 0) + stack,
    hi: processing.hi + (marketplace?.hi ?? 0) + stack,
  };

  const planCents = input.planMonthlyCents;
  const gatewayCents = processingCents(
    input.salesCents,
    input.avgCents,
    rate("stripe-online"),
  );
  return {
    elsewhere: { processing, marketplace, stack, total },
    cds: {
      gatewayCents,
      platformCutCents: 0,
      planCents,
      total: planCents === null ? null : gatewayCents + planCents,
    },
  };
}

/** "5000", "5,000", the same with a leading dollar sign, "5000.50" -> cents; anything else (or empty) -> null. */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/[\s,$]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
  const cents = whole * 100 + frac;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Whole numbers only (commas and spaces allowed); empty is 0 (the field is optional). */
export function parseCountInput(raw: string): number | null {
  const s = raw.replace(/[\s,]/g, "");
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
