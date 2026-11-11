// Paid-services boundary (SUPPORT-03, D297, D299). "No paid work before acceptance": a ticket
// marked paid blocks In progress until the owner accepts a quote or chooses a Care hour.
import { SUPPORT_COPY } from "./copy";
import { PAID_CATEGORY_KEYS } from "./types";
import type { PaidCategory, PaidService } from "./types";

/**
 * Show me how: the best existing help article per category (training entry ids and
 * HELP_EXTRAS ids in apps/web/lib/help-index.ts). 12-33 tests each resolves for an Owner:
 * design and logos pointed at "theming", a staff article hidden from Help, so design now opens
 * the paid-services article (the theme is CDS's to change) and logos Business info (where the
 * owner changes the logo). Every id must be readable by every role that sees the panel
 * (Owner, Admin, Editor; WR-B01): page_building opens "pages", because "add-pages" is
 * Owner-only (p11/pages.ts `ownerOnly`).
 */
const HELP_IDS: Record<PaidCategory, string> = {
  copywriting: "pages",
  design: "paid-services",
  page_building: "pages",
  product_entry: "csv-import",
  newsletters: "contacts",
  photos: "media-library",
  logos: "business-info",
  seo: "seo-and-sharing",
  custom: "support",
};

export const PAID_CATEGORIES: readonly {
  key: PaidCategory;
  label: string;
  helpId: string;
}[] = PAID_CATEGORY_KEYS.map((key) => ({
  key,
  label: SUPPORT_COPY.PAID_CATEGORY_LABELS[key],
  helpId: HELP_IDS[key],
}));

export function isPaidCategory(v: unknown): v is PaidCategory {
  return (
    typeof v === "string" &&
    (PAID_CATEGORY_KEYS as readonly string[]).includes(v)
  );
}

export function paidHelpId(c: PaidCategory): string {
  return HELP_IDS[c];
}

/** Quote accepted or Care hour chosen. */
export function paidAccepted(p: PaidService | null | undefined): boolean {
  return !!p && (!!p.accepted_at || !!p.care_chosen_at);
}

/** Marked paid and the owner has not picked yet (the panel asks them to). */
export function paidAwaitingChoice(p: PaidService | null | undefined): boolean {
  return !!p && !paidAccepted(p);
}

/** Staff may not start work (In progress) while this is true. */
export function paidBlocksProgress(p: PaidService | null | undefined): boolean {
  return !!p && !!p.marked_at && !paidAccepted(p);
}
