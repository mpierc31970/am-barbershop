// The UsageMeter view built from @cds/db mediaUsage (07-17; CONT-19, D278, D-UI-P7-9). Shared
// by the Website › Media tab and the /hub/api/media/library route so the USAGE-80-PACKS /
// USAGE-FULL-PACKS / USAGE-FULL-MEMBER sentences (against the org's own allowance, 10-33) come
// only from @cds/db USAGE_COPY (never re-typed).
//
// 10-43 (BILL-13, D222, D225, D285, D-UI-P10-18; T-10-43-01): the purchase affordances are
// decided here, server-side, from the viewer's context:
//   - `canBuy` = `purchases:run` (Owner) and not impersonating. Only then does the Media header
//     swap Upload files for the two pack buttons at 100%. The actions refuse everyone else again.
//   - `storageHref` (Settings › Billing #storage) only for the same viewer: the Billing tab is
//     Owner-only, so Admins, Editors and staff get no link.
//   - At 100% a viewer who can't buy reads USAGE-FULL-MEMBER instead of USAGE-FULL-PACKS.
//
// WR-D05: the pack prices on those buttons come from the price catalog for the org's path
// (D264: the catalog is the only price source; `prices:set` can change them). A size whose
// row is missing or unpriced is not offered.
import { can } from "@cds/core";
import { formatMonthly } from "@cds/core/pricing";
import {
  orgPlanPath,
  readPriceCatalog,
  USAGE_COPY,
  type MediaUsage,
  type MediaUsageRow,
  type OrgContext,
} from "@cds/db";
import type { MediaUsageRowView } from "@cds/ui/staff";

/** Settings › Billing › Media storage (10-29 renders `<div id="storage">`). */
export const STORAGE_HREF = "/hub/settings?tab=billing#storage";

type PackSize = "5gb" | "25gb";

/** Monthly cents of a new pack per size (null: unset, not offered). */
export type PackPrices = Readonly<Record<PackSize, number | null>>;

const NO_PRICES: PackPrices = { "5gb": null, "25gb": null };
const PACK_SIZES: readonly { size: PackSize; gb: number; key: string }[] = [
  { size: "5gb", gb: 5, key: "media-5gb" },
  { size: "25gb", gb: 25, key: "media-25gb" },
];

/**
 * The at-limit pack buttons (10-UI-SPEC "Media storage packs at the limit"), primary first,
 * labelled with the catalog price ("Add 5 GB for $5/mo"). The figures a confirm charges
 * always come from the server preview (packPreviewAction).
 */
export function packOffers(
  prices: PackPrices,
): { size: PackSize; label: string }[] {
  return PACK_SIZES.flatMap(({ size, gb }) => {
    const cents = prices[size];
    return cents === null
      ? []
      : [{ size, label: `Add ${gb} GB for ${formatMonthly(cents)}` }];
  });
}

/** The org's current pack prices from the catalog; none on a failed read. */
export async function readPackPrices(ctx: OrgContext): Promise<PackPrices> {
  try {
    const [catalog, path] = await Promise.all([
      readPriceCatalog(),
      orgPlanPath(ctx),
    ]);
    const cents = (key: string): number | null => {
      const row = catalog.find(
        (r) => r.itemKind === "pack" && r.itemKey === key && r.path === path,
      );
      const v = row?.monthlyCents;
      return typeof v === "number" && Number.isSafeInteger(v) && v >= 0
        ? v
        : null;
    };
    return { "5gb": cents("media-5gb"), "25gb": cents("media-25gb") };
  } catch {
    return NO_PRICES;
  }
}

export type UsageViewData = {
  usedBytes: number;
  allowanceBytes: number;
  ratio: number;
  level: "ok" | "warn" | "full";
  label: string;
  message: string;
  /** The viewer may buy a media pack on the saved card (Owner, not impersonating). */
  canBuy: boolean;
  /** "Add storage" target; null when the viewer can't open Settings › Billing. */
  storageHref: string | null;
  /** The pack buttons shown at 100%; empty unless `canBuy`. */
  offers: { size: "5gb" | "25gb"; label: string }[];
};

/** Owner signed in as themselves (D285: impersonating staff never buy). */
export function canBuyStorage(ctx: OrgContext | null | undefined): boolean {
  if (!ctx || ctx.impersonator) return false;
  return can(ctx, "purchases", "run");
}

export function usageView(
  u: MediaUsage,
  viewer?: OrgContext | null,
  prices: PackPrices = NO_PRICES,
): UsageViewData {
  const canBuy = canBuyStorage(viewer);
  return {
    usedBytes: u.usedBytes,
    allowanceBytes: u.allowanceBytes,
    ratio: u.ratio,
    level: u.level,
    label: u.label,
    message:
      u.level === "warn"
        ? USAGE_COPY.warn(u.usedBytes, u.allowanceBytes)
        : u.level === "full"
          ? canBuy
            ? USAGE_COPY.full(u.allowanceBytes)
            : USAGE_COPY.member
          : "",
    canBuy,
    storageHref: canBuy ? STORAGE_HREF : null,
    offers: canBuy ? packOffers(prices) : [],
  };
}

/**
 * 13-45 (CONT-19 staff half, D221, D225): the staff console's Media usage row from one
 * `listMediaUsage` row (the same call the `media:usage` CLI makes). Sizes per kind, the org's
 * own allowance (2 GB + packs), delivery null until Bunny stats exist.
 */
export function staffMediaUsageRowView(r: MediaUsageRow): MediaUsageRowView {
  return {
    orgId: r.orgId,
    business: r.name,
    imageBytes: r.byKind.image,
    videoBytes: r.byKind.video,
    audioBytes: r.byKind.audio,
    usedBytes: r.usedBytes,
    allowanceBytes: r.allowanceBytes,
    deliveryBytes: r.deliveryBytes,
    level: r.level,
  };
}

/**
 * usageView with the catalog prices, read only when the buttons can show (a buyer at 100%),
 * so an ordinary media page load never reads the catalog.
 */
export async function mediaUsageView(
  u: MediaUsage,
  viewer: OrgContext,
): Promise<UsageViewData> {
  const prices =
    u.level === "full" && canBuyStorage(viewer)
      ? await readPackPrices(viewer)
      : NO_PRICES;
  return usageView(u, viewer, prices);
}
