// The CDS hub's one catalog reader + blade builders (15-13; HUB-01, HUB-05, D264, D209;
// CONTEXT A2-Q1, P15-P3). Every marketing page reads prices and the add-on list through here.
//
// - marketingCatalog() never throws: a failed price read gives `catalog: null` (pages show no
//   price lines, never wrong ones) and a failed listing read gives the non-pickable
//   manifest-only view with `degraded: true` (getCatalogState, WR-B04). Errors are logged by
//   class name only (T-15-13-03).
// - demoSiteUrl() is the 60 s cached readDemoSiteUrl() (D209, D293); any failure -> null.
// - Blade builders print only strings from the shared @cds/core/pricing label helpers: no
//   money is formatted here (D264).
//
// "Included" rule (15-13 choice 2): an add-on is Included on a path when that path's `addon`
// catalog row is priced at 0 cents a month (Builder Pro on Studio, D300; migration
// 1790000780). An absent or unpriced row reads "Price coming soon"; an add-on whose catalog
// path excludes a path reads "<Path> · Not on this path". Server-only.
import {
  addonChip,
  MK_COPY,
  MK_PATHS,
  PATH_CHIPS,
  SHOP_SOON,
  swatchNumberLabel,
  type MkPathKey,
} from "@cds/core/marketing";
import {
  catalogRow,
  formatMonthly,
  PRICE_SOON,
  priceLabelFor,
  type CatalogRow,
} from "@cds/core/pricing";
import type { BladeData } from "@cds/ui/marketing";
import { readDemoSiteUrl } from "@cds/db";
import { unstable_cache as cached } from "next/cache";
import { getCatalog } from "./catalog";
import { getCatalogState, type CatalogEntry } from "./catalog-view";

export type MarketingCatalog = {
  /** Price rows, or null when the price read failed (no price lines anywhere). */
  catalog: CatalogRow[] | null;
  /** Public catalog view in listing order (manifest-only fallback when degraded). */
  view: CatalogEntry[];
  /** True when the listing read failed (fallback view, nothing pickable). */
  degraded: boolean;
  /** Slugs in the public view (coming soon included). */
  publicSlugs: Set<string>;
};

const HUB_PATHS: readonly MkPathKey[] = ["standard", "studio"];

function logKind(where: string, err: unknown): void {
  console.error(
    `[marketing] ${where} failed:`,
    err instanceof Error ? err.name : typeof err,
  );
}

/** The hub's catalog data for one request. Never throws (T-15-13-02). */
export async function marketingCatalog(): Promise<MarketingCatalog> {
  const [catalog, state] = await Promise.all([
    getCatalog().catch((err: unknown) => {
      logKind("catalog read", err);
      return null;
    }),
    getCatalogState().catch((err: unknown) => {
      logKind("catalog view", err);
      return { view: [] as CatalogEntry[], degraded: true };
    }),
  ]);
  return {
    catalog,
    view: state.view,
    degraded: state.degraded,
    publicSlugs: new Set(state.view.map((e) => e.slug)),
  };
}

const cachedDemoUrl: () => Promise<string | null> = cached(
  async () => readDemoSiteUrl(),
  ["demo-site-url"],
  { revalidate: 60 },
);

/** `https://<demo preview host>/` (60 s cache), or null: the demo panel then hides. */
export async function demoSiteUrl(): Promise<string | null> {
  try {
    return await cachedDemoUrl();
  } catch (err) {
    logKind("demo url", err);
    return null;
  }
}

/** Whether an add-on's catalog path covers a hub path. */
export function entryOnPath(entry: CatalogEntry, path: MkPathKey): boolean {
  return entry.path === "both" || entry.path === path;
}

/**
 * An add-on's price run, one line per path: "Standard · $9/mo", "Studio · Included",
 * "Standard · Not on this path", "Studio · Price coming soon". [] when the catalog failed.
 */
export function addonPriceLines(
  entry: CatalogEntry,
  catalog: readonly CatalogRow[] | null,
): string[] {
  if (catalog === null) return [];
  return HUB_PATHS.map((path) => {
    const label = MK_PATHS[path].name;
    if (!entryOnPath(entry, path)) {
      return `${label} · ${MK_COPY.ADDONS.NOT_ON_PATH}`;
    }
    const row = catalogRow(catalog, "addon", entry.slug, path);
    if (row?.monthlyCents === 0) {
      return `${label} · ${MK_COPY.ADDONS.INCLUDED}`;
    }
    return `${label} · ${priceLabelFor(row)}`;
  });
}

/** A path's base monthly line ("$39/mo" or "Price coming soon"); null when the catalog failed. */
export function pathMonthlyLine(
  catalog: readonly CatalogRow[] | null,
  path: MkPathKey,
): string | null {
  if (catalog === null) return null;
  const cents = catalogRow(catalog, "plan", "base", path)?.monthlyCents;
  return cents == null ? PRICE_SOON : formatMonthly(cents);
}

/** Standard, Studio (base monthly line), then Shop (outline, coming soon, never a link). */
export function pathBlades(catalog: readonly CatalogRow[] | null): BladeData[] {
  const paths: BladeData[] = HUB_PATHS.map((key) => {
    const line = pathMonthlyLine(catalog, key);
    return {
      key,
      name: MK_PATHS[key].name,
      number: "",
      chip: PATH_CHIPS[key],
      href: MK_PATHS[key].aboutHref,
      priceLines: line === null ? [] : [line],
      status: "available",
    };
  });
  return [
    ...paths,
    {
      key: SHOP_SOON.key,
      name: SHOP_SOON.name,
      number: "",
      chip: PATH_CHIPS.shop,
      href: null,
      priceLines: [],
      status: "coming_soon",
      addHref: null,
    },
  ];
}

export type AddonBladeOptions = {
  /** Only add-ons available on this path (path or both). */
  path?: MkPathKey;
  /** Slugs in listing order, for the chip numbers (defaults to the view order). */
  listingOrder?: readonly string[];
};

/**
 * Add-on blades in view order. `addHref` is /start?addon=<slug> only for pickable entries
 * (null otherwise, so a degraded or coming-soon blade never offers Add).
 */
export function addonBlades(
  view: readonly CatalogEntry[],
  catalog: readonly CatalogRow[] | null,
  opts: AddonBladeOptions = {},
): BladeData[] {
  const order = opts.listingOrder ?? view.map((e) => e.slug);
  const path = opts.path;
  return view
    .filter((e) => (path ? entryOnPath(e, path) : true))
    .map((e) => {
      const { chip, number } = addonChip(e.slug, order);
      return {
        key: e.slug,
        name: e.name,
        number: swatchNumberLabel(number),
        chip,
        href: `/add-ons/${encodeURIComponent(e.slug)}`,
        priceLines: addonPriceLines(e, catalog),
        status: e.availability === "available" ? "available" : "coming_soon",
        tagline: e.tagline,
        addHref: e.pickable
          ? `/start?addon=${encodeURIComponent(e.slug)}`
          : null,
      };
    });
}
