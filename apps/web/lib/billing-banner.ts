// The owner's billing banner and the one-time "add-ons are back on" toast (10-32;
// 10-UI-SPEC "Billing banner", "Paused add-ons"; BILL-03, D27, D310, D-UI-P10-12,
// D-UI-P10-13; T-10-32-01, T-10-32-03).
//
// Owner only (billing items go to Owners, D310); impersonating staff and every other role
// get nothing, so amounts never reach a non-owner. The banner shows on every hub page except
// Settings › Billing (its status strip says it there) and the focused frames (re-accept, the
// declined notice) and the bare draft preview. It is not dismissible: the next request after
// payment reads an active account and the banner is gone. Any read failure is logged and
// renders no banner (the hub never breaks over a hint).
//
// Restored toast (choice 2): shown when the account is active, `restored_at` is within the
// last 7 days and the `cds_restored_seen` cookie differs from it. The client island sets the
// cookie to the same key (restored_at in epoch ms) after showing, so each restore toasts once.
import { readBillingAccount, type OrgContext } from "@cds/db";
import { cache } from "react";
import { CARD_HREF } from "../app/(platform)/hub/settings/billing-copy";
import { bannerSuppressed } from "./billing-banner-path";

export { bannerSuppressed };

export type BillingBannerView = {
  state: "past_due" | "paused";
  amountCents: number;
  updateCardHref: string;
};

/** The cookie the restored-toast island writes after showing (value: restored_at epoch ms). */
export const RESTORED_SEEN_COOKIE = "cds_restored_seen";
/** How long after a restore the toast may still show on the next hub load. */
export const RESTORED_TOAST_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner, signed in as themselves (D310; same audience as billingNeedsYou). */
function isOwner(ctx: OrgContext): boolean {
  return ctx.role === "owner" && !ctx.impersonator;
}

/** One account read per request: the banner and the toast share it. */
const accountFor = cache((ctx: OrgContext) => readBillingAccount(ctx));

/**
 * The banner for this owner on `pathname` (pathname + optional query), or null: not the
 * Owner, a suppressed screen, an account that is not past due or lapsed, or a failed read.
 */
export async function billingBannerView(
  ctx: OrgContext,
  pathname: string,
): Promise<BillingBannerView | null> {
  if (!isOwner(ctx) || bannerSuppressed(pathname)) return null;
  try {
    const account = await accountFor(ctx);
    if (!account) return null;
    const amountCents = Math.max(0, account.amountDueCents);
    if (account.status === "past_due") {
      return { state: "past_due", amountCents, updateCardHref: CARD_HREF };
    }
    if (account.status === "lapsed") {
      return { state: "paused", amountCents, updateCardHref: CARD_HREF };
    }
    return null;
  } catch (err) {
    console.error(
      "[hub] billing banner read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

function parseDate(v: string): Date | null {
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The restore to toast once, as a cookie-safe key (`restored_at` in epoch ms), or null: not the Owner, the account is not active,
 * no restore in the last 7 days, or the cookie already holds this restore (choice 2).
 */
export async function restoredToastAt(
  ctx: OrgContext,
  seenCookie: string | undefined,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isOwner(ctx)) return null;
  try {
    const account = await accountFor(ctx);
    const restoredAt = account?.restoredAt ?? null;
    if (!account || account.status !== "active" || !restoredAt) return null;
    const at = parseDate(restoredAt);
    if (!at) return null;
    const age = now.getTime() - at.getTime();
    if (age < 0 || age > RESTORED_TOAST_DAYS * DAY_MS) return null;
    const key = String(at.getTime());
    return seenCookie === key ? null : key;
  } catch (err) {
    console.error(
      "[hub] restored toast read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}
