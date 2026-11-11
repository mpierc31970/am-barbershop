// CONTEXT A2-A4, D181, D214, D225, D299: the pure billing-model helpers.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { priceQuote } from "../pricing";
import type { CatalogRow } from "../pricing";
import {
  BASE_MEDIA_BYTES,
  BUILD_INSTALLMENTS,
  BUSINESS_TIME_ZONE,
  CARE_PLAN_MINUTES,
  DECLINE_WINDOW_BUSINESS_DAYS,
  PACK_25GB_BYTES,
  PACK_5GB_BYTES,
  addBusinessDays,
  careLogCheck,
  careMonth,
  installmentSplit,
  lapseStateFor,
  mediaAllowanceBytes,
  withinDeclineWindow,
} from "./index";

const GIB = 1024 ** 3;

// Same build rows as pricing/price-quote.test.ts (D181: 6 x $250 / 6 x $583.33).
const CATALOG: readonly CatalogRow[] = [
  {
    itemKind: "plan",
    itemKey: "base",
    path: "standard",
    monthlyCents: 3900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "build_fee",
    itemKey: "base",
    path: "standard",
    monthlyCents: null,
    oneTimeCents: 150000,
    installments: 6,
  },
  {
    itemKind: "plan",
    itemKey: "base",
    path: "studio",
    monthlyCents: 4900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "build_fee",
    itemKey: "base",
    path: "studio",
    monthlyCents: null,
    oneTimeCents: 350000,
    installments: 6,
  },
];

const NO_SELECTIONS = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
} as const;

describe("constants", () => {
  it("match the design", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
    expect(CARE_PLAN_MINUTES).toBe(60);
    expect(BASE_MEDIA_BYTES).toBe(2 * GIB);
    expect(PACK_5GB_BYTES).toBe(5 * GIB);
    expect(PACK_25GB_BYTES).toBe(25 * GIB);
    expect(DECLINE_WINDOW_BUSINESS_DAYS).toBe(5);
    expect(BUILD_INSTALLMENTS).toBe(6);
  });
});

describe("installmentSplit (D181, Pitfall 6)", () => {
  it("splits the build fee with the remainder on the last payment", () => {
    expect(installmentSplit(150000, 6)).toEqual({
      eachCents: 25000,
      lastCents: 25000,
    });
    expect(installmentSplit(350000, 6)).toEqual({
      eachCents: 58333,
      lastCents: 58335,
    });
  });

  it.each(["standard", "studio"] as const)(
    "equals priceQuote's build figures on %s",
    (path) => {
      const q = priceQuote(CATALOG, NO_SELECTIONS, path, "monthly");
      expect(q.build.cents).not.toBeNull();
      expect(installmentSplit(q.build.cents!, q.build.installments)).toEqual({
        eachCents: q.build.eachCents,
        lastCents: q.build.lastCents,
      });
    },
  );

  it("defaults to 6 payments and refuses bad input", () => {
    expect(installmentSplit(150000)).toEqual({
      eachCents: 25000,
      lastCents: 25000,
    });
    expect(() => installmentSplit(-1, 6)).toThrow(InvalidInput);
    expect(() => installmentSplit(10.5, 6)).toThrow(InvalidInput);
    expect(() => installmentSplit(100, 0)).toThrow(InvalidInput);
  });
});

describe("lapseStateFor (CONTEXT A3, D310)", () => {
  it("keeps everything on at past_due and lapses only when retries end", () => {
    expect(lapseStateFor("active")).toBe("active");
    expect(lapseStateFor("trialing")).toBe("active");
    expect(lapseStateFor("past_due")).toBe("past_due");
    expect(lapseStateFor("unpaid")).toBe("lapsed");
    expect(lapseStateFor("canceled")).toBe("lapsed");
    expect(lapseStateFor("incomplete_expired")).toBe("lapsed");
    expect(lapseStateFor("incomplete")).toBe("none");
  });
});

/** Chicago calendar date of an instant, YYYY-MM-DD. */
function chicagoDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

describe("business days (D214, CONTEXT A4)", () => {
  const friday = new Date("2026-10-09T15:00:00Z");

  it("Friday + 5 business days is the next Friday", () => {
    expect(chicagoDate(addBusinessDays(friday, 5))).toBe("2026-10-16");
  });

  it("a weekend start makes Monday business day 1 (review WR-B02)", () => {
    const saturday = new Date("2026-10-10T18:00:00Z");
    expect(chicagoDate(addBusinessDays(saturday, 0))).toBe("2026-10-12");
    expect(chicagoDate(addBusinessDays(saturday, 1))).toBe("2026-10-12");
    expect(chicagoDate(addBusinessDays(saturday, 5))).toBe("2026-10-16");
    const sunday = new Date("2026-10-11T18:00:00Z");
    expect(chicagoDate(addBusinessDays(sunday, 5))).toBe("2026-10-16");
  });

  it("decline window is open at 5 business days and closed at 6", () => {
    // Fri 2026-10-16, 10 pm Chicago = 5th business day.
    expect(withinDeclineWindow(friday, new Date("2026-10-17T03:00:00Z"))).toBe(
      true,
    );
    // Weekend after the 5th business day, then Mon 2026-10-19 = 6th.
    expect(withinDeclineWindow(friday, new Date("2026-10-18T15:00:00Z"))).toBe(
      false,
    );
    expect(withinDeclineWindow(friday, new Date("2026-10-19T15:00:00Z"))).toBe(
      false,
    );
    expect(withinDeclineWindow(friday, friday)).toBe(true);
  });

  it("a Saturday payment's window is exactly 5 business days, Mon-Fri (review WR-B02, D214)", () => {
    const saturday = new Date("2026-10-10T18:00:00Z");
    // Fri 2026-10-16, 10 pm Chicago = 5th business day: still open.
    expect(
      withinDeclineWindow(saturday, new Date("2026-10-17T03:00:00Z")),
    ).toBe(true);
    // The weekend after, and Mon 2026-10-19 (a 6th business day), are closed.
    expect(
      withinDeclineWindow(saturday, new Date("2026-10-17T15:00:00Z")),
    ).toBe(false);
    expect(
      withinDeclineWindow(saturday, new Date("2026-10-19T20:00:00Z")),
    ).toBe(false);
    // Never longer than a Friday payer's window (Fri 2026-10-09 closes Fri 2026-10-16).
    const fridayBefore = new Date("2026-10-09T15:00:00Z");
    expect(
      withinDeclineWindow(fridayBefore, new Date("2026-10-17T03:00:00Z")),
    ).toBe(true);
    expect(
      withinDeclineWindow(fridayBefore, new Date("2026-10-17T15:00:00Z")),
    ).toBe(false);
  });

  it("refuses a negative day count", () => {
    expect(() => addBusinessDays(friday, -1)).toThrow(InvalidInput);
  });
});

describe("Care Plan (D299, CONTEXT A4)", () => {
  it("the month is the business time zone's month", () => {
    const m = careMonth(new Date("2026-11-01T04:30:00Z"));
    expect(m.label).toBe("October");
    expect(m.year).toBe(2026);
    expect(m.month).toBe(10);
    expect(m.start.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    // November starts in CDT too (DST ends 2026-11-01 at 2 am).
    expect(m.end.toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("a winter month starts at 6 am UTC (CST)", () => {
    const m = careMonth(new Date("2026-12-15T12:00:00Z"));
    expect(m.label).toBe("December");
    expect(m.start.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    expect(m.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it("caps logged time at 60 minutes", () => {
    expect(careLogCheck(55, 5)).toEqual({ ok: true, total: 60 });
    expect(careLogCheck(55, 20)).toEqual({ ok: false, total: 75 });
    expect(() => careLogCheck(0, 0)).toThrow(InvalidInput);
    expect(() => careLogCheck(-1, 5)).toThrow(InvalidInput);
  });
});

describe("mediaAllowanceBytes (D225)", () => {
  it("is 2 GB plus the packs", () => {
    expect(mediaAllowanceBytes(0, 0)).toBe(2 * GIB);
    expect(mediaAllowanceBytes(2, 1)).toBe((2 + 10 + 25) * GIB);
  });

  it("refuses negative or fractional quantities", () => {
    expect(() => mediaAllowanceBytes(-1, 0)).toThrow(InvalidInput);
    expect(() => mediaAllowanceBytes(0, 1.5)).toThrow(InvalidInput);
  });
});
