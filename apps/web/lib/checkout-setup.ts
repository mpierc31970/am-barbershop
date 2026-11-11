// The "Pay and start your build" item on the Setup "What's still needed" panel (10-22;
// AGR-02, BILL-01; CONTEXT A2; 10-UI-SPEC "Setup item"). One pure rule shared by the Setup
// panel (loadStageData) and the sidebar "Set up your site" count (hub layout), the same way
// agreement-setup.ts works, so the two never disagree.
//
// Shown from Send to CDS (fit_review onward) until payment; after payment it is a done row.
// Nothing before Send to CDS, nothing once the site is closed or the state could not be read.
// No server imports (type-only from @cds/db).
import type { CheckoutPageState } from "@cds/db";
import type { AgreementSetupItem } from "./agreement-setup";

export const CHECKOUT_ITEM_TITLE = "Pay and start your build";
export const CHECKOUT_HREF = "/hub/checkout";
export const BILLING_HREF = "/hub/settings?tab=billing";

/** UI-SPEC "Setup item" labels, by state. */
export const CHECKOUT_ITEM_COPY = {
  after_sign: "After you sign your agreement.",
  held: "Checkout opens once Support has checked your details, usually within 2 business days.",
  ready: "Your build fee and first month. About 2 minutes.",
  not_owner: "Only the site owner can pay.",
  open_soon: "Checkout opens soon. We'll email you the moment it does.",
} as const;

export type CheckoutItemState =
  "after_sign" | "held" | "ready" | "not_owner" | "paid" | "open_soon";

export type CheckoutSetupItem = {
  state: CheckoutItemState;
  /** The row's Label (empty for paid: the done row says "Paid on {date}"). */
  label: string;
  /** The Owner, signed in as themselves, with the agreement current and checkout open. */
  canPay: boolean;
  /** "8 Oct" when paid, else null. */
  paidOn: string | null;
} | null;

/** The stages that show the item: from Send to CDS onward. */
export const CHECKOUT_STAGES: readonly string[] = [
  "fit_review",
  "ready_for_build",
  "being_built",
];

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

/** "8 Oct" in `timeZone` (UTC when unset or unknown); null for unreadable input. */
export function paidOnDate(
  iso: string | null,
  timeZone?: string | null,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = parts(timeZone || "UTC");
  } catch {
    p = parts("UTC");
  }
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(p.find((x) => x.type === t)?.value ?? "0");
  const month = MONTHS[get("month") - 1];
  return month ? `${get("day")} ${month}` : null;
}

export type CheckoutSetupInput = {
  stage: string;
  /** The agreement item (agreement-setup.ts); null before ready_for_build or unread. */
  agreement: AgreementSetupItem;
  /** null when the checkout state could not be read: nothing shows. */
  checkout: Pick<
    CheckoutPageState,
    "closed" | "paidAt" | "paymentsOpen"
  > | null;
  role: string;
  impersonating: boolean;
  timeZone?: string | null;
};

/** The checkout item for this org and viewer, or null when nothing shows. */
export function checkoutSetupItem(
  input: CheckoutSetupInput,
): CheckoutSetupItem {
  const { checkout } = input;
  if (!checkout || checkout.closed) return null;
  if (!CHECKOUT_STAGES.includes(input.stage)) return null;
  const item = (state: Exclude<CheckoutItemState, "paid">, canPay = false) => ({
    state,
    label: CHECKOUT_ITEM_COPY[state],
    canPay,
    paidOn: null,
  });
  if (checkout.paidAt) {
    return {
      state: "paid",
      label: "",
      canPay: false,
      paidOn: paidOnDate(checkout.paidAt, input.timeZone),
    };
  }
  if (input.stage === "fit_review") return item("held");
  if (!checkout.paymentsOpen) return item("open_soon");
  if (input.agreement?.state !== "signed") return item("after_sign");
  if (input.role !== "owner" || input.impersonating) return item("not_owner");
  return item("ready", true);
}

/** Every state but paid is a required "still needed" item (the sidebar count). */
export function checkoutCountsAsRequired(item: CheckoutSetupItem): boolean {
  return item !== null && item.state !== "paid";
}
