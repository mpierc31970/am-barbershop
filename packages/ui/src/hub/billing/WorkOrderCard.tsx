// WorkOrderCard (10-19; 10-UI-SPEC "Settings › Billing" section 6 "Quotes from CDS";
// BILL-20, D297). One quote in the Billing tab list: title + status badge, "Sent 8 Oct ·
// $360" and a Review quote (waiting) or View quote link. sortWorkOrders puts waiting
// quotes first; the list and its empty line are wired in 10-29.
import { formatCents } from "@cds/core/pricing";
import type { BadgeTone } from "../Badge";
import { Badge } from "../Badge";
import type { WorkOrderStatus, WorkOrderSummary } from "./types";

export const QUOTE_STATUS_BADGE: Record<
  WorkOrderStatus,
  { tone: BadgeTone; word: string }
> = {
  sent: { tone: "quote-waiting", word: "Waiting for you" },
  accepted: { tone: "confirmed", word: "Accepted" },
  deposit_paid: { tone: "paid", word: "Deposit paid" },
  delivered: { tone: "done", word: "Delivered" },
  paid: { tone: "paid", word: "Paid" },
  declined: { tone: "void", word: "Declined" },
  expired: { tone: "expired", word: "Expired" },
};

export const QUOTES_EMPTY =
  "No quotes yet. When you ask Support for paid work, the quote shows here for you to accept.";

/** Waiting quotes first; otherwise the server's order is kept. */
export function sortWorkOrders<T extends { status: WorkOrderStatus }>(
  orders: readonly T[],
): T[] {
  return [
    ...orders.filter((o) => o.status === "sent"),
    ...orders.filter((o) => o.status !== "sent"),
  ];
}

export interface WorkOrderCardProps {
  order: WorkOrderSummary;
}

export function WorkOrderCard({ order }: WorkOrderCardProps) {
  const badge = QUOTE_STATUS_BADGE[order.status];
  const waiting = order.status === "sent";
  return (
    <article
      data-work-order={order.id}
      className="flex flex-col gap-2 rounded-lg border border-hub-border bg-hub-surface p-4 font-hub text-hub-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{order.title}</h3>
        <Badge tone={badge.tone}>{badge.word}</Badge>
      </div>
      <p className="text-sm text-hub-ink-muted tabular-nums">
        {`Sent ${order.sentLabel} · ${formatCents(order.totalCents)}`}
      </p>
      <p>
        <a
          href={order.href}
          className="rounded text-sm font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
        >
          {waiting ? "Review quote" : "View quote"}
          <span className="sr-only">{`: ${order.title}`}</span>
        </a>
      </p>
    </article>
  );
}
