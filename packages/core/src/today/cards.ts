// Today cards (DASH-21, DASH-22): the add-on manifest card spec, the plain card data shape and
// the default order by path with per-person hide/reorder from member_prefs.today_layout.
import type { AddonPath } from "../addons/constants";

/** Manifest side: an add-on's Today card. */
export type TodayCardSpec = { id: string; title: string };

export type TodayCardRow = { label: string; value: string; href?: string };

/** What a card provider returns: plain data, at most 4 rows, one link. */
export type TodayCardData = {
  title: string;
  rows: TodayCardRow[];
  link: { label: string; href: string };
};

export const TODAY_CARD_MAX_ROWS = 4;

/** Cards the platform itself ships. */
export const CORE_CARD_IDS: readonly string[] = Object.freeze(["inquiries"]);

/** The card each path leads with (Studio: bookings, Shop: orders, Standard: inquiries). */
export const PATH_LEAD_CARD: Readonly<Record<AddonPath, string>> =
  Object.freeze({
    standard: "inquiries",
    studio: "bookings",
    shop: "orders",
  });

export type TodayLayoutPrefs = { order: string[]; hidden: string[] };
export type AvailableCard = { id: string; order: number };

/**
 * Default: the path's lead card, then the rest by manifest `order` (ties by id). With prefs:
 * ids in `prefs.order` first in that order, then any other available card in default order
 * (so a newly installed add-on's card shows up). Hidden ids are removed. Unknown ids in prefs
 * are ignored.
 */
export function defaultCardOrder(
  path: AddonPath,
  available: readonly AvailableCard[],
  prefs?: TodayLayoutPrefs | null,
): { visible: string[]; hidden: string[] } {
  const lead = PATH_LEAD_CARD[path];
  const seen = new Set<string>();
  const unique = available.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const base = [...unique]
    .sort((a, b) => {
      if (a.id === lead) return -1;
      if (b.id === lead) return 1;
      if (a.order !== b.order) return a.order - b.order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((c) => c.id);

  const known = new Set(base);
  const saved = (prefs?.order ?? []).filter(
    (id, i, arr) => known.has(id) && arr.indexOf(id) === i,
  );
  const ordered = [...saved, ...base.filter((id) => !saved.includes(id))];
  const hiddenSet = new Set(
    (prefs?.hidden ?? []).filter((id) => known.has(id)),
  );
  return {
    visible: ordered.filter((id) => !hiddenSet.has(id)),
    hidden: ordered.filter((id) => hiddenSet.has(id)),
  };
}
