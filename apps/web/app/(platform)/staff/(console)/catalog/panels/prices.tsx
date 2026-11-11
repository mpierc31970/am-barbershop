// Panel catalog/prices: filled by 13-37
// Panel catalog/prices (13-37 choice 3; STAFF-07, D161, D264, D299; 13-UI-SPEC "Prices" lines
// 858-865, 1079). The one price_catalog (readPriceCatalog) grouped by kind, a row per key the
// prices:set CLI knows (registry add-ons, catalog-only add-ons, extras, packs, services) plus
// any stored key, with Standard and Studio cells ("$79.00/mo", "$1,500.00 once", "Price coming
// soon", "—" for no row) and the provider price state from pendingPriceSyncs (the CLI's
// --sync-all dry run): "Synced" or "Missing". Studio Booking keys are not offered on Standard.
// Super Admins edit (prices_set + step-up, in the actions); agents read. A failed read logs
// the class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import type { CatalogItemKind, CatalogRow } from "@cds/core/pricing";
import { pendingPriceSyncs, readPriceCatalog } from "@cds/db";
import { CATALOG_COPY as C, type PriceGroupView } from "@cds/ui/staff";
import {
  isMonthlyKind,
  knownPriceKeys,
  pathAllowed,
  PRICE_KIND_LABELS,
  PRICE_KINDS,
  priceItemLabel,
  priceText,
  type PricedPath,
} from "../../../../../../lib/price-labels";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { PricesIsland } from "../CatalogIsland";

const PRICES_HREF = "/staff/catalog?tab=prices";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

const id = (kind: string, key: string, path: string) =>
  `${kind}:${key}:${path}`;

/** The grid view (exported for tests). */
export function priceGroups(
  rows: readonly CatalogRow[],
  missing: ReadonlySet<string>,
  addons: readonly { slug: string; name: string }[],
): PriceGroupView[] {
  const names = Object.fromEntries(addons.map((a) => [a.slug, a.name]));
  const byId = new Map(
    rows.map((r) => [id(r.itemKind, r.itemKey, r.path), r] as const),
  );
  return PRICE_KINDS.map((kind: CatalogItemKind) => {
    const keys = [
      ...new Set([
        ...knownPriceKeys(
          kind,
          addons.map((a) => a.slug),
        ),
        ...rows.filter((r) => r.itemKind === kind).map((r) => r.itemKey),
      ]),
    ];
    const monthly = isMonthlyKind(kind);
    return {
      kind,
      label: PRICE_KIND_LABELS[kind],
      rows: keys.map((key) => {
        const cell = (path: PricedPath) => {
          const row = byId.get(id(kind, key, path));
          const cents = row
            ? monthly
              ? row.monthlyCents
              : row.oneTimeCents
            : null;
          return {
            cents,
            text: row ? priceText(cents, monthly) : C.noPrice,
            offered: pathAllowed(kind, key, path),
            sync:
              cents === null
                ? ("none" as const)
                : missing.has(id(kind, key, path))
                  ? ("missing" as const)
                  : ("synced" as const),
          };
        };
        return {
          kind,
          key,
          label: priceItemLabel(kind, key, names) || key,
          cells: { standard: cell("standard"), studio: cell("studio") },
        };
      }),
    };
  }).filter((g) => g.rows.length > 0);
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: CatalogRow[];
  let missing: Set<string>;
  try {
    const [r, pending] = await Promise.all([
      readPriceCatalog(),
      pendingPriceSyncs(),
    ]);
    rows = r;
    missing = new Set(pending.map((p) => id(p.kind, p.key, p.path)));
  } catch (err) {
    console.error("[staff] price catalog read failed", errName(err));
    return <SitesLoadError href={PRICES_HREF} />;
  }
  const addons = ADDON_REGISTRY.list().map((m) => ({
    slug: m.slug,
    name: m.name,
  }));
  return (
    <PricesIsland
      groups={priceGroups(rows, missing, addons)}
      canEdit={staffCan(session.role, "prices_set")}
    />
  );
}
