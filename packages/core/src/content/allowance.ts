// Page allowance (11-07; DASH-08; D185, D273). Pure and Edge-safe. The server check in
// createPage / restore (11-26) and the Pages tab counter share these rules (T-11-07-03).
//
// Allowance = 10 included pages + 5 per page pack. Only live builder pages count: system
// pages (404, policies, password), generated and landing pages, deleted pages and
// password-protected pages do not (UI-SPEC ALLOWANCE-HELP).
import { CdsError } from "../errors";

export const PAGE_BASE = 10;
export const PAGE_PACK_SIZE = 5;

function packCount(packs: number): number {
  return typeof packs === "number" && Number.isFinite(packs) && packs > 0
    ? Math.floor(packs)
    : 0;
}

/** Pages a site may have: 10 + 5 x packs (D185). Junk or negative packs count as 0. */
export function pageAllowance(packs: number): number {
  return PAGE_BASE + PAGE_PACK_SIZE * packCount(packs);
}

export type AllowancePage = {
  kind: string;
  deleted_at?: string | null;
  password_protected?: boolean | null;
};

/** True when a page uses one of the site's allowance (D273: builder pages only). */
export function countsTowardLimit(p: AllowancePage): boolean {
  return p.kind === "builder" && !p.deleted_at && !p.password_protected;
}

export function countPagesTowardLimit(pages: readonly AllowancePage[]): number {
  return pages.reduce((n, p) => (countsTowardLimit(p) ? n + 1 : n), 0);
}

/**
 * PAGES-FULL (D185; the number tracks the allowance). WR-C02: the pack price is the
 * catalog's label (`pagesPackPriceLabel`), never typed here; without one (unpriced, or a
 * server message that is not owner-specific) the buy sentence is left out.
 */
export function pagesFullCopy(
  allowance: number,
  priceLabel: string | null = null,
): string {
  const base = `You've used all ${allowance} pages included with your site.`;
  return priceLabel
    ? `${base} Add ${PAGE_PACK_SIZE} more pages for ${priceLabel}.`
    : base;
}

/** PAGES-FULL-MEMBER: Admin and Editor see this instead (no buy action). */
export function pagesFullMemberCopy(allowance: number): string {
  return `You've used all ${allowance} pages included with your site. Ask your site owner to add more pages.`;
}

/** PAGES-PACK-REFUSED: removing a pack would leave more pages than the new allowance. */
export function pagesPackRefusedCopy(
  count: number,
  leftAllowance: number,
): string {
  const over = Math.max(1, count - leftAllowance);
  const pages = over === 1 ? "1 page" : `${over} pages`;
  return `You have ${count} pages, more than the ${leftAllowance} you'd have left. Delete ${pages} first, then remove the pack.`;
}

/** The plan-named alias for the PAGES-PACK-REFUSED copy builder. */
export const PAGES_PACK_REFUSED = pagesPackRefusedCopy;

/**
 * Thrown by the server when a create or restore would pass the allowance (11-26). The
 * message is neutral (no price, no buy offer: WR-C02); the hub builds the Owner or member
 * copy from the allowance it carries.
 */
export class PageLimitReached extends CdsError {
  override readonly code = "page_limit";
  readonly allowance: number;
  constructor(allowance: number) {
    super(pagesFullCopy(allowance));
    this.allowance = allowance;
  }
}
