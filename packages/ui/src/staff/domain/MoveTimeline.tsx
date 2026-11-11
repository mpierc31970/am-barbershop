"use client";
// MoveTimeline (14-38 choice 2; DOM-08, D169, D288, P14-P33; 14-UI-SPEC "MoveTimeline"). A
// CaseTimeline of kind "domain_move": heading "Move · launch · rivera.sites… → riverabakery.com"
// with the move's status badge, then the ten steps in order with the italic "Prepared (waits
// for launch approval)" row between 5 and 6 (launch moves only: a post-launch move has no
// approval). Each row: step name · `m-*` badge · started/finished (Central time) · detail. The
// failed step's disclosure is open by default with the error code and the audit line.
// Actions under the timeline (P13 role gates; handlers are server actions from 14-51):
// primary **Retry step** only when a step failed · **Re-take snapshot** and **Add zone file**
// (both roles, before step 4) · **Cancel move** (super_admin, step-up on the server; a
// destructive CaseDialog whose body adds CANCEL-DELEGATED once delegation is done, reason
// 10-500) · **Move domain** (super_admin, live sites, via `moveDomain`). A support_agent sees
// the super_admin buttons disabled with "Super Admin only" (T-14-38-02).
import {
  P14_COPY,
  STAFF_PREPARED_WORDS,
  STAFF_STEP_WORDS,
} from "@cds/core/dns";
import { FileUp, RotateCw, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { Drawer } from "../../hub/Drawer";
import { FileDrop } from "../../hub/FileDrop";
import { InlineAlert } from "../../hub/feedback";
import { CaseDialog } from "../dialogs";
import {
  CaseTimeline,
  type CaseTimelineItem,
  type CaseTimelineItemState,
} from "../review/CaseTimeline";
import {
  MOVE_STATUS_TONE,
  STAFF_DOMAIN_COPY,
  STEP_STATUS_TONE,
  formatDomainWhen,
  staffStepDetailWords,
  type StaffDomainMoveData,
  type StaffDomainOrgAction,
  type StaffDomainReasonAction,
  type StaffDomainStepData,
  type StaffDomainStepKey,
  type StaffDomainStepStatus,
  type StaffDomainTextAction,
} from "./copy";
import { SuperOnly, failureText, useDomainRun } from "./parts";

const C = STAFF_DOMAIN_COPY.timeline;

export const MOVE_STEP_ORDER: readonly StaffDomainStepKey[] = Object.freeze([
  "snapshot",
  "zone",
  "gate",
  "nameservers",
  "delegation",
  "site_records",
  "edge",
  "https",
  "cutover",
  "search",
]);

/** Re-take snapshot and Add zone file apply before step 4 (UI-SPEC). */
const BEFORE_NAMESERVERS: readonly StaffDomainStepKey[] = [
  "snapshot",
  "zone",
  "gate",
];

const OPEN_STATUSES = new Set([
  "running",
  "waiting_owner",
  "prepared",
  "failed",
]);

export const ZONE_FILE_MAX_BYTES_STAFF = 256 * 1024;
const ZONE_ACCEPT = ".txt,.zone,.db,.bind,text/plain";

export interface MoveTimelineActions {
  retry?: StaffDomainOrgAction;
  retake?: StaffDomainOrgAction;
  addZoneFile?: StaffDomainTextAction;
  cancel?: StaffDomainReasonAction;
}

export interface MoveTimelineProps {
  orgId: string;
  business: string;
  move: StaffDomainMoveData | null;
  /** The viewer is super_admin (Cancel move, Move domain usable). */
  canSuper: boolean;
  actions?: MoveTimelineActions;
  /** Richer per-step detail from the caller (e.g. "47 records from zone file + sweep"). */
  details?: Partial<Record<StaffDomainStepKey, string>>;
  /** The audit line shown under a failed step ("Lee retried · 10 Oct 10:02"). */
  audit?: Partial<Record<StaffDomainStepKey, string>>;
  /** Move domain trigger (MoveDomainButton), rendered with the actions. */
  moveDomain?: ReactNode;
  timeZone?: string;
}

function itemState(s: StaffDomainStepStatus): CaseTimelineItemState {
  switch (s) {
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "running":
    case "waiting_owner":
      return "current";
    case "skipped":
    case "cancelled":
      return "skipped";
    default:
      return "waiting";
  }
}

function whenLine(step: StaffDomainStepData, timeZone?: string): string {
  const parts: string[] = [];
  if (step.startedAt) {
    parts.push(`${C.started} ${formatDomainWhen(step.startedAt, timeZone)}`);
  }
  if (step.finishedAt) {
    parts.push(`${C.finished} ${formatDomainWhen(step.finishedAt, timeZone)}`);
  }
  return parts.join(" · ");
}

/** The timeline rows: ten steps plus the Prepared marker for a launch move. */
export function moveTimelineItems(
  move: StaffDomainMoveData,
  opts: {
    details?: MoveTimelineProps["details"];
    audit?: MoveTimelineProps["audit"];
    timeZone?: string;
  } = {},
): CaseTimelineItem[] {
  const byKey = new Map(move.steps.map((s) => [s.key, s]));
  const items: CaseTimelineItem[] = [];
  for (const key of MOVE_STEP_ORDER) {
    const step = byKey.get(key) ?? { key, status: "waiting" as const };
    const failed = step.status === "failed";
    const detailWords =
      opts.details?.[key] ?? staffStepDetailWords(step.detail) ?? undefined;
    const detail =
      detailWords && step.attempts && step.attempts > 1
        ? `${detailWords} · ${C.attempts(step.attempts)}`
        : detailWords;
    const audit = opts.audit?.[key];
    items.push({
      id: key,
      label: STAFF_STEP_WORDS[key],
      state: itemState(step.status),
      badge: (
        <Badge tone={STEP_STATUS_TONE[step.status]}>
          {STAFF_DOMAIN_COPY.stepStatus[step.status]}
        </Badge>
      ),
      when: whenLine(step, opts.timeZone) || undefined,
      detail,
      more:
        failed && (step.detail || audit) ? (
          <>
            {step.detail ? (
              <span className="font-mono">{step.detail}</span>
            ) : null}
            {audit ? <span className="text-hub-ink-muted">{audit}</span> : null}
          </>
        ) : undefined,
      moreLabel: C.errorDetail,
    });
    if (key === "delegation" && move.kind === "launch") {
      const later = MOVE_STEP_ORDER.slice(5).some(
        (k) => (byKey.get(k)?.status ?? "waiting") !== "waiting",
      );
      const preparedState: CaseTimelineItemState =
        move.status === "prepared"
          ? "current"
          : move.prepared || later
            ? "done"
            : "waiting";
      items.push({
        id: "prepared",
        label: STAFF_PREPARED_WORDS,
        state: preparedState,
        marker: true,
        badge:
          move.prepared || move.status === "prepared" ? (
            <Badge tone="m-prepared">
              {STAFF_DOMAIN_COPY.moveStatus.prepared}
            </Badge>
          ) : undefined,
      });
    }
  }
  return items;
}

export function MoveTimeline({
  orgId,
  business,
  move,
  canSuper,
  actions = {},
  details,
  audit,
  moveDomain,
  timeZone,
}: MoveTimelineProps) {
  const headingId = useId();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);

  if (!move) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-4 font-hub"
        data-move-timeline=""
      >
        <h2 id={headingId} className="text-xl font-semibold text-hub-ink">
          {STAFF_DOMAIN_COPY.timeline.move}
        </h2>
        <p className="text-base text-hub-ink-muted">{C.noMove}</p>
        {moveDomain ? (
          <div className="flex flex-wrap gap-2">{moveDomain}</div>
        ) : null}
      </section>
    );
  }

  const isOpen = OPEN_STATUSES.has(move.status);
  const anyFailed = move.steps.some((s) => s.status === "failed");
  // WR-E05: Retry only on a failed move or an open one with a failed step; a cancelled or
  // finished move keeps its failed step for the record but offers no Retry.
  const canRetry = move.status === "failed" || (isOpen && anyFailed);
  const early = isOpen && BEFORE_NAMESERVERS.includes(move.currentStep);
  const delegated =
    move.steps.find((s) => s.key === "delegation")?.status === "done";

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub"
      data-move-timeline=""
      data-move-status={move.status}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id={headingId}
          className="text-xl font-semibold break-all text-hub-ink"
        >
          {C.heading(move.kind, move.fromHost, move.toHost)}
        </h2>
        <Badge tone={MOVE_STATUS_TONE[move.status]}>
          {STAFF_DOMAIN_COPY.moveStatus[move.status]}
        </Badge>
        <span className="text-sm text-hub-ink-muted tabular-nums">
          {move.code}
        </span>
      </div>
      {move.cancelNote ? (
        <InlineAlert tone="warning">{move.cancelNote}</InlineAlert>
      ) : null}
      <CaseTimeline
        kind="domain_move"
        label={C.label}
        items={moveTimelineItems(move, { details, audit, timeZone })}
      />
      <div
        role="group"
        aria-label={C.actionsLabel}
        className="flex flex-wrap items-center gap-2"
      >
        {canRetry && actions.retry ? (
          <RetryButton orgId={orgId} action={actions.retry} />
        ) : null}
        {early && actions.retake ? (
          <RetakeButton orgId={orgId} action={actions.retake} />
        ) : null}
        {early && actions.addZoneFile ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<FileUp aria-hidden size={16} strokeWidth={2} />}
            onClick={() => setZoneOpen(true)}
          >
            {P14_COPY.BTN_ADD_ZONE_FILE_STAFF}
          </Button>
        ) : null}
        {isOpen && actions.cancel ? (
          canSuper ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<X aria-hidden size={16} strokeWidth={2} />}
              className="text-hub-danger"
              onClick={() => setCancelOpen(true)}
            >
              {P14_COPY.BTN_CANCEL_MOVE}
            </Button>
          ) : (
            <SuperOnly label={P14_COPY.BTN_CANCEL_MOVE} />
          )
        ) : null}
        {moveDomain ?? null}
      </div>
      {actions.cancel && canSuper ? (
        <CancelMoveDialog
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          orgId={orgId}
          business={business}
          move={move}
          delegated={delegated}
          action={actions.cancel}
        />
      ) : null}
      {actions.addZoneFile ? (
        <ZoneFileDrawer
          open={zoneOpen}
          onClose={() => setZoneOpen(false)}
          orgId={orgId}
          action={actions.addZoneFile}
        />
      ) : null}
    </section>
  );
}

function RetryButton({
  orgId,
  action,
}: {
  orgId: string;
  action: StaffDomainOrgAction;
}) {
  const { pending, run } = useDomainRun(action, P14_COPY.BTN_RETRY_STEP);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        icon={<RotateCw aria-hidden size={16} strokeWidth={2} />}
        loading={pending}
        loadingLabel={P14_COPY.BTN_RETRYING}
        onClick={async () => {
          if (pending) return;
          setError(failureText(await run(orgId)));
        }}
      >
        {P14_COPY.BTN_RETRY_STEP}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-hub-danger">
          {error}
        </span>
      ) : null}
    </>
  );
}

function RetakeButton({
  orgId,
  action,
}: {
  orgId: string;
  action: StaffDomainOrgAction;
}) {
  const label = P14_COPY.BTN_RETAKE_SNAPSHOT;
  const { pending, run } = useDomainRun(action, label);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={async () => {
          if (pending) return;
          setError(failureText(await run(orgId)));
        }}
      >
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-hub-danger">
          {error}
        </span>
      ) : null}
    </>
  );
}

function CancelMoveDialog({
  open,
  onClose,
  orgId,
  business,
  move,
  delegated,
  action,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  move: StaffDomainMoveData;
  delegated: boolean;
  action: StaffDomainReasonAction;
}) {
  const { run } = useDomainRun(
    action,
    `${P14_COPY.BTN_CANCEL_MOVE}: ${move.toHost}`,
  );
  return (
    <CaseDialog
      open={open}
      onClose={onClose}
      destructive
      title={C.cancelTitle(move.toHost)}
      consequence={
        delegated ? C.cancelAfter(move.fromHost) : C.cancelBefore(move.fromHost)
      }
      alert={
        delegated ? (
          <InlineAlert tone="warning">{P14_COPY.CANCEL_DELEGATED}</InlineAlert>
        ) : undefined
      }
      caseRows={[
        [C.site, business],
        [C.move, move.code],
        [C.domain, move.toHost],
      ]}
      reasonField={{
        label: C.reason,
        helper: C.reasonHelper,
        min: 10,
        max: 500,
      }}
      confirmLabel={P14_COPY.BTN_CANCEL_MOVE}
      safeLabel={P14_COPY.BTN_KEEP_MOVE}
      onConfirm={(values) => run(orgId, values.reason ?? "")}
    />
  );
}

function ZoneFileDrawer({
  open,
  onClose,
  orgId,
  action,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  action: StaffDomainTextAction;
}) {
  const { pending, run } = useDomainRun(action, C.zoneDrawer);
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer open={open} onClose={onClose} label={C.zoneDrawer} side="right">
      <div className="flex flex-col gap-4 p-6 font-hub">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-hub-ink">{C.zoneDrawer}</h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close"
            icon={<X aria-hidden size={16} strokeWidth={2} />}
            onClick={onClose}
          />
        </div>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <FileDrop
          onText={async (text) => {
            if (pending) return;
            const res = await run(orgId, text);
            const msg = failureText(res);
            setError(msg);
            if (res.ok) onClose();
          }}
          onError={setError}
          maxBytes={ZONE_FILE_MAX_BYTES_STAFF}
          disabled={pending}
          accept={ZONE_ACCEPT}
          hint={C.zoneHint}
          tooBigCopy={P14_COPY.ZONE_TOO_BIG}
          unreadableCopy={P14_COPY.ZONE_UNREADABLE}
        />
        {pending ? (
          <p role="status" className="text-sm text-hub-ink-muted">
            {C.zoneReading}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
