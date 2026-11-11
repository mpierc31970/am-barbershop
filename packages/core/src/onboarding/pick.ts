// Which add-ons a visitor can pick on a path, and which are recommended for their business
// type (ONB-11, D176, D177, D268). Pure. PickSource is structural so the browser can pass a
// plain serialisable list and the server can pass the real AddonRegistry.
import type { AddonPath } from "../addons/constants";
import type { AddonManifest } from "../addons/types";
import type { QuoteSelections } from "../pricing/types";
import { BUSINESS_TYPES } from "./business-types";
import type { BusinessType } from "./business-types";
import { PATH_RULES } from "./paths";

export type PickableAddon = Pick<
  AddonManifest,
  "slug" | "name" | "summary" | "category" | "paths" | "visibility" | "order"
>;

export type PickSource = { publicList(): readonly PickableAddon[] };

export function pickSourceFrom(list: readonly PickableAddon[]): PickSource {
  const frozen = Object.freeze([...list]);
  return { publicList: () => frozen };
}

/** Plain, serialisable copy of the fields the picker needs (crosses the RSC boundary). */
export function toPickableAddon(m: AddonManifest): PickableAddon {
  return {
    slug: m.slug,
    name: m.name,
    summary: m.summary,
    category: m.category,
    paths: [...m.paths],
    visibility: m.visibility,
    order: m.order,
  };
}

function pickable(source: PickSource, path: AddonPath): PickableAddon[] {
  // Defence in depth: publicList() already drops private add-ons (ADDON-09).
  return source
    .publicList()
    .filter((a) => a.visibility === "public" && a.paths.includes(path));
}

export function pickableAddons(
  source: PickSource,
  path: AddonPath,
  businessTypeId: string | null,
  types: readonly BusinessType[] = BUSINESS_TYPES,
  rules: typeof PATH_RULES = PATH_RULES,
): { recommended: PickableAddon[]; rest: PickableAddon[] } {
  const all = pickable(source, path);
  const type =
    businessTypeId === null
      ? undefined
      : types.find((t) => t.id === businessTypeId && t.paths.includes(path));
  const seeAllOnly = rules[path]?.seeAllOnly ?? [];

  const recommended: PickableAddon[] = [];
  for (const slug of type?.recommended ?? []) {
    if (seeAllOnly.includes(slug)) continue;
    const addon = all.find((a) => a.slug === slug);
    // Unknown or not-yet-shipped slugs are skipped silently.
    if (addon && !recommended.includes(addon)) recommended.push(addon);
  }
  const rest = all.filter((a) => !recommended.includes(a));
  return { recommended, rest };
}

/** Drop selected add-ons that are not pickable on the new path; report which went. */
export function reconcileSelections(
  source: PickSource,
  path: AddonPath,
  s: QuoteSelections,
): { selections: QuoteSelections; removed: string[] } {
  const ok = new Set(pickable(source, path).map((a) => a.slug));
  const removed = s.addons.filter((slug) => !ok.has(slug));
  return {
    selections: { ...s, addons: s.addons.filter((slug) => ok.has(slug)) },
    removed,
  };
}
