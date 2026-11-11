// JobTable (13-45 choice 1; STAFF-13, D-UI-P13-13; 13-UI-SPEC "Jobs" line 898): every job
// heartbeat, read-only (jobs run from the scheduler). Job (`health:run` + its label) ·
// Schedule · Last success (relative, absolute time in the title) · Last counts (the job's
// one-line reading) · State (`h-*`; late = warning, past critical = critical) · Threshold
// (ThresholdCell). Sorted critical first. Relative times come from the server (one clock).
import type { HealthLevel } from "@cds/core/health";
import { formatHealthTime, HEALTH_COPY as C } from "./copy";
import {
  HealthStateBadge,
  healthSinceText,
  sortHealthRows,
} from "./HealthTable";
import { ThresholdCell } from "./ThresholdCell";

export interface JobRowView {
  id: string;
  /** "support:run". */
  job: string;
  label: string;
  schedule: string;
  /** ISO, or null when the job never succeeded. */
  lastSuccess: string | null;
  /** "4 min ago" (server clock); null = never. */
  lastSuccessAgo: string | null;
  level: HealthLevel;
  /** The one-line reading ("Last success 4 min ago · 1 failed step"). */
  reading: string;
  warningText: string;
  criticalText: string | null;
  since: string | null;
}

const TH =
  "px-3 py-2 text-left text-sm font-semibold text-hub-ink-muted whitespace-nowrap";
const TD = "px-3 py-3 align-top text-base";

export function JobTable({ rows }: { rows: readonly JobRowView[] }) {
  const list = sortHealthRows(rows);
  return (
    <div className="flex flex-col gap-3 font-hub text-hub-ink">
      <p className="text-sm text-hub-ink-muted">{C.jobsNote}</p>
      <div className="overflow-x-auto rounded border border-hub-border bg-hub-surface">
        <table className="w-full border-collapse">
          <caption className="sr-only">{C.jobsCaption}</caption>
          <thead className="border-b border-hub-border bg-hub-surface-2">
            <tr>
              <th scope="col" className={TH}>
                {C.cols.job}
              </th>
              <th scope="col" className={`${TH} max-md:hidden`}>
                {C.cols.schedule}
              </th>
              <th scope="col" className={TH}>
                {C.cols.lastSuccess}
              </th>
              <th scope="col" className={`${TH} max-md:hidden`}>
                {C.cols.counts}
              </th>
              <th scope="col" className={TH}>
                {C.cols.state}
              </th>
              <th scope="col" className={`${TH} max-md:hidden`}>
                {C.cols.threshold}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const since = healthSinceText(r.level, r.since);
              return (
                <tr
                  key={r.id}
                  data-level={r.level}
                  className="border-b border-hub-border last:border-b-0"
                >
                  <th scope="row" className={`${TD} text-left`}>
                    <code className="font-semibold">{r.job}</code>
                    <span className="block text-sm font-normal text-hub-ink-muted">
                      {r.label}
                    </span>
                  </th>
                  <td className={`${TD} whitespace-nowrap max-md:hidden`}>
                    {r.schedule}
                  </td>
                  <td
                    className={`${TD} whitespace-nowrap tabular-nums`}
                    title={formatHealthTime(r.lastSuccess) ?? undefined}
                  >
                    {r.lastSuccessAgo ?? C.neverRun}
                  </td>
                  <td
                    className={`${TD} text-sm text-hub-ink-muted tabular-nums max-md:hidden`}
                  >
                    {r.reading}
                  </td>
                  <td className={TD}>
                    <HealthStateBadge level={r.level} reading={r.reading} />
                    {since ? (
                      <span className="mt-1 block text-sm text-hub-ink-muted">
                        {since}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${TD} max-md:hidden`}>
                    <ThresholdCell
                      warning={r.warningText}
                      critical={r.criticalText}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
