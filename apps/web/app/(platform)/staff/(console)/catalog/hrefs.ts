// Catalog console URLs (13-37), shared by the panels (server) and CatalogIsland (client).
export const CATALOG_ADDONS_HREF = "/staff/catalog?tab=addons";

/** The listing editor for one add-on (choice 2: in the Add-ons tab, so the shell stays). */
export function listingEditHref(slug: string): string {
  return `${CATALOG_ADDONS_HREF}&edit=${encodeURIComponent(slug)}`;
}
