// Staff table cells (13-07 choice 2; 13-UI-SPEC "Staff status tone map", "Typography").
// Server-safe: no hooks. Every number is tabular; SLA and priority always carry a word
// (colour is never the only signal), icons come from Badge and are aria-hidden.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  businessMsBetween,
  type Priority,
  type SlaState,
} from "@cds/core/support";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { STAFF_TABLE_COPY as C } from "./copy";

type When = Date | string | null | undefined;

function toDate(v: When): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Compact hours for SLA text: "45m" under an hour, else whole hours rounded up ("3h"). */
export function compactHours(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.ceil(ms / MIN))}m`;
  return `${Math.ceil(ms / HOUR - 1e-9)}h`;
}

export interface SlaCellProps {
  /** The P12 `slaState(...)` result for the ticket. */
  state: SlaState;
  dueAt?: When;
  repliedAt?: When;
  now: Date;
  tz?: string;
}

/**
 * First-reply SLA cell: missed → `sla-missed` "Missed · 3h late"; due_soon → `sla-risk`
 * "At risk · 2h"; on_track → muted "due in 11h"; met → `sla-met` "Met"; none → muted "—".
 * Times are business time (P12 `businessMsBetween`), the same clock the SLA uses.
 */
export function SlaCell({
  state,
  dueAt,
  repliedAt,
  now,
  tz = BUSINESS_TIME_ZONE,
}: SlaCellProps) {
  const due = toDate(dueAt);
  if (state === "met") return <Badge tone="sla-met">{C.slaMet}</Badge>;
  if (state === "none" || !due) {
    return <span className="text-sm text-hub-ink-muted">{C.slaNone}</span>;
  }
  if (state === "missed") {
    const end = toDate(repliedAt) ?? now;
    const late = businessMsBetween(due, end, tz);
    return (
      <Badge tone="sla-missed" className="tabular-nums">
        {C.slaMissed(compactHours(late))}
      </Badge>
    );
  }
  const left = businessMsBetween(now, due, tz);
  if (state === "due_soon") {
    return (
      <Badge tone="sla-risk" className="tabular-nums">
        {C.slaAtRisk(compactHours(left))}
      </Badge>
    );
  }
  return (
    <span className="text-sm whitespace-nowrap text-hub-ink-muted tabular-nums">
      {C.slaDueIn(compactHours(left))}
    </span>
  );
}

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  urgent: "p-urgent",
  high: "p-high",
  normal: "p-normal",
  low: "p-low",
};

/** Priority badge: Urgent (danger + TriangleAlert) / High / Normal / Low. */
export function PriorityCell({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{C.priority[priority]}</Badge>;
}

/**
 * Compact age: "20m", "4h", "2d", "3w"; past 8 weeks a date ("9 Oct", "9 Oct 2025" past a
 * year) in `tz`. Never negative (a future time reads "1m").
 */
export function compactAge(from: Date, now: Date, tz: string): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MIN))}m`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 14 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms <= 8 * WEEK) return `${Math.floor(ms / WEEK)}w`;
  const sameYear = ms < 365 * DAY;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(from);
}

export interface AgeCellProps {
  from: Date | string;
  now: Date;
  tz?: string;
}

export function AgeCell({ from, now, tz = BUSINESS_TIME_ZONE }: AgeCellProps) {
  const d = toDate(from);
  if (!d)
    return <span className="text-sm text-hub-ink-muted">{C.slaNone}</span>;
  const full = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
  return (
    <time
      dateTime={d.toISOString()}
      title={full}
      className="text-sm whitespace-nowrap text-hub-ink-muted tabular-nums"
    >
      {compactAge(d, now, tz)}
    </time>
  );
}

export interface ChipItem {
  id: string;
  label: string;
  href: string;
  pressed?: boolean;
  /** Shown after the label, tabular ("Submitted 3"). */
  count?: number;
}

const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1 rounded px-3 font-hub text-sm " +
  "whitespace-nowrap transition-colors duration-150 pointer-coarse:min-h-11 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

/**
 * Toggle-link chips shared by QuickFilters and StageChips. Links (a filtered view is a URL),
 * `role="button"` + `aria-pressed` so the pressed state is announced; the active chip takes
 * the accent tint + accent text, the rest stay neutral. Scrolls horizontally on phones.
 */
export function ChipRow({
  label,
  items,
}: {
  label: string;
  items: readonly ChipItem[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex max-w-full gap-1 overflow-x-auto max-sm:flex-nowrap sm:flex-wrap"
    >
      {items.map((it) => {
        const pressed = it.pressed === true;
        return (
          <a
            key={it.id}
            href={it.href}
            role="button"
            aria-pressed={pressed}
            className={
              CHIP +
              " " +
              (pressed
                ? "bg-hub-accent-tint font-semibold text-hub-accent"
                : "bg-hub-surface text-hub-ink hover:bg-hub-surface-2")
            }
          >
            {it.label}
            {it.count !== undefined ? (
              <>
                {" "}
                <span className="tabular-nums">{it.count}</span>
              </>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

export interface StageChip extends ChipItem {
  count: number;
}

/** Lead stage chips (13-UI-SPEC Pipeline › Leads): one per stage, in order, with counts. */
export function StageChips({
  label,
  stages,
}: {
  label: string;
  stages: readonly StageChip[];
}) {
  return <ChipRow label={label} items={stages} />;
}
