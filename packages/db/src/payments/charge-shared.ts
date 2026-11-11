// P10 payments: what every saved-card charge shares (10-20; BILL-12, BILL-13, BILL-16,
// BILL-19; CONTEXT A3, A4; D186, D225, D263, D299, D-UI-P10-14).
//
// The real BillingGate (gate.ts) and the pack / Care Plan charges (charges.ts) read the same
// state: the org's billing account, its path, `launched_at`, and the catalog price plus its
// provider ref. Internal: these helpers take the superuser client and are NOT re-exported
// from the payments barrel (invariant 1). gate.ts / charges.ts hold the public names.
import {
  BUSINESS_TIME_ZONE,
  type BillingLine,
  type ChangePreview,
} from "@cds/core/payments";
import type { CatalogItemKind } from "@cds/core/pricing";
import type PocketBase from "pocketbase";
import { readCatalogBillingRefs, readPriceCatalog } from "../catalog";
import { billingAccountByOrg, type BillingAccount } from "./accounts";

/** CONTEXT A3 locked copy (UI-SPEC ERR-CARD). */
export const CARD_DECLINED_COPY =
  "Your card was declined. Update it in Settings › Billing.";
/** UI-SPEC PAUSED-NO-ADD: nothing new is added while the account is lapsed. */
export const PAUSED_NO_ADD_COPY =
  "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.";
/** UI-SPEC UNPRICED-ADDON (D264: never an invented number). */
export const UNPRICED_ADDON_COPY =
  "We're finalising this price. You'll be able to add it soon.";
/** Packs and the Care Plan go on the order at checkout until the site is paid for. */
export const NOT_PAID_COPY =
  "Finish checkout first. You can add this to your order there.";

/** Yearly billing charges 10 months for 12 (D180, D314), the priceQuote rule. */
export const YEARLY_MONTHS = 10;

/**
 * Card is declined / needs action / account paused / the figure moved since the preview
 * (CR-C01: re-preview and confirm again) / anything else refused.
 */
export type ChargeFailReason =
  "card_declined" | "paused" | "price_changed" | "refused";

/** Server figures for the confirm dialog (D-UI-P10-14). Integer cents throughout. */
export type ChargePreviewData = {
  /** Charged today: setup + proration. */
  todayCents: number;
  /** $25 add-on setup after launch (D186); 0 otherwise. */
  setupCents: number;
  /** The prorated part of today's charge. */
  prorationCents: number;
  /** The item's price per `interval` from the next bill. */
  thenCents: number;
  interval: "month" | "year";
  /** "1 Nov": when the "then" figure starts (business time zone). */
  periodEndLabel: string;
  /** "Visa ending 4242", or null when no card is on file yet. */
  cardLine: string | null;
  beforeCheckout: boolean;
  beforeLaunch: boolean;
  /**
   * The confirm token (CR-C01, charge-token.ts): sent back with the confirm so the charge is
   * bound to these figures and a retry cannot charge twice. Opaque to the browser.
   */
  token: string;
};

/** The figures before the token is attached. */
export type ChargeFigures = Omit<ChargePreviewData, "token">;

export type ChargeState = {
  account: BillingAccount | null;
  path: string;
  launchedAt: string | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The org's account, path and launch time, read with the caller's superuser client. */
export async function loadChargeState(
  pb: PocketBase,
  orgId: string,
): Promise<ChargeState> {
  const [account, org] = await Promise.all([
    billingAccountByOrg(pb, orgId),
    pb
      .collection("organizations")
      .getOne(orgId, { fields: "path,launched_at" }),
  ]);
  const launched = str(org.launched_at);
  return { account, path: str(org.path), launchedAt: launched || null };
}

/** True until checkout has been paid and the one subscription exists. */
export function isBeforeCheckout(account: BillingAccount | null): boolean {
  return !account || account.paidAt === null || account.subscriptionId === "";
}

export type PricedItem = {
  /** Monthly cents for recurring kinds, one-time cents for `setup_fee`. */
  cents: number;
  monthlyRef: string | null;
  yearlyRef: string | null;
  onceRef: string | null;
};

/** The priced, active catalog row for (kind, key, path); null when missing or unpriced. */
export async function pricedItem(
  kind: CatalogItemKind,
  key: string,
  path: string,
): Promise<PricedItem | null> {
  const [rows, refs] = await Promise.all([
    readPriceCatalog(),
    readCatalogBillingRefs(),
  ]);
  const row = rows.find(
    (r) => r.itemKind === kind && r.itemKey === key && r.path === path,
  );
  if (!row) return null;
  const cents = kind === "setup_fee" ? row.oneTimeCents : row.monthlyCents;
  if (cents === null) return null;
  const ref = refs.find(
    (r) => r.kind === kind && r.key === key && r.path === path,
  );
  return {
    cents,
    monthlyRef: ref?.monthlyRef ?? null,
    yearlyRef: ref?.yearlyRef ?? null,
    onceRef: ref?.onceRef ?? null,
  };
}

/** A monthly recurring line (packs and the Care Plan are always monthly, D263). */
export function monthlyLine(
  kind: "pack" | "care_plan",
  key: string,
  label: string,
  item: PricedItem,
): BillingLine {
  return {
    kind,
    key,
    label,
    interval: "month",
    unitCents: item.cents,
    quantity: 1,
    priceRef: item.monthlyRef,
  };
}

/** "Visa ending 4242", or null without a card on file. */
export function cardLineOf(account: BillingAccount | null): string | null {
  if (!account || account.cardLast4 === "") return null;
  const brand = account.cardBrand.trim();
  const name = brand === "" ? "Card" : brand[0]!.toUpperCase() + brand.slice(1);
  return `${name} ending ${account.cardLast4}`;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

/** "1 Nov" for an ISO instant; "" when it is not a date. */
export function periodEndLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY_MONTH.format(d);
}

/** A preview with nothing due today (before checkout, $0 items). */
export function freePreview(
  account: BillingAccount | null,
  launchedAt: string | null,
  thenCents: number,
  interval: "month" | "year",
): ChargeFigures {
  return {
    todayCents: 0,
    setupCents: 0,
    prorationCents: 0,
    thenCents,
    interval,
    periodEndLabel: periodEndLabel(account?.currentPeriodEnd ?? null),
    cardLine: cardLineOf(account),
    beforeCheckout: isBeforeCheckout(account),
    beforeLaunch: launchedAt === null,
  };
}

/** Map the provider's preview onto the dialog figures. */
export function previewData(
  p: ChangePreview,
  account: BillingAccount,
  launchedAt: string | null,
  setupCents: number,
  thenCents: number,
  interval: "month" | "year",
): ChargeFigures {
  return {
    todayCents: p.todayCents,
    setupCents,
    prorationCents: Math.max(0, p.todayCents - setupCents),
    thenCents,
    interval,
    periodEndLabel: periodEndLabel(p.periodEnd),
    cardLine: cardLineOf(account),
    beforeCheckout: false,
    beforeLaunch: launchedAt === null,
  };
}
