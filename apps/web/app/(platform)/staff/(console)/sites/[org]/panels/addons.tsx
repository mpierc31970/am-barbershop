// Panel sites/[org]/addons: filled by 13-33
// Panel sites/[org]/addons (13-33 choice 3; STAFF-02, ADDON-09, D21; 13-UI-SPEC site detail
// "Add-ons" line 784; T-13-33-01). Every add-on for the site's path (private ones included:
// staff can add any add-on, like `addons:install`) plus any entitlement outside it, with its
// state (on site / removed / not on site), since date and catalog price. Super_admin gets
// Install / Uninstall (CaseDialog + reason → installAddonAction / uninstallAddonAction, step-up
// in the action); support agents see the buttons disabled with "Super Admin only".
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  staffGetSite,
  staffSiteAddons,
  type StaffSiteAddon,
  type StaffSiteDetail,
} from "@cds/db";
import type { CatalogRow } from "@cds/core/pricing";
import { SiteAddonsTable, type SiteAddonRowView } from "@cds/ui/staff";
import { getCatalog } from "../../../../../../../lib/catalog";
import { staffCan } from "../../../../../../../lib/staff-session";
import {
  installAddonAction,
  uninstallAddonAction,
} from "../../../../../../actions/staff/sites";
import { addonPriceLabel } from "../../../../../hub/add-ons/catalog-logic";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

/** Registry add-ons for the site's path (all paths when none is set), then stray entitlements. */
export function siteAddonRows(
  path: string,
  entitlements: readonly StaffSiteAddon[],
  catalog: readonly CatalogRow[],
): SiteAddonRowView[] {
  const bySlug = new Map(entitlements.map((e) => [e.slug, e]));
  const manifests = ADDON_REGISTRY.list().filter(
    (m) =>
      path === "" ||
      (m.paths as readonly string[]).includes(path) ||
      bySlug.has(m.slug),
  );
  const rows: SiteAddonRowView[] = manifests.map((m) => {
    const e = bySlug.get(m.slug);
    return {
      slug: m.slug,
      name: m.name,
      state: !e ? "off" : e.status === "active" ? "on" : "removed",
      since: e?.since ?? null,
      price: addonPriceLabel(catalog, m.slug, path),
    };
  });
  // An entitlement whose add-on left the registry still shows (read-only facts).
  for (const e of entitlements) {
    if (ADDON_REGISTRY.get(e.slug)) continue;
    rows.push({
      slug: e.slug,
      name: e.slug,
      state: e.status === "active" ? "on" : "removed",
      since: e.since,
      price: null,
    });
  }
  const rank = { on: 0, removed: 1, off: 2 } as const;
  return rows.sort(
    (a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name),
  );
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let site: StaffSiteDetail;
  let entitlements: StaffSiteAddon[];
  let catalog: CatalogRow[] = [];
  try {
    [site, entitlements] = await Promise.all([
      staffGetSite(session.ctx, orgId),
      staffSiteAddons(session.ctx, orgId),
    ]);
  } catch (err) {
    console.error(
      "[staff] site add-ons failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=addons`} />;
  }
  try {
    catalog = await getCatalog();
  } catch (err) {
    // Prices are context, not the decision: the table still renders ("Price coming soon").
    console.error(
      "[staff] catalog read failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  return (
    <SiteAddonsTable
      orgId={orgId}
      business={site.name || orgId}
      rows={siteAddonRows(site.path, entitlements, catalog)}
      canInstall={staffCan(session.role, "addon_install")}
      install={installAddonAction}
      uninstall={uninstallAddonAction}
    />
  );
}
