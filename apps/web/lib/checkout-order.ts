// The checkout order view (10-22; 10-UI-SPEC "Checkout"; D181, D264, D299, D314,
// D-UI-P10-1, D-UI-P10-5). Pure: turns the server's priced order (`checkoutOrderFor` in
// @cds/db, every figure from priceQuote) into the rows, cards and live text the page shows.
// The client island never adds a price up; it only renders this view and asks the server
// for a new one after each change (10-22 choice 1).
//
// No server imports and no @cds/db import (the browser-boundary scan): the input is typed
// structurally, so the "use client" island can import the view types and the copy from here.
import type { AddonManifest } from "@cds/core/addons";
import { EXTRAS } from "@cds/core/onboarding";
import {
  formatCents,
  formatCentsExact,
  formatMonthly,
  type QuoteTotals,
} from "@cds/core/pricing";
import type { BuildFeeOption, CheckoutSummaryView } from "@cds/ui/hub/billing";

export type CheckoutChoicesView = {
  addons: string[];
  extras: string[];
  carePlan: boolean;
  cadence: "monthly" | "yearly";
  buildPlan: "full" | "installments";
};

/** The priced order as @cds/db returns it (structural copy of `CheckoutOrder`). */
export type PricedOrder = {
  choices: CheckoutChoicesView;
  path: "standard" | "studio";
  totals: QuoteTotals;
  summary: CheckoutSummaryView | null;
  carePlanMonthlyCents: number | null;
};

export type CheckoutRow = {
  key: string;
  kind: "addon" | "extra";
  name: string;
  sub: string;
  /** "$9/mo", "$400 once", "Included", "Price coming soon". */
  amountLabel: string;
  unpriced: boolean;
  /** Paid or unpriced rows; $0 included add-ons cannot be removed. */
  removable: boolean;
};

export type CheckoutOrderView = {
  choices: CheckoutChoicesView;
  plan: { name: string; sub: string; amountLabel: string };
  addonRows: CheckoutRow[];
  extraRows: CheckoutRow[];
  buildOptions: BuildFeeOption[];
  carePlanLabel: string;
  /** null when anything is unpriced: no figure rather than a wrong one. */
  summary: CheckoutSummaryView | null;
  /** Names of the unpriced rows (the primary's reason line). */
  unpricedNames: string[];
  liveText: string;
};

// UI-SPEC copy (Copywriting Contract).
export const CHECKOUT_TITLE = "Pay and start your build";
export const INTRO_CHECKOUT =
  "Check your order, choose how to pay for the build, then pay on a secure payment page. Support starts building your site as soon as payment goes through.";
export const TEST_CHECKOUT =
  "Test mode: no real money moves. You'll see a test payment page instead of Stripe.";
export const CANCELLED_CHECKOUT =
  "You left the payment page, so nothing was charged. Your choices are kept.";
export const UNPRICED_COPY =
  "We're finalising this price; remove it to continue now, or we'll email you when it's set.";
export const MORE_ADDONS =
  "Want more add-ons? Add them from Get add-ons after you pay. There's no setup fee until your site launches.";
export const PRICE_CHANGED =
  "A price changed since you opened this page. We've updated your order; check the new total before you pay.";
export const IMPERSONATING_PAY =
  "You're viewing as support staff, so payment is turned off. Only the owner can pay.";
export const ERR_GATE =
  "Sign your agreement before you buy anything. It takes about 3 minutes.";
export const HELD_CHECKOUT =
  "We're still checking a couple of details about your business, usually within 2 business days. Checkout opens as soon as that's done, and we'll email you.";
export const OPEN_SOON_H = "Checkout opens soon";
export const OPEN_SOON_B =
  "We're finishing our payment setup. Your order is saved, and we'll email you the moment you can pay.";
export const ERR_CHECKOUT =
  "We couldn't open the payment page, and nothing was charged. Try again in a minute. If it keeps happening, contact Support.";
export const ERR_PAY =
  "Your payment didn't go through, so nothing was charged. Try again, or use a different card.";
export const ERR_PRICES = "We couldn't load prices just now.";
export const SLOW_CONFIRM =
  "Your payment is still being confirmed. This can take a few minutes. We'll email your receipt; you can leave this page.";
export const PAID_BODY =
  "Thank you. Support starts building your site now. We'll email you when it's ready for you to review.";
export const CARE_HELPER =
  "1 hour a month of changes made for you by Support. Every plan already includes support.";
export const CADENCE_HELPER =
  "Yearly covers the plan and add-ons. The build fee is the same.";
export const CONTINUE_LABEL = "Continue to payment";
export const PENDING_LABEL = "Opening secure payment…";
export const AGREEMENT_NEXT = "/hub/agreement?next=/hub/checkout";
export const BILLING_TAB = "/hub/settings?tab=billing";

/** NOT-OWNER-PAY with the owner's name when known. */
export function notOwnerPay(ownerName: string | null): string {
  const who = ownerName?.trim() ? ownerName.trim() : "Your site owner";
  return `Only the site owner can pay. ${who} can do it from Set up your site.`;
}

/** The aria-disabled primary's reason line for unpriced rows. */
export function unpricedReason(names: readonly string[]): string {
  const list =
    names.length <= 1
      ? (names[0] ?? "it")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Remove ${list} to continue, or wait until its price is set.`;
}

/** "{Name} removed from your order." (the Undo toast). */
export function removedToast(name: string): string {
  return `${name} removed from your order.`;
}

/** Polite live text: "Due today now $289. Then $289 a month." */
export function liveTextFor(summary: CheckoutSummaryView | null): string {
  if (!summary) return "";
  const then = summary.then[0]?.text;
  const due = `Due today now ${formatCents(summary.dueTodayCents)}.`;
  return then ? `${due} Then ${then}.` : due;
}

/** The Payment received lines (UI-SPEC "Checkout return"). */
export type PaidLines = {
  paidLabel: string;
  nextBillLabel: string;
  receiptLine: string;
};

/** From the org's own mirrored checkout invoice and the paid order (never the session). */
export function paidLines(st: {
  paidCents: number | null;
  taxCents: number | null;
  nextBill: string | null;
  receiptEmail: string;
}): PaidLines {
  return {
    paidLabel:
      st.paidCents === null
        ? "Your invoice will be in Settings › Billing shortly"
        : `${formatCentsExact(st.paidCents)} plus ${formatCentsExact(st.taxCents ?? 0)} tax`,
    nextBillLabel: st.nextBill ?? "See Settings › Billing",
    receiptLine:
      st.receiptEmail === ""
        ? "Emailed to you"
        : `Emailed to ${st.receiptEmail}`,
  };
}

const PLAN_SUB = "Hosting, support and 10 pages";
const COMING_SOON = "Price coming soon";

function extraLabel(key: string): { name: string; sub: string } {
  const e = EXTRAS.find((x) => x.key === key);
  return e ? { name: e.label, sub: e.description } : { name: key, sub: "" };
}

/** Build the page view from the priced order. `manifests` is the registry list (order). */
export function buildOrderView(
  order: PricedOrder,
  manifests: readonly Pick<AddonManifest, "slug" | "name" | "summary">[],
): CheckoutOrderView {
  const { totals, choices } = order;
  const lineOf = new Map(totals.addons.map((l) => [l.key, l]));
  const extraLineOf = new Map(totals.extras.map((l) => [l.key, l]));
  const unpriced = new Set(totals.unpriced);

  // Manifest order for add-ons (stable rows, so Undo puts a row back where it was).
  const ordered = [...manifests.filter((m) => choices.addons.includes(m.slug))];
  for (const slug of choices.addons) {
    if (!ordered.some((m) => m.slug === slug)) {
      ordered.push({ slug, name: slug, summary: "" });
    }
  }
  const addonRows: CheckoutRow[] = ordered.map((m) => {
    const line = lineOf.get(m.slug);
    const cents = line?.monthlyCents ?? null;
    const isUnpriced = cents === null || unpriced.has(m.slug);
    return {
      key: m.slug,
      kind: "addon",
      name: m.name,
      sub: m.summary,
      amountLabel: isUnpriced
        ? COMING_SOON
        : cents === 0
          ? "Included"
          : formatMonthly(cents),
      unpriced: isUnpriced,
      removable: isUnpriced || (cents ?? 0) > 0,
    };
  });

  const extraKeys = [
    ...EXTRAS.map((e) => e.key).filter((k) => choices.extras.includes(k)),
    ...choices.extras.filter((k) => !EXTRAS.some((e) => e.key === k)),
  ];
  const extraRows: CheckoutRow[] = extraKeys.map((key) => {
    const cents = extraLineOf.get(key)?.oneTimeCents ?? null;
    const isUnpriced = cents === null || unpriced.has(key);
    const label = extraLabel(key);
    return {
      key,
      kind: "extra",
      name: label.name,
      sub: label.sub,
      amountLabel: isUnpriced ? COMING_SOON : `${formatCents(cents)} once`,
      unpriced: isUnpriced,
      removable: true,
    };
  });

  const planName = order.path === "studio" ? "Studio plan" : "Standard plan";
  const planCents = totals.plan.monthlyCents;
  const build = totals.build;
  const buildOptions: BuildFeeOption[] = [
    {
      value: "full",
      title: "Pay in full",
      priceLine:
        build.cents === null
          ? COMING_SOON
          : `${formatCents(build.cents)} today`,
      detail: "One payment.",
    },
    {
      value: "installments",
      title: `${build.installments} monthly payments`,
      priceLine:
        build.eachCents === null
          ? COMING_SOON
          : `${build.installments} × ${formatCents(build.eachCents)}`,
      detail:
        "No surcharge. The first is today and the rest come with your monthly bill. If you cancel your plan, the remaining build payments are still owed.",
    },
  ];

  const care = order.carePlanMonthlyCents;
  const unpricedNames = [
    ...(planCents === null ? [planName] : []),
    ...(build.cents === null ? ["Website build"] : []),
    ...addonRows.filter((r) => r.unpriced).map((r) => r.name),
    ...extraRows.filter((r) => r.unpriced).map((r) => r.name),
    ...(choices.carePlan && care === null ? ["Care Plan"] : []),
  ];

  return {
    choices,
    plan: {
      name: planName,
      sub: PLAN_SUB,
      amountLabel: planCents === null ? COMING_SOON : formatMonthly(planCents),
    },
    addonRows,
    extraRows,
    buildOptions,
    carePlanLabel:
      care === null
        ? `Add the Care Plan · ${COMING_SOON}`
        : `Add the Care Plan · ${formatMonthly(care)}`,
    summary: order.summary,
    unpricedNames,
    liveText: liveTextFor(order.summary),
  };
}
