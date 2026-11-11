// P10 payments: checkout lines and the owner's order summary, both from one priceQuote()
// result (BILL-01, BILL-02, BILL-10, BILL-11, BILL-19; CONTEXT A2; D181, D299, D300, D314;
// RESEARCH Pattern 4). Pure: no PocketBase, no provider, no clock beyond the `now` passed in.
//
// What is charged and what the owner sees come from the same QuoteTotals, so the two can
// never disagree. Every amount is a figure priceQuote already used: the build fee or its
// first installment, the plan and each priced add-on (monthly, or 10 x monthly on yearly,
// D314), each priced extra as a one-time line, and the Care Plan. Yearly cadence is the
// two-step of Pattern 4(a): the Checkout carries the yearly items plus one-time "first
// month" lines for the monthly-by-nature items (Care Plan, build installment); those items
// come back as `deferredMonthly` for the completion handler to add with no proration.
// $0 lines (an add-on included on the path) add nothing. Anything unpriced throws
// CheckoutBlocked with the locked copy (D264): never an invented number.
// 11-27 (D185): "5 more pages" packs added before checkout ride on the order as one
// `pack:pages-5 x n` monthly item (yearly: a first-month line, the item deferred, like the
// Care Plan). priceQuote never reads packs (Pitfall 8), so they are added on top of its
// figure here: `orderDueToday` is the one due-today figure for both lines and summary.
import { CdsError } from "@cds/core";
import { EXTRAS } from "@cds/core/onboarding";
import { BUSINESS_TIME_ZONE, type BillingLine } from "@cds/core/payments";
import {
  formatCents,
  type QuoteLine,
  type QuoteTotals,
} from "@cds/core/pricing";
import { INSTALLMENT_KEY } from "./accounts";

/** CONTEXT A2 locked copy (UI-SPEC UNPRICED). */
export const UNPRICED_COPY =
  "We're finalising this price; remove it to continue now, or we'll email you when it's set.";

/** Yearly billing charges 10 months for 12 (D180, D314), the priceQuote rule. */
const YEARLY_MONTHS = 10;

/** Checkout refused: `unpriced` lists the items still "Price coming soon" (D264). */
export class CheckoutBlocked extends CdsError {
  override readonly code = "checkout_blocked";
  readonly unpriced: string[];
  constructor(unpriced: readonly string[]) {
    super(UNPRICED_COPY);
    this.unpriced = [...unpriced];
  }
}

/** The provider refs checkout needs; `CatalogBillingRef` from catalog.ts fits. */
export type CheckoutRef = {
  kind: string;
  key: string;
  path: string;
  monthlyRef: string | null;
  yearlyRef: string | null;
  onceRef: string | null;
};

export type BuildPlanChoice = "full" | "installments";

/** Pages packs on the order (11-27): quantity and the catalog's monthly cents (null = unpriced). */
export type PagePacksOrder = { quantity: number; monthlyCents: number | null };

export const PAGES_PACK_KEY = "pages-5";
const PAGES_PACK_LABEL = "5 more pages";

function packQty(p: PagePacksOrder | undefined): number {
  return p && Number.isSafeInteger(p.quantity) && p.quantity > 0
    ? p.quantity
    : 0;
}

/** What the pages packs add today: one month each (both cadences; packs are monthly). */
function packsTodayCents(p: PagePacksOrder | undefined): number {
  return packQty(p) * (p?.monthlyCents ?? 0);
}

/** Unpriced items, plus the pages pack when the order holds one without a price. */
function blockedWithPacks(
  totals: QuoteTotals,
  p: PagePacksOrder | undefined,
): string[] {
  const out = blocked(totals);
  if (packQty(p) > 0 && p!.monthlyCents === null) out.push(PAGES_PACK_KEY);
  return out;
}

/** The order's due-today figure: priceQuote's, plus the pages packs' first month. */
export function orderDueToday(
  totals: QuoteTotals,
  buildPlan: BuildPlanChoice,
  pagePacks?: PagePacksOrder,
): number {
  return quoteDueToday(totals, buildPlan) + packsTodayCents(pagePacks);
}

export type CheckoutLinesInput = {
  totals: QuoteTotals;
  refs: readonly CheckoutRef[];
  cadence: "monthly" | "yearly";
  buildPlan: BuildPlanChoice;
  /** Must match the selection priceQuote was given (totals.carePlan is set when on). */
  carePlan: boolean;
  /** Add-on display names by slug (manifest `name`); the slug is the fallback. */
  addonNames?: Readonly<Record<string, string>>;
  /** "5 more pages" packs added before checkout (11-27). */
  pagePacks?: PagePacksOrder;
};

export type CheckoutLines = {
  lines: BillingLine[];
  deferredMonthly: BillingLine[];
  dueTodayCents: number;
};

function pathName(path: string): string {
  return path === "" ? "" : path[0]!.toUpperCase() + path.slice(1);
}

function extraName(key: string): string {
  return EXTRAS.find((e) => e.key === key)?.label ?? key;
}

function addonName(
  slug: string,
  names: Readonly<Record<string, string>> | undefined,
): string {
  const n = names && Object.hasOwn(names, slug) ? names[slug] : undefined;
  return typeof n === "string" && n !== "" ? n : slug;
}

function refFor(
  refs: readonly CheckoutRef[],
  kind: string,
  key: string,
  path: string,
): CheckoutRef | undefined {
  return refs.find((r) => r.kind === kind && r.key === key && r.path === path);
}

function assertSelection(input: CheckoutLinesInput): void {
  const { totals } = input;
  if (totals.cadence !== input.cadence) {
    throw new Error("checkout lines: cadence differs from the quote");
  }
  if ((totals.carePlan !== null) !== input.carePlan) {
    throw new Error("checkout lines: Care Plan differs from the quote");
  }
}

/** Items that block checkout, as priceQuote listed them (add-ons, extras, plan, build, care). */
function blocked(totals: QuoteTotals): string[] {
  return totals.unpricedCount > 0 ? [...totals.unpriced] : [];
}

/** priceQuote's due-today figure for the chosen build plan. */
export function quoteDueToday(
  totals: QuoteTotals,
  buildPlan: BuildPlanChoice,
): number {
  return buildPlan === "installments"
    ? totals.dueAtCheckoutWithInstallmentsCents
    : totals.dueAtCheckoutCents;
}

/**
 * The provider lines for one checkout. Throws CheckoutBlocked when anything selected is
 * unpriced. The sum of `lines` always equals priceQuote's due-today figure (asserted).
 */
export function buildCheckoutLines(input: CheckoutLinesInput): CheckoutLines {
  assertSelection(input);
  const { totals, refs, cadence, buildPlan } = input;
  const unpriced = blockedWithPacks(totals, input.pagePacks);
  if (unpriced.length > 0) throw new CheckoutBlocked(unpriced);

  const path = totals.path;
  const yearly = cadence === "yearly";
  const lines: BillingLine[] = [];
  const deferredMonthly: BillingLine[] = [];
  const buildRef = refFor(refs, "build_fee", "base", path);

  // Website build (D181): in full as a one-time line, or the 6-payment item.
  if (buildPlan === "full") {
    lines.push({
      kind: "build_fee",
      key: "base",
      label: "Website build",
      interval: "once",
      unitCents: totals.build.cents!,
      quantity: 1,
      priceRef: buildRef?.onceRef ?? null,
    });
  } else {
    const installment: BillingLine = {
      kind: "installment",
      key: INSTALLMENT_KEY,
      label: "Website build payment",
      interval: "month",
      unitCents: totals.build.eachCents!,
      quantity: 1,
      priceRef: buildRef?.monthlyRef ?? null,
    };
    if (yearly) {
      lines.push({
        ...installment,
        kind: "first_month",
        label: "Build payment 1",
        interval: "once",
        priceRef: null,
      });
      deferredMonthly.push(installment);
    } else {
      lines.push(installment);
    }
  }

  // Base plan per path (D300), then each priced add-on; $0 included add-ons add no line.
  const recurring = (
    l: QuoteLine,
    kind: "plan" | "addon",
    label: string,
  ): void => {
    const monthly = l.monthlyCents!;
    if (monthly === 0) return;
    const ref = refFor(refs, kind, l.key, path);
    lines.push({
      kind,
      key: l.key,
      label,
      interval: yearly ? "year" : "month",
      unitCents: yearly ? YEARLY_MONTHS * monthly : monthly,
      quantity: 1,
      priceRef: (yearly ? ref?.yearlyRef : ref?.monthlyRef) ?? null,
    });
  };
  recurring(totals.plan, "plan", `${pathName(path)} plan`);
  for (const a of totals.addons) {
    recurring(a, "addon", addonName(a.key, input.addonNames));
  }

  // Intake extras: one-time, charged in full today under both build plans.
  for (const e of totals.extras) {
    const cents = e.oneTimeCents!;
    if (cents === 0) continue;
    lines.push({
      kind: "extra",
      key: e.key,
      label: extraName(e.key),
      interval: "once",
      unitCents: cents,
      quantity: 1,
      priceRef: refFor(refs, "extra", e.key, path)?.onceRef ?? null,
    });
  }

  // Care Plan (D299, off by default): monthly by nature, so yearly charges its first month
  // once and adds the item after completion.
  if (totals.carePlan) {
    const cents = totals.carePlan.monthlyCents!;
    const care: BillingLine = {
      kind: "care_plan",
      key: "care",
      label: "Care Plan",
      interval: "month",
      unitCents: cents,
      quantity: 1,
      priceRef: refFor(refs, "care_plan", "care", path)?.monthlyRef ?? null,
    };
    if (yearly) {
      lines.push({
        ...care,
        kind: "first_month",
        label: "Care Plan, first month",
        interval: "once",
        priceRef: null,
      });
      deferredMonthly.push(care);
    } else {
      lines.push(care);
    }
  }

  // Pages packs (11-27, D185): monthly by nature, so yearly charges the first month once
  // and adds the item after completion, exactly like the Care Plan.
  const packs = packQty(input.pagePacks);
  if (packs > 0) {
    const pack: BillingLine = {
      kind: "pack",
      key: PAGES_PACK_KEY,
      label: PAGES_PACK_LABEL,
      interval: "month",
      unitCents: input.pagePacks!.monthlyCents!,
      quantity: packs,
      priceRef: refFor(refs, "pack", PAGES_PACK_KEY, path)?.monthlyRef ?? null,
    };
    if (yearly) {
      lines.push({
        ...pack,
        kind: "first_month",
        label: `${PAGES_PACK_LABEL}, first month`,
        interval: "once",
        priceRef: null,
      });
      deferredMonthly.push(pack);
    } else {
      lines.push(pack);
    }
  }

  const dueTodayCents = lines.reduce(
    (sum, l) => sum + l.unitCents * l.quantity,
    0,
  );
  if (dueTodayCents !== orderDueToday(totals, buildPlan, input.pagePacks)) {
    // Never charge a figure the owner was not shown (D-UI-P10-6).
    throw new Error("checkout lines do not add up to the quote");
  }
  return { lines, deferredMonthly, dueTodayCents };
}

// ---------------------------------------------------------------------------------------
// The order summary (10-UI-SPEC "CheckoutSummary"; the CheckoutSummaryView of
// @cds/ui/hub/billing, kept structural here because @cds/db never imports UI).

export type CheckoutSummaryView = {
  pathLabel: string;
  today: { label: string; cents: number }[];
  dueTodayCents: number;
  then: { text: string }[];
  testMode: boolean;
};

export type CheckoutSummaryOptions = {
  buildPlan: BuildPlanChoice;
  /** The fake adapter is active: test-mode tax and secure lines. */
  testMode: boolean;
  addonNames?: Readonly<Record<string, string>>;
  /** "5 more pages" packs added before checkout (11-27). */
  pagePacks?: PagePacksOrder;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const CIVIL = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

type Civil = { year: number; month: number; day: number };

function civilOf(d: Date): Civil {
  const out: Record<string, number> = {};
  for (const p of CIVIL.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year!, month: out.month!, day: out.day! };
}

/** `months` later, the day clamped to the month's last day (31 Jan + 1 = 28/29 Feb). */
function addMonths(c: Civil, months: number): Civil {
  const total = c.year * 12 + (c.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(c.day, last) };
}

function dayMonth(c: Civil): string {
  return `${c.day} ${MONTHS[c.month - 1]}`;
}

function dayMonthYear(c: Civil): string {
  return `${dayMonth(c)} ${c.year}`;
}

/**
 * What the owner sees: the Today lines, the due-today figure (equal to the charge) and the
 * Then lines with dates in the business time zone (choice 4). Throws CheckoutBlocked when
 * anything is unpriced, exactly like the charge.
 */
export function checkoutSummaryView(
  totals: QuoteTotals,
  opts: CheckoutSummaryOptions,
  now: Date,
): CheckoutSummaryView {
  const unpriced = blockedWithPacks(totals, opts.pagePacks);
  if (unpriced.length > 0) throw new CheckoutBlocked(unpriced);
  const yearly = totals.cadence === "yearly";
  const packs = packQty(opts.pagePacks);
  const packsMonthly = packsTodayCents(opts.pagePacks);
  const first = yearly ? "first year" : "first month";
  const pathLabel = pathName(totals.path);
  const today: { label: string; cents: number }[] = [];
  const installments = opts.buildPlan === "installments";
  const each = totals.build.eachCents!;

  if (installments) {
    today.push({
      label: `Build payment 1 of ${totals.build.installments}`,
      cents: each,
    });
  } else {
    today.push({ label: "Website build", cents: totals.build.cents! });
  }
  const recurringToday = (monthly: number): number =>
    yearly ? YEARLY_MONTHS * monthly : monthly;
  today.push({
    label: `${pathLabel} plan, ${first}`,
    cents: recurringToday(totals.plan.monthlyCents!),
  });
  for (const a of totals.addons) {
    if (a.monthlyCents === 0) continue;
    today.push({
      label: `${addonName(a.key, opts.addonNames)}, ${first}`,
      cents: recurringToday(a.monthlyCents!),
    });
  }
  for (const e of totals.extras) {
    if (e.oneTimeCents === 0) continue;
    today.push({ label: extraName(e.key), cents: e.oneTimeCents! });
  }
  const care = totals.carePlan?.monthlyCents ?? 0;
  if (totals.carePlan && care > 0) {
    today.push({ label: "Care Plan, first month", cents: care });
  }
  if (packsMonthly > 0) {
    today.push({
      label: `${PAGES_PACK_LABEL}${packs > 1 ? ` × ${packs}` : ""}, first month`,
      cents: packsMonthly,
    });
  }

  const c = civilOf(now);
  const nextMonth = dayMonth(addMonths(c, 1));
  const lastInstallment = dayMonth(addMonths(c, totals.build.installments - 1));
  const more = totals.build.installments - 1;
  const then: { text: string }[] = [];
  if (!yearly) {
    const monthly = totals.monthlyCents + packsMonthly;
    if (installments && more > 0) {
      then.push({
        text: `${formatCents(monthly + each)} a month from ${nextMonth} to ${lastInstallment}`,
      });
      then.push({ text: `${formatCents(monthly)} a month after that` });
    } else {
      then.push({ text: `${formatCents(monthly)} a month from ${nextMonth}` });
    }
  } else {
    const yearlyCents = totals.recurringFirstChargeCents - care;
    if (installments && more > 0) {
      then.push({
        text: `${formatCents(each)} a month for ${more} more months (build)`,
      });
    }
    if (care > 0) {
      then.push({
        text: `${formatCents(care)} a month from ${nextMonth} (Care Plan)`,
      });
    }
    if (packsMonthly > 0) {
      then.push({
        text: `${formatCents(packsMonthly)} a month from ${nextMonth} (${PAGES_PACK_LABEL})`,
      });
    }
    then.push({
      text: `${formatCents(yearlyCents)} a year from ${dayMonthYear(addMonths(c, 12))}`,
    });
  }

  return {
    pathLabel,
    today,
    dueTodayCents: orderDueToday(totals, opts.buildPlan, opts.pagePacks),
    then,
    testMode: opts.testMode,
  };
}
