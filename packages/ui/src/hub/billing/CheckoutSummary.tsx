"use client";
// CheckoutSummary (10-08; 10-UI-SPEC "CheckoutSummary", the phase's signature element):
// the P6 receipt structure on the checkout rail. Presentational and data-free: every
// figure is a prop computed server-side by priceQuote(); this component adds nothing up
// (D-UI-P10-1), so the owner sees exactly the figure that will be charged (T-10-08-01).
// Fee line per D296, tax line per D262.
import { formatCents } from "@cds/core/pricing";
import { Lock } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CheckoutSummaryView } from "./types";

/** P6 rule: totals are announced politely after 1 s without change. */
export const CHECKOUT_ANNOUNCE_DEBOUNCE_MS = 1000;

export const CHECKOUT_COPY = {
  title: "Your order",
  today: "Today",
  dueToday: "Due today",
  then: "Then",
  taxLine: "Plus sales tax, worked out on the payment page.",
  taxLineTest: "Tax calculated at payment. Test mode charges none.",
  promoLine: "Have a promotion code? Enter it on the payment page.",
  feesLine: "You pay your own payment processor's fees. We take no cut.",
  secureLine:
    "You pay on Stripe's secure page. Support never sees your card number.",
  secureLineTest: "You'll pay on a test page. No card is needed.",
} as const;

export interface CheckoutSummaryProps {
  view: CheckoutSummaryView;
  /** The page's primary: Continue to payment, or its blocked-state slot. */
  primary: ReactNode;
  /** e.g. "Due today now $289. Then $289 a month." Announced debounced. */
  liveText: string;
}

/** 150 ms opacity cross-fade on change; none under reduced motion. */
function Figure({ text, className }: { text: string; className?: string }) {
  return (
    <span
      key={text}
      className={
        "tabular-nums transition-opacity duration-150 starting:opacity-0 " +
        "motion-reduce:transition-none motion-reduce:starting:opacity-100 " +
        (className ?? "")
      }
    >
      {text}
    </span>
  );
}

export function CheckoutSummary({
  view,
  primary,
  liveText,
}: CheckoutSummaryProps) {
  // Live line: never the first render, then the latest text after 1 s of quiet.
  const [announced, setAnnounced] = useState("");
  const last = useRef(liveText);
  useEffect(() => {
    if (liveText === last.current) return;
    const timer = setTimeout(() => {
      last.current = liveText;
      setAnnounced(liveText);
    }, CHECKOUT_ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [liveText]);

  const due = formatCents(view.dueTodayCents);

  return (
    <aside
      aria-labelledby="order-title"
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-base text-hub-ink"
    >
      <div>
        <h2 id="order-title" className="text-xl leading-tight font-semibold">
          {CHECKOUT_COPY.title}
        </h2>
        <p className="text-sm text-hub-ink-muted">{view.pathLabel} website</p>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="checkout-live">
        {announced}
      </p>

      <section aria-labelledby="order-today" className="flex flex-col gap-2">
        <h3 id="order-today" className="text-sm font-semibold">
          {CHECKOUT_COPY.today}
        </h3>
        <ul className="flex flex-col gap-4">
          {view.today.map((line) => (
            <li
              key={line.label}
              className="flex items-baseline justify-between gap-4"
            >
              <span className="min-w-0">
                {line.label}
                <span className="sr-only">, </span>
              </span>
              <Figure
                text={formatCents(line.cents)}
                className="shrink-0 text-right"
              />
            </li>
          ))}
        </ul>
      </section>

      <hr className="border-0 border-t border-dashed border-hub-border-strong" />

      <div className="flex flex-col gap-2">
        <p className="sr-only">{`${CHECKOUT_COPY.dueToday}, ${due}`}</p>
        <div
          aria-hidden="true"
          className="flex items-baseline justify-between gap-4"
        >
          <span className="font-semibold">{CHECKOUT_COPY.dueToday}</span>
          <Figure
            text={due}
            className="text-[1.75rem] leading-tight font-semibold"
          />
        </div>
        <p className="text-sm text-hub-ink-muted">
          {view.testMode ? CHECKOUT_COPY.taxLineTest : CHECKOUT_COPY.taxLine}
        </p>
      </div>

      {view.then.length > 0 ? (
        <section aria-labelledby="order-then" className="flex flex-col gap-2">
          <h3 id="order-then" className="text-sm font-semibold">
            {CHECKOUT_COPY.then}
          </h3>
          <ul className="flex flex-col gap-1">
            {view.then.map((t) => (
              <li key={t.text} className="tabular-nums">
                {t.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-1 text-sm text-hub-ink-muted">
        <p>{CHECKOUT_COPY.promoLine}</p>
        <p>{CHECKOUT_COPY.feesLine}</p>
      </div>

      <div className="flex flex-col gap-2">
        {primary}
        <p className="flex items-start gap-2 text-sm text-hub-ink-muted">
          <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {view.testMode
              ? CHECKOUT_COPY.secureLineTest
              : CHECKOUT_COPY.secureLine}
          </span>
        </p>
      </div>
    </aside>
  );
}
