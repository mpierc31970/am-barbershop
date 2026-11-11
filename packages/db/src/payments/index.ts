// P10 payments barrel (PAY-09). Every module is re-exported here; plans fill modules,
// never this file (10-12 narrowed accounts / invoices to their public names). The Stripe
// adapter is not exported: only factory.ts imports it.
export * from "./factory";
export * from "./ledger";
export * from "./process";
// accounts / invoices: public names only. Their superuser-client helpers and the billing
// context minter stay internal (10-12, invariant 1).
export {
  readBillingAccount,
  parseCheckoutDraft,
  INSTALLMENT_KEY,
  INSTALLMENT_REMAINDER_KEY,
  type BillingAccountView,
  type BillingItemPrice,
  type BillingAccountStatus,
  type CheckoutDraft,
} from "./accounts";
export {
  listBillingInvoices,
  isInstallmentLine,
  type InvoiceMirror,
  type InvoiceKind,
  type InvoiceMirrorStatus,
} from "./invoices";
export * from "./checkout";
export * from "./checkout-lines";
export { entitlements, hasEntitlement, orgPlanPath } from "./entitlements";
export * from "./gate";
export * from "./charges";
// connect: public names only. The row readers and applyAccountState take the superuser
// client and stay internal (10-14, invariant 1).
export {
  startStripeConnect,
  refreshConnectLink,
  readConnectStatus,
  refreshConnectStatus,
  canTakePayments,
  CONNECT_RETURN_PATH,
  CONNECT_REFRESH_PATH,
  PAYMENT_PAUSED_SITE_COPY,
  type ConnectState,
  type ConnectStatusView,
  type CanTakePayments,
} from "./connect";
// lapse: nothing public. Its sync functions run inside the payment handlers with the
// superuser client (10-15, invariant 1); the handlers are the only entry.
export * from "./needs-you";
// work-orders: public names only. applyWorkOrderPayment takes the superuser client and
// runs inside the invoice handler (10-26, invariant 1).
export {
  previewWorkOrder,
  createWorkOrder,
  sendWorkOrder,
  listWorkOrders,
  readWorkOrder,
  acceptWorkOrder,
  declineWorkOrder,
  deliverWorkOrder,
  workOrderSplit,
  workOrderPriceRows,
  workOrderDay,
  WORK_ORDER_EXPIRED_COPY,
  WORK_ORDER_ANSWERED_COPY,
  WORK_ORDER_NOT_ACCEPTED_COPY,
  WORK_ORDER_UNPAID_COPY,
  WORK_ORDER_NO_CARD_COPY,
  type WorkOrderKind,
  type WorkOrderStatus,
  type OwnerWorkOrderStatus,
  type CreateWorkOrderInput,
  type WorkOrderPreview,
  type WorkOrderPriceRow,
  type WorkOrderSummary,
  type WorkOrderView,
  type WorkOrderDeps,
  type DeliverResult,
} from "./work-orders";
export * from "./care-time";
export * from "./decline";
export * from "./fake/index";
// 10-23: the test pages' org-scoped id readers (ids are compared server-side only).
export { testPayCustomerId, testPayAccountId } from "./test-pay";
export * from "./handlers/index";
