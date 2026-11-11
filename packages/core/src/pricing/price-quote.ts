// priceQuote: the one function every figure on /start, the saved quote and P10 billing comes
// from (ONB-06, D79, D181, D264, D299, D300, D314). Integer cents only: no floats here.
import type { AddonPath } from "../addons/constants";
import type {
  BillingCadence,
  CatalogItemKind,
  CatalogRow,
  QuoteLine,
  QuoteSelections,
  QuoteTotals,
} from "./types";

/** Yearly billing charges 10 months for 12 ("2 months free", D180). */
const YEARLY_MONTHS = 10;

function findRow(
  catalog: readonly CatalogRow[],
  kind: CatalogItemKind,
  key: string,
  path: AddonPath,
): CatalogRow | undefined {
  return catalog.find(
    (r) => r.itemKind === kind && r.itemKey === key && r.path === path,
  );
}

/** A usable amount: a non-negative safe integer; anything else is treated as unpriced. */
function cents(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function line(
  catalog: readonly CatalogRow[],
  kind: CatalogItemKind,
  key: string,
  path: AddonPath,
): QuoteLine {
  const row = findRow(catalog, kind, key, path);
  return {
    kind,
    key,
    monthlyCents: cents(row?.monthlyCents),
    oneTimeCents: cents(row?.oneTimeCents),
  };
}

/**
 * Reads only plan, build_fee, care_plan and the selected addon / extra rows (by kind and key),
 * so the P10 billing kinds (pack, service, setup_fee) and unselected rows never change a
 * total (Pitfall 8; price-quote.test.ts proves it).
 */
export function priceQuote(
  catalog: readonly CatalogRow[],
  selections: QuoteSelections,
  path: AddonPath,
  cadence: BillingCadence,
): QuoteTotals {
  const unpriced: string[] = [];

  // Website build and its installment plan (D181): remainder goes on the last payment (PD-18).
  const buildRow = findRow(catalog, "build_fee", "base", path);
  const buildCents = cents(buildRow?.oneTimeCents);
  const rawN = buildRow?.installments;
  const installments =
    typeof rawN === "number" && Number.isSafeInteger(rawN) && rawN >= 1
      ? rawN
      : 1;
  let eachCents: number | null = null;
  let lastCents: number | null = null;
  if (buildCents === null) {
    unpriced.push("build");
  } else {
    eachCents = Math.floor(buildCents / installments);
    lastCents = buildCents - eachCents * (installments - 1);
  }

  const plan = line(catalog, "plan", "base", path);
  if (plan.monthlyCents === null) unpriced.push("plan");

  const addons = selections.addons.map((slug) => {
    const l = line(catalog, "addon", slug, path);
    if (l.monthlyCents === null) unpriced.push(slug);
    return l;
  });

  const extras = selections.extras.map((key) => {
    const l = line(catalog, "extra", key, path);
    if (l.oneTimeCents === null) unpriced.push(key);
    return l;
  });

  let carePlan: QuoteLine | null = null;
  if (selections.carePlan) {
    carePlan = line(catalog, "care_plan", "care", path);
    if (carePlan.monthlyCents === null) unpriced.push("care");
  }

  // Flat monthly = base plan + priced flat add-ons. Only these get the yearly discount.
  const flatMonthly =
    (plan.monthlyCents ?? 0) +
    addons.reduce((sum, a) => sum + (a.monthlyCents ?? 0), 0);
  const careMonthly = carePlan?.monthlyCents ?? 0;
  const extrasCents = extras.reduce((sum, e) => sum + (e.oneTimeCents ?? 0), 0);
  const build = buildCents ?? 0;

  const monthlyCents = flatMonthly + careMonthly;
  // PD-1: D314 annual prepay covers "base plan fee and flat monthly add-ons only"; the Care
  // Plan is a service and stays billed monthly on yearly cadence.
  const recurringFirstChargeCents =
    cadence === "yearly"
      ? YEARLY_MONTHS * flatMonthly + careMonthly
      : monthlyCents;
  const recurringFirstYear =
    cadence === "yearly"
      ? YEARLY_MONTHS * flatMonthly + 12 * careMonthly
      : 12 * monthlyCents;

  return {
    path,
    cadence,
    build: { cents: buildCents, installments, eachCents, lastCents },
    plan,
    addons,
    extras,
    carePlan,
    monthlyCents,
    recurringFirstChargeCents,
    dueAtCheckoutCents: build + extrasCents + recurringFirstChargeCents,
    dueAtCheckoutWithInstallmentsCents:
      (eachCents ?? 0) + extrasCents + recurringFirstChargeCents,
    firstYearCents: build + extrasCents + recurringFirstYear,
    unpricedCount: unpriced.length,
    unpriced,
  };
}
