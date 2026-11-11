// Staff Today building blocks (13-47 choice 3; STAFF-20, D-UI-P13-5; 13-UI-SPEC "Today" lines
// 340-376). Server-safe (no hooks): the app passes plain views built from staffTodayCounts.
// - CountRow: one needs-attention link row, min 56px, marker column 24px (severity icon or
//   blank) · count (600, tabular) · text · "oldest 2d" (ink-muted) · ChevronRight. Accessible
//   name: "3 tickets at SLA risk, oldest 2 days. Open." A failed source shows "Couldn't count".
// - CountRowList: the single <ul> (1px dividers) under the "Needs attention" heading, or the
//   TODAY-EMPTY state (P13_COPY) with "See all open tickets" when there are no rows.
// - TodayStatusLine: "14 live · 3 building · 9 open tickets · Jobs OK" (each segment a link;
//   "1 job late" in warning text with TriangleAlert 14). No tiles, no charts (D-UI-P13-5).
import { P13_COPY } from "@cds/core/staff";
import {
  ChevronRight,
  ClockAlert,
  Hourglass,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { EmptyState } from "../../hub/feedback";
import { STAFF_TODAY_COPY as C } from "./copy";

export type TodaySeverity = "critical" | "warn" | "info";

export interface TodayRowView {
  id: string;
  /** null = the source failed. */
  count: number | null;
  severity: TodaySeverity;
  label: string;
  href: string;
  oldestDays?: number | null;
}

export interface TodayStatusView {
  live: number | null;
  building: number | null;
  openTickets: number | null;
  jobsLate: number | null;
}

export type TodayLinkComponent = ComponentType<{
  href: string;
  className?: string;
  "aria-label"?: string;
  children?: ReactNode;
}>;

function PlainLink(props: {
  href: string;
  className?: string;
  "aria-label"?: string;
  children?: ReactNode;
}) {
  return <a {...props} />;
}

/** The marker for a row: severity and row id pick the icon; info rows have none. */
export function todayMarker(
  row: Pick<TodayRowView, "id" | "severity" | "count">,
): { Icon: LucideIcon; className: string } | null {
  if (row.count === null || row.severity === "info") return null;
  const className =
    row.severity === "critical" ? "text-hub-danger" : "text-hub-warning";
  if (row.id === "sla_at_risk") return { Icon: ClockAlert, className };
  if (row.id === "held_late") return { Icon: Hourglass, className };
  return { Icon: TriangleAlert, className };
}

/** "3 tickets at SLA risk, oldest 2 days. Open." */
export function countRowName(row: TodayRowView): string {
  if (row.count === null) return `${row.label}: ${C.couldntCount}. ${C.open}`;
  const age =
    typeof row.oldestDays === "number" ? `, ${C.oldestSr(row.oldestDays)}` : "";
  return `${row.label}${age}. ${C.open}`;
}

/** Splits "3 tickets at SLA risk" into the count and the rest (the count is styled). */
function splitLabel(row: TodayRowView): { count: string; text: string } {
  if (row.count === null) return { count: "", text: row.label };
  const prefix = `${row.count} `;
  return row.label.startsWith(prefix)
    ? { count: String(row.count), text: row.label.slice(prefix.length) }
    : { count: "", text: row.label };
}

export function CountRow({
  row,
  LinkComponent = PlainLink,
}: {
  row: TodayRowView;
  LinkComponent?: TodayLinkComponent;
}) {
  const marker = todayMarker(row);
  const { count, text } = splitLabel(row);
  return (
    <li
      data-today-row={row.id}
      className="border-b border-hub-border last:border-b-0"
    >
      <LinkComponent
        href={row.href}
        aria-label={countRowName(row)}
        className={
          "flex min-h-14 items-center gap-3 px-2 py-4 text-base text-hub-ink " +
          "hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 " +
          "focus-visible:outline-hub-accent"
        }
      >
        <span className="flex w-6 shrink-0 justify-center" aria-hidden="true">
          {marker ? (
            <marker.Icon
              size={16}
              strokeWidth={2}
              className={marker.className}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          {count ? (
            <span className="font-semibold tabular-nums">{count}</span>
          ) : null}
          <span>{text}</span>
          {row.count === null ? (
            <span className="text-sm text-hub-ink-muted">{C.couldntCount}</span>
          ) : typeof row.oldestDays === "number" ? (
            <span className="text-sm text-hub-ink-muted">
              {C.oldest(row.oldestDays)}
            </span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="shrink-0 text-hub-ink-muted"
        />
      </LinkComponent>
    </li>
  );
}

export function CountRowList({
  rows,
  LinkComponent = PlainLink,
  openTicketsHref = "/staff/tickets",
}: {
  rows: readonly TodayRowView[];
  LinkComponent?: TodayLinkComponent;
  openTicketsHref?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-12">
        <EmptyState
          heading={P13_COPY.TODAY_EMPTY_H}
          body={P13_COPY.TODAY_EMPTY_B}
          action={
            <LinkComponent
              href={openTicketsHref}
              className="text-sm font-semibold text-hub-accent underline-offset-2 hover:underline"
            >
              {C.seeAllOpen}
            </LinkComponent>
          }
        />
      </div>
    );
  }
  return (
    <section aria-labelledby="today-needs" className="flex flex-col gap-2">
      <h2 id="today-needs" className="text-xl leading-tight font-semibold">
        {C.needsAttention}
      </h2>
      <ul className="flex flex-col border-t border-hub-border">
        {rows.map((r) => (
          <CountRow key={r.id} row={r} LinkComponent={LinkComponent} />
        ))}
      </ul>
    </section>
  );
}

export function TodayStatusLine({
  status,
  LinkComponent = PlainLink,
}: {
  status: TodayStatusView;
  LinkComponent?: TodayLinkComponent;
}) {
  const link = "underline-offset-2 hover:underline";
  const parts: ReactNode[] = [];
  if (status.live !== null)
    parts.push(
      <LinkComponent
        key="live"
        href="/staff/sites?status=live"
        className={link}
      >
        {C.live(status.live)}
      </LinkComponent>,
    );
  if (status.building !== null)
    parts.push(
      <LinkComponent
        key="building"
        href="/staff/pipeline?tab=building"
        className={link}
      >
        {C.building(status.building)}
      </LinkComponent>,
    );
  if (status.openTickets !== null)
    parts.push(
      <LinkComponent key="tickets" href="/staff/tickets" className={link}>
        {C.openTickets(status.openTickets)}
      </LinkComponent>,
    );
  if (status.jobsLate !== null)
    parts.push(
      status.jobsLate > 0 ? (
        <LinkComponent
          key="jobs"
          href="/staff/health?tab=jobs"
          className={`${link} inline-flex items-center gap-1 text-hub-warning`}
        >
          <TriangleAlert aria-hidden="true" size={14} strokeWidth={2} />
          {C.jobsLate(status.jobsLate)}
        </LinkComponent>
      ) : (
        <LinkComponent
          key="jobs"
          href="/staff/health?tab=jobs"
          className={link}
        >
          {C.jobsOk}
        </LinkComponent>
      ),
    );
  if (parts.length === 0) return null;
  return (
    <p
      aria-label={C.statusLabel}
      className="flex flex-wrap items-center gap-x-1 text-sm text-hub-ink-muted"
    >
      {parts.flatMap((p, i) =>
        i === 0
          ? [p]
          : [
              <span key={`sep-${i}`} aria-hidden="true">
                ·
              </span>,
              p,
            ],
      )}
    </p>
  );
}
