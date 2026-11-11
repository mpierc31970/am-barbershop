// Catalog card (05-06; 05-UI-SPEC "Catalog", D-UI-P5-1/2/3, R1; D311).
// An <article> labelled by its name: 1px hub-border, 8px radius, 24px padding, min-height
// 176px, hover border hub-border-strong, no shadow, no icon tile, no eyebrow. The name is
// the one link to the detail page (the card itself is not a link). The footer is pinned to
// the bottom: secondary "Add to site" (not added, Owner) or secondary "Manage" (added,
// goes to the add-on's tab), plus a ghost "Details" link. Admin (canAdd false) sees
// Details only. Never an accent button: the one primary lives on the detail page.
// P10 (10-31; 10-UI-SPEC "Paused add-ons", "Add-on prices and charges"; BILL-03, BILL-18,
// D27, D264): the meta line carries the catalog price on the right ("$9/mo", "Included", or
// "Price coming soon" in Label ink-muted, pre-formatted by the server). An unpriced add-on's
// Add to site is aria-disabled with the UNPRICED-ADDON reason line and opens no dialog. A
// paused add-on (billing lapse) shows the Paused badge and only Details.
// P13 (13-32; STAFF-07): a coming-soon catalog listing shows the neutral "Coming soon"
// badge and an aria-disabled Add to site with its reason line (never opens a dialog).
import { useId, type AnchorHTMLAttributes, type ComponentType } from "react";
import { Badge } from "./Badge";
import { Button, buttonClasses } from "./Button";

export const ADDON_CARD_COPY = {
  priceSoon: "Price coming soon",
  paused: "Paused",
  comingSoon: "Coming soon",
  comingSoonReason:
    "Support is getting this one ready. You'll be able to add it soon.",
  /** UI-SPEC UNPRICED-ADDON (D264: never an invented number). */
  unpriced: "We're finalising this price. You'll be able to add it soon.",
} as const;

export type HubLinkComponent = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

export interface AddonCardProps {
  name: string;
  summary: string;
  /** "{Category} · Adds a page, a block and a tab" */
  meta: string;
  /** org_addons.status = active: shows "On your site" and Manage. */
  active: boolean;
  /** Detail page, /hub/add-ons/<slug>. */
  href: string;
  /** The add-on's tab, /hub/website?tab=<slug>. */
  manageHref: string;
  /** Owner only: may add or manage. Admin sees Details only. */
  canAdd: boolean;
  /** Catalog price for the org's path ("$9/mo", "Included"); null = not priced yet. */
  priceLabel: string | null;
  /** Disabled for a billing lapse: Paused badge, Details only (BILL-03). */
  paused: boolean;
  /** Listed as coming soon (13-32): badge, Add to site disabled. */
  comingSoon?: boolean;
  /** Opens the same Add confirm dialog as the detail page. */
  onAdd: () => void;
  /** next/link from the app; a plain <a> by default. */
  LinkComponent?: HubLinkComponent;
}

export function AddonCard({
  name,
  summary,
  meta,
  active,
  href,
  manageHref,
  canAdd,
  priceLabel,
  paused,
  comingSoon = false,
  onAdd,
  LinkComponent,
}: AddonCardProps) {
  const Link = LinkComponent ?? "a";
  const nameId = useId();
  const reasonId = useId();
  const unpriced = priceLabel === null;
  const soon = comingSoon && !active;
  const showAdd = canAdd && !active && !paused;
  const blocked = unpriced || soon;
  return (
    <article
      aria-labelledby={nameId}
      className={
        "flex min-h-44 flex-col gap-2 rounded-lg border border-hub-border bg-hub-surface p-6 " +
        "font-hub text-hub-ink transition-colors duration-150 hover:border-hub-border-strong"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={nameId} className="text-xl leading-tight font-semibold">
          <Link
            href={href}
            className="rounded text-hub-ink underline-offset-2 hover:underline"
          >
            {name}
          </Link>
        </h2>
        {active ? <Badge tone="on-site">On your site</Badge> : null}
        {!active && paused ? (
          <Badge tone="paused">{ADDON_CARD_COPY.paused}</Badge>
        ) : null}
        {soon && !paused ? (
          <Badge tone="coming-soon">{ADDON_CARD_COPY.comingSoon}</Badge>
        ) : null}
      </div>
      <p className="line-clamp-2 text-base text-hub-ink">{summary}</p>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-hub-ink-muted">{meta}</p>
        {unpriced ? (
          <p
            data-addon-price=""
            className="shrink-0 text-sm text-hub-ink-muted"
          >
            {ADDON_CARD_COPY.priceSoon}
          </p>
        ) : (
          <p
            data-addon-price=""
            className="shrink-0 text-base font-semibold text-hub-ink tabular-nums"
          >
            {priceLabel}
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        {showAdd && !blocked ? (
          <Button variant="secondary" onClick={onAdd} data-tour="addons-add">
            Add to site
          </Button>
        ) : null}
        {showAdd && blocked ? (
          <Button
            variant="secondary"
            aria-disabled
            aria-describedby={reasonId}
            className="cursor-not-allowed opacity-50"
          >
            Add to site
          </Button>
        ) : null}
        {canAdd && active ? (
          <Link
            href={manageHref}
            aria-label={`Manage ${name}`}
            className={buttonClasses("secondary")}
          >
            Manage
          </Link>
        ) : null}
        <Link
          href={href}
          aria-label={`${name} details`}
          className={buttonClasses("ghost")}
        >
          Details
        </Link>
      </div>
      {showAdd && blocked ? (
        <p id={reasonId} className="text-sm text-hub-ink-muted">
          {soon ? ADDON_CARD_COPY.comingSoonReason : ADDON_CARD_COPY.unpriced}
        </p>
      ) : null}
    </article>
  );
}
