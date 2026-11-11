// SlaCard (13-42 choice 4; STAFF-21, D212; 13-UI-SPEC "Ratings & SLA" lines 597-609). Heading
// "First replies", one Body line that is the `support:sla` CLI line verbatim (`slaReportLine`,
// computed on the server), then the missed tickets as links "#1031 · 3h late". No gauge, no
// percentage ring. Server-safe (no hooks).

export const SLA_CARD_COPY = Object.freeze({
  heading: "First replies",
  missed: "Missed first replies",
  missedItem: (n: number, late: string) => `#${n} · ${late}`,
});

export type SlaMissedView = {
  number: number;
  /** "3h late" (`slaLateLabel`). */
  late: string;
};

export interface SlaCardProps {
  /** "October 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)". */
  line: string;
  missed: readonly SlaMissedView[];
  /** Ticket link; defaults to the console ticket page. */
  hrefFor?: (number: number) => string;
}

const LINK =
  "rounded font-semibold text-hub-accent underline underline-offset-2 tabular-nums " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function SlaCard({
  line,
  missed,
  hrefFor = (n) => `/staff/tickets/${n}`,
}: SlaCardProps) {
  return (
    <section
      aria-labelledby="sla-card-h"
      className="flex flex-col gap-3 rounded-lg border border-hub-border bg-hub-surface p-4 font-hub text-hub-ink"
      data-sla-card=""
    >
      <h2 id="sla-card-h" className="text-base font-semibold">
        {SLA_CARD_COPY.heading}
      </h2>
      <p className="text-base tabular-nums" data-sla-line="">
        {line}
      </p>
      {missed.length > 0 ? (
        <ul
          aria-label={SLA_CARD_COPY.missed}
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
        >
          {missed.map((m) => (
            <li key={m.number}>
              <a href={hrefFor(m.number)} className={LINK}>
                {SLA_CARD_COPY.missedItem(m.number, m.late)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
