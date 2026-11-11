// @cds/ui/hub/billing: P10 billing components (10-08; 10-UI-SPEC). Controlled and
// data-free; figures arrive as props from server code that uses priceQuote or mirrored
// rows. Later P10 plans add their components here. Hub tokens only (--hub-*).
export {
  CheckoutSummary,
  CHECKOUT_ANNOUNCE_DEBOUNCE_MS,
  CHECKOUT_COPY,
} from "./CheckoutSummary";
export type { CheckoutSummaryProps } from "./CheckoutSummary";
export { BuildFeeChoice, BUILD_FEE_LEGEND } from "./BuildFeeChoice";
export type { BuildFeeChoiceProps } from "./BuildFeeChoice";
export { TestModeStrip, TEST_STRIP_TEXT } from "./TestModeStrip";
export type {
  BuildFeeOption,
  BuildFeeValue,
  CheckoutSummaryView,
  CheckoutTodayLine,
} from "./types";
// 10-10: Settings › Billing read side and the owner billing banner.
export { BillingStatusStrip, BILLING_STATUS_COPY } from "./BillingStatusStrip";
export type { BillingStatusStripProps } from "./BillingStatusStrip";
export { BillingBanner, BANNER_PAST_DUE } from "./BillingBanner";
export type { BillingBannerProps } from "./BillingBanner";
export { PlanSummary, PLAN_COPY } from "./PlanSummary";
export type { PlanSummaryProps } from "./PlanSummary";
export { SubscriptionItemsList, ITEMS_COPY } from "./SubscriptionItemsList";
export type { SubscriptionItemsListProps } from "./SubscriptionItemsList";
export {
  InvoiceTable,
  INVOICE_COPY,
  INVOICE_STATUS_WORD,
} from "./InvoiceTable";
export type { InvoiceTableProps } from "./InvoiceTable";
export type {
  BillingState,
  BillingStatusView,
  InvoiceRow,
  InvoiceStatus,
  ItemRow,
  ItemsView,
  PlanView,
} from "./types";
// 10-13: the purchase side. One confirm for every saved-card charge, the Care Plan and
// media packs.
export { ChargeConfirmDialog, CHARGE_COPY } from "./ChargeConfirmDialog";
export type { ChargeConfirmDialogProps } from "./ChargeConfirmDialog";
export { CarePlanPanel, CARE_COPY, CARE_PLAN_MINUTES } from "./CarePlanPanel";
export type { CarePlanPanelProps } from "./CarePlanPanel";
export { MediaPacksPanel, PACKS_COPY } from "./MediaPacksPanel";
// 11-28: the pages pack's Remove one (Settings › Billing) reuses the P10 danger confirm.
export { RemoveConfirmDialog } from "./purchase-dialogs";
export type { RemoveConfirmDialogProps } from "./purchase-dialogs";
export type { MediaPacksPanelProps } from "./MediaPacksPanel";
export type {
  CarePlanEntry,
  CarePlanView,
  ChargePreview,
  ChargeResult,
  MediaPackPrice,
  MediaPackSize,
  MediaPacksView,
} from "./types";
// 10-19: Settings › Payments connect panel and quotes from CDS.
export { StripeConnectPanel, CONNECT_COPY } from "./StripeConnectPanel";
export type { StripeConnectPanelProps } from "./StripeConnectPanel";
export {
  WorkOrderCard,
  QUOTE_STATUS_BADGE,
  QUOTES_EMPTY,
  sortWorkOrders,
} from "./WorkOrderCard";
export type { WorkOrderCardProps } from "./WorkOrderCard";
export { QuoteDetail, QUOTE_COPY } from "./QuoteDetail";
export type { QuoteDetailProps } from "./QuoteDetail";
export type {
  ConnectPanelView,
  ConnectState,
  QuoteKind,
  QuoteView,
  WorkOrderStatus,
  WorkOrderSummary,
} from "./types";
