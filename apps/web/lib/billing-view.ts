// Settings › Billing view builder (10-29; BILL-03, BILL-08, BILL-13, BILL-16, BILL-19; CONTEXT A3,
// A4; D82, D161, D225, D263, D298, D299, D311; 10-UI-SPEC "Settings › Billing").
//
// `buildBillingTabView(ctx, deps)` maps the org's mirrored rows (billing account, invoice mirror,
// work orders, Care Plan minutes, media usage, add-on rows, the price catalog) onto the
// `@cds/ui/hub/billing` view types. It never calls the payment provider: the hub renders billing
// from the mirror only (D82). Every read runs in parallel, each in its own guard, so one failing
// section shows ERR-LOAD in place and the rest still render (10-29 choice 1). Dates are in the
// business time zone; money goes through the core formatters. No provider ids reach a view
// (T-10-29-03): the reads are already `toBrowser`-projected.
// 11-28 (DASH-08, D185): "+5 pages × n" joins What you pay for (key `pack:pages-5`), and
// `pagePacks` carries what Remove one needs: the allowance now, the per-pack drop and the
// PAGES-PACK-REFUSED copy when the counted pages would not fit one pack less.
import type { AddonRegistry } from "@cds/core/addons";
import { pageAllowance, pagesPackRefusedCopy } from "@cds/core/content";
import {
  BUILD_INSTALLMENTS,
  BUSINESS_TIME_ZONE,
  installmentSplit,
  mediaAllowanceBytes,
} from "@cds/core/payments";
import {
  formatCents,
  formatCentsExact,
  formatMonthly,
  formatYearly,
  type CatalogRow,
} from "@cds/core/pricing";
import {
  carePlanUsage,
  formatGb,
  getOrgStage,
  listBillingInvoices,
  listOrgAddons,
  listWorkOrders,
  mediaAllowance,
  mediaUsage,
  packRemoveRefusedCopy,
  pagesUsage,
  readBillingAccount,
  readPriceCatalog,
  INSTALLMENT_KEY,
  INSTALLMENT_REMAINDER_KEY,
  type BillingAccountView,
  type BillingItemPrice,
  type InvoiceMirror,
  type OrgContext,
  type OrgAddonRow,
} from "@cds/db";
import type {
  BillingStatusView,
  CarePlanView,
  InvoiceRow,
  InvoiceStatus,
  ItemRow,
  ItemsView,
  MediaPackPrice,
  MediaPackSize,
  MediaPacksView,
  PlanView,
  WorkOrderSummary,
} from "@cds/ui/hub/billing";
import {
  CARD_HREF,
  CHECKOUT_HREF,
  PAGES_PACK_ROW,
  careResetCopy,
} from "../app/(platform)/hub/settings/billing-copy";
import { CHECKOUT_STAGES } from "./checkout-setup";

/** One section's data, or a failed read (the section shows ERR-LOAD in place). */
export type Section<T> = { ok: true; data: T } | { ok: false };

/** 11-28: the pages pack's Remove one (Settings › Billing, What you pay for). */
export type PagePacksView = {
  qty: number;
  /** Pages the site may have now (10 + 5 x packs). */
  allowance: number;
  /** One pack per month without the unit ("$10"), for the Remove dialog; null if unknown. */
  dropLabel: string | null;
  /** PAGES-PACK-REFUSED when one pack less would not fit the counted pages; null: removable. */
  removeRefusal: string | null;
};

export type BillingTabView = {
  /** Checkout paid and the one subscription exists. */
  paid: boolean;
  status: Section<BillingStatusView>;
  /** Null before the first payment (sections 2-5 are replaced by one line). */
  plan: Section<PlanView> | null;
  items: Section<ItemsView> | null;
  care: Section<CarePlanView> | null;
  media: Section<MediaPacksView> | null;
  /** 11-28: null unless paid with at least one pages pack. */
  pagePacks: Section<PagePacksView> | null;
  quotes: Section<WorkOrderSummary[]>;
  invoices: Section<InvoiceRow[]>;
  /** Owner, signed in as themselves, paid and not paused: purchase buttons show. */
  canBuy: boolean;
  impersonating: boolean;
};

export type BillingViewDeps = {
  registry: Pick<AddonRegistry, "get">;
  now?: Date;
};

const PAUSED_STATUSES: ReadonlySet<string> = new Set(["lapsed", "canceled"]);
const PACK_KEYS = { "5gb": "media-5gb", "25gb": "media-25gb" } as const;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: BUSINESS_TIME_ZONE,
});

/** "8 Nov 2026" in the business time zone; "" when not a date. */
export function billingDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : DATE.format(d);
}

function addMonths(iso: string, n: number): string | null {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

async function attempt<T>(label: string, fn: () => Promise<T>) {
  try {
    return { ok: true as const, data: await fn() };
  } catch (err) {
    console.error(
      `[hub] billing tab: ${label} failed`,
      err instanceof Error ? err.name : typeof err,
    );
    return { ok: false as const };
  }
}

function isPaid(account: BillingAccountView | null): boolean {
  return Boolean(account && account.paidAt);
}

function pathLabel(path: string): string {
  return path === "studio" ? "Studio" : "Standard";
}

function catalogRow(
  catalog: readonly CatalogRow[],
  kind: CatalogRow["itemKind"],
  key: string,
  path: string,
): CatalogRow | undefined {
  return catalog.find(
    (r) => r.itemKind === kind && r.itemKey === key && r.path === path,
  );
}

function monthlyOf(
  catalog: readonly CatalogRow[],
  kind: CatalogRow["itemKind"],
  key: string,
  path: string,
): number | null {
  const v = catalogRow(catalog, kind, key, path)?.monthlyCents;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** The pages pack's catalog key (11-27: `pack/pages-5`, $10 on both paths). */
export const PAGES_PACK_KEY = "pages-5";

/**
 * Remove one pages pack's figures (11-28): refused (PAGES-PACK-REFUSED) when the counted pages
 * are more than the allowance one pack less leaves, the same rule `removePack` re-checks.
 */
export function pagePacksView(
  qty: number,
  used: number,
  dropCents: number | null,
): PagePacksView {
  const left = pageAllowance(Math.max(0, qty - 1));
  return {
    qty,
    allowance: pageAllowance(qty),
    dropLabel: dropCents === null ? null : formatCents(dropCents),
    removeRefusal: used > left ? pagesPackRefusedCopy(used, left) : null,
  };
}

/**
 * "$10/mo" for one new pages pack at the catalog price for the org's path (11-28; WR-C05:
 * never typed in the UI); null while unpriced, so no buy button and no invented number.
 */
export function pagesPackPriceLabel(
  catalog: readonly CatalogRow[],
  path: string,
): string | null {
  const cents = monthlyOf(catalog, "pack", PAGES_PACK_KEY, path);
  return cents === null || cents === 0 ? null : formatMonthly(cents);
}

/**
 * The pack money labels (WR-C05, WR-D05): a new pack at the catalog price for the org's path
 * (what a confirm charges); null while unset, so no Add button and no invented number. The
 * pack as billed now (`current`, `drop`) comes from the subscription mirror when it has the
 * item (WR-D04: a price lock keeps the old amount), else the catalog.
 */
export function packPrices(
  catalog: readonly CatalogRow[] | null,
  path: string,
  account?: Pick<BillingAccountView, "itemPrices">,
): Record<MediaPackSize, MediaPackPrice> {
  const one = (size: MediaPackSize): MediaPackPrice => {
    const cents = catalog
      ? monthlyOf(catalog, "pack", PACK_KEYS[size], path)
      : null;
    const billed = account
      ? billedItem(account, "pack", PACK_KEYS[size])
      : null;
    const now = billed ? billed.unitCents : cents;
    return {
      add: cents === null ? null : formatMonthly(cents),
      current: now === null ? null : formatMonthly(now),
      drop: now === null ? null : formatCents(now),
    };
  };
  return { "5gb": one("5gb"), "25gb": one("25gb") };
}

/** "Add the Care Plan, $99/mo" from the catalog; null while unset (WR-C05). */
export function careAddLabel(
  catalog: readonly CatalogRow[] | null,
  path: string,
): string | null {
  const cents = catalog ? monthlyOf(catalog, "care_plan", "care", path) : null;
  return cents === null ? null : `Add the Care Plan, ${formatMonthly(cents)}`;
}

type PricedRow = ItemRow & {
  /** Cents billed every month (monthly items, and every item on a monthly account). */
  monthlyCents: number;
  /** Cents billed at the yearly renewal (yearly items only). */
  yearlyCents: number;
};

type Money = Pick<PricedRow, "amountLabel" | "monthlyCents" | "yearlyCents">;

const COMING_SOON: Money = {
  amountLabel: "Price coming soon",
  monthlyCents: 0,
  yearlyCents: 0,
};
const INCLUDED: Money = {
  amountLabel: "Included",
  monthlyCents: 0,
  yearlyCents: 0,
};

/**
 * The mirrored price of one subscription item (WR-D04): what the provider bills for it, so a
 * price lock (D161) shows the old amount. Null when the mirror does not have the item yet.
 */
export function billedItem(
  account: Pick<BillingAccountView, "itemPrices">,
  kind: string,
  key: string,
): BillingItemPrice | null {
  return (
    (account.itemPrices ?? []).find(
      (p) => p.kind === kind && p.key === key && p.interval !== "once",
    ) ?? null
  );
}

/**
 * The one subscription made legible (BILL-16). Amounts come from the subscription mirror
 * (`itemPrices`, WR-D04: the price each item is billed at, so a locked owner sees what they
 * pay) and fall back to the catalog for an item the mirror does not have yet. An unpriced
 * item reads "Price coming soon", never "Included" (never an invented number).
 */
export function itemRows(
  account: BillingAccountView,
  addons: readonly OrgAddonRow[],
  catalog: readonly CatalogRow[],
  path: string,
  registry: Pick<AddonRegistry, "get">,
): PricedRow[] {
  const yearly = account.cadence === "yearly";
  /** A plan or add-on: billed on the account's cadence. */
  const flat = (
    kind: string,
    key: string,
    catalogCents: number | null,
  ): Money => {
    const m = billedItem(account, kind, key);
    if (m) {
      const cents = m.unitCents * Math.max(1, m.quantity);
      if (cents === 0) return INCLUDED;
      return m.interval === "year"
        ? {
            amountLabel: formatYearly(cents),
            monthlyCents: 0,
            yearlyCents: cents,
          }
        : {
            amountLabel: formatMonthly(cents),
            monthlyCents: cents,
            yearlyCents: 0,
          };
    }
    if (catalogCents === null) return COMING_SOON;
    if (catalogCents === 0) return INCLUDED;
    return yearly
      ? {
          amountLabel: formatYearly(catalogCents * 10),
          monthlyCents: 0,
          yearlyCents: catalogCents * 10,
        }
      : {
          amountLabel: formatMonthly(catalogCents),
          monthlyCents: catalogCents,
          yearlyCents: 0,
        };
  };
  /** Packs and the Care Plan: always monthly (D263). */
  const monthly = (
    kind: string,
    key: string,
    catalogCents: number | null,
    qty = 1,
  ): Money => {
    const m = billedItem(account, kind, key);
    const unit = m ? m.unitCents : catalogCents;
    if (unit === null) return COMING_SOON;
    return {
      amountLabel: formatMonthly(unit * qty),
      monthlyCents: unit * qty,
      yearlyCents: 0,
    };
  };

  const rows: PricedRow[] = [];
  rows.push({
    name: `${pathLabel(path)} plan`,
    sub: "Hosting, support and 10 pages",
    paused: false,
    note: null,
    ...flat("plan", "base", monthlyOf(catalog, "plan", "base", path)),
  });

  const shown = addons.filter(
    (a) =>
      a.status === "active" ||
      (a.status === "disabled" && a.disabled_reason === "billing_lapse"),
  );
  const ordered = [...shown].sort((a, b) => {
    const ma = registry.get(a.addon);
    const mb = registry.get(b.addon);
    return (
      (ma?.order ?? 0) - (mb?.order ?? 0) || a.addon.localeCompare(b.addon)
    );
  });
  for (const a of ordered) {
    const m = registry.get(a.addon);
    if (!m) continue;
    const cents = monthlyOf(catalog, "addon", a.addon, path);
    const money = flat("addon", a.addon, cents);
    rows.push({
      name: m.name,
      sub: null,
      paused: a.status === "disabled",
      note: null,
      ...money,
      amountLabel:
        cents === 0 &&
        path === "studio" &&
        a.addon === "builder-pro" &&
        money.amountLabel === "Included"
          ? "Included with Studio"
          : money.amountLabel,
    });
  }

  for (const [size, key] of Object.entries(PACK_KEYS)) {
    const qty = size === "5gb" ? account.media5gbQty : account.media25gbQty;
    if (qty <= 0) continue;
    rows.push({
      name: `+${size === "5gb" ? "5" : "25"} GB storage × ${qty}`,
      sub: null,
      paused: false,
      note: null,
      ...monthly("pack", key, monthlyOf(catalog, "pack", key, path), qty),
    });
  }

  // 11-28: "+5 pages × n" (D185), monthly like every pack.
  const pages5 = account.pages5Qty ?? 0;
  if (pages5 > 0) {
    rows.push({
      key: PAGES_PACK_ROW,
      name: `+5 pages × ${pages5}`,
      sub: null,
      paused: false,
      note: null,
      ...monthly(
        "pack",
        PAGES_PACK_KEY,
        monthlyOf(catalog, "pack", PAGES_PACK_KEY, path),
        pages5,
      ),
    });
  }

  if (account.buildPlan === "installments") {
    const left = BUILD_INSTALLMENTS - account.installmentsPaid;
    const build = catalogRow(catalog, "build_fee", "base", path)?.oneTimeCents;
    const next = account.installmentsPaid + 1;
    // The mirrored installment item is what is billed (a lock keeps the checkout's price).
    const billed =
      next === BUILD_INSTALLMENTS
        ? (billedItem(account, "build_fee", INSTALLMENT_REMAINDER_KEY) ??
          billedItem(account, "build_fee", INSTALLMENT_KEY))
        : billedItem(account, "build_fee", INSTALLMENT_KEY);
    let cents: number | null = billed ? billed.unitCents : null;
    if (cents === null && typeof build === "number" && build > 0) {
      const { eachCents, lastCents } = installmentSplit(build);
      cents = next === BUILD_INSTALLMENTS ? lastCents : eachCents;
    }
    if (left > 0 && cents !== null && cents > 0) {
      const end = account.currentPeriodEnd
        ? addMonths(account.currentPeriodEnd, left - 1)
        : null;
      rows.push({
        name: `Website build, payment ${next} of ${BUILD_INSTALLMENTS}`,
        sub: null,
        paused: false,
        note: end ? `Ends after ${billingDate(end)}.` : null,
        amountLabel: formatMonthly(cents),
        monthlyCents: cents,
        yearlyCents: 0,
      });
    }
  }

  if (account.carePlan) {
    rows.push({
      name: "Care Plan",
      sub: "1 hour of changes a month",
      paused: false,
      note: null,
      ...monthly(
        "care_plan",
        "care",
        monthlyOf(catalog, "care_plan", "care", path),
      ),
    });
  }
  return rows;
}

function stripState(
  account: BillingAccountView | null,
): BillingStatusView["state"] {
  if (!isPaid(account)) return "not_paid";
  if (account!.status === "past_due") return "past_due";
  if (PAUSED_STATUSES.has(account!.status)) return "paused";
  return "paid_up";
}

/**
 * What the next bill is: the monthly lines, plus (yearly cadence, WR-D04) the yearly renewal
 * of the flat items, so packs, the Care Plan and installments are never left out.
 */
function nextBillCents(
  account: BillingAccountView,
  rows: readonly PricedRow[] | null,
): number | null {
  if (!rows) return null;
  const monthly = rows.reduce((s, r) => s + r.monthlyCents, 0);
  if (account.cadence !== "yearly") return monthly;
  return monthly + rows.reduce((s, r) => s + r.yearlyCents, 0);
}

function cardLine(account: BillingAccountView): string | null {
  if (account.cardLast4 === "") return null;
  const brand = account.cardBrand.trim();
  const name = brand === "" ? "Card" : brand[0]!.toUpperCase() + brand.slice(1);
  const exp = account.cardExp.trim();
  return exp === ""
    ? `${name} ending ${account.cardLast4}`
    : `${name} ending ${account.cardLast4}, expires ${exp}`;
}

const INVOICE_STATUS: Record<InvoiceMirror["status"], InvoiceStatus> = {
  paid: "paid",
  open: "due",
  draft: "due",
  uncollectible: "unpaid",
  refunded: "refunded",
  void: "void",
};

const WHAT_FOR: Record<InvoiceMirror["kind"], string> = {
  checkout: "Website build and first month",
  renewal: "Monthly plan",
  change: "Change to your plan",
  one_off: "One-off charge",
  work_order: "Quote from Support",
};

/** Invoice rows newest first; drafts are not shown (not yet an invoice to the owner). */
export function invoiceRows(list: readonly InvoiceMirror[]): InvoiceRow[] {
  return [...list]
    .filter((i) => i.status !== "draft")
    .sort((a, b) =>
      a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0,
    )
    .map((i) => ({
      id: i.id,
      date: billingDate(i.issuedAt),
      number: i.number,
      whatFor: i.description.trim() || WHAT_FOR[i.kind],
      amountCents: i.amountCents,
      taxCents: i.taxCents,
      status: INVOICE_STATUS[i.status],
      href: i.hostedUrl ?? i.pdfUrl,
    }));
}

/**
 * PACK-REMOVE-REFUSED per pack size, when removing one pack of that size would leave less
 * than the media in use (10-29 choice 2; WR-C06: a 25 GB and a 5 GB removal free different
 * amounts, so each size is judged on its own, with the arithmetic `removePack` re-checks
 * under the lock). Sizes the org holds none of, or may remove, have no entry.
 */
export function packRemoveRefusal(
  usedBytes: number,
  packs5: number,
  packs25: number,
): Partial<Record<MediaPackSize, string>> {
  const out: Partial<Record<MediaPackSize, string>> = {};
  if (packs5 > 0) {
    const left = mediaAllowanceBytes(packs5 - 1, packs25);
    if (usedBytes > left) out["5gb"] = packRemoveRefusedCopy(usedBytes, left);
  }
  if (packs25 > 0) {
    const left = mediaAllowanceBytes(packs5, packs25 - 1);
    if (usedBytes > left) out["25gb"] = packRemoveRefusedCopy(usedBytes, left);
  }
  return out;
}

/** Every Billing section's view for the owner (Settings › Billing). */
export async function buildBillingTabView(
  ctx: OrgContext,
  deps: BillingViewDeps,
): Promise<BillingTabView> {
  const [
    account,
    invoices,
    quotes,
    care,
    usage,
    allowance,
    addons,
    catalog,
    org,
  ] = await Promise.all([
    attempt("account", () => readBillingAccount(ctx)),
    attempt("invoices", () => listBillingInvoices(ctx)),
    attempt("quotes", () => listWorkOrders(ctx)),
    attempt("care", () => carePlanUsage(ctx)),
    attempt("media usage", () => mediaUsage(ctx)),
    attempt("media allowance", () => mediaAllowance(ctx)),
    attempt("add-ons", () => listOrgAddons(ctx)),
    attempt("catalog", () => readPriceCatalog()),
    attempt("org", () => getOrgStage(ctx)),
  ]);
  const acctPages = account.ok ? (account.data?.pages5Qty ?? 0) : 0;
  // 11-28: the counted pages, only when a pages pack could be removed.
  const pageUse =
    isPaid(account.ok ? account.data : null) && acctPages > 0
      ? await attempt("pages usage", () => pagesUsage(ctx))
      : null;

  const acct = account.ok ? account.data : null;
  const paid = isPaid(acct);
  const impersonating = Boolean(ctx.impersonator);
  const state = stripState(acct);
  const path = org.ok ? org.data.path : "";

  const rows =
    paid && addons.ok && catalog.ok && org.ok
      ? itemRows(acct!, addons.data, catalog.data, path, deps.registry)
      : null;

  const quoteList: WorkOrderSummary[] = quotes.ok
    ? (quotes.data as WorkOrderSummary[])
    : [];
  const waiting = quoteList.find((q) => q.status === "sent") ?? null;

  let status: Section<BillingStatusView>;
  if (!account.ok) {
    status = { ok: false };
  } else {
    const next = paid ? nextBillCents(acct!, rows) : null;
    const eligible =
      !paid &&
      ctx.role === "owner" &&
      !impersonating &&
      org.ok &&
      CHECKOUT_STAGES.includes(org.data.stage);
    status = {
      ok: true,
      data: {
        state,
        nextBill:
          paid && next !== null && acct!.currentPeriodEnd
            ? { date: billingDate(acct!.currentPeriodEnd), cents: next }
            : null,
        amountDueCents:
          state === "past_due" || state === "paused"
            ? acct!.amountDueCents
            : null,
        quoteWaiting: waiting
          ? { title: waiting.title, href: waiting.href }
          : null,
        checkoutHref: eligible ? CHECKOUT_HREF : null,
        updateCardHref: CARD_HREF,
      },
    };
  }

  let plan: Section<PlanView> | null = null;
  let items: Section<ItemsView> | null = null;
  let carePanel: Section<CarePlanView> | null = null;
  let media: Section<MediaPacksView> | null = null;
  let pagePacks: Section<PagePacksView> | null = null;
  if (paid) {
    const a = acct!;
    const next = nextBillCents(a, rows);
    const renews = billingDate(a.currentPeriodEnd);
    plan = org.ok
      ? {
          ok: true,
          data: {
            planLine:
              a.cadence === "yearly"
                ? `${pathLabel(path)} website, billed yearly${renews ? `, renews ${renews}` : ""}`
                : `${pathLabel(path)} website, billed monthly`,
            nextBillLine:
              renews && next !== null
                ? `${renews} · ${formatCentsExact(next)} plus sales tax`
                : "Shows after your first monthly bill.",
            cardLine: cardLine(a),
            priceLockedUntil: a.priceLockedUntil
              ? billingDate(a.priceLockedUntil) || null
              : null,
          },
        }
      : { ok: false };
    items = rows
      ? {
          ok: true,
          data: {
            rows: rows.map((r): ItemRow => ({
              ...(r.key ? { key: r.key } : {}),
              name: r.name,
              sub: r.sub,
              amountLabel: r.amountLabel,
              paused: r.paused,
              note: r.note,
            })),
            monthlyTotalCents: rows.reduce((s, r) => s + r.monthlyCents, 0),
          },
        }
      : { ok: false };
    carePanel = care.ok
      ? {
          ok: true,
          data: {
            on: care.data.on,
            usedMinutes: care.data.usedMinutes,
            monthLabel: care.data.monthLabel,
            resetLabel: careResetCopy(care.data.resetLabel),
            entries: care.data.entries,
            totalEntries: care.data.totalEntries,
            addLabel: careAddLabel(catalog.ok ? catalog.data : null, path),
          },
        }
      : { ok: false };
    media =
      usage.ok && allowance.ok
        ? {
            ok: true,
            data: {
              usedLabel: formatGb(usage.data.usedBytes),
              allowanceLabel: formatGb(allowance.data),
              ratio:
                allowance.data > 0 ? usage.data.usedBytes / allowance.data : 1,
              packs5: a.media5gbQty,
              packs25: a.media25gbQty,
              removeRefusal: packRemoveRefusal(
                usage.data.usedBytes,
                a.media5gbQty,
                a.media25gbQty,
              ),
              prices: packPrices(catalog.ok ? catalog.data : null, path, a),
            },
          }
        : { ok: false };
    if (pageUse) {
      const billed = billedItem(a, "pack", PAGES_PACK_KEY);
      const drop = billed
        ? billed.unitCents
        : catalog.ok
          ? monthlyOf(catalog.data, "pack", PAGES_PACK_KEY, path)
          : null;
      pagePacks = pageUse.ok
        ? {
            ok: true,
            data: pagePacksView(acctPages, pageUse.data.used, drop),
          }
        : { ok: false };
    }
  }

  return {
    paid,
    status,
    plan,
    items,
    care: carePanel,
    media,
    pagePacks,
    quotes: quotes.ok ? { ok: true, data: quoteList } : { ok: false },
    invoices: invoices.ok
      ? { ok: true, data: invoiceRows(invoices.data) }
      : { ok: false },
    canBuy:
      paid &&
      ctx.role === "owner" &&
      !impersonating &&
      !PAUSED_STATUSES.has(acct!.status),
    impersonating,
  };
}
