// HealthTable, HealthStateBadge, HealthStatusLine and PremiumHealthTable (13-45 choice 1;
// STAFF-13, D154, D-UI-P13-22; 13-UI-SPEC "Health" lines 873-893, tones line 216, states
// line 1019). Read-only tables (no row links, so a plain semantic table, not StaffTable):
// Component · State (`h-*` badge, the word always shown; critical carries TriangleAlert) ·
// Reading (tabular) · Threshold (ThresholdCell) · Since ("Warning since 2:10 PM"). Rows sort
// critical, warning, OK, then no data. A stand-in (level `none` with "(stand-in)" in the
// reading) shows "Stand-in" on the h-none tone: stand-ins are stated in words, never as errors.
// Server-safe: the Refresh button is a slot filled by the app (router.refresh()).
import type { HealthLevel } from "@cds/core/health";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { formatHealthClock, formatHealthTime, HEALTH_COPY as C } from "./copy";
import { ThresholdCell } from "./ThresholdCell";

export interface HealthRowView {
  id: string;
  label: string;
  reading: string;
  level: HealthLevel;
  /** One threshold line ("warn > 500 ms · critical > 2 s"). */
  threshold: string;
  /** ISO time the open incident started, else null. */
  since: string | null;
}

export const HEALTH_TONE: Readonly<Record<HealthLevel, BadgeTone>> = {
  ok: "h-ok",
  warn: "h-warn",
  critical: "h-critical",
  none: "h-none",
};

const ORDER: Readonly<Record<HealthLevel, number>> = {
  critical: 0,
  warn: 1,
  ok: 2,
  none: 3,
};

/** Critical, warning, OK, no data; label order within a level. */
export function sortHealthRows<T extends { level: HealthLevel; label: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) => ORDER[a.level] - ORDER[b.level] || a.label.localeCompare(b.label),
  );
}

export function isStandIn(reading: string): boolean {
  return /\(stand-in\)|\bstand-in\b/i.test(reading);
}

export function HealthStateBadge({
  level,
  reading = "",
}: {
  level: HealthLevel;
  reading?: string;
}) {
  const word =
    level === "none" && isStandIn(reading) ? C.standIn : C.level[level];
  return <Badge tone={HEALTH_TONE[level]}>{word}</Badge>;
}

/** "Warning since 2:10 PM"; empty when no incident is open. */
export function healthSinceText(
  level: HealthLevel,
  since: string | null,
): string {
  const at = formatHealthClock(since);
  if (!at || level === "ok" || level === "none") return "";
  return `${C.sinceWord[level]} since ${at}`;
}

const TH =
  "px-3 py-2 text-left text-sm font-semibold text-hub-ink-muted whitespace-nowrap";
const TD = "px-3 py-3 align-top text-base";

export function HealthTable({
  caption,
  rows,
  firstColumn = C.cols.component,
  sort = true,
  extra,
}: {
  caption: string;
  rows: readonly HealthRowView[];
  firstColumn?: string;
  /** Sort critical first (default). Backups keep their own order. */
  sort?: boolean;
  /** Extra content under a row's label (the restore Runbook line). */
  extra?: (row: HealthRowView) => ReactNode;
}) {
  const list = sort ? sortHealthRows(rows) : rows;
  return (
    <div className="overflow-x-auto rounded border border-hub-border bg-hub-surface">
      <table className="w-full border-collapse font-hub text-hub-ink">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-hub-border bg-hub-surface-2">
          <tr>
            <th scope="col" className={TH}>
              {firstColumn}
            </th>
            <th scope="col" className={TH}>
              {C.cols.state}
            </th>
            <th scope="col" className={TH}>
              {C.cols.reading}
            </th>
            <th scope="col" className={`${TH} max-md:hidden`}>
              {C.cols.threshold}
            </th>
            <th scope="col" className={`${TH} max-md:hidden`}>
              {C.cols.since}
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
                <th scope="row" className={`${TD} text-left font-semibold`}>
                  {r.label}
                  {extra ? extra(r) : null}
                </th>
                <td className={TD}>
                  <HealthStateBadge level={r.level} reading={r.reading} />
                </td>
                <td className={`${TD} tabular-nums`}>{r.reading}</td>
                <td className={`${TD} max-md:hidden`}>
                  <ThresholdCell text={r.threshold} />
                </td>
                <td
                  className={`${TD} text-sm text-hub-ink-muted max-md:hidden`}
                  title={formatHealthTime(r.since) ?? undefined}
                >
                  {since || C.none}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Checked 2 min ago · Alerts email m•••@example.com" + the Refresh slot. */
export function HealthStatusLine({
  checkedAgo,
  alertEmail,
  refresh,
}: {
  checkedAgo: string;
  alertEmail: string | null;
  refresh?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-hub">
      <p className="text-sm text-hub-ink-muted">
        {C.checked(checkedAgo, alertEmail)}
      </p>
      {refresh ? <div className="ml-auto">{refresh}</div> : null}
    </div>
  );
}

export interface PremiumHealthRowView {
  orgId: string;
  business: string;
  addon: string;
  checks: number;
  passing: number | null;
  errorRate1h: number | null;
  dbWriteP95Ms: number | null;
  failedEmails1h: number | null;
  level: HealthLevel;
}

function n(v: number | null, suffix = ""): string {
  return v === null ? C.none : `${v}${suffix}`;
}

/** Premium tab: one row per (site, premium add-on). Empty state is the panel's (PREMIUM-EMPTY). */
export function PremiumHealthTable({
  rows,
  siteHref = (orgId) => `/staff/sites/${orgId}`,
}: {
  rows: readonly PremiumHealthRowView[];
  siteHref?: (orgId: string) => string;
}) {
  const list = [...rows].sort(
    (a, b) =>
      ORDER[a.level] - ORDER[b.level] || a.business.localeCompare(b.business),
  );
  return (
    <div className="overflow-x-auto rounded border border-hub-border bg-hub-surface">
      <table className="w-full border-collapse font-hub text-hub-ink">
        <caption className="sr-only">{C.premiumCaption}</caption>
        <thead className="border-b border-hub-border bg-hub-surface-2">
          <tr>
            <th scope="col" className={TH}>
              {C.cols.site}
            </th>
            <th scope="col" className={TH}>
              {C.cols.addon}
            </th>
            <th scope="col" className={TH}>
              {C.cols.checks}
            </th>
            <th scope="col" className={`${TH} max-md:hidden`}>
              {C.cols.errorRate}
            </th>
            <th scope="col" className={`${TH} max-md:hidden`}>
              {C.cols.dbWrite}
            </th>
            <th scope="col" className={`${TH} max-md:hidden`}>
              {C.cols.failed}
            </th>
            <th scope="col" className={TH}>
              {C.cols.state}
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr
              key={`${r.orgId}:${r.addon}`}
              className="border-b border-hub-border last:border-b-0"
            >
              <th scope="row" className={`${TD} text-left font-semibold`}>
                <a
                  href={siteHref(r.orgId)}
                  className="rounded underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                >
                  {r.business || r.orgId}
                </a>
              </th>
              <td className={TD}>{r.addon}</td>
              <td className={`${TD} tabular-nums`}>
                {r.passing === null
                  ? `${C.none} / ${r.checks}`
                  : `${r.passing} / ${r.checks}`}
              </td>
              <td className={`${TD} tabular-nums max-md:hidden`}>
                {r.errorRate1h === null
                  ? C.none
                  : `${Math.round(r.errorRate1h * 1000) / 10} %`}
              </td>
              <td className={`${TD} tabular-nums max-md:hidden`}>
                {n(r.dbWriteP95Ms, " ms")}
              </td>
              <td className={`${TD} tabular-nums max-md:hidden`}>
                {n(r.failedEmails1h)}
              </td>
              <td className={TD}>
                <HealthStateBadge level={r.level} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
