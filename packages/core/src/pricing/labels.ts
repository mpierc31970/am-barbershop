// Shared public price labels (HUB-05, D264; P15-P5, CONTEXT A2-Q1). Moved verbatim from the
// /start configurator so /start and the CDS hub use one price wording. Every label comes from
// a catalog row: the UI never computes a price. Pure, Edge/browser-safe.
import type { AddonPath } from "../addons/constants";
import { formatCents, formatMonthly } from "./format";
import type { CatalogItemKind, CatalogRow } from "./types";

export const PRICE_SOON = "Price coming soon";

/** One catalog row, or undefined when the catalog has none (or failed to load). */
export function catalogRow(
  catalog: readonly CatalogRow[] | null,
  kind: CatalogItemKind,
  key: string,
  path: AddonPath,
): CatalogRow | undefined {
  return catalog?.find(
    (r) => r.itemKind === kind && r.itemKey === key && r.path === path,
  );
}

/**
 * The price slot of an add-on or extra row: "$9/mo" (monthly kinds), "$300 once"
 * (one-time kinds) or "Price coming soon" (no row, or the row is unpriced).
 */
export function priceLabelFor(row: CatalogRow | null | undefined): string {
  if (!row) return PRICE_SOON;
  if (row.monthlyCents !== null) return formatMonthly(row.monthlyCents);
  if (row.oneTimeCents !== null) return `${formatCents(row.oneTimeCents)} once`;
  return PRICE_SOON;
}

/**
 * A path card's price line: "$1,500 build, then $39 a month". null when the catalog did
 * not load (no line rather than a wrong one); "Price coming soon" when either is unpriced.
 */
export function pathPriceLine(
  catalog: readonly CatalogRow[] | null,
  path: AddonPath,
): string | null {
  if (catalog === null) return null;
  const build = catalogRow(catalog, "build_fee", "base", path)?.oneTimeCents;
  const plan = catalogRow(catalog, "plan", "base", path)?.monthlyCents;
  if (build == null || plan == null) return PRICE_SOON;
  return `${formatCents(build)} build, then ${formatCents(plan)} a month`;
}
