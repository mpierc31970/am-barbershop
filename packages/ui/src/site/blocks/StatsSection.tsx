// StatsSection (07-21; CONT-27, CONT-35, D-UI-P7-27; 07-UI-SPEC "Stats").
//
// An auto-fit row of numbers (min 200px, 32px gap), left-aligned. The server prints every
// final number; CountUp (direct island import, Countdown pattern) animates it once in view
// when count_up is on and the value parses. Each item's accessible name is an sr-only
// "250+ clients served"; the visual number and label are aria-hidden. The number colour is
// text, never accent. Incomplete items (blank label, blank or invalid value) are skipped;
// none left renders nothing. The heading is an <h2>: only the Hero or the page title owns
// the page H1. --site-* roles only. Server component.
import {
  STATS_VALUE,
  type StatsContent,
  type StatsItem,
} from "@cds/core/content";
import { CountUp } from "../client/CountUp";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { statsNumberParts } from "./stats-number";

function keptItems(content: StatsContent): StatsItem[] {
  const items = Array.isArray(content?.items) ? content.items : [];
  return items.filter(
    (i) =>
      !!i &&
      text(i.label) !== "" &&
      typeof i.value === "string" &&
      STATS_VALUE.test(i.value.trim()),
  );
}

export function StatsSection({
  content,
  layout,
  background,
}: SectionComponentProps<StatsContent>) {
  const c = (content ?? {}) as StatsContent;
  const items = keptItems(c);
  if (items.length === 0) return null;
  const heading = text(c.heading);
  const countUp = c.count_up === true;

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-8">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-8 text-left">
          {items.map((item) => {
            const value = item.value.trim();
            const prefix = text(item.prefix);
            const suffix = text(item.suffix);
            const label = text(item.label);
            const animate = countUp && statsNumberParts(value) !== null;
            return (
              <li key={item.id} className="flex flex-col gap-2">
                <span className="sr-only">{`${prefix}${value}${suffix} ${label}`}</span>
                <span aria-hidden="true" className="flex flex-col gap-2">
                  <span className="text-[length:var(--site-text-h2)] font-semibold leading-[1.2] text-site-text tabular-nums">
                    {prefix}
                    {animate ? <CountUp value={value} /> : value}
                    {suffix}
                  </span>
                  <span className={`${BODY_CLASS} text-site-text-muted`}>
                    {label}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </RowRenderer>
  );
}
