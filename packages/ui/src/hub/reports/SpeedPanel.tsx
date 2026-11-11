// SpeedPanel (11-33; DASH-11; 11-UI-SPEC "Reports" section 6). Real-visitor speed at the
// 75th percentile, Phone and Computer columns: Loading (LCP), Responsiveness (INP), Visual
// stability (CLS), each a tabular value + speed-* badge (word, never colour alone). Fewer
// than 20 visits in the period: SPEED-FEW. Before launch the page shows SPEED-PRELAUNCH
// instead (the caller decides). Server-safe; structural types (no @cds/db import).
import type { VitalMetric, VitalRating } from "@cds/core/analytics";
import { Badge, type BadgeTone } from "../Badge";
import { REPORTS_COPY, SPEED_ROWS, SPEED_WORDS, formatVital } from "./copy";

export type SpeedValue = { p75: number; rating: VitalRating } | null;
export type SpeedDevice = Readonly<Record<VitalMetric, SpeedValue>>;

export interface SpeedPanelProps {
  phone: SpeedDevice;
  computer: SpeedDevice;
  /** Visits in the period; under 20 shows SPEED-FEW. */
  visits: number;
}

export const SPEED_MIN_VISITS = 20;

const TONE: Readonly<Record<VitalRating, BadgeTone>> = {
  good: "speed-good",
  "needs-work": "speed-work",
  poor: "speed-poor",
};

function Cell({ metric, value }: { metric: VitalMetric; value: SpeedValue }) {
  if (!value)
    return <span className="text-hub-ink-muted">Not enough data</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="tabular-nums">{formatVital(metric, value.p75)}</span>
      <Badge tone={TONE[value.rating]}>{SPEED_WORDS[value.rating]}</Badge>
    </span>
  );
}

export function SpeedPanel({ phone, computer, visits }: SpeedPanelProps) {
  const hasAny = SPEED_ROWS.some(
    (r) => phone[r.metric] !== null || computer[r.metric] !== null,
  );
  if (visits < SPEED_MIN_VISITS || !hasAny) {
    return (
      <p className="font-hub text-base text-hub-ink-muted">
        {REPORTS_COPY.speedFew}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 font-hub text-hub-ink">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Page speed for real visitors</caption>
          <thead>
            <tr className="border-b border-hub-border text-hub-ink-muted">
              <th scope="col" className="py-2 pr-4 text-left font-semibold">
                Measure
              </th>
              <th scope="col" className="py-2 pl-4 text-right font-semibold">
                Phone
              </th>
              <th scope="col" className="py-2 pl-4 text-right font-semibold">
                Computer
              </th>
            </tr>
          </thead>
          <tbody>
            {SPEED_ROWS.map((r) => (
              <tr key={r.metric} className="border-b border-hub-border">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {r.label}{" "}
                  <span className="text-hub-ink-muted">({r.code})</span>
                </th>
                <td className="py-2 pl-4 text-right">
                  <Cell metric={r.metric} value={phone[r.metric]} />
                </td>
                <td className="py-2 pl-4 text-right">
                  <Cell metric={r.metric} value={computer[r.metric]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-hub-ink-muted">{REPORTS_COPY.speedHelp}</p>
    </div>
  );
}
