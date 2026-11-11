// TodayCard (11-19; DASH-21, DASH-22; 11-UI-SPEC "Today" § 4; D-UI-P11-9, D310). One card in
// the main column: 1px border, 8px radius, 24px padding; the card's Heading title with one
// right-aligned text link, then at most 4 rows (Body label left, Label value right, tabular),
// an optional footer line and, with no rows, the card's empty line (Label ink-muted).
// A list of rows, never a grid of icon tiles. `linked={false}` is the numbers-only variant
// (Viewers, D310): no row links and no card link. Server-safe (useId only).
import { TODAY_CARD_MAX_ROWS, type TodayCardData } from "@cds/core/today";
import { useId } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { TODAY_CARDS_COPY } from "./copy";

export interface TodayCardProps {
  id: string;
  data: TodayCardData;
  /** Shown under the rows (Label ink-muted), e.g. "7 messages this week". */
  footer?: string;
  /** Shown when there are no rows. */
  empty?: string;
  /** False: numbers only, no links (default true). */
  linked?: boolean;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-base text-hub-accent underline underline-offset-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function TodayCard({
  id,
  data,
  footer,
  empty,
  linked = true,
  LinkComponent,
}: TodayCardProps) {
  const headingId = useId();
  const Link = LinkComponent ?? "a";
  const rows = data.rows.slice(0, TODAY_CARD_MAX_ROWS);
  return (
    <section
      aria-labelledby={headingId}
      data-today-card={id}
      className="flex flex-col gap-3 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-lg leading-tight font-semibold">
          {data.title}
        </h3>
        {linked && data.link.href ? (
          <Link href={data.link.href} className={LINK}>
            {data.link.label}
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-hub-ink-muted" data-card-empty="">
          {empty ?? ""}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hub-border">
          {rows.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              data-card-row=""
              className="flex items-baseline justify-between gap-4 py-2"
            >
              {linked && r.href ? (
                <Link
                  href={r.href}
                  className="min-w-0 truncate rounded text-base text-hub-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                >
                  {r.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-base">{r.label}</span>
              )}
              <span className="shrink-0 text-sm text-hub-ink-muted tabular-nums">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer ? <p className="text-sm text-hub-ink-muted">{footer}</p> : null}
    </section>
  );
}

/** ERR-SECTION for one card (the rest of the cards render). */
export function TodayCardError({ id, title }: { id: string; title: string }) {
  return (
    <section
      data-today-card={id}
      data-card-error=""
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
    >
      <h3 className="text-lg leading-tight font-semibold">{title}</h3>
      <p className="text-sm text-hub-ink-muted">{TODAY_CARDS_COPY.cardError}</p>
    </section>
  );
}
