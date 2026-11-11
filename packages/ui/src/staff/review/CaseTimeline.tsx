"use client";
// CaseTimeline (13-38 choice 3; D249; 13-UI-SPEC "Case page" CaseTimeline). The DMCA / report
// steps as an <ol> on --hub-surface-2: Received → Content disabled → Owner notified →
// Counter-notice received → Restore date set → Restored / Upheld → Closed (reports skip the
// four DMCA-only steps). Done steps: CircleCheck 16 success + date + by; the current step: Label
// 600 ink "Next" with only the next allowed step buttons; later steps ink-muted. The buttons
// call `onStep(step)`; the caller opens the small CaseDialog and runs the action.
// P14 (14-38 choice 1): kinds `domain_move` and `offboarding` take their steps from data
// (`items`) and render with the same geometry: done steps CircleCheck success, a failed step
// TriangleAlert danger, the rest a hollow dot; an item with `more` content is a <details>,
// open by default when the step failed. The case kinds above are unchanged.
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../hub/Button";
import { REVIEW_COPY } from "./copy";

const C = REVIEW_COPY;

export type CaseTimelineStep =
  | "received"
  | "content_disabled"
  | "tenant_notified"
  | "counter_notice"
  | "restore_date_set"
  | "restored"
  | "upheld"
  | "closed";

export type CaseTimelineKind = "report" | "dmca" | "spot_check";

export interface CaseTimelineEntry {
  step: CaseTimelineStep;
  at: string;
  /** Display name of who did it ("You", "CDS staff", "Public form"). */
  byName?: string;
  note?: string;
  restoreDate?: string;
}

/** P14 kinds whose steps come from data (14-38 choice 1). */
export type CaseTimelineDataKind = "domain_move" | "offboarding";

export type CaseTimelineItemState =
  "done" | "current" | "failed" | "waiting" | "skipped";

export interface CaseTimelineItem {
  id: string;
  /** Step name (Body 600 when done, current or failed). */
  label: string;
  state: CaseTimelineItemState;
  /** Status badge after the name (`m-*` tones for a domain move). */
  badge?: ReactNode;
  /** Started / finished line (Label, already formatted in Central time). */
  when?: string;
  /** One-line detail (Label). */
  detail?: ReactNode;
  /** Extra content behind a disclosure (error detail, audit line). */
  more?: ReactNode;
  /** Disclosure summary words (default "Details"). */
  moreLabel?: string;
  /** Open the disclosure on first render (default: state === "failed"). */
  open?: boolean;
  /** A marker row between steps (the domain move's "Prepared"): italic, no number. */
  marker?: boolean;
}

export interface CaseTimelineDataProps {
  kind: CaseTimelineDataKind;
  items: readonly CaseTimelineItem[];
  /** Accessible name of the list (default "Case timeline"). */
  label?: string;
}

export interface CaseTimelineCaseProps {
  kind: CaseTimelineKind;
  entries: readonly CaseTimelineEntry[];
  timeZone: string;
  /** Hide the step buttons (closed case, read-only view). */
  readOnly?: boolean;
  onStep?: (step: CaseTimelineStep) => void;
}

export type CaseTimelineProps = CaseTimelineCaseProps | CaseTimelineDataProps;

const DATA_KINDS: readonly string[] = ["domain_move", "offboarding"];
const DETAILS_LABEL = "Details";

function isDataProps(p: CaseTimelineProps): p is CaseTimelineDataProps {
  return DATA_KINDS.includes(p.kind);
}

type Slot = { id: string; steps: readonly CaseTimelineStep[]; label: string };

const DMCA_SLOTS: readonly Slot[] = [
  { id: "received", steps: ["received"], label: C.steps.received },
  {
    id: "content_disabled",
    steps: ["content_disabled"],
    label: C.steps.content_disabled,
  },
  {
    id: "tenant_notified",
    steps: ["tenant_notified"],
    label: C.steps.tenant_notified,
  },
  {
    id: "counter_notice",
    steps: ["counter_notice"],
    label: C.steps.counter_notice,
  },
  {
    id: "restore_date_set",
    steps: ["restore_date_set"],
    label: C.steps.restore_date_set,
  },
  { id: "result", steps: ["restored", "upheld"], label: C.restoredOrUpheld },
  { id: "closed", steps: ["closed"], label: C.steps.closed },
];

const REPORT_SLOTS: readonly Slot[] = DMCA_SLOTS.filter(
  (s) =>
    s.id === "received" ||
    s.id === "content_disabled" ||
    s.id === "tenant_notified" ||
    s.id === "closed",
);

const RANK: Readonly<Record<CaseTimelineStep, number>> = {
  received: 0,
  content_disabled: 1,
  tenant_notified: 2,
  counter_notice: 3,
  restore_date_set: 4,
  restored: 5,
  upheld: 5,
  closed: 6,
};

/** The steps a person may record next, given the last one (the timeline's buttons). */
export function caseNextSteps(
  kind: CaseTimelineKind,
  last: CaseTimelineStep | null,
): CaseTimelineStep[] {
  if (kind === "spot_check" || last === "closed") return [];
  const at = last ?? "received";
  if (kind === "dmca") {
    switch (at) {
      case "received":
        return ["content_disabled"];
      case "content_disabled":
        return ["tenant_notified"];
      case "tenant_notified":
        return ["counter_notice", "upheld"];
      case "counter_notice":
        return ["restore_date_set"];
      case "restore_date_set":
        return ["restored", "upheld"];
      default:
        return ["closed"];
    }
  }
  switch (at) {
    case "received":
      return ["content_disabled"];
    case "content_disabled":
      return ["tenant_notified"];
    default:
      return ["closed"];
  }
}

/** "Mon 12 Oct, 10:00 am" in the business time zone. */
export function formatCaseWhen(iso: string, timeZone: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const period = get("dayPeriod").toLowerCase();
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${period}`;
}

/** "Thu 30 Oct" in the business time zone. */
export function formatCaseDay(iso: string, timeZone: string): string {
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export function CaseTimeline(props: CaseTimelineProps) {
  if (isDataProps(props)) return <DataTimeline {...props} />;
  return <CaseStepsTimeline {...props} />;
}

function DataItemIcon({ state }: { state: CaseTimelineItemState }) {
  if (state === "done") {
    return (
      <CircleCheck
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-hub-success"
      />
    );
  }
  if (state === "failed") {
    return (
      <TriangleAlert
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-hub-danger"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-1 size-3 shrink-0 rounded-full border border-hub-border-strong"
    />
  );
}

function DataTimeline({ kind, items, label }: CaseTimelineDataProps) {
  return (
    <ol
      aria-label={label ?? C.timelineLabel}
      data-timeline-kind={kind}
      className="flex flex-col gap-4 rounded bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      {items.map((item) => {
        const quiet = item.state === "waiting" || item.state === "skipped";
        const open = item.open ?? item.state === "failed";
        return (
          <li
            key={item.id}
            data-step={item.id}
            data-state={item.state}
            aria-current={item.state === "current" ? "step" : undefined}
            className={
              "flex items-start gap-3 " + (quiet ? "text-hub-ink-muted" : "")
            }
          >
            <DataItemIcon state={item.state} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    item.marker
                      ? "text-sm italic"
                      : quiet
                        ? "text-base"
                        : "text-base font-semibold"
                  }
                >
                  {item.label}
                </span>
                {item.badge ?? null}
              </span>
              {item.when ? (
                <span className="text-sm text-hub-ink-muted tabular-nums">
                  {item.when}
                </span>
              ) : null}
              {item.detail ? (
                <span className="text-sm break-words">{item.detail}</span>
              ) : null}
              {item.more ? (
                <details open={open} className="text-sm">
                  <summary className="cursor-pointer rounded text-hub-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent pointer-coarse:min-h-11">
                    {item.moreLabel ?? DETAILS_LABEL}
                  </summary>
                  <div className="mt-2 flex flex-col gap-1 break-words">
                    {item.more}
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CaseStepsTimeline({
  kind,
  entries,
  timeZone,
  readOnly = false,
  onStep,
}: CaseTimelineCaseProps) {
  const slots = kind === "dmca" ? DMCA_SLOTS : REPORT_SLOTS;
  const last = entries.reduce<CaseTimelineEntry | null>(
    (best, e) => (!best || RANK[e.step] >= RANK[best.step] ? e : best),
    null,
  );
  const lastRank = last ? RANK[last.step] : -1;
  const next = readOnly ? [] : caseNextSteps(kind, last?.step ?? null);
  let currentMarked = false;
  return (
    <ol
      aria-label={C.timelineLabel}
      className="flex flex-col gap-4 rounded bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      {slots.map((slot) => {
        const done = entries.find((e) => slot.steps.includes(e.step));
        if (done) {
          return (
            <li key={slot.id} className="flex items-start gap-3">
              <CircleCheck
                size={16}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-hub-success"
              />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">
                  {C.steps[done.step]}
                </span>
                <span className="text-sm text-hub-ink-muted">
                  {formatCaseWhen(done.at, timeZone)}
                  {done.byName ? ` · ${C.by(done.byName)}` : ""}
                </span>
                {done.restoreDate ? (
                  <span className="text-sm">
                    {C.restoreAfter(formatCaseDay(done.restoreDate, timeZone))}
                  </span>
                ) : null}
                {done.note ? (
                  <span className="whitespace-pre-wrap text-sm">
                    {done.note}
                  </span>
                ) : null}
              </div>
            </li>
          );
        }
        const slotRank = RANK[slot.steps[0]!];
        const isCurrent =
          !currentMarked && slotRank > lastRank && lastRank < RANK.closed;
        if (isCurrent) currentMarked = true;
        const buttons = isCurrent
          ? next.filter((s) => RANK[s] >= slotRank)
          : [];
        return (
          <li
            key={slot.id}
            className={
              "flex items-start gap-3 " +
              (isCurrent ? "" : "text-hub-ink-muted")
            }
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              aria-hidden="true"
              className="mt-1 size-3 shrink-0 rounded-full border border-hub-border-strong"
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm">
                {isCurrent ? (
                  <span className="font-semibold text-hub-ink">{C.next}: </span>
                ) : null}
                {slot.label}
              </span>
              {buttons.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {buttons.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onStep?.(s)}
                    >
                      {
                        C.stepActions[
                          s as Exclude<CaseTimelineStep, "received">
                        ]
                      }
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
