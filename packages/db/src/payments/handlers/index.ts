// P10 payments: dispatch table from normalised event type to handler (10-09, PAY-01).
// The per-area maps are filled by 10-12 (checkout, invoice), 10-14 (account) and 10-15
// (subscription); this file only merges them. A type with no handler is recorded "ignored".
import { accountHandlers } from "./account";
import { checkoutHandlers } from "./checkout";
import { invoiceHandlers } from "./invoice";
import { subscriptionHandlers } from "./subscription";
import type { HandlerMap } from "./types";

export type { Handler, HandlerContext, HandlerMap } from "./types";
export {
  accountHandlers,
  checkoutHandlers,
  invoiceHandlers,
  subscriptionHandlers,
};

export const HANDLERS: HandlerMap = {
  ...checkoutHandlers,
  ...invoiceHandlers,
  ...subscriptionHandlers,
  ...accountHandlers,
};
