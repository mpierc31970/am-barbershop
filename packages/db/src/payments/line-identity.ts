// P10 payments: what a provider price says a subscription item or invoice line is (CR-E01).
// Pure, shared by both adapters so the fake reads kinds the way Stripe does.
//
// Stripe Checkout cannot set subscription-item metadata, and an invoice line for a
// subscription item carries the SUBSCRIPTION's metadata. So for those, the only CDS kind is
// the one on the synced catalog price. The build fee row syncs two prices: the one-time
// "pay in full" price and the monthly installment price. Both carry the row's identity
// (`build_fee` / `base`) on prices synced before CR-E01, so a monthly `build_fee` price is
// read as the installment here; prices synced since carry `installment` themselves.
import type { BillingLine, Interval } from "@cds/core/payments";
import { INSTALLMENT_KEY } from "./accounts";

export type LineIdentity = { kind: BillingLine["kind"]; key: string };

/** The identity of an item or line priced by a catalog price with this metadata. */
export function priceIdentity(
  kind: string,
  key: string,
  interval: Interval,
): LineIdentity {
  if (kind === "build_fee" && interval === "month") {
    return {
      kind: "installment",
      key: key === "" || key === "base" ? INSTALLMENT_KEY : key,
    };
  }
  return { kind: kind as BillingLine["kind"], key };
}
