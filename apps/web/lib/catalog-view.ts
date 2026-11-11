// The one merged add-on catalog every tenant-facing list reads (STAFF-07, D264, P13-P7;
// 13-32). Manifest = default + behaviour; the staff console's listing (13-20, 13-37)
// overrides tagline, description, screenshots, availability and order only. /start, the
// quote submit page, the quote actions and hub Get add-ons all call getCatalogView(), so a
// console edit reaches owners and visitors without a code change.
//
// - Public audience only: private add-ons (whatever the listing says) and hidden listings
//   never appear. A coming_soon add-on stays in the list with `pickable: false`.
// - Order: the listing sort, then the manifest order (ADDON_REGISTRY.list()), so a catalog
//   nobody has edited keeps the order owners saw before P13.
// - A listing read failure falls back to the last good view this process read, else the
//   manifest-only view (every public add-on, manifest copy, NOT pickable), and logs the
//   error's class name: never an empty catalog, never a hidden or coming-soon add-on made
//   pickable by an outage (WR-B04). Adding fails closed either way (`degraded`, WR-D09).
//
// React `cache` dedupes the read within one request; @cds/db keeps a 30 s listing cache and
// clears it on every staff write. Server-only (CatalogEntry is a @cds/db type: client
// components get plain derived props, never this module).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import type { AddonManifest } from "@cds/core/addons";
import { toPickableAddon, type PickableAddon } from "@cds/core/onboarding";
import {
  publicCatalogView,
  type CatalogEntry,
  type CatalogManifestInput,
} from "@cds/db";
import { cache } from "react";

export type { CatalogEntry };

/** The listing default sort (13-20 CATALOG_DEFAULT_SORT) for the manifest-only fallback. */
const FALLBACK_SORT = 1000;

/** A manifest as the catalog view's input (13-20 choice 1). */
export function toCatalogManifestInput(m: AddonManifest): CatalogManifestInput {
  const standard = m.paths.includes("standard");
  const studio = m.paths.includes("studio");
  return {
    slug: m.slug,
    name: m.name,
    summary: m.summary,
    visibility: m.visibility,
    path: standard && studio ? "both" : studio ? "studio" : "standard",
    premium: m.premium !== undefined,
  };
}

/**
 * Every public manifest, manifest copy and order (the fallback when no good read exists).
 * WR-B04: shown as coming soon and never pickable, since staff availability and Hidden
 * decisions can't be known without the listing.
 */
export function manifestOnlyView(
  manifests: readonly AddonManifest[],
): CatalogEntry[] {
  return manifests
    .filter((m) => m.visibility === "public")
    .map((m) => {
      const input = toCatalogManifestInput(m);
      return {
        slug: m.slug,
        name: m.name,
        tagline: m.summary,
        description: m.summary,
        screenshots: [],
        availability: "coming_soon" as const,
        sort: FALLBACK_SORT,
        pickable: false,
        private: false,
        path: input.path,
        premium: input.premium === true,
      };
    });
}

/** Listing sort first, then the manifest order (stable, keeps the pre-P13 order on ties). */
function orderLikeManifests(
  entries: readonly CatalogEntry[],
  manifests: readonly AddonManifest[],
): CatalogEntry[] {
  const index = new Map(manifests.map((m, i) => [m.slug, i]));
  const at = (slug: string) => index.get(slug) ?? Number.MAX_SAFE_INTEGER;
  return [...entries].sort(
    (a, b) => a.sort - b.sort || at(a.slug) - at(b.slug),
  );
}

function logKind(err: unknown): void {
  console.error(
    "[catalog-view] listing read failed:",
    err instanceof Error ? err.name : typeof err,
  );
}

/** The merged view plus whether it is a fallback (listing read failed). */
export type CatalogState = { view: CatalogEntry[]; degraded: boolean };

/** WR-B04: the last view read cleanly in this process, served during a listing outage. */
let lastGood: CatalogEntry[] | null = null;

/** Tests only: forget the last good view. */
export function resetCatalogSnapshot(): void {
  lastGood = null;
}

/**
 * The merged public catalog and its read state. Never throws for a listing read failure:
 * the last good view (else the non-pickable manifest-only view) is returned with
 * `degraded: true`.
 */
export const getCatalogState: () => Promise<CatalogState> = cache(
  async (): Promise<CatalogState> => {
    const manifests = ADDON_REGISTRY.list();
    try {
      const view = await publicCatalogView(
        manifests.map(toCatalogManifestInput),
      );
      const ordered = orderLikeManifests(view, manifests);
      lastGood = ordered;
      return { view: ordered, degraded: false };
    } catch (err) {
      logKind(err);
      return { view: lastGood ?? manifestOnlyView(manifests), degraded: true };
    }
  },
);

/**
 * The merged public catalog (choice 1), for display. Never throws for a listing read
 * failure: the last good or manifest-only view is returned instead (WR-B04). Anything that ADDS an add-on (quote,
 * submit, hub add) reads `getPickableSlugs` or `getCatalogState`, which fail closed.
 */
export async function getCatalogView(): Promise<CatalogEntry[]> {
  return (await getCatalogState()).view;
}

/** WR-D09: shown while the listing can't be read; adding waits rather than fail open. */
export const CATALOG_UNAVAILABLE_COPY =
  "We couldn't check which add-ons are available just now. Try again in a minute.";

/**
 * WR-D09: slugs that may be picked or added right now, or null when the listing read failed
 * (a fallback view may be stale or know nothing of staff decisions, so it can't gate adding:
 * an outage must never sell an add-on staff set to coming soon or hidden).
 */
export async function getPickableSlugs(): Promise<Set<string> | null> {
  const { view, degraded } = await getCatalogState();
  return degraded ? null : pickableSlugs(view);
}

/**
 * The server gate for a list of chosen add-on slugs (T-13-32-01, CR-D01, WR-D09): "ok" when
 * every slug is pickable now (an empty or absent list is "ok" without a read), "refused"
 * when one is coming soon, hidden, private or unknown, "unavailable" when the listing read
 * failed.
 */
export async function checkAddonsPickable(
  addons: unknown,
): Promise<"ok" | "refused" | "unavailable"> {
  if (!Array.isArray(addons) || addons.length === 0) return "ok";
  const ok = await getPickableSlugs();
  if (!ok) return "unavailable";
  return addons.every((slug) => typeof slug === "string" && ok.has(slug))
    ? "ok"
    : "refused";
}

/** The view's entry for one slug (own-property safe), or null (hidden, private, unknown). */
export function catalogEntryFor(
  view: readonly CatalogEntry[],
  slug: unknown,
): CatalogEntry | null {
  if (typeof slug !== "string") return null;
  return view.find((e) => e.slug === slug) ?? null;
}

/** Slugs that may be picked or added right now (available, public). */
export function pickableSlugs(view: readonly CatalogEntry[]): Set<string> {
  return new Set(view.filter((e) => e.pickable).map((e) => e.slug));
}

/**
 * The /start picker's plain list (choice 2): view order, the listing tagline as the row
 * copy, behaviour fields (paths, category, visibility) from the manifest. Coming-soon
 * add-ons are included; `comingSoon` names them so the row renders disabled.
 */
export function startAddons(view: readonly CatalogEntry[]): {
  addons: PickableAddon[];
  comingSoon: string[];
} {
  const addons: PickableAddon[] = [];
  const comingSoon: string[] = [];
  view.forEach((e, i) => {
    const m = ADDON_REGISTRY.get(e.slug);
    if (!m || m.visibility !== "public") return;
    addons.push({ ...toPickableAddon(m), summary: e.tagline, order: i });
    if (!e.pickable) comingSoon.push(e.slug);
  });
  return { addons, comingSoon };
}
