// 10-16 Task 1 (BILL-01, BILL-02, BILL-10, BILL-11, BILL-19; D181, D299, D300, D314): the
// checkout lines and the owner's summary come from one priceQuote() result, and due today
// always equals priceQuote's checkout figure.
import {
  priceQuote,
  type CatalogRow,
  type QuoteSelections,
} from "@cds/core/pricing";
import { describe, expect, it } from "vitest";
import { INSTALLMENT_KEY } from "./accounts";
import {
  buildCheckoutLines,
  CheckoutBlocked,
  checkoutSummaryView,
  orderDueToday,
  quoteDueToday,
  UNPRICED_COPY,
  type CheckoutRef,
} from "./checkout-lines";

const row = (
  itemKind: CatalogRow["itemKind"],
  itemKey: string,
  path: CatalogRow["path"],
  monthlyCents: number | null,
  oneTimeCents: number | null = null,
  installments: number | null = null,
): CatalogRow => ({
  itemKind,
  itemKey,
  path,
  monthlyCents,
  oneTimeCents,
  installments,
});

const CATALOG: readonly CatalogRow[] = [
  row("plan", "base", "standard", 3900),
  row("plan", "base", "studio", 4900),
  row("build_fee", "base", "standard", null, 150000, 6),
  row("build_fee", "base", "studio", null, 350000, 6),
  row("care_plan", "care", "standard", 9900),
  row("care_plan", "care", "studio", 9900),
  row("addon", "testimonials", "standard", 900),
  row("addon", "credentials", "standard", null),
  row("addon", "builder-pro", "studio", 0),
  row("extra", "copywriting", "standard", null, 50000),
  row("extra", "logo-design", "standard", null, null),
];

const ref = (kind: string, key: string, path: string): CheckoutRef => ({
  kind,
  key,
  path,
  monthlyRef: `price_${kind}_${key}_${path}_m`,
  yearlyRef: `price_${kind}_${key}_${path}_y`,
  onceRef: `price_${kind}_${key}_${path}_o`,
});

const REFS: readonly CheckoutRef[] = CATALOG.map((r) =>
  ref(r.itemKind, r.itemKey, r.path),
);

const NAMES = { testimonials: "Testimonials", "builder-pro": "Builder Pro" };
const NOW = new Date("2026-10-08T17:00:00.000Z"); // 8 Oct, Chicago

function quote(
  sel: Partial<QuoteSelections>,
  path: "standard" | "studio" = "standard",
) {
  const s: QuoteSelections = {
    addons: [],
    extras: [],
    carePlan: false,
    cadence: "monthly",
    ...sel,
  };
  return priceQuote(CATALOG, s, path, s.cadence);
}

const simple = (
  lines: { kind: string; key: string; interval: string; unitCents: number }[],
) => lines.map((l) => [l.kind, l.key, l.interval, l.unitCents]);

describe("buildCheckoutLines", () => {
  it("monthly, paid in full, Testimonials $9", () => {
    const totals = quote({ addons: ["testimonials"] });
    const out = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "monthly",
      buildPlan: "full",
      carePlan: false,
      addonNames: NAMES,
    });
    expect(simple(out.lines)).toEqual([
      ["build_fee", "base", "once", 150000],
      ["plan", "base", "month", 3900],
      ["addon", "testimonials", "month", 900],
    ]);
    expect(out.lines[0]!.priceRef).toBe("price_build_fee_base_standard_o");
    expect(out.lines[2]!.priceRef).toBe("price_addon_testimonials_standard_m");
    expect(out.lines[2]!.label).toBe("Testimonials");
    expect(out.deferredMonthly).toEqual([]);
    expect(out.dueTodayCents).toBe(154800);
    expect(out.dueTodayCents).toBe(totals.dueAtCheckoutCents);
  });

  it("monthly, 6 payments: the installment item replaces the build line", () => {
    const totals = quote({ addons: ["testimonials"] });
    const out = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "monthly",
      buildPlan: "installments",
      carePlan: false,
    });
    expect(simple(out.lines)).toEqual([
      ["installment", INSTALLMENT_KEY, "month", 25000],
      ["plan", "base", "month", 3900],
      ["addon", "testimonials", "month", 900],
    ]);
    expect(out.lines[0]!.priceRef).toBe("price_build_fee_base_standard_m");
    expect(out.dueTodayCents).toBe(25000 + 3900 + 900);
    expect(out.dueTodayCents).toBe(totals.dueAtCheckoutWithInstallmentsCents);
  });

  it("yearly, 6 payments, Care Plan: yearly items + first-month lines, monthly items deferred", () => {
    const totals = quote({
      addons: ["testimonials"],
      carePlan: true,
      cadence: "yearly",
    });
    const out = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "yearly",
      buildPlan: "installments",
      carePlan: true,
    });
    expect(simple(out.lines)).toEqual([
      ["first_month", INSTALLMENT_KEY, "once", 25000],
      ["plan", "base", "year", 39000],
      ["addon", "testimonials", "year", 9000],
      ["first_month", "care", "once", 9900],
    ]);
    expect(out.lines[1]!.priceRef).toBe("price_plan_base_standard_y");
    expect(out.lines[0]!.priceRef).toBeNull();
    expect(simple(out.deferredMonthly)).toEqual([
      ["installment", INSTALLMENT_KEY, "month", 25000],
      ["care_plan", "care", "month", 9900],
    ]);
    expect(out.dueTodayCents).toBe(quoteDueToday(totals, "installments"));
    expect(out.dueTodayCents).toBe(25000 + 39000 + 9000 + 9900);
  });

  it("a $0 included add-on adds no line", () => {
    const totals = quote({ addons: ["builder-pro"] }, "studio");
    const out = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "monthly",
      buildPlan: "full",
      carePlan: false,
    });
    expect(out.lines.map((l) => l.key)).toEqual(["base", "base"]);
    expect(out.dueTodayCents).toBe(totals.dueAtCheckoutCents);
  });

  it("an unpriced add-on blocks checkout with the locked copy", () => {
    const totals = quote({ addons: ["testimonials", "credentials"] });
    let err: unknown;
    try {
      buildCheckoutLines({
        totals,
        refs: REFS,
        cadence: "monthly",
        buildPlan: "full",
        carePlan: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CheckoutBlocked);
    expect((err as CheckoutBlocked).unpriced).toEqual(["credentials"]);
    expect((err as CheckoutBlocked).message).toBe(UNPRICED_COPY);
  });

  it("extras: a priced copywriting extra is one once line charged today", () => {
    const totals = quote({ extras: ["copywriting"] });
    const full = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "monthly",
      buildPlan: "full",
      carePlan: false,
    });
    const extra = full.lines.find((l) => l.kind === "extra")!;
    expect(extra).toMatchObject({
      key: "copywriting",
      label: "Copywriting",
      interval: "once",
      unitCents: 50000,
      priceRef: "price_extra_copywriting_standard_o",
    });
    expect(full.dueTodayCents).toBe(
      priceQuote(
        CATALOG,
        {
          addons: [],
          extras: ["copywriting"],
          carePlan: false,
          cadence: "monthly",
        },
        "standard",
        "monthly",
      ).dueAtCheckoutCents,
    );

    const inst = buildCheckoutLines({
      totals,
      refs: REFS,
      cadence: "monthly",
      buildPlan: "installments",
      carePlan: false,
    });
    expect(inst.lines.some((l) => l.key === "copywriting")).toBe(true);
    expect(inst.dueTodayCents).toBe(totals.dueAtCheckoutWithInstallmentsCents);
    expect(inst.dueTodayCents).toBe(25000 + 3900 + 50000);
  });

  it("an unpriced extra blocks checkout and is listed", () => {
    const totals = quote({ extras: ["copywriting", "logo-design"] });
    expect(() =>
      buildCheckoutLines({
        totals,
        refs: REFS,
        cadence: "monthly",
        buildPlan: "full",
        carePlan: false,
      }),
    ).toThrow(CheckoutBlocked);
    try {
      checkoutSummaryView(totals, { buildPlan: "full", testMode: false }, NOW);
    } catch (e) {
      expect((e as CheckoutBlocked).unpriced).toEqual(["logo-design"]);
    }
  });
});

describe("checkoutSummaryView", () => {
  it("monthly, paid in full", () => {
    const totals = quote({ extras: ["copywriting"] });
    const v = checkoutSummaryView(
      totals,
      { buildPlan: "full", testMode: true },
      NOW,
    );
    expect(v.pathLabel).toBe("Standard");
    expect(v.today).toEqual([
      { label: "Website build", cents: 150000 },
      { label: "Standard plan, first month", cents: 3900 },
      { label: "Copywriting", cents: 50000 },
    ]);
    expect(v.dueTodayCents).toBe(totals.dueAtCheckoutCents);
    expect(v.then).toEqual([{ text: "$39 a month from 8 Nov" }]);
    expect(v.testMode).toBe(true);
  });

  it("monthly, 6 payments, Care Plan", () => {
    const totals = quote({ carePlan: true });
    const v = checkoutSummaryView(
      totals,
      { buildPlan: "installments", testMode: false },
      NOW,
    );
    expect(v.today.map((t) => t.label)).toEqual([
      "Build payment 1 of 6",
      "Standard plan, first month",
      "Care Plan, first month",
    ]);
    expect(v.then.map((t) => t.text)).toEqual([
      "$388 a month from 8 Nov to 8 Mar",
      "$138 a month after that",
    ]);
    expect(v.testMode).toBe(false);
  });

  it("the UI-SPEC worked figures: $289 then $39", () => {
    const v = checkoutSummaryView(
      quote({}),
      { buildPlan: "installments", testMode: false },
      NOW,
    );
    expect(v.then.map((t) => t.text)).toEqual([
      "$289 a month from 8 Nov to 8 Mar",
      "$39 a month after that",
    ]);
  });

  it("yearly, paid in full and 6 payments", () => {
    const full = checkoutSummaryView(
      quote({ cadence: "yearly" }),
      { buildPlan: "full", testMode: false },
      NOW,
    );
    expect(full.today[1]).toEqual({
      label: "Standard plan, first year",
      cents: 39000,
    });
    expect(full.then.map((t) => t.text)).toEqual([
      "$390 a year from 8 Oct 2027",
    ]);
    const totals = quote({ cadence: "yearly" });
    const inst = checkoutSummaryView(
      totals,
      { buildPlan: "installments", testMode: false },
      NOW,
    );
    expect(inst.then.map((t) => t.text)).toEqual([
      "$250 a month for 5 more months (build)",
      "$390 a year from 8 Oct 2027",
    ]);
    expect(inst.dueTodayCents).toBe(totals.dueAtCheckoutWithInstallmentsCents);
  });
});

describe("pages packs on the order (11-27, D185)", () => {
  const PACKS2 = { quantity: 2, monthlyCents: 1000 };
  const REFS_P: readonly CheckoutRef[] = [
    ...REFS,
    ref("pack", "pages-5", "standard"),
  ];

  it("monthly: one pack:pages-5 line x n, due today includes it", () => {
    const totals = quote({});
    const out = buildCheckoutLines({
      totals,
      refs: REFS_P,
      cadence: "monthly",
      buildPlan: "full",
      carePlan: false,
      pagePacks: PACKS2,
    });
    const pack = out.lines.find((l) => l.kind === "pack")!;
    expect(pack).toMatchObject({
      key: "pages-5",
      label: "5 more pages",
      interval: "month",
      unitCents: 1000,
      quantity: 2,
      priceRef: "price_pack_pages-5_standard_m",
    });
    expect(out.dueTodayCents).toBe(totals.dueAtCheckoutCents + 2000);
    expect(orderDueToday(totals, "full", PACKS2)).toBe(out.dueTodayCents);
  });

  it("yearly: a first-month line today, the monthly item deferred", () => {
    const totals = quote({ cadence: "yearly" });
    const out = buildCheckoutLines({
      totals,
      refs: REFS_P,
      cadence: "yearly",
      buildPlan: "full",
      carePlan: false,
      pagePacks: PACKS2,
    });
    const first = out.lines.find((l) => l.key === "pages-5")!;
    expect(first).toMatchObject({
      kind: "first_month",
      interval: "once",
      unitCents: 1000,
      quantity: 2,
      priceRef: null,
    });
    expect(out.deferredMonthly).toEqual([
      expect.objectContaining({
        kind: "pack",
        key: "pages-5",
        interval: "month",
        quantity: 2,
      }),
    ]);
    expect(out.dueTodayCents).toBe(quoteDueToday(totals, "full") + 2000);
  });

  it("0 packs adds nothing; an unpriced pack blocks checkout", () => {
    const totals = quote({});
    const none = buildCheckoutLines({
      totals,
      refs: REFS_P,
      cadence: "monthly",
      buildPlan: "full",
      carePlan: false,
      pagePacks: { quantity: 0, monthlyCents: null },
    });
    expect(none.lines.some((l) => l.key === "pages-5")).toBe(false);
    expect(() =>
      buildCheckoutLines({
        totals,
        refs: REFS_P,
        cadence: "monthly",
        buildPlan: "full",
        carePlan: false,
        pagePacks: { quantity: 1, monthlyCents: null },
      }),
    ).toThrow(CheckoutBlocked);
  });

  it("the summary shows the packs today and in the monthly figure", () => {
    const totals = quote({});
    const view = checkoutSummaryView(
      totals,
      { buildPlan: "full", testMode: true, pagePacks: PACKS2 },
      NOW,
    );
    expect(view.today).toContainEqual({
      label: "5 more pages × 2, first month",
      cents: 2000,
    });
    expect(view.dueTodayCents).toBe(totals.dueAtCheckoutCents + 2000);
    expect(view.then[0]!.text).toBe("$59 a month from 8 Nov");
  });
});
