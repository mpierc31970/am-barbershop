// BillingStatusStrip (10-10; 10-UI-SPEC "Settings › Billing" section 1, copy table; D27,
// D-UI-P10-12): the first thing on the Billing tab. One InlineAlert for the billing state,
// plus a second info strip when CDS sent a quote. Past due and paused are warning, never
// danger: the owner reads what happened, what still works, and the one fix. Data-free:
// every figure arrives as a prop from mirrored rows (D82).
import { formatCentsExact } from "@cds/core/pricing";
import { PauseCircle } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import type { BillingStatusView } from "./types";

export const BILLING_STATUS_COPY = {
  ok: (date: string, amount: string) =>
    `You're all paid up. Next bill ${date}, ${amount}.`,
  okNoBill: "You're all paid up.",
  notPaid:
    "You haven't checked out yet. Your plan and invoices show here after you pay.",
  pastDue: (amount: string | null) =>
    `Your last payment${amount ? ` of ${amount}` : ""} didn't go through. ` +
    "Your site and add-ons are still on while Stripe tries again. " +
    "Update your card to fix it now.",
  paused: (amount: string | null) =>
    "Your add-ons are paused because payment stopped. Your site's pages are still live " +
    "and nothing was deleted. " +
    (amount
      ? `Pay ${amount} to turn everything back on.`
      : "Pay what's due to turn everything back on."),
  quote: (title: string) => `CDS sent you a quote: ${title}.`,
  goToCheckout: "Go to checkout",
  updateCard: "Update card",
  updateCardAndPay: "Update card and pay",
  reviewQuote: "Review quote",
} as const;

function ActionLink({
  href,
  primary,
  children,
}: {
  href: string;
  primary: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`${buttonClasses(primary ? "primary" : "secondary", "sm")} pointer-coarse:min-h-11`}
    >
      {children}
    </a>
  );
}

export interface BillingStatusStripProps {
  view: BillingStatusView;
}

export function BillingStatusStrip({ view }: BillingStatusStripProps) {
  const due =
    view.amountDueCents === null ? null : formatCentsExact(view.amountDueCents);
  let strip: ReactNode;
  switch (view.state) {
    case "paid_up":
      strip = (
        <InlineAlert tone="success">
          <span className="tabular-nums">
            {view.nextBill
              ? BILLING_STATUS_COPY.ok(
                  view.nextBill.date,
                  formatCentsExact(view.nextBill.cents),
                )
              : BILLING_STATUS_COPY.okNoBill}
          </span>
        </InlineAlert>
      );
      break;
    case "not_paid":
      strip = (
        <InlineAlert
          tone="info"
          action={
            view.checkoutHref ? (
              <ActionLink href={view.checkoutHref} primary={false}>
                {BILLING_STATUS_COPY.goToCheckout}
              </ActionLink>
            ) : undefined
          }
        >
          {BILLING_STATUS_COPY.notPaid}
        </InlineAlert>
      );
      break;
    case "past_due":
      strip = (
        <InlineAlert
          tone="warning"
          action={
            <ActionLink href={view.updateCardHref} primary>
              {BILLING_STATUS_COPY.updateCard}
            </ActionLink>
          }
        >
          <span className="tabular-nums">
            {BILLING_STATUS_COPY.pastDue(due)}
          </span>
        </InlineAlert>
      );
      break;
    case "paused":
      strip = (
        <InlineAlert
          tone="warning"
          icon={PauseCircle}
          action={
            <ActionLink href={view.updateCardHref} primary>
              {BILLING_STATUS_COPY.updateCardAndPay}
            </ActionLink>
          }
        >
          <span className="tabular-nums">
            {BILLING_STATUS_COPY.paused(due)}
          </span>
        </InlineAlert>
      );
      break;
  }
  return (
    <div className="flex flex-col gap-4" data-billing-status={view.state}>
      {strip}
      {view.quoteWaiting ? (
        <InlineAlert
          tone="info"
          action={
            <ActionLink href={view.quoteWaiting.href} primary={false}>
              {BILLING_STATUS_COPY.reviewQuote}
            </ActionLink>
          }
        >
          {BILLING_STATUS_COPY.quote(view.quoteWaiting.title)}
        </InlineAlert>
      ) : null}
    </div>
  );
}
