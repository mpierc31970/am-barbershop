// Get add-ons catalog (ADDON-05, ADDON-09; D311, D-UI-P5-1/2/3; 05-UI-SPEC "Catalog").
// Owner and Admin only (others 404). Display H1, one intro line, then a 1/2/3-column grid of
// AddonCards in manifest order: added ones stay where they are. Private add-ons never render
// (publicList). Card "Add to site" opens the same confirm dialog as the detail page. The org
// comes only from the session cookie. P10 (10-31; BILL-03, BILL-18): each card shows its
// catalog price for the org's path (cached catalog, formatted here, never summed), and a
// billing-lapsed add-on shows Paused with Details only. 11-47 (DASH-17): ScreenHeader with
// the "?" for the Get add-ons how-to (help id `add-ons`). 11-48 (DASH-17, D208): first-use
// tour `addons` (a catalog card, Add to site).
// 13-32 (STAFF-07): cards follow the merged catalog view (getCatalogView): listing tagline
// and order, hidden listings absent, coming-soon cards badged with Add to site disabled.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { can } from "@cds/core";
import {
  activeAddons,
  listOrgAddons,
  orgPlanPath,
  retainedRecordCounts,
  type OrgAddonRow,
  type OrgContext,
} from "@cds/db";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  addAddonAction,
  addBothAction,
  removeAddonAction,
  addAddonPreviewAction,
  updateCardAction,
} from "../../../actions/addons";
import { addonDeps } from "../../../../lib/addons";
import { getCatalog } from "../../../../lib/catalog";
import { getCatalogView } from "../../../../lib/catalog-view";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { AddFlowProvider, CatalogGrid, type CatalogCard } from "./AddonActions";
import {
  CATALOG_INTRO,
  addonPriceLabel,
  cardMeta,
  pausedSlugs,
} from "./catalog-logic";
import { LoadError } from "./LoadError";
import { buildView } from "./views";
import { TourHost } from "../TourHost";
import { tourState } from "../tour-slot";

export const metadata: Metadata = { title: "Get add-ons" };

export const dynamic = "force-dynamic";

function Heading() {
  return (
    <div className="flex flex-col gap-2">
      <ScreenHeader
        title="Get add-ons"
        helpId="add-ons"
        LinkComponent={GuardedLink}
      />
      <p className="max-w-[68ch] text-base text-hub-ink-muted">
        {CATALOG_INTRO}
      </p>
    </div>
  );
}

/** Items kept from an earlier add, per disabled add-on (the re-add line). Owner only. */
async function retainedBySlug(
  ctx: OrgContext,
  active: readonly string[],
  rows: readonly OrgAddonRow[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ctx.role !== "owner") return out;
  const deps = addonDeps();
  await Promise.all(
    rows
      .filter((r) => r.status === "disabled" && !active.includes(r.addon))
      .filter((r) => ADDON_REGISTRY.get(r.addon)?.visibility === "public")
      .map(async (r) => {
        out.set(r.addon, await retainedRecordCounts(ctx, deps, r.addon));
      }),
  );
  return out;
}

export default async function AddonsCatalogPage() {
  const { ctx } = await requireHubSession();
  if (!can(ctx, "addons", "read")) notFound();

  let cards: CatalogCard[];
  try {
    const [active, rows, catalog, path, view] = await Promise.all([
      activeAddons(ctx),
      listOrgAddons(ctx),
      getCatalog(),
      orgPlanPath(ctx),
      getCatalogView(),
    ]);
    const retained = await retainedBySlug(ctx, active, rows);
    const paused = pausedSlugs(rows);
    cards = view.flatMap((e) => {
      const m = ADDON_REGISTRY.get(e.slug);
      if (!m || m.visibility !== "public") return [];
      return [
        {
          ...buildView({
            manifest: m,
            ctx,
            active,
            retained: retained.get(m.slug) ?? 0,
            pageUrl: null,
            registry: ADDON_REGISTRY,
            priceLabel: addonPriceLabel(catalog, m.slug, path),
            paused: paused.has(m.slug),
            comingSoon: !e.pickable,
          }),
          summary: e.tagline,
          meta: cardMeta(m),
        },
      ];
    });
  } catch (err) {
    console.error("[hub] add-on catalog failed", err);
    return (
      <div className="flex flex-col gap-6">
        <Heading />
        <LoadError href="/hub/add-ons" />
      </div>
    );
  }

  const tour = await tourState(ctx, "addons");
  return (
    <div className="flex flex-col gap-6">
      <Heading />
      {cards.length === 0 ? (
        <p className="text-base text-hub-ink-muted">
          No add-ons to show yet. Check back soon.
        </p>
      ) : (
        <AddFlowProvider
          actions={{
            add: addAddonAction,
            addBoth: addBothAction,
            remove: removeAddonAction,
            updateCard: updateCardAction,
            preview: addAddonPreviewAction,
          }}
        >
          <CatalogGrid
            cards={cards}
            canAdd={ctx.role === "owner" && !ctx.impersonator}
          />
        </AddFlowProvider>
      )}
      {tour && cards.length > 0 ? (
        <TourHost tourId="addons" autoStart={tour.autoStart} />
      ) : null}
    </div>
  );
}
