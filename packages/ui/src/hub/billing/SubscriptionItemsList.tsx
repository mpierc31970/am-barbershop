// SubscriptionItemsList (10-10; 10-UI-SPEC "Settings › Billing" section 3; BILL-16,
// BILL-03): "What you pay for", the one subscription made legible. Rows with 1px
// dividers and 16px padding-y: name (600) + sub-line left, amount right (tabular).
// Paused rows carry the paused badge (warning, never danger). The monthly total is a
// prop from the server; this component adds nothing up.
// 11-28: `rowAction` puts a control under a keyed row (the pages pack's Remove one).
import { formatCentsExact } from "@cds/core/pricing";
import { useId, type ReactNode } from "react";
import { Badge } from "../Badge";
import type { ItemsView } from "./types";

export const ITEMS_COPY = {
  heading: "What you pay for",
  paused: "Paused",
  total: (amount: string) => `Monthly total · ${amount} plus sales tax`,
  manage: "Manage add-ons",
} as const;

export interface SubscriptionItemsListProps {
  view: ItemsView;
  manageHref: string;
  /** 11-28: an optional control for a row (rendered under it, full width). */
  rowAction?: (row: ItemsView["rows"][number]) => ReactNode;
}

export function SubscriptionItemsList({
  view,
  manageHref,
  rowAction,
}: SubscriptionItemsListProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-[880px] flex-col gap-4 font-hub"
      data-subscription-items=""
    >
      <h2
        id={headingId}
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        {ITEMS_COPY.heading}
      </h2>
      <ul className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {view.rows.map((row, i) => (
          <li key={`${row.name}-${i}`} className="flex flex-col gap-2 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-hub-ink">
                  {row.name}
                  {row.paused ? (
                    <Badge tone="paused">{ITEMS_COPY.paused}</Badge>
                  ) : null}
                </span>
                {row.sub ? (
                  <span className="text-sm text-hub-ink-muted">{row.sub}</span>
                ) : null}
                {row.note ? (
                  <span className="text-sm text-hub-ink-muted">{row.note}</span>
                ) : null}
              </div>
              <span className="shrink-0 text-base text-hub-ink tabular-nums">
                {row.amountLabel}
              </span>
            </div>
            {rowAction ? rowAction(row) : null}
          </li>
        ))}
        <li className="py-4 text-base font-semibold text-hub-ink tabular-nums">
          {ITEMS_COPY.total(formatCentsExact(view.monthlyTotalCents))}
        </li>
      </ul>
      <p className="text-sm text-hub-ink-muted">
        <a
          href={manageHref}
          className="inline-flex items-center rounded text-hub-accent underline underline-offset-2 pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          {ITEMS_COPY.manage}
        </a>
      </p>
    </section>
  );
}
