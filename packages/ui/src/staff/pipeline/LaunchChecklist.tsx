// LaunchChecklist (13-34 choice 5; STAFF-03; 13-UI-SPEC "Launch" lines 666-677; 14-36 choice 3,
// 14-UI-SPEC "Pipeline › Launch"). The six owner launch review items (14-33) with CircleCheck
// (done, success) or an empty circle (ink-muted) and the progress as text ("4 of 6", no meter).
// Since P14 the list is the owner's real review; the P13 informational note shows only when a
// caller still passes `informational`. The expanded view adds "Owner review: Sent" / "Not sent
// yet" and the line "Domain: Prepared · riverabakery.com". `LaunchMoveBadge` is the Domain
// column's `m-*` badge (14-30 tones). Approve launch stays blocked (APPROVE_BLOCKED from
// P14_COPY, computed by the panel) unless the move is Prepared. `compact` renders the progress
// line only (the table cell). Server-safe.
import { Circle, CircleCheck } from "lucide-react";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { PIPELINE_COPY } from "./copy";

const C = PIPELINE_COPY.launch;

/** Mirrors @cds/db StaffLaunchMoveState (client code never imports @cds/db). */
export type LaunchMoveState =
  | "prepared"
  | "waiting_owner"
  | "gate_review"
  | "running"
  | "failed"
  | "cutover_running"
  | "none";

export interface LaunchMoveView {
  code: string | null;
  state: LaunchMoveState;
  failedStep?: number;
  domain?: string;
}

/** UI-SPEC Pipeline › Launch Domain column words. */
export const LAUNCH_MOVE_WORDS = {
  column: "Domain",
  line: "Domain",
  review: "Owner review",
  reviewSent: "Sent",
  reviewNotSent: "Not sent yet",
  state: (m: LaunchMoveView): string => {
    switch (m.state) {
      case "prepared":
        return "Prepared";
      case "waiting_owner":
        return "Waiting on nameservers";
      case "gate_review":
        return "Gate: needs review";
      case "running":
        return "In progress";
      case "cutover_running":
        return "Launching";
      case "failed":
        return m.failedStep ? `Failed · step ${m.failedStep}` : "Failed";
      case "none":
        return "No domain";
    }
  },
} as const;

const MOVE_TONE: Record<Exclude<LaunchMoveState, "none">, BadgeTone> = {
  prepared: "m-prepared",
  waiting_owner: "m-owner",
  gate_review: "m-waiting",
  running: "m-running",
  cutover_running: "m-running",
  failed: "m-failed",
};

/** The Domain column cell: an `m-*` badge, or ink-muted "No domain". */
export function LaunchMoveBadge({ move }: { move: LaunchMoveView }) {
  const words = LAUNCH_MOVE_WORDS.state(move);
  if (move.state === "none") {
    return <span className="font-hub text-sm text-hub-ink-muted">{words}</span>;
  }
  return <Badge tone={MOVE_TONE[move.state]}>{words}</Badge>;
}

export interface LaunchChecklistView {
  items: readonly { id: string; label: string; done: boolean }[];
  done: number;
  total: number;
  /** P13 only: the list never blocked a launch. False since P14 (14-36). */
  informational: boolean;
  /** "(owner review arrives in P14)" from the P13 read model; "" since P14. */
  note: string;
}

export interface LaunchChecklistProps {
  checklist: LaunchChecklistView;
  compact?: boolean;
  /** The site's launch move: adds "Domain: Prepared · riverabakery.com" (expanded only). */
  move?: LaunchMoveView;
  /** Whether the owner pressed Ready to launch (expanded only). */
  reviewSent?: boolean;
}

export function LaunchChecklist({
  checklist,
  compact,
  move,
  reviewSent,
}: LaunchChecklistProps) {
  const progress = (
    <span className="tabular-nums">
      {C.progress(checklist.done, checklist.total)}
    </span>
  );
  const note =
    checklist.informational && checklist.note ? (
      <span className="text-hub-ink-muted">{checklist.note}</span>
    ) : null;
  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-hub text-sm">
        {progress}
        {note}
      </span>
    );
  }
  return (
    <section
      aria-label={C.checklist}
      className="flex flex-col gap-2 font-hub text-sm text-hub-ink"
    >
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{C.checklist}</span>
        {progress}
        {note}
      </p>
      <ul className="flex flex-col gap-1">
        {checklist.items.map((it) => (
          <li key={it.id} className="flex items-center gap-2">
            {it.done ? (
              <CircleCheck
                aria-hidden
                size={16}
                strokeWidth={2}
                className="shrink-0 text-hub-success"
              />
            ) : (
              <Circle
                aria-hidden
                size={16}
                strokeWidth={2}
                className="shrink-0 text-hub-ink-muted"
              />
            )}
            <span>
              {it.label}
              <span className="sr-only">
                {it.done ? " (done)" : " (not done)"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {reviewSent !== undefined ? (
        <p>
          <span className="text-hub-ink-muted">
            {LAUNCH_MOVE_WORDS.review}:{" "}
          </span>
          {reviewSent
            ? LAUNCH_MOVE_WORDS.reviewSent
            : LAUNCH_MOVE_WORDS.reviewNotSent}
        </p>
      ) : null}
      {move ? (
        <p>
          <span className="text-hub-ink-muted">{LAUNCH_MOVE_WORDS.line}: </span>
          {LAUNCH_MOVE_WORDS.state(move)}
          {move.domain ? (
            <>
              {" · "}
              <span className="font-mono">{move.domain}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
