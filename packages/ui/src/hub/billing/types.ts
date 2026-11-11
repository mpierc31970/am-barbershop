// P10 checkout view types (10-08; 10-UI-SPEC "Checkout"). Amounts are integer cents,
// dates arrive pre-formatted from the server. The components add nothing up: every
// figure here is computed server-side by priceQuote() (D-UI-P10-1).

export interface CheckoutTodayLine {
  label: string;
  cents: number;
}

export interface CheckoutSummaryView {
  /** "Standard" or "Studio"; rendered as "{pathLabel} website". */
  pathLabel: string;
  today: readonly CheckoutTodayLine[];
  dueTodayCents: number;
  /** Later bills with their dates, e.g. "$39 a month from 8 Nov". */
  then: readonly { text: string }[];
  /** Fake adapter: test-mode tax and secure lines. */
  testMode: boolean;
}

export type BuildFeeValue = "full" | "installments";

export interface BuildFeeOption {
  value: BuildFeeValue;
  title: string;
  priceLine: string;
  detail: string;
}

// P10 Settings › Billing read-side view types (10-10; 10-UI-SPEC "Settings › Billing"
// sections 1-3 and 7, "Billing banner"). Labels and dates are pre-formatted server-side
// from mirrored rows (D82). Provider customer/subscription ids never appear here
// (T-10-10-01): only labels and hosted URLs reach the browser.

export type BillingState = "paid_up" | "not_paid" | "past_due" | "paused";

export interface BillingStatusView {
  state: BillingState;
  nextBill: { date: string; cents: number } | null;
  amountDueCents: number | null;
  quoteWaiting: { title: string; href: string } | null;
  /** Set only when the owner is eligible to check out. */
  checkoutHref: string | null;
  updateCardHref: string;
}

export interface PlanView {
  /** "Standard website, billed monthly". */
  planLine: string;
  /** "8 Nov 2026 · $39.00 plus sales tax". */
  nextBillLine: string;
  /** "Visa ending 4242, expires 08/28"; null before a card is on file. */
  cardLine: string | null;
  /** "8 Oct 2028" when price_locked_until is set (D161). */
  priceLockedUntil: string | null;
}

export interface ItemRow {
  /** 11-28: a stable id for rows that carry an action ("pack:pages-5"). */
  key?: string;
  name: string;
  sub: string | null;
  /** "$9/mo", "Included", "Included with Studio". */
  amountLabel: string;
  paused: boolean;
  /** "Ends after 8 Mar 2027." */
  note: string | null;
}

export interface ItemsView {
  rows: readonly ItemRow[];
  monthlyTotalCents: number;
}

export type InvoiceStatus = "paid" | "due" | "unpaid" | "refunded" | "void";

export interface InvoiceRow {
  id: string;
  date: string;
  number: string;
  whatFor: string;
  amountCents: number;
  taxCents: number;
  status: InvoiceStatus;
  /** Hosted invoice page (with PDF), or null when none exists yet. */
  href: string | null;
}

// P10 purchase side (10-13; 10-UI-SPEC sections 4-5 and `ChargeConfirmDialog`). Every
// figure comes from the server's preview of the proration (D-UI-P10-14): the components
// format cents and never add anything up.

export interface ChargePreview {
  /** "Add the Care Plan?" */
  title: string;
  /** One line of what it is. */
  what: string;
  todayCents: number;
  /** "For the rest of October". */
  todayLabel: string;
  /** "$99/mo on your monthly bill from 1 Nov" (rendered after "Then · "). */
  thenText: string;
  /** "Plus sales tax. Charged to Visa ending 4242." */
  cardLine: string;
  /** "Add and pay $41.50", "Add Care Plan, $99/mo", "Add 5 GB". */
  confirmLabel: string;
  /**
   * 11-28: before checkout is paid nothing is charged now; this one line replaces the
   * Today/Then receipt ("It joins your order: $10/mo from checkout.").
   */
  orderNote?: string;
  /**
   * Opaque confirm token (CR-C01): sent back with the confirm so the server charges exactly
   * these figures, once. Never shown.
   */
  token: string;
}

export type ChargeResult =
  | { ok: true; toast: string }
  | {
      ok: false;
      /** price_changed: the figures moved since the preview; `preview` has the new ones. */
      reason: "card_declined" | "price_changed" | "error";
      message: string;
      /** A fresh preview to confirm next (after a decline or a price change). */
      preview?: ChargePreview;
    };

export interface CarePlanEntry {
  date: string;
  minutes: number;
  note: string;
}

export interface CarePlanView {
  on: boolean;
  usedMinutes: number;
  /** "October", in the business time zone. */
  monthLabel: string;
  /** CARE-RESET, with the reset date filled in server-side. */
  resetLabel: string;
  /** Newest first. */
  entries: readonly CarePlanEntry[];
  totalEntries: number;
  /**
   * "Add the Care Plan, $99/mo", from the price catalog on the server (WR-C05); null while
   * the price is unset (no add button).
   */
  addLabel: string | null;
}

export type MediaPackSize = "5gb" | "25gb";

/** One pack size's money labels, formatted on the server (WR-C05). Null = unknown or unset. */
export interface MediaPackPrice {
  /** A new pack, from the price catalog: "$5/mo". Null hides the Add button. */
  add: string | null;
  /** One pack as it is billed now (a price lock keeps the old price): "$5/mo". */
  current: string | null;
  /** The same per month without the unit, for the Remove dialog: "$5". */
  drop: string | null;
}

export interface MediaPacksView {
  /** "1.2 GB". */
  usedLabel: string;
  /** "7 GB". */
  allowanceLabel: string;
  ratio: number;
  packs5: number;
  packs25: number;
  /**
   * PACK-REMOVE-REFUSED per size, filled server-side, when removing one pack of that size
   * would overfill (WR-C06: each size frees a different amount). No entry: removable.
   */
  removeRefusal: Partial<Record<MediaPackSize, string>>;
  /** Money labels per size, never hard-coded in the panel (WR-C05). */
  prices: Readonly<Record<MediaPackSize, MediaPackPrice>>;
}

// P10 Settings › Payments and quotes (10-19; 10-UI-SPEC "Settings › Payments", "Quotes
// from CDS", "Quote page"). The connect view carries only a display name and the last
// characters of the account id, never the full id (T-10-19-03).

export type ConnectState =
  | "not_connected"
  | "setup_unfinished"
  | "connected"
  | "restricted"
  | "disconnected";

export interface ConnectPanelView {
  state: ConnectState;
  /** "Rivera Bakery". */
  displayName: string | null;
  /** Last 4 characters of the account id, "4f2Q". */
  accountSuffix: string | null;
  /** "2 minutes ago". */
  checkedLabel: string | null;
  role: "owner" | "admin";
  impersonating: boolean;
  testMode: boolean;
  /** True while the return from Stripe waits on the account status. */
  checking: boolean;
  /** The "Help me set up Stripe" how-to (D296). */
  helpHref: string;
  /** The tenant's own Stripe dashboard; null when not connected. */
  dashboardHref: string | null;
}

export type WorkOrderStatus =
  | "sent"
  | "accepted"
  | "deposit_paid"
  | "delivered"
  | "paid"
  | "declined"
  | "expired";

export interface WorkOrderSummary {
  id: string;
  title: string;
  status: WorkOrderStatus;
  /** "8 Oct". */
  sentLabel: string;
  totalCents: number;
  href: string;
}

export type QuoteKind =
  "polish" | "custom_block" | "private_addon" | "premium_addon";

export interface QuoteView {
  title: string;
  status: WorkOrderStatus;
  /** "Quote from CDS · Sent 8 Oct 2026 · Valid until 7 Nov 2026". */
  metaLine: string;
  /** Sanitised server-side (P3 sanitizer, T-10-19-01); injected as is. */
  scopeHtml: string;
  kind: QuoteKind;
  /** Mini receipt rows by kind, pre-formatted server-side. */
  priceRows: readonly { label: string; amountLabel: string }[];
  /** What the next payment is: the full price, the deposit, or the balance once delivered. */
  payNowCents: number;
  /** "9 Oct". */
  acceptedLabel: string | null;
  /** "20 Oct". */
  deliveredLabel: string | null;
  /** The date for paid, declined and expired lines ("9 Oct", "7 Nov"). */
  statusDateLabel?: string | null;
  /** Hosted invoice page (or /test-pay/<id>) once an invoice exists. */
  payHref: string | null;
  /** Owner, not impersonating. */
  canAct: boolean;
  impersonating: boolean;
}
