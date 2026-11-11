// Panel catalog/addons: filled by 13-37
// Panel catalog/addons (13-37 choice 2; STAFF-07, D5, D264, D-UI-P13-23; 13-UI-SPEC "Catalog"
// lines 838-856). The add-on listings from staffListListings over the registry manifests
// (toCatalogManifestInput, so path and premium match /start and the hub), in owner order:
// Add-on · Availability · Visibility · Tagline · Screenshots · Updated · Sort, with Move up /
// Move down per row. `?edit=<slug>` opens the ListingEditor for that add-on in this tab (the
// console shell stays): tagline, description, availability, screenshots, and the Owners see
// card with the add-on's Standard price (Studio for a Studio-only add-on). Both staff roles
// edit listings (catalog_listings). A failed read logs the class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  CATALOG_DESCRIPTION_MAX,
  CATALOG_SCREENSHOTS_MAX,
  CATALOG_TAGLINE_MAX,
  readPriceCatalog,
  staffListListings,
  type StaffCatalogEntry,
} from "@cds/db";
import { CATALOG_COPY as C } from "@cds/ui/staff";
import type { CatalogRow } from "@cds/core/pricing";
import { notFound } from "next/navigation";
import { toCatalogManifestInput } from "../../../../../../lib/catalog-view";
import {
  addonPriceLabel,
  cardMeta,
} from "../../../../hub/add-ons/catalog-logic";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  ListingEditorIsland,
  ListingsTable,
  type ListingRowView,
} from "../CatalogIsland";
import { CATALOG_ADDONS_HREF } from "../hrefs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

function updatedText(e: StaffCatalogEntry): string {
  if (!e.updatedAt) return C.never;
  const t = Date.parse(e.updatedAt.replace(" ", "T"));
  if (Number.isNaN(t)) return C.never;
  return C.updatedBy(DAY.format(new Date(t)), e.updatedByName);
}

async function prices(): Promise<CatalogRow[]> {
  try {
    return await readPriceCatalog();
  } catch (err) {
    console.error("[staff] price catalog read failed", errName(err));
    return [];
  }
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const manifests = ADDON_REGISTRY.list();
  let entries: StaffCatalogEntry[];
  try {
    entries = await staffListListings(
      session.ctx,
      manifests.map(toCatalogManifestInput),
    );
  } catch (err) {
    console.error("[staff] catalog listings read failed", errName(err));
    return <SitesLoadError href={CATALOG_ADDONS_HREF} />;
  }

  const edit = one(params.edit);
  if (edit !== "") {
    const entry = SLUG_RE.test(edit)
      ? entries.find((e) => e.slug === edit)
      : undefined;
    const manifest = manifests.find((m) => m.slug === edit);
    if (!entry || !manifest) notFound();
    const rows = await prices();
    const pricePath = entry.path === "studio" ? "studio" : "standard";
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <a
            href={CATALOG_ADDONS_HREF}
            className="w-fit rounded text-sm font-semibold text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            {C.backToList}
          </a>
          <h2 className="font-hub text-xl font-semibold text-hub-ink">
            {entry.name}
          </h2>
        </div>
        <ListingEditorIsland
          listing={{
            slug: entry.slug,
            name: entry.name,
            summary: entry.summary,
            private: entry.private,
            taglineOverride: entry.taglineOverride,
            descriptionOverride: entry.descriptionOverride,
            availability: entry.availability,
            screenshots: entry.screenshots,
            meta: cardMeta(manifest),
            priceLabel: addonPriceLabel(rows, entry.slug, pricePath),
          }}
          taglineMax={CATALOG_TAGLINE_MAX}
          descriptionMax={CATALOG_DESCRIPTION_MAX}
          screenshotsMax={CATALOG_SCREENSHOTS_MAX}
        />
      </section>
    );
  }

  const rows: ListingRowView[] = entries.map((e, i) => ({
    slug: e.slug,
    name: e.name,
    availability: e.availability,
    private: e.private,
    tagline: e.tagline,
    screenshots: e.screenshots.length,
    updated: updatedText(e),
    sort: e.sort,
    first: i === 0,
    last: i === entries.length - 1,
  }));
  return <ListingsTable rows={rows} />;
}
