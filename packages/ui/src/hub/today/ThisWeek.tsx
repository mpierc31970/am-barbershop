// ThisWeek (11-19; DASH-23, DASH-32; 11-UI-SPEC "Today" § 6; D-UI-P11-9, D-UI-P11-30). Side
// rail panel on hub-surface-2: Heading "This week" + the business week ("Mon 6 – Sun 12 Oct"),
// then a <dl> of rows (Visitors, Messages, then Bookings / Sales when an add-on reports them):
// name left, figure right (Body 600, tabular) and under it the plain-word delta with an
// aria-hidden ArrowUp / ArrowDown / Minus. No Display numbers, no sparklines. Link "See your
// Site Report". Before launch the rows and link are replaced by WEEK-PRELAUNCH.
// Server-safe (useId only).
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useId } from "react";
import type { HubLinkComponent } from "../AddonCard";
import {
  TODAY_CARDS_COPY,
  TODAY_REPORTS_HREF,
  weekDelta,
  weekRangeLabel,
} from "./copy";

export type ThisWeekRow = {
  id: string;
  name: string;
  now: number;
  prev: number;
};

export interface ThisWeekProps {
  /** False before launch: WEEK-PRELAUNCH and no numbers. */
  live: boolean;
  /** The current business week, Monday first (YYYY-MM-DD). */
  days?: readonly string[];
  rows?: readonly ThisWeekRow[];
  LinkComponent?: HubLinkComponent;
}

const ICONS = { up: ArrowUp, down: ArrowDown, same: Minus } as const;

export function ThisWeek({
  live,
  days = [],
  rows = [],
  LinkComponent,
}: ThisWeekProps) {
  const headingId = useId();
  const Link = LinkComponent ?? "a";
  const range = live ? weekRangeLabel(days) : "";
  return (
    <section
      aria-labelledby={headingId}
      data-this-week=""
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {TODAY_CARDS_COPY.thisWeek}
        </h2>
        {range ? <p className="text-sm text-hub-ink-muted">{range}</p> : null}
      </div>
      {!live ? (
        <p className="text-base" data-week-prelaunch="">
          {TODAY_CARDS_COPY.weekPrelaunch}
        </p>
      ) : (
        <>
          <dl className="flex flex-col divide-y divide-hub-border">
            {rows.map((r) => {
              const d = weekDelta(r.now, r.prev);
              const Icon = ICONS[d.dir];
              return (
                <div
                  key={r.id}
                  data-week-row={r.id}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <dt className="text-base">{r.name}</dt>
                  <dd className="flex flex-col items-end gap-0.5">
                    <span className="text-base font-semibold tabular-nums">
                      {Math.round(r.now).toLocaleString("en-US")}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 text-sm text-hub-ink-muted"
                      data-delta={d.dir}
                    >
                      <Icon aria-hidden size={14} strokeWidth={2} />
                      {d.words}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <div>
            <Link
              href={TODAY_REPORTS_HREF}
              className="rounded text-base text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {TODAY_CARDS_COPY.seeReport}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
