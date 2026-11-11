"use client";
// Section 3 add-on and extras rows (ONB-06, ONB-11; UI-SPEC "Section 3 · Add-ons"; D181,
// D185, D186, D299). Rows, not a card grid: each row is a <label> around a native checkbox
// (accent-color), name + summary on the left, the catalog price on the right in tabular
// figures, or "Price coming soon". Recommended rows first; "See all add-ons (N)" discloses
// the rest in catalog order. With nothing recommended, the list starts expanded.
// 13-32 (STAFF-07): copy and order come from the merged catalog view; a coming-soon add-on
// shows a neutral "Coming soon" badge and a disabled checkbox (the quote action refuses it
// too).
import type { AddonPath } from "@cds/core/addons";
import type { Extra, PickableAddon } from "@cds/core/onboarding";
import type { CatalogRow } from "@cds/core/pricing";
import { Badge } from "@cds/ui/hub";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  catalogRow,
  NOTHING_RECOMMENDED,
  PRICE_SOON,
  priceLabelFor,
} from "./start-logic";

export interface AddonPickListProps {
  path: AddonPath;
  catalog: readonly CatalogRow[] | null;
  recommended: readonly PickableAddon[];
  rest: readonly PickableAddon[];
  extras: readonly Extra[];
  /** Add-ons listed as coming soon: shown, never pickable. */
  comingSoon?: readonly string[];
  selectedAddons: readonly string[];
  selectedExtras: readonly string[];
  onToggleAddon: (slug: string, on: boolean) => void;
  onToggleExtra: (key: string, on: boolean) => void;
}

function Row({
  name,
  value,
  summary,
  price,
  checked,
  onToggle,
  comingSoon = false,
}: {
  name: string;
  value: string;
  summary: string;
  price: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  comingSoon?: boolean;
}) {
  const soon = price === PRICE_SOON;
  return (
    <li>
      <label
        className={
          "flex items-start gap-4 border-b border-hub-border p-4 " +
          "transition-colors duration-150 motion-reduce:transition-none " +
          (comingSoon
            ? "cursor-not-allowed"
            : checked
              ? "cursor-pointer bg-hub-accent-tint"
              : "cursor-pointer hover:bg-hub-surface-2")
        }
      >
        <input
          type="checkbox"
          value={value}
          checked={comingSoon ? false : checked}
          disabled={comingSoon}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-hub-accent pointer-coarse:h-6 pointer-coarse:w-6"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{name}</span>
              {comingSoon ? (
                <Badge tone="coming-soon">{COMING_SOON}</Badge>
              ) : null}
            </span>
            <span className="text-base text-hub-ink-muted md:truncate">
              {summary}
            </span>
          </span>
          <span
            className={
              soon
                ? "shrink-0 text-sm text-hub-ink-muted"
                : "shrink-0 text-base font-semibold tabular-nums"
            }
          >
            {price}
          </span>
        </span>
      </label>
    </li>
  );
}

/** 13-32: the neutral badge on a listed add-on that can't be picked yet. */
export const COMING_SOON = "Coming soon";

const NO_SLUGS: readonly string[] = [];

export function AddonPickList({
  path,
  catalog,
  recommended,
  rest,
  extras,
  comingSoon = NO_SLUGS,
  selectedAddons,
  selectedExtras,
  onToggleAddon,
  onToggleExtra,
}: AddonPickListProps) {
  const nothingRecommended = recommended.length === 0;
  // Starts expanded when nothing is recommended; the parent keys this list by business
  // type, so a new type resets it.
  // Starts expanded when nothing is recommended. The parent keys this list by path and
  // business type, so a new choice resets it.
  const [expanded, setOpen] = useState(nothingRecommended);

  const addonRow = (a: PickableAddon) => (
    <Row
      key={a.slug}
      name={a.name}
      value={a.slug}
      summary={a.summary}
      price={priceLabelFor(catalogRow(catalog, "addon", a.slug, path))}
      checked={selectedAddons.includes(a.slug)}
      onToggle={(on) => onToggleAddon(a.slug, on)}
      comingSoon={comingSoon.includes(a.slug)}
    />
  );

  return (
    <div className="flex flex-col">
      {nothingRecommended ? (
        <p className="text-base text-hub-ink-muted">{NOTHING_RECOMMENDED}</p>
      ) : (
        <ul className="border-t border-hub-border">
          {recommended.map(addonRow)}
        </ul>
      )}

      {rest.length > 0 ? (
        <div className="mt-4 flex flex-col">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="start-addons-all"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-10 items-center gap-2 self-start rounded px-2 text-base font-semibold hover:bg-hub-surface-2 pointer-coarse:min-h-11"
          >
            See all add-ons ({rest.length})
            <ChevronDown
              aria-hidden
              size={16}
              strokeWidth={2}
              className={
                "transition-transform duration-150 motion-reduce:transition-none " +
                (expanded ? "rotate-180" : "")
              }
            />
          </button>
          {expanded ? (
            <ul
              id="start-addons-all"
              className="mt-2 border-t border-hub-border"
            >
              {rest.map(addonRow)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <h3
        id="start-extras-title"
        className="mt-12 text-xl leading-tight font-semibold"
      >
        Want help with any of these?
      </h3>
      <ul
        aria-labelledby="start-extras-title"
        className="mt-4 border-t border-hub-border"
      >
        {extras.map((x) => (
          <Row
            key={x.key}
            name={x.label}
            value={x.key}
            summary={x.description}
            price={priceLabelFor(catalogRow(catalog, "extra", x.key, path))}
            checked={selectedExtras.includes(x.key)}
            onToggle={(on) => onToggleExtra(x.key, on)}
          />
        ))}
      </ul>
    </div>
  );
}
