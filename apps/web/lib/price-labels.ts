// Price catalog display rules for the staff console (13-37 choice 3; STAFF-07, D264, D161).
// The prices:set CLI's kind list, cadence split and item names, so Catalog › Prices and the
// CLI describe a row the same way. Pure; the caller passes the registry's add-on names.
import { EXTRAS } from "@cds/core/onboarding";
import { formatCentsExact, type CatalogItemKind } from "@cds/core/pricing";

/** Grid order: one group per kind (UI-SPEC "Prices"). */
export const PRICE_KINDS: readonly CatalogItemKind[] = [
  "plan",
  "build_fee",
  "addon",
  "pack",
  "care_plan",
  "extra",
  "service",
  "setup_fee",
];

export const PRICE_KIND_LABELS: Readonly<Record<CatalogItemKind, string>> = {
  plan: "Base fee",
  build_fee: "Build fee",
  addon: "Add-ons",
  pack: "Page packs",
  care_plan: "Care Plan",
  extra: "Extras",
  service: "Services",
  setup_fee: "Setup fee",
};

/** Kinds priced per month (the rest are one-time), as prices:set. */
export const MONTHLY_PRICE_KINDS: readonly CatalogItemKind[] = [
  "plan",
  "care_plan",
  "addon",
  "pack",
];

export const PRICED_PATHS = ["standard", "studio"] as const;
export type PricedPath = (typeof PRICED_PATHS)[number];
export const PRICED_PATH_LABELS: Readonly<Record<PricedPath, string>> = {
  standard: "Standard",
  studio: "Studio",
};

/** The db's ceiling ($100,000.00). */
export const PRICE_MAX_CENTS = 10_000_000;

// prices:set's fixed names (P10 packs and services; catalog-only add-ons, BILL-10, D180).
const FIXED_KEYS: Readonly<
  Partial<Record<CatalogItemKind, Record<string, string>>>
> = {
  plan: { base: "Base platform fee" },
  build_fee: { base: "Build fee" },
  care_plan: { care: "Care Plan" },
  pack: {
    "media-5gb": "Media pack, 5 GB",
    "media-25gb": "Media pack, 25 GB",
    "pages-5": "Page pack, 5 pages",
  },
  service: { "polish-hour": "Design polish, per hour" },
  setup_fee: { addon: "Add-on setup fee" },
  addon: {
    "studio-booking-solo": "Studio Booking, Solo (1 staff)",
    "studio-booking-team": "Studio Booking, Team (2-5 staff)",
    "studio-booking-large-team": "Studio Booking, Large team (6+ staff)",
    newsletter: "Newsletter",
    "landing-pages": "Landing pages",
  },
};

function own(map: Record<string, string> | undefined, key: string): string {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : "";
}

export function isPriceKind(v: unknown): v is CatalogItemKind {
  return (
    typeof v === "string" && (PRICE_KINDS as readonly string[]).includes(v)
  );
}

export function isPricedPath(v: unknown): v is PricedPath {
  return (
    typeof v === "string" && (PRICED_PATHS as readonly string[]).includes(v)
  );
}

export function isMonthlyKind(kind: CatalogItemKind): boolean {
  return MONTHLY_PRICE_KINDS.includes(kind);
}

/**
 * The item's name, or "" when prices:set would refuse the key ("unknown add-on …"), so a
 * typo never creates a row. `addonNames` maps registry slugs to names.
 */
export function priceItemLabel(
  kind: CatalogItemKind,
  key: string,
  addonNames: Readonly<Record<string, string>>,
): string {
  if (kind === "addon") {
    return (
      own(addonNames as Record<string, string>, key) ||
      own(FIXED_KEYS.addon, key)
    );
  }
  if (kind === "extra") return EXTRAS.find((e) => e.key === key)?.label ?? "";
  return own(FIXED_KEYS[kind], key);
}

/** Every key prices:set knows for a kind (grid rows that may not have a price yet). */
export function knownPriceKeys(
  kind: CatalogItemKind,
  addonSlugs: readonly string[],
): string[] {
  if (kind === "addon") {
    return [...addonSlugs, ...Object.keys(FIXED_KEYS.addon ?? {})];
  }
  if (kind === "extra") return EXTRAS.map((e) => e.key);
  return Object.keys(FIXED_KEYS[kind] ?? {});
}

/** Studio Booking is offered on the Studio path only (prices:set refuses the rest). */
export function pathAllowed(
  kind: CatalogItemKind,
  key: string,
  path: PricedPath,
): boolean {
  return !(
    kind === "addon" &&
    key.startsWith("studio-booking") &&
    path !== "studio"
  );
}

/** "$79.00/mo", "$1,500.00 once", or "Price coming soon" (D264: never an invented number). */
export function priceText(cents: number | null, monthly: boolean): string {
  if (cents === null) return "Price coming soon";
  return `${formatCentsExact(cents)}${monthly ? "/mo" : " once"}`;
}
