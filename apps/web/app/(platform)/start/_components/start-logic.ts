// Pure helpers for the /start configurator (ONB-06, ONB-11, ONB-12; 06-UI-SPEC
// "Configurator", Voice, Copywriting). No React, no I/O: every price label comes from a
// catalog row (the UI never computes a price), every list from data (invariant 2).
import type { AddonPath } from "@cds/core/addons";
import { PATHS, type AupCategory } from "@cds/core/onboarding";

// Price labels live in @cds/core/pricing (P15-P5); re-exported so importers do not change.
export {
  PRICE_SOON,
  catalogRow,
  priceLabelFor,
  pathPriceLine,
} from "@cds/core/pricing";

export const REVIEWED_NOTE =
  "We review sites like this before we build them, usually within 2 business days. You can still set everything up in the meantime.";
export const NOTHING_RECOMMENDED =
  "No add-ons are recommended for this type yet. Your site already includes pages, hosting and support.";
export const OTHER_LABEL = "Describe your business in a few words";
export const OTHER_MAX = 80;

/** The step list in the top bar (UI-SPEC Frame). Submit is its own page (06-15). */
export const STEPS = [
  { n: 1, label: "Your path", anchor: "start-path" },
  { n: 2, label: "Your business", anchor: "start-business" },
  { n: 3, label: "Add-ons", anchor: "start-addons" },
  { n: 4, label: "Submit", anchor: null },
] as const;

export type StepNumber = 1 | 2 | 3 | 4;

/** "Appointments isn't part of the Studio path, so we took it off your quote." */
export function removedMessage(
  names: readonly string[],
  pathLabel: string,
): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) {
    return `${names[0]} isn't part of the ${pathLabel} path, so we took it off your quote.`;
  }
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} aren't part of the ${pathLabel} path, so we took them off your quote.`;
}

/** Which sections show: business after a path, add-ons after a business type. */
export function sectionVisibility(q: { path: string; businessType: string }): {
  business: boolean;
  addons: boolean;
} {
  const business = q.path !== "";
  return { business, addons: business && q.businessType !== "" };
}

/** The current step for the step list. */
export function currentStep(q: {
  path: string;
  businessType: string;
}): StepNumber {
  const v = sectionVisibility(q);
  if (v.addons) return 3;
  if (v.business) return 2;
  return 1;
}

/**
 * Roving tabindex for radiogroups (UI-SPEC Accessibility): the index focus moves to for a
 * key, wrapping at the ends, or null when the key is not a move key.
 */
export function rovingIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

/** The FAQ box lists: each category as "Category: examples" (UI-SPEC FAQ box, ONB-12). */
export function aupLines(categories: readonly AupCategory[]): {
  never: string[];
  review: string[];
} {
  const line = (c: AupCategory) => `${c.name}: ${lowerFirst(c.examples)}`;
  return {
    never: categories.filter((c) => c.verdict === "never").map(line),
    review: categories.filter((c) => c.verdict === "review").map(line),
  };
}

/** The catalog fields startPreselect reads (a structural slice of @cds/db CatalogEntry). */
export type PreselectEntry = {
  slug: string;
  name: string;
  path: AddonPath | "both";
};

/** A validated /start preselect (15-21, HUB-02): path and/or one add-on, or nulls. */
export type StartPreselect = {
  path: AddonPath | null;
  addon: { slug: string; name: string } | null;
};

function firstParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : "";
}

/**
 * Validate `/start?path=…&addon=…` from a hub CTA (A3-Q1, D78, P15-P25). Untrusted input:
 * `path` must be a PATHS id; `addon` must be in `pickable` (null = degraded read, so it is
 * ignored), listed in the view, and allowed on the chosen path. A path-only add-on with no
 * path param sets that path; an add-on off an explicit path is dropped (the path kept).
 * The name comes from the catalog entry, never the query (T-15-21-03).
 */
export function startPreselect(
  params: { path?: string | string[]; addon?: string | string[] },
  view: readonly PreselectEntry[],
  pickable: ReadonlySet<string> | null,
): StartPreselect {
  const rawPath = firstParam(params.path);
  let path: AddonPath | null =
    PATHS.find((p) => p.id === rawPath && p.available)?.id ?? null;
  const slug = firstParam(params.addon);
  let addon: StartPreselect["addon"] = null;
  if (slug !== "" && pickable !== null && pickable.has(slug)) {
    const entry = view.find((e) => e.slug === slug) ?? null;
    if (entry) {
      if (path === null) {
        if (entry.path !== "both") path = entry.path;
        addon = { slug: entry.slug, name: entry.name };
      } else if (entry.path === "both" || entry.path === path) {
        addon = { slug: entry.slug, name: entry.name };
      }
    }
  }
  return { path, addon };
}
