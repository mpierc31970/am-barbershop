"use client";
// VisitorsChart (11-33; DASH-11; 11-UI-SPEC "Reports" section 2 `DailyVisitsChart`,
// "Accessibility contract" Charts; D-UI-P11-14). One hand-built SVG column chart, no chart
// library. The table is the server render and the no-JS default (the accessible
// equivalent); "Show as chart" swaps in the SVG, "Show as table" swaps back.
// Chart: 160px tall, one column per day (ink at 80%, 2px radius, 2px gap), 3 gridlines with
// tabular labels, x labels every 7th day. The chart group takes focus; Left/Right/Home/End
// move between days and the tooltip ("Fri 3 Oct · 84 visitors") is its aria-describedby.
import { useId, useState, type KeyboardEvent } from "react";
import { buttonClasses } from "../Button";
import {
  REPORTS_COPY,
  formatCount,
  formatDayLong,
  formatDayShort,
  plural,
} from "./copy";

export interface VisitorsDay {
  day: string;
  views: number;
}

export interface VisitorsChartProps {
  days: readonly VisitorsDay[];
  /** Start in chart view (tests and callers that know JS is on). Default: table. */
  initialView?: "table" | "chart";
}

const HEIGHT = 160;
const COL_GAP = 2;
const VIEW_W = 720;

/** A round axis top >= max (1, 2, 2.5, 5 x 10^n), divisible into 3 gridlines. */
export function niceAxisMax(max: number): number {
  if (!(max > 0)) return 3;
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const step = m * pow;
    if (step * 3 >= max && Number.isInteger(step)) return step * 3;
  }
  return Math.ceil(raw) * 3;
}

/** "Visitors by day, highest 84 on 3 Oct" (the chart group's text summary). */
export function chartSummary(days: readonly VisitorsDay[]): string {
  if (days.length === 0) return "Visitors by day, no days in this period";
  let top = days[0]!;
  for (const d of days) if (d.views > top.views) top = d;
  if (top.views === 0) return "Visitors by day, no visitors in this period";
  return `Visitors by day, highest ${formatCount(top.views)} on ${formatDayShort(top.day)}`;
}

function tooltipOf(d: VisitorsDay): string {
  return `${formatDayLong(d.day)} · ${plural(d.views, "visitor", "visitors")}`;
}

export function VisitorsChart({
  days,
  initialView = "table",
}: VisitorsChartProps) {
  const [view, setView] = useState<"table" | "chart">(initialView);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const summary = chartSummary(days);
  const n = days.length;

  const axisMax = niceAxisMax(Math.max(0, ...days.map((d) => d.views)));
  const colW = n > 0 ? VIEW_W / n : VIEW_W;
  const barW = Math.max(1, colW - COL_GAP);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const cur = active ?? -1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp")
      next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown")
      next = Math.max(0, cur < 0 ? n - 1 : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  }

  const toggle = (
    <button
      type="button"
      className={buttonClasses("ghost", "sm")}
      onClick={() => {
        setView(view === "table" ? "chart" : "table");
        setActive(null);
      }}
    >
      {view === "table" ? REPORTS_COPY.showChart : REPORTS_COPY.showTable}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 font-hub text-hub-ink">
      <div className="flex justify-end">{toggle}</div>
      {view === "table" ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr className="border-b border-hub-border text-left text-hub-ink-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Day
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Visitors
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-b border-hub-border">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {formatDayLong(d.day)}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {formatCount(d.views)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="group"
          tabIndex={0}
          aria-label={summary}
          aria-describedby={active !== null ? tipId : undefined}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="relative rounded outline-none focus-visible:ring-2 focus-visible:ring-hub-accent"
        >
          <div className="flex">
            <div aria-hidden="true" className="relative h-40 w-10 shrink-0">
              {[1, 2, 3].map((g) => (
                <span
                  key={g}
                  className="absolute right-1.5 -translate-y-1/2 text-xs text-hub-ink-muted tabular-nums"
                  style={{ top: `${100 - (100 * g) / 3}%` }}
                >
                  {formatCount((axisMax * g) / 3)}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <svg
                role="img"
                aria-label={summary}
                viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
                preserveAspectRatio="none"
                className="block h-40 w-full"
              >
                {[1, 2, 3].map((g) => {
                  const y = HEIGHT - (HEIGHT * g) / 3;
                  return (
                    <line
                      key={g}
                      x1={0}
                      x2={VIEW_W}
                      y1={y}
                      y2={y}
                      stroke="var(--hub-border)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                <line
                  x1={0}
                  x2={VIEW_W}
                  y1={HEIGHT}
                  y2={HEIGHT}
                  stroke="var(--hub-border-strong)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {days.map((d, i) => {
                  const h = axisMax > 0 ? (d.views / axisMax) * HEIGHT : 0;
                  const x = i * colW + COL_GAP / 2;
                  return (
                    <g
                      key={d.day}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                    >
                      <rect
                        x={x}
                        y={0}
                        width={barW}
                        height={HEIGHT}
                        fill="transparent"
                      />
                      <rect
                        data-column={d.day}
                        x={x}
                        y={HEIGHT - h}
                        width={barW}
                        height={h}
                        rx={2}
                        fill="var(--hub-ink)"
                        fillOpacity={active === i ? 1 : 0.8}
                      />
                    </g>
                  );
                })}
              </svg>
              <div aria-hidden="true" className="relative h-5">
                {days.map((d, i) =>
                  i % 7 === 0 ? (
                    <span
                      key={d.day}
                      className="absolute top-1 text-xs whitespace-nowrap text-hub-ink-muted"
                      style={{ left: `${(i / Math.max(1, n)) * 100}%` }}
                    >
                      {formatDayShort(d.day)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          </div>
          {active !== null && days[active] ? (
            <p
              id={tipId}
              role="status"
              className="pointer-events-none absolute top-0 rounded bg-hub-ink px-2 py-1 text-sm whitespace-nowrap text-white"
              style={{
                left: `${Math.min(75, (active / Math.max(1, n)) * 100)}%`,
              }}
            >
              {tooltipOf(days[active])}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
