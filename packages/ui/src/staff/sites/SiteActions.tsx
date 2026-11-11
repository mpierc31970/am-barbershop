"use client";
// SiteActions: the Site › Actions tab body (13-43 choice 1; STAFF-06 entry, STAFF-19, STAFF-22;
// D10, D210, D215, D218; 13-UI-SPEC site detail "Actions" line 791, "Impersonation › Start"
// lines 808-816; T-13-43-01, T-13-43-04). A plain list of rows grouped by section, each row a
// Body 600 action, a one-line consequence and one button; a row the role can't use shows its
// button disabled with "Super Admin only".
//   View as CDS      Open as admin (both roles) · Open as owner (super_admin) -> the start
//                    dialog (As admin / As owner, Reason 3-500 prefilled from ?reason=) ->
//                    startImpersonationAction (opens /hub in the same tab)
//   Talk to the site Open ticket -> OpenTicketDialog · Post a message, note or document ->
//                    CdsPostDialog (previewed as the business sees it)
//   Stage            current stage + forward stages -> CaseDialog "Move {business} to …?"
//   Hosting rules    state line; Suspend or warn… (notice for both roles, Suspend now for
//                    super_admin) · Mark fixed · Suspend now… · Lift suspension
//   Add-ons          link to the Add-ons tab (install is there, with its sale dialog)
//   Demo             read-only badge (the flag is set only by the demo seed, 13-24)
//   Leaving CDS      (14-43 choice 3) Start offboarding (super_admin, step-up on the server;
//                    "Super Admin only" for an agent) -> the shared destructive CaseDialog; a
//                    running notice links to the Offboarding tab instead. Optional props, so
//                    the row shows only when the panel passes them.
// Every call goes through useStaffAction (step-up retry, sign-in on an ended session); the
// server re-checks the role and freshness, so the disabled buttons are presentation only.
import { fillCopy, P13_COPY, P13_DIALOGS } from "@cds/core/staff";
import type { TargetGroup } from "@cds/core/support";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { Dialog } from "../../hub/Dialog";
import { InlineAlert } from "../../hub/feedback";
import { Select, TextArea } from "../../hub/fields";
import { SegmentedControl } from "../../hub/SegmentedControl";
import { formatSuspendedOn } from "../../hub/shell/SuspensionNotice";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { SITE_ACTIONS_COPY as A } from "./actions-copy";
import { CdsPostDialog, type PostToSiteAction } from "./CdsPostDialog";
import {
  StartOffboardingButton,
  STAFF_OFFBOARDING_COPY,
  type StaffOffboardingReasonAction,
  type StaffOffboardingStartCase,
} from "./OffboardingPanel";
import { OpenTicketDialog, type OpenTicketAction } from "./OpenTicketDialog";
import {
  LiftSuspensionDialog,
  MarkFixedDialog,
  noticeWhen,
  SuspendOrWarnDialog,
  type SendNoticeAction,
  type SiteOrgAction,
  type SuspendNowAction,
} from "./SuspensionDialogs";

export const IMPERSONATION_REASON_MIN = 3;
export const IMPERSONATION_REASON_MAX = 500;

export type ImpersonationView = "admin" | "owner";

export type StartImpersonationAction = (input: {
  orgId: string;
  view: ImpersonationView;
  reason: string;
}) => Promise<StaffActionResult<unknown>>;

export type MoveStageAction = (
  orgId: string,
  to: string,
) => Promise<StaffActionResult<{ message: string }>>;

export interface SiteActionsSuspension {
  state: "none" | "notice" | "suspended";
  fixBy?: string | null;
  suspendedAt?: string | null;
  category?: string;
}

export interface SiteActionsView {
  orgId: string;
  business: string;
  /** Business time zone (dates and the note preview). */
  timeZone: string;
  /** Stored stage ("" before intake). */
  stage: string;
  /** Stages this site may move to (forward only; never fit_review). */
  forwardStages: readonly string[];
  suspension: SiteActionsSuspension;
  demo: boolean;
  /** ISO fix-by a notice sent now gets. */
  noticeFixBy: string;
  /** The site's TargetSelect groups (whole site, pages, add-ons). */
  targets: readonly TargetGroup[];
  /** Reason prefilled in the start dialog (`?reason=Ticket #1042`). */
  reasonPrefill?: string;
  /** `/staff/api/sites/<org>/document`. */
  documentHref: string;
  /** `/staff/sites/<org>?tab=addons`. */
  addonsHref: string;
  /** 14-43: the Start offboarding case; absent hides the Leaving CDS row. */
  offboarding?: {
    start: StaffOffboardingStartCase;
    /** A notice is running: the row links to the tab instead. */
    leaving: boolean;
    /** `/staff/sites/<org>?tab=offboarding`. */
    href: string;
  };
}

export interface SiteActionsCan {
  /** Open as owner: super_admin. */
  ownerView: boolean;
  /** org_stage: super_admin. */
  stage: boolean;
  /** suspend_now: super_admin. */
  suspendNow: boolean;
  /** suspend_lift: super_admin. */
  lift: boolean;
  /** 14-43 offboard: super_admin (default false). */
  offboard?: boolean;
}

export interface SiteActionsHandlers {
  startImpersonation: StartImpersonationAction;
  openTicket: OpenTicketAction;
  post: PostToSiteAction;
  moveStage: MoveStageAction;
  sendNotice: SendNoticeAction;
  suspendNow: SuspendNowAction;
  markFixed: SiteOrgAction;
  liftSuspension: SiteOrgAction;
  /** 14-43: Start offboarding (absent hides the Leaving CDS row). */
  startOffboarding?: StaffOffboardingReasonAction;
}

export interface SiteActionsProps {
  view: SiteActionsView;
  can: SiteActionsCan;
  actions: SiteActionsHandlers;
}

type Open =
  | { kind: "impersonate"; view: ImpersonationView }
  | { kind: "ticket" }
  | { kind: "post" }
  | { kind: "stage"; to: string }
  | { kind: "suspend"; initial: "notice" | "now" }
  | { kind: "fixed" }
  | { kind: "lift" }
  | null;

function stageName(s: string): string {
  return A.stages[s] ?? s;
}

/** A super_admin button an agent sees disabled, with "Super Admin only" beside it. */
function SuperOnly({ id, label }: { id: string; label: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" disabled aria-describedby={id}>
        {label}
      </Button>
      <span id={id} className="text-sm text-hub-ink-muted">
        {P13_COPY.SUPER_ONLY}
      </span>
    </span>
  );
}

function Row({
  action,
  hint,
  children,
}: {
  action: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 border-b border-hub-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-base font-semibold text-hub-ink">{action}</p>
        <p className="text-sm text-hub-ink-muted">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2
        id={id}
        className="text-sm font-semibold tracking-wide text-hub-ink-muted uppercase"
      >
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

interface ImpersonationDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  initialView: ImpersonationView;
  canOwner: boolean;
  reasonPrefill: string;
  start: StartImpersonationAction;
}

/** "View {business} as CDS staff" (UI-SPEC lines 808-816). */
function ImpersonationDialog({
  open,
  onClose,
  orgId,
  business,
  initialView,
  canOwner,
  reasonPrefill,
  start,
}: ImpersonationDialogProps) {
  const C = A.impersonation;
  const base = useId();
  const [view, setView] = useState<ImpersonationView>(initialView);
  const [reason, setReason] = useState(reasonPrefill);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useStaffAction(start, {
    describe: () => `${C.start}: ${business}`,
  });

  useEffect(() => {
    if (!open) return;
    setView(canOwner ? initialView : "admin");
    setReason(reasonPrefill.slice(0, IMPERSONATION_REASON_MAX));
    setError(null);
    setPending(false);
  }, [open, initialView, canOwner, reasonPrefill]);

  const len = reason.trim().length;
  const ready =
    !pending &&
    len >= IMPERSONATION_REASON_MIN &&
    len <= IMPERSONATION_REASON_MAX &&
    (view === "admin" || canOwner);

  async function submit() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      // Success redirects to /hub (the browser leaves); only a refusal comes back.
      const res = await run({ orgId, view, reason: reason.trim() });
      if (
        !res.ok &&
        res.code !== "step_up_needed" &&
        res.code !== "session_ended"
      ) {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={fillCopy(C.title, { business })}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {C.safe}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!ready}
            loading={pending}
            loadingLabel={C.working}
            className="max-sm:w-full"
          >
            {C.start}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 font-hub">
        <div className="flex flex-col gap-1">
          <span
            id={`${base}-view`}
            className="text-sm font-semibold text-hub-ink"
          >
            {C.viewLabel}
          </span>
          {canOwner ? (
            <SegmentedControl<ImpersonationView>
              name={`${base}-view`}
              label={C.viewLabel}
              labelledBy={`${base}-view`}
              value={view}
              onChange={setView}
              options={[
                { value: "admin", label: C.asAdmin },
                { value: "owner", label: C.asOwner },
              ]}
            />
          ) : (
            <p className="text-base text-hub-ink">
              {C.asAdmin}{" "}
              <span className="text-sm text-hub-ink-muted">
                · {C.asOwner}: {P13_COPY.SUPER_ONLY}
              </span>
            </p>
          )}
        </div>
        <TextArea
          id={`${base}-reason`}
          label={C.reason}
          helper={C.reasonHelper}
          value={reason}
          rows={2}
          maxLength={IMPERSONATION_REASON_MAX}
          counter={{ value: reason.length, max: IMPERSONATION_REASON_MAX }}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <p className="text-sm text-hub-ink-muted">{C.note}</p>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

export function SiteActions({ view, can, actions }: SiteActionsProps) {
  const base = useId();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [picked, setTo] = useState<string>(view.forwardStages[0] ?? "");
  // WR-E08: after a move the refreshed list no longer holds the old pick; use what is shown.
  const to = view.forwardStages.includes(picked)
    ? picked
    : (view.forwardStages[0] ?? "");
  const runMove = useStaffAction(actions.moveStage, {
    describe: ([, target]) =>
      `${A.rows.stage.button}: ${view.business} → ${stageName(target)}`,
  });
  const close = () => setOpen(null);
  const R = A.rows;
  const s = view.suspension;

  const hostingLine =
    s.state === "suspended"
      ? fillCopy(A.hosting.suspended, {
          date:
            (s.suspendedAt &&
              formatSuspendedOn(s.suspendedAt, view.timeZone)) ||
            "",
          category: A.suspension.categories[s.category ?? ""] ?? "",
        }).replace(/ · $/, "")
      : s.state === "notice"
        ? fillCopy(A.hosting.notice, {
            when: s.fixBy ? noticeWhen(s.fixBy) : "",
          })
        : A.hosting.none;

  const stageDialog = P13_DIALOGS.stage_forward;
  const stageVars = {
    business: view.business,
    stage: open?.kind === "stage" ? stageName(open.to) : "",
  };

  return (
    <div className="flex flex-col gap-8 font-hub" data-site-actions="">
      <Section title={A.sections.view}>
        <Row action={R.openAdmin.action} hint={R.openAdmin.hint}>
          <Button
            size="sm"
            onClick={() => setOpen({ kind: "impersonate", view: "admin" })}
          >
            {R.openAdmin.action}
          </Button>
        </Row>
        <Row action={R.openOwner.action} hint={R.openOwner.hint}>
          {can.ownerView ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen({ kind: "impersonate", view: "owner" })}
            >
              {R.openOwner.action}
            </Button>
          ) : (
            <SuperOnly id={`${base}-owner`} label={R.openOwner.action} />
          )}
        </Row>
      </Section>

      <Section title={A.sections.talk}>
        <Row action={R.openTicket.action} hint={R.openTicket.hint}>
          <Button size="sm" onClick={() => setOpen({ kind: "ticket" })}>
            {R.openTicket.action}
          </Button>
        </Row>
        <Row action={R.post.action} hint={R.post.hint}>
          <Button size="sm" onClick={() => setOpen({ kind: "post" })}>
            {R.post.button}
          </Button>
        </Row>
      </Section>

      <Section title={A.sections.stage}>
        <Row
          action={R.stage.action}
          hint={
            <>
              {fillCopy(R.stage.current, { stage: stageName(view.stage) })} ·{" "}
              {view.stage === "live"
                ? R.stage.final
                : view.forwardStages.length === 0
                  ? R.stage.none
                  : R.stage.hint}
            </>
          }
        >
          {!can.stage ? (
            <SuperOnly id={`${base}-stage`} label={R.stage.button} />
          ) : view.forwardStages.length === 0 ? (
            <Button size="sm" disabled>
              {R.stage.button}
            </Button>
          ) : (
            <>
              <div className="w-48">
                <Select
                  id={`${base}-to`}
                  label={R.stage.label}
                  value={to}
                  onChange={(e) => setTo(e.currentTarget.value)}
                  options={view.forwardStages.map((st) => ({
                    value: st,
                    label: stageName(st),
                  }))}
                />
              </div>
              <Button
                size="sm"
                className="self-end"
                onClick={() => to && setOpen({ kind: "stage", to })}
              >
                {R.stage.button}
              </Button>
            </>
          )}
        </Row>
      </Section>

      <Section title={A.sections.hosting}>
        <li className="py-2" data-hosting-state={s.state}>
          {s.state === "none" ? (
            <p className="text-sm text-hub-ink-muted">{hostingLine}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-hub-ink">
              <Badge tone={s.state === "notice" ? "s-notice" : "s-suspended"}>
                {s.state === "notice"
                  ? A.hosting.noticeBadge
                  : A.hosting.suspendedBadge}
              </Badge>
              {hostingLine}
            </p>
          )}
        </li>
        {s.state === "none" ? (
          <Row action={R.notice.action} hint={R.notice.hint}>
            <Button
              size="sm"
              onClick={() => setOpen({ kind: "suspend", initial: "notice" })}
            >
              {R.notice.button}
            </Button>
          </Row>
        ) : null}
        {s.state === "notice" ? (
          <>
            <Row action={R.markFixed.action} hint={R.markFixed.hint}>
              <Button size="sm" onClick={() => setOpen({ kind: "fixed" })}>
                {R.markFixed.action}
              </Button>
            </Row>
            <Row
              action={A.suspension.now.title}
              hint={A.suspension.now.description}
            >
              {can.suspendNow ? (
                <Button
                  size="sm"
                  onClick={() => setOpen({ kind: "suspend", initial: "now" })}
                >
                  {R.suspendFromNotice.button}
                </Button>
              ) : (
                <SuperOnly
                  id={`${base}-suspend`}
                  label={R.suspendFromNotice.button}
                />
              )}
            </Row>
          </>
        ) : null}
        {s.state === "suspended" ? (
          <Row action={R.lift.action} hint={R.lift.hint}>
            {can.lift ? (
              <Button size="sm" onClick={() => setOpen({ kind: "lift" })}>
                {R.lift.action}
              </Button>
            ) : (
              <SuperOnly id={`${base}-lift`} label={R.lift.action} />
            )}
          </Row>
        ) : null}
      </Section>

      {view.offboarding && actions.startOffboarding ? (
        <Section title={STAFF_OFFBOARDING_COPY.actionsRow.section}>
          <Row
            action={STAFF_OFFBOARDING_COPY.actionsRow.action}
            hint={
              view.offboarding.leaving
                ? STAFF_OFFBOARDING_COPY.actionsRow.leaving
                : STAFF_OFFBOARDING_COPY.actionsRow.hint
            }
          >
            {view.offboarding.leaving ? (
              <a
                href={view.offboarding.href}
                className="inline-flex h-8 items-center rounded px-3 text-sm font-semibold text-hub-ink underline underline-offset-2 hover:no-underline"
              >
                {STAFF_OFFBOARDING_COPY.actionsRow.open}
              </a>
            ) : (
              <StartOffboardingButton
                orgId={view.orgId}
                business={view.business}
                start={view.offboarding.start}
                canOffboard={can.offboard === true}
                action={actions.startOffboarding}
                timeZone={view.timeZone}
              />
            )}
          </Row>
        </Section>
      ) : null}

      <Section title={A.sections.addons}>
        <Row action={R.addons.action} hint={R.addons.hint}>
          <a
            href={view.addonsHref}
            className="inline-flex h-8 items-center rounded px-3 text-sm font-semibold text-hub-ink underline underline-offset-2 hover:no-underline"
          >
            {R.addons.button}
          </a>
        </Row>
      </Section>

      <Section title={A.sections.demo}>
        <li className="flex flex-wrap items-center gap-2 py-2 text-sm text-hub-ink-muted">
          {view.demo ? <Badge tone="demo">{A.demo.badge}</Badge> : null}
          <span>{view.demo ? A.demo.on : A.demo.off}</span>
        </li>
      </Section>

      <ImpersonationDialog
        open={open?.kind === "impersonate"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        initialView={open?.kind === "impersonate" ? open.view : "admin"}
        canOwner={can.ownerView}
        reasonPrefill={view.reasonPrefill ?? ""}
        start={actions.startImpersonation}
      />
      <OpenTicketDialog
        open={open?.kind === "ticket"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        targets={view.targets}
        openTicket={actions.openTicket}
      />
      <CdsPostDialog
        open={open?.kind === "post"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        timeZone={view.timeZone}
        post={actions.post}
        documentHref={view.documentHref}
      />
      {open?.kind === "stage" ? (
        <CaseDialog
          open
          onClose={close}
          title={fillCopy(stageDialog.title, stageVars)}
          consequence={stageDialog.body}
          caseRows={[
            [A.openTicket.site, view.business],
            [A.sections.stage, `${stageName(view.stage)} → ${stageVars.stage}`],
          ]}
          confirmLabel={stageDialog.confirm}
          safeLabel={stageDialog.safe}
          onConfirm={async () => {
            const res = await runMove(view.orgId, open.to);
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
      <SuspendOrWarnDialog
        open={open?.kind === "suspend"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        initial={open?.kind === "suspend" ? open.initial : "notice"}
        canNotice={s.state === "none"}
        canSuspendNow={can.suspendNow && s.state !== "suspended"}
        noticeFixBy={view.noticeFixBy}
        sendNotice={actions.sendNotice}
        suspendNow={actions.suspendNow}
      />
      <MarkFixedDialog
        open={open?.kind === "fixed"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        action={actions.markFixed}
      />
      <LiftSuspensionDialog
        open={open?.kind === "lift"}
        onClose={close}
        orgId={view.orgId}
        business={view.business}
        action={actions.liftSuspension}
      />
    </div>
  );
}
