// Settings › Billing copy and fixed paths (10-29; 10-UI-SPEC "Settings › Billing", Copywriting).
// Pure: shared by the server view builder, the billing Server Actions (a "use server" file may
// export only async functions) and the client BillingPanel (which must not import @cds/db).

/** The Billing tab. */
export const BILLING_TAB = "/hub/settings?tab=billing";
/**
 * "Update card" target: a GET route that 303s to the provider's hosted card page (or the test
 * portal). The panel intercepts the click and uses updateCardAction instead (10-29 choice 4);
 * the route is the no-JS fallback.
 */
export const CARD_HREF = "/hub/settings/billing/card";
/** Manage add-ons link under the items list. */
export const MANAGE_ADDONS_HREF = "/hub/add-ons";
/** Go to checkout (strip, before the first payment, when eligible). */
export const CHECKOUT_HREF = "/hub/checkout";

export const CARD_UPDATED_TOAST = "Card updated.";
/** UI-SPEC ERR-PORTAL. */
export const ERR_PORTAL =
  "We couldn't open the card page just now. Try again in a minute.";
/** Before the first payment, sections 2-5 are replaced by this line. */
export const BEFORE_CHECKOUT_LINE =
  "Your plan, card and invoices show here after checkout.";
/** UI-SPEC CADENCE-HELP (D-UI-P10-11). */
export const CADENCE_HELP =
  "Want to switch between monthly and yearly billing? Ask Support and we'll change it from your next bill.";
export const NOT_OWNER_BILLING = "Only the site owner can change billing.";
export const IMPERSONATING_BILLING =
  "You're viewing as support staff, so billing changes are turned off. Only the owner can change billing.";
/** The preview call failed or was refused without its own copy. */
export const PREVIEW_FAILED =
  "We couldn't get the price just now. Try again in a minute.";
export const BAD_PACK = "Choose a 5 GB or 25 GB pack, or 5 more pages.";
/** CR-C01: a retried confirm found the change already on the plan; nothing was charged. */
export const ALREADY_ADDED =
  "That's already on your plan. Nothing more was charged.";
/** 11-28: the What you pay for row key the pages pack's Remove one attaches to. */
export const PAGES_PACK_ROW = "pack:pages-5";

export const BAD_CARE = "Choose whether to add or remove the Care Plan.";

/** "Resets on 1 Nov. Need more than the hour? …" (CARE-RESET). */
export function careResetCopy(resetLabel: string): string {
  return `Resets on ${resetLabel}. Need more than the hour? Ask Support; extra time is quoted before any work starts.`;
}

/** True for `?card=updated` (string or first of an array). */
export function isCardUpdated(raw: unknown): boolean {
  const v = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return v === "updated";
}
