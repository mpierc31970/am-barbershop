"use client";
// TodayCards (11-19; DASH-21, DASH-22; 11-UI-SPEC "Today" §§ 4-5). The "Your day" section:
// Heading + ghost sm Customize (SlidersHorizontal), then the person's cards stacked full width,
// 16px apart. The server already filtered the cards by grants and ordered them
// (defaultCardOrder with the person's layout); after a Customize save the section re-orders
// and hides at once (the page also refreshes behind the sheet so newly shown cards load).
// A card whose provider failed shows its ERR-SECTION line; the others render.
// All cards hidden: "You've hidden all your cards." + a Customize link-button.
import type { TodayCardData } from "@cds/core/today";
import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { TODAY_CARDS_COPY } from "./copy";
import {
  CustomizeTodaySheet,
  type CustomizeCard,
  type TodayLayout,
} from "./CustomizeTodaySheet";
import { TodayCard, TodayCardError } from "./TodayCard";

export type TodayCardView =
  | {
      id: string;
      title: string;
      state: "ok";
      data: TodayCardData;
      footer?: string;
      empty?: string;
    }
  | { id: string; title: string; state: "error" };

export interface TodayCardsProps {
  /** Visible cards with their data, in the person's order. */
  cards: readonly TodayCardView[];
  /** Every card the person may see (visible first, then hidden), for Customize. */
  all: readonly CustomizeCard[];
  hidden: readonly string[];
  defaultOrder: readonly string[];
  impersonating?: boolean;
  /** False: numbers only (no links; D310). */
  linked?: boolean;
  onSave: (layout: TodayLayout) => Promise<HubActionResult<unknown>>;
  onSaved?: (layout: TodayLayout) => void;
  LinkComponent?: HubLinkComponent;
}

/** The visible cards for a saved layout, keeping the server's order for ids it doesn't name. */
export function applyLayout<T extends { id: string }>(
  cards: readonly T[],
  layout: TodayLayout | null,
): T[] {
  if (!layout) return [...cards];
  const hidden = new Set(layout.hidden);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const named = layout.order
    .map((id) => byId.get(id))
    .filter((c): c is T => c !== undefined);
  const rest = cards.filter((c) => !layout.order.includes(c.id));
  return [...named, ...rest].filter((c) => !hidden.has(c.id));
}

export function TodayCards({
  cards,
  all,
  hidden,
  defaultOrder,
  impersonating = false,
  linked = true,
  onSave,
  onSaved,
  LinkComponent,
}: TodayCardsProps) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<TodayLayout | null>(null);
  const shown = applyLayout(cards, layout);
  // Reset sends an empty order: show the default order at once.
  const ordered =
    layout && layout.order.length === 0
      ? [...shown].sort(
          (a, b) => defaultOrder.indexOf(a.id) - defaultOrder.indexOf(b.id),
        )
      : shown;
  const openSheet = () => setOpen(true);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-today-cards=""
      data-tour="today-cards"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {TODAY_CARDS_COPY.yourDay}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={openSheet}
          icon={<SlidersHorizontal aria-hidden size={16} strokeWidth={2} />}
          data-tour="today-customize"
        >
          {TODAY_CARDS_COPY.customize}
        </Button>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-hub-ink-muted" data-all-hidden="">
          {TODAY_CARDS_COPY.allHidden}{" "}
          <button
            type="button"
            onClick={openSheet}
            className="rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            {TODAY_CARDS_COPY.customize}
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {ordered.map((c) =>
            c.state === "ok" ? (
              <TodayCard
                key={c.id}
                id={c.id}
                data={c.data}
                footer={c.footer}
                empty={c.empty}
                linked={linked}
                LinkComponent={LinkComponent}
              />
            ) : (
              <TodayCardError key={c.id} id={c.id} title={c.title} />
            ),
          )}
        </div>
      )}
      <CustomizeTodaySheet
        open={open}
        onClose={() => setOpen(false)}
        cards={all}
        hidden={layout ? layout.hidden : hidden}
        defaultOrder={defaultOrder}
        impersonating={impersonating}
        onSave={onSave}
        onSaved={(l) => {
          setLayout(l);
          onSaved?.(l);
        }}
      />
    </section>
  );
}
