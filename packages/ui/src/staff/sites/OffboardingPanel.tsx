"use client";
// OffboardingPanel (14-43 choices 0-3; LIFE-01, D282, D58, P14-P13; 14-UI-SPEC "Staff ›
// Offboarding" lines 882-897, destructive table line 1105). The staff Site › Offboarding tab:
//   - No running notice: EmptyState "Rivera Bakery isn't leaving." + (super_admin) secondary
//     **Start offboarding** (a cancelled or never-started notice reads the same way).
//   - A notice (or a closed site): CaseTimeline kind `offboarding` with the six owner steps,
//     then the system steps Hosts removed, Site closed and Zone deleted (with its condition),
//     each with an `m-*` badge and a detail line. The DNS handback step embeds the GateReport
//     in reverse mode per zone (CDS zone vs destination answers). Connected services carries
//     the GA4 / Search Console transfer line and names the staff runbook
//     docs/ops/ga4-search-console.md §4 "Transfer on cancellation" (choice 0).
//   - Rail: requested by / at, notice ends, reason category, owner note (or staff reason).
//   - Actions: secondary **Re-run handback check** (both roles) · danger **Cancel
//     offboarding** (super_admin, step-up on the server; CaseDialog with a reason).
// Start offboarding is a destructive CaseDialog (choice 2) shared with Site › Actions
// (`StartOffboardingButton`). Props are plain data (never @cds/db rows); every value renders as
// a text node. The server re-checks the role and step-up; disabled buttons are presentation.
import { P14_COPY } from "@cds/core/dns";
import { DoorOpen, RotateCw, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { EmptyState, InlineAlert } from "../../hub/feedback";
import { LEAVE_REASONS } from "../../hub/leaving/copy";
import { CaseDialog, type StaffActionResult } from "../dialogs";
import { GateReport, type GateReportData } from "../domain/GateReport";
import { SuperOnly, failureText, useDomainRun } from "../domain/parts";
import {
  CaseTimeline,
  type CaseTimelineItem,
  type CaseTimelineItemState,
} from "../review/CaseTimeline";

export const STAFF_OFFBOARDING_TIME_ZONE = "America/Chicago";
export const STAFF_OFFBOARDING_REASON_MIN = 3;
export const STAFF_OFFBOARDING_REASON_MAX = 500;
export const GA4_RUNBOOK = "docs/ops/ga4-search-console.md";

// ---- Plain data (shaped like @cds/db StaffOffboardingView; mapped by the panel) ----

export type StaffOffboardingStepStatus =
  "open" | "done" | "not_applicable" | "locked";

export interface StaffOffboardingStepData {
  key: string;
  title: string;
  status: StaffOffboardingStepStatus;
  at: string | null;
}

export interface StaffOffboardingData {
  status: "notice" | "closed" | "cancelled";
  requestedAt: string | null;
  requestedByKind: "owner" | "staff" | null;
  noticeEndsAt: string | null;
  daysLeft: number;
  reasonCategory: string | null;
  /** The owner's note, or the staff reason when CDS started it. */
  note: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  handbackOverdueAt: string | null;
  steps: readonly StaffOffboardingStepData[];
  systemSteps: readonly StaffOffboardingStepData[];
}

export type StaffHandbackStatus =
  "open" | "checking" | "ready_to_switch" | "waiting" | "done" | "mismatch";

export interface StaffHandbackZoneData {
  domain: string;
  status: StaffHandbackStatus;
  destination: "registrar" | "other" | null;
  /** Reverse gate report, or null before the first check. */
  gate: GateReportData | null;
}

/** What the Start offboarding case shows. */
export interface StaffOffboardingStartCase {
  /** ISO end of a notice started now. */
  noticeWouldEnd: string;
  /** A CDS zone is delegated (active or moved). */
  handbackNeeded: boolean;
  /** Why it can't start (demo, closed, already leaving), or null. */
  blocked: string | null;
}

export interface StaffOffboardingPanelView {
  orgId: string;
  business: string;
  start: StaffOffboardingStartCase;
  /** Null when no notice is running or the site never left (a cancelled one too). */
  offboarding: StaffOffboardingData | null;
  /** The last cancelled notice's date (EmptyState body), or null. */
  lastCancelledAt: string | null;
  handback: readonly StaffHandbackZoneData[];
  timeZone?: string;
}

export type StaffOffboardingReasonAction = (
  orgId: string,
  reason: string,
) => Promise<StaffActionResult<{ message: string }>>;
export type StaffOffboardingOrgAction = (
  orgId: string,
) => Promise<StaffActionResult<{ message: string }>>;

export interface OffboardingPanelActions {
  start: StaffOffboardingReasonAction;
  cancel: StaffOffboardingReasonAction;
  rerunHandback: StaffOffboardingOrgAction;
}

export interface OffboardingPanelProps {
  view: StaffOffboardingPanelView;
  actions: OffboardingPanelActions;
  /** staffCan(role, "offboard"): super_admin. Gates Start and Cancel. */
  canOffboard: boolean;
}

// ---- Copy ----

export const STAFF_OFFBOARDING_COPY = Object.freeze({
  heading: "Leaving CDS",
  timelineLabel: "Offboarding steps",
  emptyBody:
    "No notice is running. Start offboarding only when the owner asked to leave CDS.",
  emptyCancelled: (date: string) =>
    `No notice is running. The last one was cancelled on ${date}.`,
  status: {
    notice: "Notice running",
    closed: "Closed",
    cancelled: "Cancelled",
  } as const,
  stepWords: {
    open: "Waiting on owner",
    done: "Done",
    not_applicable: "Not applicable",
    locked: "Locked",
  } as const,
  systemWords: {
    open: "Waiting",
    done: "Done",
    not_applicable: "Not applicable",
    locked: "Waiting",
  } as const,
  systemTag: "System",
  lockedDetail: "Opens once the DNS handback is done.",
  doneAt: (when: string) => `Done ${when}`,
  zoneCondition:
    "After the delegation moved and the reverse check passed, or 30 days.",
  hostsDetail: "Every host of the site comes off the edge when it closes.",
  siteDetail: "The site closes at the notice end.",
  noHandback: "No CDS zone: nothing to hand back.",
  handbackHeading: (domain: string) => `Handback check · ${domain}`,
  handbackNotChosen: "The owner hasn't chosen where the DNS goes yet.",
  handbackNotChecked: "Not checked yet.",
  handbackWords: {
    open: "Not started",
    checking: "Checking",
    ready_to_switch: "Ready to switch",
    waiting: "Waiting for the switch",
    done: "Moved back",
    mismatch: "Records missing",
  } as const,
  destination: {
    registrar: "to the registrar's DNS",
    other: "to another DNS host",
  } as const,
  overdue: (when: string) =>
    `The notice ended with the DNS handback open (since ${when}). Nothing closes until it is done.`,
  services:
    "GA4 / Search Console: transfer CDS-owned properties to the owner, then clear the ids.",
  runbook: `Runbook: ${GA4_RUNBOOK} §4 "Transfer on cancellation"`,
  rail: {
    heading: "Offboarding details",
    requestedBy: "Requested by",
    requestedAt: "Requested",
    noticeEnds: "Notice ends",
    daysLeft: (n: number) => `${n} ${n === 1 ? "day" : "days"} left`,
    reason: "Reason",
    note: "Owner note",
    staffReason: "Staff reason",
    by: { owner: "Owner", staff: "CDS staff" } as const,
    none: "—",
  },
  start: {
    title: (business: string) => `Start offboarding for ${business}?`,
    consequence:
      "A 30-day notice starts now. The site keeps running until it ends; the owner works through the Leaving CDS checklist.",
    noticeEnds: "Notice ends",
    handback: "DNS handback needed",
    handbackYes: "Yes, CDS zone active",
    handbackNo: "No",
    billing: "Billing",
    billingLine:
      "Annual prepay is not refunded; the launch rate lock is removed.",
    owner: "Owner",
    ownerLine: "Emailed the checklist",
    reason: "Reason",
    reasonHelper: "Why CDS is starting it (3 to 500 characters). Audited.",
  },
  cancel: {
    title: (business: string) => `Cancel ${business}'s offboarding?`,
    consequence: "Their plan and price carry on.",
    site: "Site",
    noticeEnds: "Notice ends",
    reason: "Reason",
    reasonHelper: "Why it is cancelled (3 to 500 characters). Audited.",
  },
  rerunHelp: "Runs the destination check again for every zone in the handback.",
  actionsRow: {
    section: "Leaving CDS",
    action: "Start offboarding",
    hint: "Starts the 30-day notice and emails the owner the checklist.",
    leaving: "A notice is running. See the Offboarding tab.",
    open: "Open Offboarding",
  },
});

const C = STAFF_OFFBOARDING_COPY;

const STEP_TONE: Readonly<Record<StaffOffboardingStepStatus, BadgeTone>> =
  Object.freeze({
    open: "m-owner",
    done: "m-done",
    not_applicable: "m-skipped",
    locked: "m-waiting",
  });

const SYSTEM_TONE: Readonly<Record<StaffOffboardingStepStatus, BadgeTone>> =
  Object.freeze({
    open: "m-waiting",
    done: "m-done",
    not_applicable: "m-skipped",
    locked: "m-waiting",
  });

const STATUS_TONE: Readonly<Record<StaffOffboardingData["status"], BadgeTone>> =
  Object.freeze({
    notice: "s-leaving",
    closed: "m-done",
    cancelled: "m-cancelled",
  });

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14 Nov 2026" in the business time zone ("" when unknown). */
export function formatOffboardingDate(
  iso: string | null | undefined,
  timeZone: string = STAFF_OFFBOARDING_TIME_ZONE,
): string {
  const d = parse(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** "17 Oct 09:14" in the business time zone ("" when unknown). */
export function formatOffboardingWhen(
  iso: string | null | undefined,
  timeZone: string = STAFF_OFFBOARDING_TIME_ZONE,
): string {
  const d = parse(iso);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
}

export function offboardingReasonLabel(category: string | null): string {
  if (!category) return C.rail.none;
  return LEAVE_REASONS.find((r) => r.value === category)?.label ?? category;
}

// ---- Start offboarding (shared with Site › Actions) ----

export interface StartOffboardingButtonProps {
  orgId: string;
  business: string;
  start: StaffOffboardingStartCase;
  canOffboard: boolean;
  action: StaffOffboardingReasonAction;
  timeZone?: string;
}

/** Secondary **Start offboarding** + its destructive CaseDialog (UI-SPEC, choice 2). */
export function StartOffboardingButton({
  orgId,
  business,
  start,
  canOffboard,
  action,
  timeZone,
}: StartOffboardingButtonProps) {
  const [open, setOpen] = useState(false);
  const { run } = useDomainRun(
    action,
    `${P14_COPY.BTN_START_OFFBOARDING}: ${business}`,
  );
  if (!canOffboard) {
    return (
      <SuperOnly
        label={P14_COPY.BTN_START_OFFBOARDING}
        icon={<DoorOpen size={16} aria-hidden />}
      />
    );
  }
  const S = C.start;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<DoorOpen size={16} aria-hidden />}
        disabled={start.blocked !== null}
        onClick={() => setOpen(true)}
        data-start-offboarding=""
      >
        {P14_COPY.BTN_START_OFFBOARDING}
      </Button>
      {start.blocked ? (
        <span className="text-sm text-hub-ink-muted">{start.blocked}</span>
      ) : null}
      {open ? (
        <CaseDialog
          open
          destructive
          onClose={() => setOpen(false)}
          title={S.title(business)}
          consequence={S.consequence}
          caseRows={[
            [
              S.noticeEnds,
              formatOffboardingDate(start.noticeWouldEnd, timeZone),
            ],
            [S.handback, start.handbackNeeded ? S.handbackYes : S.handbackNo],
            [S.billing, S.billingLine],
            [S.owner, S.ownerLine],
          ]}
          reasonField={{
            label: S.reason,
            min: STAFF_OFFBOARDING_REASON_MIN,
            max: STAFF_OFFBOARDING_REASON_MAX,
            helper: S.reasonHelper,
          }}
          confirmLabel={P14_COPY.BTN_START_OFFBOARDING}
          safeLabel={P14_COPY.BTN_NOT_NOW}
          onConfirm={(v) => run(orgId, (v.reason ?? "").trim())}
        />
      ) : null}
    </>
  );
}

// ---- The timeline ----

function stepState(
  s: StaffOffboardingStepData,
  current: boolean,
  failed: boolean,
): CaseTimelineItemState {
  if (s.status === "done") return "done";
  if (s.status === "not_applicable") return "skipped";
  if (failed) return "failed";
  return current ? "current" : "waiting";
}

function handbackLine(z: StaffHandbackZoneData): string {
  const dest = z.destination ? ` ${C.destination[z.destination]}` : "";
  return `${z.domain}${dest} · ${C.handbackWords[z.status]}`;
}

function HandbackDetail({
  orgId,
  zones,
  timeZone,
}: {
  orgId: string;
  zones: readonly StaffHandbackZoneData[];
  timeZone?: string;
}) {
  return (
    <div className="flex flex-col gap-6" data-handback-zones="">
      {zones.map((z) =>
        z.gate ? (
          <GateReport
            key={z.domain}
            mode="reverse"
            orgId={orgId}
            domain={z.domain}
            gate={z.gate}
            canSuper={false}
            timeZone={timeZone}
            heading={C.handbackHeading(z.domain)}
          />
        ) : (
          <p key={z.domain} className="text-sm text-hub-ink-muted">
            {z.domain}:{" "}
            {z.destination ? C.handbackNotChecked : C.handbackNotChosen}
          </p>
        ),
      )}
    </div>
  );
}

export function offboardingTimelineItems(
  view: StaffOffboardingPanelView,
): CaseTimelineItem[] {
  const o = view.offboarding;
  if (!o) return [];
  const tz = view.timeZone;
  const firstOpen = o.steps.find((s) => s.status === "open")?.key ?? null;
  const items: CaseTimelineItem[] = o.steps.map((s) => {
    const handback = s.key === "dns_handback";
    const overdue = handback && s.status === "open" && !!o.handbackOverdueAt;
    const when = s.at ? C.doneAt(formatOffboardingWhen(s.at, tz)) : undefined;
    let detail: ReactNode = undefined;
    let more: ReactNode = undefined;
    if (handback) {
      detail = overdue
        ? C.overdue(formatOffboardingWhen(o.handbackOverdueAt, tz))
        : view.handback.length === 0
          ? C.noHandback
          : view.handback.map(handbackLine).join(" · ");
      if (view.handback.length > 0) {
        more = (
          <HandbackDetail
            orgId={view.orgId}
            zones={view.handback}
            timeZone={tz}
          />
        );
      }
    } else if (s.key === "services") {
      detail = (
        <span className="flex flex-col gap-1">
          <span>{C.services}</span>
          <code className="font-mono text-sm text-hub-ink-muted">
            {C.runbook}
          </code>
        </span>
      );
    } else if (s.status === "locked") {
      detail = C.lockedDetail;
    }
    return {
      id: s.key,
      label: s.title,
      state: stepState(
        s,
        s.key === firstOpen && o.status === "notice",
        overdue,
      ),
      badge: (
        <Badge tone={overdue ? "m-failed" : STEP_TONE[s.status]}>
          {C.stepWords[s.status]}
        </Badge>
      ),
      ...(when ? { when } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(more !== undefined
        ? {
            more,
            moreLabel: C.handbackHeading(view.handback[0]?.domain ?? ""),
            open: overdue || view.handback.some((z) => z.status === "mismatch"),
          }
        : {}),
    };
  });
  for (const s of o.systemSteps) {
    const detail =
      s.key === "zone_deleted"
        ? C.zoneCondition
        : s.key === "hosts_removed"
          ? C.hostsDetail
          : s.key === "site_closed"
            ? C.siteDetail
            : undefined;
    items.push({
      id: `system:${s.key}`,
      label: `${s.title} (${C.systemTag})`,
      state: stepState(s, false, false),
      badge: (
        <Badge tone={SYSTEM_TONE[s.status]}>{C.systemWords[s.status]}</Badge>
      ),
      ...(s.at ? { when: C.doneAt(formatOffboardingWhen(s.at, tz)) } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  return items;
}

function Rail({ o, timeZone }: { o: StaffOffboardingData; timeZone?: string }) {
  const id = useId();
  const R = C.rail;
  const rows: [string, string][] = [
    [R.requestedBy, o.requestedByKind ? R.by[o.requestedByKind] : R.none],
    [R.requestedAt, formatOffboardingWhen(o.requestedAt, timeZone) || R.none],
    [
      R.noticeEnds,
      o.noticeEndsAt
        ? `${formatOffboardingDate(o.noticeEndsAt, timeZone)}${
            o.status === "notice" ? ` · ${R.daysLeft(o.daysLeft)}` : ""
          }`
        : R.none,
    ],
    [R.reason, offboardingReasonLabel(o.reasonCategory)],
    [
      o.requestedByKind === "staff" ? R.staffReason : R.note,
      o.note && o.note.trim() !== "" ? o.note : R.none,
    ],
  ];
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-4"
      data-offboarding-rail=""
    >
      <h3 id={id} className="text-base font-semibold text-hub-ink">
        {R.heading}
      </h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-hub-ink-muted">{k}</dt>
            <dd className="break-words text-hub-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PanelActions({ view, actions, canOffboard }: OffboardingPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const rerun = useDomainRun(
    actions.rerunHandback,
    `${P14_COPY.BTN_RERUN_HANDBACK}: ${view.business}`,
  );
  const cancel = useDomainRun(
    actions.cancel,
    `${P14_COPY.BTN_CANCEL_OFFBOARDING}: ${view.business}`,
  );
  const o = view.offboarding;
  if (!o || o.status !== "notice") return null;
  const K = C.cancel;
  return (
    <div className="flex flex-col gap-3" data-offboarding-actions="">
      <div className="flex flex-wrap items-center gap-2">
        {view.handback.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCw size={16} aria-hidden />}
            loading={rerun.pending}
            onClick={async () => {
              setError(null);
              const res = await rerun.run(view.orgId);
              setError(failureText(res));
            }}
            title={C.rerunHelp}
          >
            {P14_COPY.BTN_RERUN_HANDBACK}
          </Button>
        ) : null}
        {canOffboard ? (
          <Button
            size="sm"
            variant="secondary"
            className="text-hub-danger"
            icon={<X size={16} aria-hidden />}
            onClick={() => setCancelOpen(true)}
          >
            {P14_COPY.BTN_CANCEL_OFFBOARDING}
          </Button>
        ) : (
          <SuperOnly
            label={P14_COPY.BTN_CANCEL_OFFBOARDING}
            icon={<X size={16} aria-hidden />}
          />
        )}
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {cancelOpen ? (
        <CaseDialog
          open
          destructive
          onClose={() => setCancelOpen(false)}
          title={K.title(view.business)}
          consequence={K.consequence}
          caseRows={[
            [K.site, view.business],
            [
              K.noticeEnds,
              formatOffboardingDate(o.noticeEndsAt, view.timeZone),
            ],
          ]}
          reasonField={{
            label: K.reason,
            min: STAFF_OFFBOARDING_REASON_MIN,
            max: STAFF_OFFBOARDING_REASON_MAX,
            helper: K.reasonHelper,
          }}
          confirmLabel={P14_COPY.BTN_CANCEL_OFFBOARDING}
          safeLabel={P14_COPY.BTN_KEEP_OFFBOARDING}
          onConfirm={(v) => cancel.run(view.orgId, (v.reason ?? "").trim())}
        />
      ) : null}
    </div>
  );
}

export function OffboardingPanel(props: OffboardingPanelProps) {
  const { view, actions, canOffboard } = props;
  const headingId = useId();
  const o = view.offboarding;
  if (!o) {
    const cancelled = formatOffboardingDate(
      view.lastCancelledAt,
      view.timeZone,
    );
    return (
      <div data-staff-offboarding="none">
        <EmptyState
          heading={P14_COPY.STAFF_NOT_LEAVING({ business: view.business })}
          body={cancelled ? C.emptyCancelled(cancelled) : C.emptyBody}
          action={
            <span className="inline-flex flex-wrap items-center gap-2">
              <StartOffboardingButton
                orgId={view.orgId}
                business={view.business}
                start={view.start}
                canOffboard={canOffboard}
                action={actions.start}
                timeZone={view.timeZone}
              />
            </span>
          }
        />
      </div>
    );
  }
  return (
    <div
      className="grid gap-8 font-hub xl:grid-cols-[minmax(0,1fr)_320px]"
      data-staff-offboarding={o.status}
    >
      <div className="xl:order-last">
        <Rail o={o} timeZone={view.timeZone} />
      </div>
      <section
        aria-labelledby={headingId}
        className="flex min-w-0 flex-col gap-4"
      >
        <h2
          id={headingId}
          className="flex flex-wrap items-center gap-2 text-xl font-semibold text-hub-ink"
        >
          {C.heading}
          <Badge tone={STATUS_TONE[o.status]}>
            {o.status === "notice"
              ? `${C.status.notice} · ${o.daysLeft}d`
              : C.status[o.status]}
          </Badge>
        </h2>
        <CaseTimeline
          kind="offboarding"
          label={C.timelineLabel}
          items={offboardingTimelineItems(view)}
        />
        <PanelActions {...props} />
      </section>
    </div>
  );
}
