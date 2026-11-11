// ONB-06, D79, D181, D300, D314: the UI-SPEC worked figures, in integer cents.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { normaliseSelections, priceQuote } from "./index";
import type { CatalogRow, QuoteSelections } from "./index";

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
    itemKind: "care_plan",
    itemKey: "care",
    path: "standard",
    monthlyCents: 9900,
    oneTimeCents: null,
    installments: null,
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
  {
    itemKind: "care_plan",
    itemKey: "care",
    path: "studio",
    monthlyCents: 9900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "addon",
    itemKey: "testimonials",
    path: "standard",
    monthlyCents: 900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "addon",
    itemKey: "credentials",
    path: "standard",
    monthlyCents: null,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "extra",
    itemKey: "logo-design",
    path: "standard",
    monthlyCents: null,
    oneTimeCents: 30000,
    installments: null,
  },
  {
    itemKind: "extra",
    itemKey: "copywriting",
    path: "standard",
    monthlyCents: null,
    oneTimeCents: null,
    installments: null,
  },
];

const sel = (over: Partial<QuoteSelections> = {}): QuoteSelections => ({
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  ...over,
});

describe("priceQuote worked figures (UI-SPEC Receipt)", () => {
  it("Standard monthly: $1,539 / 6 payments $289 / first-year $1,968", () => {
    const q = priceQuote(CATALOG, sel(), "standard", "monthly");
    expect(q.dueAtCheckoutCents).toBe(153900);
    expect(q.dueAtCheckoutWithInstallmentsCents).toBe(28900);
    expect(q.firstYearCents).toBe(196800);
    expect(q.build).toEqual({
      cents: 150000,
      installments: 6,
      eachCents: 25000,
      lastCents: 25000,
    });
    expect(q.monthlyCents).toBe(3900);
    expect(q.unpricedCount).toBe(0);
  });

  it("Standard yearly: $1,890 at checkout and first-year", () => {
    const q = priceQuote(
      CATALOG,
      sel({ cadence: "yearly" }),
      "standard",
      "yearly",
    );
    expect(q.recurringFirstChargeCents).toBe(39000);
    expect(q.dueAtCheckoutCents).toBe(189000);
    expect(q.firstYearCents).toBe(189000);
  });

  it("Studio monthly: $3,549 / $632.33 / $4,088 with the remainder on the last payment", () => {
    const q = priceQuote(CATALOG, sel(), "studio", "monthly");
    expect(q.dueAtCheckoutCents).toBe(354900);
    expect(q.build.eachCents).toBe(58333);
    expect(q.build.lastCents).toBe(58335);
    expect(q.build.eachCents! * 5 + q.build.lastCents!).toBe(350000);
    expect(q.dueAtCheckoutWithInstallmentsCents).toBe(63233);
    expect(q.firstYearCents).toBe(408800);
  });
});

describe("priceQuote add-ons, extras and the Care Plan", () => {
  it("a priced add-on adds to the monthly and to the yearly first charge", () => {
    const m = priceQuote(
      CATALOG,
      sel({ addons: ["testimonials"] }),
      "standard",
      "monthly",
    );
    expect(m.monthlyCents).toBe(4800);
    expect(m.addons).toEqual([
      {
        kind: "addon",
        key: "testimonials",
        monthlyCents: 900,
        oneTimeCents: null,
      },
    ]);
    const y = priceQuote(
      CATALOG,
      sel({ addons: ["testimonials"] }),
      "standard",
      "yearly",
    );
    expect(y.recurringFirstChargeCents).toBe(10 * 4800);
  });

  it("an unpriced add-on is excluded and counted, never invented", () => {
    const q = priceQuote(
      CATALOG,
      sel({ addons: ["credentials"] }),
      "standard",
      "monthly",
    );
    expect(q.monthlyCents).toBe(3900);
    expect(q.unpricedCount).toBe(1);
    expect(q.unpriced).toContain("credentials");
  });

  it("an unpriced extra is excluded and counted; a priced extra is one-time", () => {
    const q = priceQuote(
      CATALOG,
      sel({ extras: ["copywriting", "logo-design"] }),
      "standard",
      "monthly",
    );
    expect(q.unpricedCount).toBe(1);
    expect(q.unpriced).toEqual(["copywriting"]);
    expect(q.dueAtCheckoutCents).toBe(153900 + 30000);
    expect(q.dueAtCheckoutWithInstallmentsCents).toBe(28900 + 30000);
    expect(q.firstYearCents).toBe(196800 + 30000);
  });

  it("a selected slug with no catalog row counts as unpriced and never throws", () => {
    const q = priceQuote(
      CATALOG,
      sel({ addons: ["no-such-row"] }),
      "standard",
      "monthly",
    );
    expect(q.unpriced).toEqual(["no-such-row"]);
    expect(q.addons[0]?.monthlyCents).toBeNull();
    expect(q.dueAtCheckoutCents).toBe(153900);
  });

  it("Care Plan stays monthly on yearly billing (PD-1, D314)", () => {
    const q = priceQuote(
      CATALOG,
      sel({ carePlan: true, cadence: "yearly" }),
      "standard",
      "yearly",
    );
    expect(q.carePlan?.monthlyCents).toBe(9900);
    expect(q.recurringFirstChargeCents).toBe(10 * 3900 + 9900);
    expect(q.firstYearCents).toBe(150000 + 10 * 3900 + 12 * 9900);
  });

  it("Care Plan on monthly adds to the monthly", () => {
    const q = priceQuote(
      CATALOG,
      sel({ carePlan: true }),
      "standard",
      "monthly",
    );
    expect(q.monthlyCents).toBe(3900 + 9900);
    expect(q.firstYearCents).toBe(150000 + 12 * (3900 + 9900));
  });

  it("an empty catalog prices nothing and lists the base items as unpriced", () => {
    const q = priceQuote([], sel(), "standard", "monthly");
    expect(q.build.cents).toBeNull();
    expect(q.build.eachCents).toBeNull();
    expect(q.dueAtCheckoutCents).toBe(0);
    expect(q.unpriced).toEqual(["build", "plan"]);
  });
});

describe("normaliseSelections", () => {
  it("dedupes preserving order and coerces carePlan", () => {
    expect(
      normaliseSelections({
        addons: ["testimonials", "credentials", "testimonials"],
        extras: ["logo-design"],
        carePlan: 1,
        cadence: "yearly",
      }),
    ).toEqual({
      addons: ["testimonials", "credentials"],
      extras: ["logo-design"],
      carePlan: true,
      cadence: "yearly",
    });
  });

  it("defaults missing lists and cadence", () => {
    expect(normaliseSelections({})).toEqual({
      addons: [],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    });
  });

  it.each([
    ["non-object", "nope"],
    ["null", null],
    ["array", []],
    ["bad slug", { addons: ["Bad Slug"] }],
    ["non-string item", { addons: [7] }],
    ["non-array list", { extras: "logo-design" }],
    [
      "too many items",
      { addons: Array.from({ length: 41 }, (_, i) => `addon-${i}`) },
    ],
    ["bad cadence", { cadence: "weekly" }],
  ])("rejects %s", (_label, raw) => {
    expect(() => normaliseSelections(raw)).toThrow(InvalidInput);
  });
});

describe("priceQuote ignores the P10 billing rows (Pitfall 8)", () => {
  const row = (
    itemKind: CatalogRow["itemKind"],
    itemKey: string,
    path: CatalogRow["path"],
    monthlyCents: number | null,
    oneTimeCents: number | null,
  ): CatalogRow => ({
    itemKind,
    itemKey,
    path,
    monthlyCents,
    oneTimeCents,
    installments: null,
  });
  const P10_ROWS: CatalogRow[] = [];
  for (const path of ["standard", "studio"] as const) {
    P10_ROWS.push(
      row("pack", "media-5gb", path, 500, null),
      row("pack", "media-25gb", path, 1500, null),
      row("pack", "pages-5", path, 1000, null),
      row("service", "polish-hour", path, null, null),
      row("setup_fee", "addon", path, null, 2500),
      // Same keys as P6 kinds, so a kind-blind lookup would pick these up.
      row("pack", "base", path, 777, 777),
      row("setup_fee", "base", path, 888, 888),
      row("service", "care", path, 999, null),
    );
  }
  P10_ROWS.push(
    row("addon", "builder-pro", "standard", 1200, null),
    row("addon", "builder-pro", "studio", 0, null),
    row("addon", "studio-booking-solo", "studio", 4900, null),
    row("addon", "studio-booking-team", "studio", 9900, null),
    row("addon", "studio-booking-large-team", "studio", 17900, null),
    row("addon", "newsletter", "studio", 0, null),
    row("addon", "landing-pages", "studio", 0, null),
  );
  // P10 rows placed first so a first-match lookup would hit them before the P6 rows.
  const WIDE = [...P10_ROWS, ...CATALOG];

  it.each([
    ["standard", "monthly"],
    ["standard", "yearly"],
    ["studio", "monthly"],
    ["studio", "yearly"],
  ] as const)("%s %s totals are identical", (path, cadence) => {
    const selections = sel({
      cadence,
      carePlan: true,
      addons: ["testimonials", "credentials"],
      extras: ["copywriting", "logo-design"],
    });
    expect(priceQuote(WIDE, selections, path, cadence)).toEqual(
      priceQuote(CATALOG, selections, path, cadence),
    );
    expect(priceQuote(WIDE, sel({ cadence }), path, cadence)).toEqual(
      priceQuote(CATALOG, sel({ cadence }), path, cadence),
    );
  });
});
