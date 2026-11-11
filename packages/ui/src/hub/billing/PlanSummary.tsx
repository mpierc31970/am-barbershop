// PlanSummary (10-10; 10-UI-SPEC "Settings › Billing" section 2; BILL-16, D161,
// D-UI-P10-11): "Your plan" as a two-column description list from 640px. Every line is
// pre-formatted server-side from mirrored rows (D82). Update card goes to the hosted
// billing portal (or /test-pay/portal) in the same tab.
import { CreditCard } from "lucide-react";
import { useId } from "react";
import { buttonClasses } from "../Button";
import type { PlanView } from "./types";

export const PLAN_COPY = {
  heading: "Your plan",
  plan: "Plan",
  nextBill: "Next bill",
  card: "Card",
  noCard: "No card on file yet.",
  priceLock: "Price lock",
  priceLocked: (date: string) => `Your prices are locked until ${date}.`,
  updateCard: "Update card",
  cadenceHelp:
    "Want to switch between monthly and yearly billing? Ask CDS Support and we'll change it from your next bill.",
} as const;

export interface PlanSummaryProps {
  view: PlanView;
  updateCardHref: string;
}

const TERM = "text-sm font-semibold text-hub-ink-muted";
const DESC = "text-base text-hub-ink tabular-nums";

export function PlanSummary({ view, updateCardHref }: PlanSummaryProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-[880px] flex-col gap-4 font-hub"
      data-plan-summary=""
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 text-xl leading-tight font-semibold text-hub-ink"
      >
        <CreditCard aria-hidden size={20} strokeWidth={2} />
        {PLAN_COPY.heading}
      </h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{PLAN_COPY.plan}</dt>
          <dd className={DESC}>{view.planLine}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{PLAN_COPY.nextBill}</dt>
          <dd className={DESC}>{view.nextBillLine}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={TERM}>{PLAN_COPY.card}</dt>
          <dd className={`${DESC} flex flex-wrap items-center gap-3`}>
            <span>{view.cardLine ?? PLAN_COPY.noCard}</span>
            <a
              href={updateCardHref}
              className={`${buttonClasses("secondary", "sm")} pointer-coarse:min-h-11`}
            >
              {PLAN_COPY.updateCard}
            </a>
          </dd>
        </div>
        {view.priceLockedUntil ? (
          <div className="flex flex-col gap-1">
            <dt className={TERM}>{PLAN_COPY.priceLock}</dt>
            <dd className={DESC}>
              {PLAN_COPY.priceLocked(view.priceLockedUntil)}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="text-sm text-hub-ink-muted">{PLAN_COPY.cadenceHelp}</p>
    </section>
  );
}
