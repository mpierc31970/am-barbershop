// BillingBanner (10-10; 10-UI-SPEC "Billing banner"; BILL-03, D27, D310,
// D-UI-P10-13): Owner-only strip at the top of every hub page except Settings › Billing.
// Not dismissible while the state lasts (no close button); it disappears on the next
// request after payment. Warning tone only (BANNER-PAUSED shares STRIP-PAUSED: "pages are
// still live and nothing was deleted"): a paused account has lost nothing, and the
// copy says so. The action is secondary sm so the page keeps its own primary.
import { formatCentsExact } from "@cds/core/pricing";
import { PauseCircle } from "lucide-react";
import { buttonClasses } from "../Button";
import { InlineAlert } from "../feedback";
import { BILLING_STATUS_COPY } from "./BillingStatusStrip";

export const BANNER_PAST_DUE =
  "Your last card payment didn't go through. Update your card to keep your add-ons on.";

export interface BillingBannerProps {
  state: "past_due" | "paused";
  amountCents: number | null;
  updateCardHref: string;
}

export function BillingBanner({
  state,
  amountCents,
  updateCardHref,
}: BillingBannerProps) {
  const paused = state === "paused";
  return (
    <div data-billing-banner={state}>
      <InlineAlert
        tone="warning"
        icon={paused ? PauseCircle : undefined}
        action={
          <a
            href={updateCardHref}
            className={`${buttonClasses("secondary", "sm")} pointer-coarse:min-h-11`}
          >
            {paused
              ? BILLING_STATUS_COPY.updateCardAndPay
              : BILLING_STATUS_COPY.updateCard}
          </a>
        }
      >
        <span className="tabular-nums">
          {paused
            ? BILLING_STATUS_COPY.paused(
                amountCents === null ? null : formatCentsExact(amountCents),
              )
            : BANNER_PAST_DUE}
        </span>
      </InlineAlert>
    </div>
  );
}
