"use client";
// Pipeline action island (13-34 choices 1-5; STAFF-01, STAFF-03, STAFF-04; D26, D28, D29;
// 13-UI-SPEC "Pipeline" lines 610-677, dialogs lines 1069-1072; T-13-34-01..03). The client
// half of the five Pipeline tabs. Every button calls the 13-27 server action through
// useStaffAction, so a stale sign-in asks for an emailed code (StepUpDialog over the
// CaseDialog) and retries the SAME call once: the reason, the override switch and the
// "Launch anyway" box are never retyped. The UI is not the gate: each action re-checks the
// role, the step-up and the stage on the server (T-13-34-01). Agents see the super_admin
// buttons disabled with SUPER-ONLY. Lead emails arrive masked; Reveal email fetches one address
// on demand (audited server-side), shows it inline and keeps it nowhere else (T-13-34-02).
// Approve launch is a CaseDialog with "Live is final" (T-13-34-03). Row types mirror the
// @cds/db read models (client code never imports @cds/db); the panels map rows into them.
import { fillCopy, P13_COPY, P13_DIALOGS } from "@cds/core/staff";
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  InlineAlert,
  RadioCardGroup,
  Switch,
  TextArea,
  useToast,
} from "@cds/ui/hub";
import {
  CaseDialog,
  FitCasePanel,
  LAUNCH_MOVE_WORDS,
  LaunchChecklist,
  LaunchMoveBadge,
  PIPELINE_COPY,
  StaffTable,
  compactAge,
  sitePathLabel,
  useStaffAction,
  type FitCaseView,
  type LaunchChecklistView,
  type LaunchMoveView,
  type StaffColumn,
} from "@cds/ui/staff";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { ExternalLink, RotateCw } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import {
  approveFitAction,
  approveLaunchAction,
  declineFitAction,
  declinePaidOrderAction,
  markReadyForReviewAction,
  moveStageAction,
  rerunAssemblyAction,
  revealLeadEmailAction,
  saveBuildNoteAction,
} from "../../../../actions/staff/pipeline";

const C = PIPELINE_COPY;

function ago(iso: string | null, now: string): string {
  if (!iso) return C.none;
  const from = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(from.getTime())) return C.none;
  return compactAge(from, new Date(now), BUSINESS_TIME_ZONE);
}

/** A super_admin button an agent sees disabled, with "Super Admin only" next to it. */
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

const LINK =
  "inline-flex h-8 items-center gap-1 rounded px-3 font-hub text-sm font-semibold text-hub-ink " +
  "hover:bg-hub-surface-2 pointer-coarse:min-h-11 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function PreviewLink({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <span className="text-sm text-hub-ink-muted">{C.polish.noPreview}</span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>
      <ExternalLink aria-hidden size={16} strokeWidth={2} />
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// ------------------------------------------------------------------ Leads (choice 1)

export interface LeadView {
  id: string;
  orgId: string | null;
  business: string;
  stageLabel: string;
  path: string;
  abandoned: boolean;
  abandonedDays: number;
  lastActivity: string;
  emailMasked: string;
  /** Shown in the Lead column when there is no org (15-07: "Contact form" for inquiries). */
  noOrgLabel?: string;
}

/** Masked address + ghost "Reveal email": one audited fetch, shown inline, never stored. */
export function RevealEmail({
  leadId,
  masked,
  canReveal,
}: {
  leadId: string;
  masked: string;
  canReveal: boolean;
}) {
  const toast = useToast();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const reveal = useStaffAction(revealLeadEmailAction, {
    describe: () => C.leads.reveal,
  });
  if (email) {
    return <span className="break-all font-semibold">{email}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-hub-ink-muted">{masked || C.none}</span>
      {canReveal && masked ? (
        <Button
          size="sm"
          variant="ghost"
          loading={pending}
          loadingLabel={C.leads.revealing}
          onClick={async () => {
            setPending(true);
            try {
              const res = await reveal(leadId);
              if (res.ok) setEmail(res.data.email);
              else if (res.message) toast.show({ message: res.message });
            } finally {
              setPending(false);
            }
          }}
        >
          {C.leads.reveal}
        </Button>
      ) : null}
    </span>
  );
}

export function LeadsTable({
  rows,
  now,
  canReveal,
}: {
  rows: readonly LeadView[];
  now: string;
  canReveal: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">
        {C.leads.empty}
      </p>
    );
  }
  const columns: StaffColumn<LeadView>[] = [
    {
      id: "business",
      header: C.leads.cols.business,
      priority: 1,
      stack: true,
      cell: (r) => (
        <span className="font-semibold">{r.business || C.leads.unnamed}</span>
      ),
    },
    {
      id: "stage",
      header: C.leads.cols.stage,
      priority: 1,
      stack: true,
      cell: (r) => r.stageLabel,
    },
    {
      id: "path",
      header: C.leads.cols.path,
      priority: 3,
      cell: (r) => (r.path ? sitePathLabel(r.path) : C.none),
    },
    {
      id: "activity",
      header: C.leads.cols.activity,
      priority: 2,
      nowrap: true,
      cell: (r) => (
        <span className="tabular-nums">{ago(r.lastActivity, now)}</span>
      ),
    },
    {
      id: "email",
      header: C.leads.cols.email,
      priority: 2,
      cell: (r) => (
        <RevealEmail
          leadId={r.id}
          masked={r.emailMasked}
          canReveal={canReveal}
        />
      ),
    },
    {
      id: "status",
      header: C.leads.cols.status,
      priority: 1,
      stack: true,
      cell: (r) =>
        r.abandoned ? (
          <Badge tone="abandoned">{C.leads.abandoned(r.abandonedDays)}</Badge>
        ) : (
          C.none
        ),
    },
    {
      id: "open",
      header: C.leads.cols.open,
      priority: 1,
      stack: true,
      cell: (r) =>
        r.orgId ? (
          <a
            href={`/staff/sites/${r.orgId}`}
            className={LINK}
            aria-label={`${C.leads.open}: ${r.business || C.leads.unnamed}`}
          >
            {C.leads.open}
          </a>
        ) : (
          <span className="text-sm text-hub-ink-muted">
            {r.noOrgLabel ?? C.leads.noOrg}
          </span>
        ),
    },
  ];
  return (
    <StaffTable
      caption={C.leads.caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.business || C.leads.unnamed}
      primaryHref={(r) => (r.orgId ? `/staff/sites/${r.orgId}` : "#")}
      shortcutsEnabled={false}
    />
  );
}

// -------------------------------------------------------------- Fit holds (choice 2)

export type DeclineCategory = "fit" | "capacity" | "scope" | "other";

export interface FitHoldView extends FitCaseView {
  fingerprint: string;
  /** Paid order: decline refunds through org:decline ("Full refund of $1,500."). */
  refund: string | null;
  /** CR-D02: the payment read failed. Decline stays off rather than assume unpaid. */
  refundUnknown?: boolean;
}

function DeclineDialog({
  hold,
  onClose,
}: {
  hold: FitHoldView;
  onClose: () => void;
}) {
  const toast = useToast();
  const base = useId();
  const [category, setCategory] = useState<DeclineCategory | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const business = hold.name || hold.orgId;
  const declineUnpaid = useStaffAction(declineFitAction, {
    describe: () => `${C.fit.decline}: ${business}`,
  });
  const declinePaid = useStaffAction(declinePaidOrderAction, {
    describe: () => `${C.fit.declinePaid}: ${business}`,
  });
  const d = P13_DIALOGS.decline_fit;
  const trimmed = note.trim();
  const canConfirm =
    category !== null && (category !== "other" || trimmed !== "") && !pending;

  async function confirm() {
    if (!category) {
      setError(C.fit.pickReason);
      return;
    }
    if (category === "other" && trimmed === "") {
      setError(C.fit.otherNeedsNote);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const input = { reasonCategory: category, note: trimmed };
      const res = hold.refund
        ? await declinePaid(hold.orgId, input)
        : await declineUnpaid(hold.orgId, input);
      if (res.ok) {
        toast.show({ message: res.data.message });
        onClose();
        return;
      }
      if (res.code !== "step_up_needed" && res.code !== "session_ended") {
        setError(res.message ?? "");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={fillCopy(d.title, { business })}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="secondary"
            autoFocus
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {d.safe}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={!canConfirm}
            loading={pending}
            className="max-sm:w-full"
          >
            {hold.refund ? C.fit.declinePaid : C.fit.declineUnpaid}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base">
          {hold.refund
            ? fillCopy(d.body, { amount: hold.refund })
            : C.fit.unpaidConsequence}
        </p>
        <RadioCardGroup<DeclineCategory>
          name={`${base}-category`}
          legend={C.fit.reasonCategory}
          value={category}
          onChange={setCategory}
          options={(Object.keys(C.fit.categories) as DeclineCategory[]).map(
            (k) => ({ value: k, title: C.fit.categories[k] }),
          )}
        />
        <TextArea
          id={`${base}-note`}
          label={C.fit.note}
          helper={C.fit.noteHelper}
          value={note}
          rows={2}
          maxLength={280}
          onChange={(e) =>
            setNote(e.currentTarget.value.replace(/[\r\n]/g, " "))
          }
        />
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

/** Approve fit / Decline fit for one held signup (super_admin, step-up, reason). */
export function FitHoldActions({
  hold,
  canDecide,
}: {
  hold: FitHoldView;
  canDecide: boolean;
}) {
  const toast = useToast();
  const base = useId();
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [override, setOverride] = useState(false);
  const business = hold.name || hold.orgId;
  const approve = useStaffAction(approveFitAction, {
    describe: () => `${C.fit.approve}: ${business}`,
  });

  if (!canDecide) {
    return (
      <span className="inline-flex flex-wrap items-center gap-3">
        <SuperOnly id={`${base}-approve`} label={C.fit.approve} />
        <SuperOnly id={`${base}-decline`} label={C.fit.decline} />
      </span>
    );
  }
  const blocked = hold.verdict === "blocked";
  const d = P13_DIALOGS.approve_fit;
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        disabled={blocked && !override}
        aria-label={`${C.fit.approve}: ${business}`}
        onClick={() => setDialog("approve")}
      >
        {C.fit.approve}
      </Button>
      <Button
        variant="secondary"
        aria-label={`${C.fit.decline}: ${business}`}
        disabled={hold.refundUnknown === true}
        aria-describedby={
          hold.refundUnknown ? `${base}-refund-unknown` : undefined
        }
        onClick={() => setDialog("decline")}
      >
        {C.fit.decline}
      </Button>
      {hold.refundUnknown ? (
        <span
          id={`${base}-refund-unknown`}
          role="alert"
          className="text-sm text-hub-danger"
        >
          {C.fit.refundUnknown}
        </span>
      ) : null}
      {blocked ? (
        <Switch
          id={`${base}-override`}
          label={C.fit.override}
          checked={override}
          onChange={setOverride}
        />
      ) : null}
      {dialog === "approve" ? (
        <CaseDialog
          open
          onClose={() => setDialog(null)}
          title={fillCopy(d.title, { business })}
          consequence={d.body}
          caseRows={[
            [C.fit.business, business],
            [C.fit.verdict, C.fit.verdicts[hold.verdict]],
            ...(blocked && override
              ? ([[C.fit.override, "Yes"]] as [string, string][])
              : []),
          ]}
          confirmLabel={d.confirm}
          safeLabel={d.safe}
          reasonField={{ label: C.fit.reason }}
          onConfirm={async (v) => {
            const res = await approve(hold.orgId, {
              reason: v.reason ?? "",
              reviewed: hold.fingerprint,
              overrideBlocked: blocked && override,
            });
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
      {dialog === "decline" && !hold.refundUnknown ? (
        <DeclineDialog hold={hold} onClose={() => setDialog(null)} />
      ) : null}
    </span>
  );
}

/** One expandable fit hold: the case, then the decisions. */
export function FitHoldItem({
  hold,
  canDecide,
}: {
  hold: FitHoldView;
  canDecide: boolean;
}) {
  return (
    <FitCasePanel
      hold={hold}
      siteHref={`/staff/sites/${hold.orgId}`}
      actions={<FitHoldActions hold={hold} canDecide={canDecide} />}
    />
  );
}

// --------------------------------------------------------------- Building (choice 3)

export interface BuildingView {
  orgId: string;
  name: string;
  stage: "ready_for_build" | "being_built";
  assemblyState: "none" | "queued" | "running" | "done" | "failed";
  lastRun: string | null;
  unfilled: number;
  errorCode: string | null;
  buildNote: string;
  paidAt: string | null;
  inStageSince: string;
}

function assemblyText(r: BuildingView, now: string): string {
  switch (r.assemblyState) {
    case "done":
      return C.building.assembled(ago(r.lastRun, now), r.unfilled);
    case "failed":
      return C.building.failed(r.errorCode);
    case "queued":
      return C.building.queued;
    case "running":
      return C.building.running;
    default:
      return C.building.notAssembled;
  }
}

function assemblyCell(r: BuildingView, now: string): ReactNode {
  const text = assemblyText(r, now);
  return r.assemblyState === "failed" ? (
    <span className="font-semibold text-hub-danger">{text}</span>
  ) : (
    text
  );
}

function BuildNoteEditor({
  row,
  max,
  onDone,
}: {
  row: BuildingView;
  max: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const id = useId();
  const [text, setText] = useState(row.buildNote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useStaffAction(saveBuildNoteAction, {
    describe: () => `${C.building.saveNote}: ${row.name}`,
  });
  return (
    <div className="flex min-w-60 flex-col gap-2">
      <TextArea
        id={`${id}-note`}
        label={C.building.noteLabel}
        helper={C.building.noteHelper}
        value={text}
        rows={2}
        maxLength={max}
        counter={{ value: text.length, max }}
        error={error ?? undefined}
        onChange={(e) => setText(e.currentTarget.value.replace(/[\r\n]/g, " "))}
      />
      <span className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          loadingLabel={C.building.saving}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              const res = await save(row.orgId, text.trim() || null);
              if (res.ok) {
                toast.show({
                  message:
                    text.trim() === ""
                      ? C.building.noteCleared
                      : C.building.noteSaved,
                });
                onDone();
              } else if (
                res.code !== "step_up_needed" &&
                res.code !== "session_ended"
              ) {
                setError(res.message ?? "");
              }
            } finally {
              setPending(false);
            }
          }}
        >
          {C.building.saveNote}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          {C.building.cancel}
        </Button>
      </span>
    </div>
  );
}

export function BuildingTable({
  rows,
  now,
  canStage,
  canAssemble,
  canNote,
  noteMax,
}: {
  rows: readonly BuildingView[];
  now: string;
  canStage: boolean;
  canAssemble: boolean;
  canNote: boolean;
  noteMax: number;
}) {
  const toast = useToast();
  const base = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    row: BuildingView;
    mode: "rerun" | "polish";
  } | null>(null);
  const [report, setReport] = useState<{
    business: string;
    lines: string[];
  } | null>(null);
  const rerun = useStaffAction(rerunAssemblyAction, {
    describe: ([org]) =>
      `${C.building.rerun}: ${rows.find((r) => r.orgId === org)?.name ?? ""}`,
  });
  const move = useStaffAction(moveStageAction, {
    describe: ([org]) =>
      `${C.building.moveToPolish}: ${rows.find((r) => r.orgId === org)?.name ?? ""}`,
  });

  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">
        {C.building.empty}
      </p>
    );
  }

  const columns: StaffColumn<BuildingView>[] = [
    {
      id: "business",
      header: C.building.cols.business,
      priority: 1,
      stack: true,
      cell: (r) => (
        <a
          href={`/staff/sites/${r.orgId}`}
          className="rounded font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          {r.name || r.orgId}
        </a>
      ),
    },
    {
      id: "stage",
      header: C.building.cols.stage,
      priority: 1,
      stack: true,
      cell: (r) => (
        <Badge tone={r.stage === "being_built" ? "being-built" : "s-ready"}>
          {C.building.stages[r.stage]}
        </Badge>
      ),
    },
    {
      id: "assembly",
      header: C.building.cols.assembly,
      priority: 1,
      cell: (r) => assemblyCell(r, now),
    },
    {
      id: "note",
      header: C.building.cols.note,
      priority: 2,
      cell: (r) =>
        editing === r.orgId ? (
          <BuildNoteEditor
            row={r}
            max={noteMax}
            onDone={() => setEditing(null)}
          />
        ) : (
          <span className="line-clamp-1 text-hub-ink-muted">
            {r.buildNote || C.none}
          </span>
        ),
    },
    {
      id: "paid",
      header: C.building.cols.paid,
      priority: 3,
      nowrap: true,
      cell: (r) =>
        r.paidAt ? (
          <span className="tabular-nums">{ago(r.paidAt, now)}</span>
        ) : (
          C.building.notPaid
        ),
    },
    {
      id: "age",
      header: C.building.cols.age,
      priority: 3,
      nowrap: true,
      cell: (r) => (
        <span className="tabular-nums">{ago(r.inStageSince, now)}</span>
      ),
    },
    {
      id: "actions",
      header: C.building.cols.actions,
      priority: 1,
      stack: true,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {canNote && editing !== r.orgId ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${C.building.editNote}: ${r.name}`}
              onClick={() => setEditing(r.orgId)}
            >
              {C.building.editNote}
            </Button>
          ) : null}
          {canAssemble ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${C.building.rerun}: ${r.name}`}
              onClick={() => setPending({ row: r, mode: "rerun" })}
            >
              <RotateCw aria-hidden size={16} strokeWidth={2} />
              {C.building.rerun}
            </Button>
          ) : null}
          {r.stage === "ready_for_build" ? (
            canStage ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${C.building.moveToPolish}: ${r.name}`}
                onClick={() => setPending({ row: r, mode: "polish" })}
              >
                {C.building.moveToPolish}
              </Button>
            ) : (
              <SuperOnly
                id={`${base}-polish-${r.orgId}`}
                label={C.building.moveToPolish}
              />
            )
          ) : null}
        </span>
      ),
    },
  ];

  const business = pending ? pending.row.name || pending.row.orgId : "";
  const stage = P13_DIALOGS.stage_forward;
  return (
    <>
      <StaffTable
        caption={C.building.caption}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.orgId}
        rowLabel={(r) => r.name || r.orgId}
        primaryHref={(r) => `/staff/sites/${r.orgId}`}
        shortcutsEnabled={false}
      />
      {pending?.mode === "rerun" ? (
        <CaseDialog
          open
          onClose={() => setPending(null)}
          title={C.building.rerunTitle(business)}
          consequence={C.building.rerunBody}
          caseRows={[
            [C.building.cols.business, business],
            [C.building.cols.assembly, assemblyText(pending.row, now)],
          ]}
          confirmLabel={C.building.rerun}
          safeLabel={C.building.rerunSafe}
          onConfirm={async () => {
            const res = await rerun(pending.row.orgId);
            if (res.ok) {
              toast.show({ message: res.data.message });
              if (res.data.lines.length > 0) {
                setReport({ business, lines: res.data.lines });
              }
            }
            return res;
          }}
        />
      ) : null}
      {pending?.mode === "polish" ? (
        <CaseDialog
          open
          onClose={() => setPending(null)}
          title={fillCopy(stage.title, {
            business,
            stage: C.building.beingBuilt,
          })}
          consequence={stage.body}
          caseRows={[
            [C.building.cols.business, business],
            [C.building.cols.stage, C.building.stages[pending.row.stage]],
          ]}
          confirmLabel={stage.confirm}
          safeLabel={stage.safe}
          onConfirm={async () => {
            const res = await move(pending.row.orgId, "being_built");
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
      <Drawer
        open={report !== null}
        onClose={() => setReport(null)}
        label={report ? C.building.rerunReport(report.business) : ""}
        side="right"
      >
        {report ? (
          <div className="flex flex-col gap-4 p-6 font-hub text-hub-ink">
            <h2 className="text-xl font-semibold">
              {C.building.rerunReport(report.business)}
            </h2>
            <pre className="overflow-x-auto rounded bg-hub-surface-2 p-4 font-mono text-sm whitespace-pre">
              {report.lines.join("\n")}
            </pre>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

// --------------------------------------------------------- Polish queue (choice 4)

/** Primary "Mark ready for owner review" → CaseDialog "Send {business} to review?". */
export function MarkReadyButton({
  orgId,
  business,
  canStage,
}: {
  orgId: string;
  business: string;
  canStage: boolean;
}) {
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const mark = useStaffAction(markReadyForReviewAction, {
    describe: () => `${C.polish.markReady}: ${business}`,
  });
  if (!canStage) {
    return <SuperOnly id={`${id}-ready`} label={C.polish.markReady} />;
  }
  return (
    <>
      <Button
        variant="primary"
        aria-label={`${C.polish.markReady}: ${business}`}
        onClick={() => setOpen(true)}
      >
        {C.polish.markReady}
      </Button>
      {open ? (
        <CaseDialog
          open
          onClose={() => setOpen(false)}
          title={C.polish.sendTitle(business)}
          consequence={C.polish.sendBody}
          caseRows={[]}
          confirmLabel={C.polish.sendConfirm}
          safeLabel={C.polish.sendSafe}
          onConfirm={async () => {
            const res = await mark(orgId);
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
    </>
  );
}

export { PreviewLink };

// --------------------------------------------------------------- Launch (choice 5)

export interface LaunchView {
  orgId: string;
  name: string;
  checklist: LaunchChecklistView;
  /** 14-36: the site's launch move (Domain column). */
  move: LaunchMoveView;
  /** 14-36: the owner pressed Ready to launch (P14-P35). */
  reviewSent: boolean;
  /**
   * 14-36: why Approve launch is blocked (P14_COPY.APPROVE_BLOCKED, or the review/no-domain
   * refusal words), or null when the move is Prepared and the review sent. The server action
   * re-checks; this only keeps the button honest.
   */
  approveBlocked: string | null;
  /** 14-36: the dialog body, P14_COPY.APPROVE_B ("Make … live at …? CDS runs the last five …"). */
  approveBody: string;
  openChangeTickets: number;
  openChangeTicketNumbers: readonly number[];
  inReviewSince: string;
  previewUrl: string | null;
}

/**
 * Per-row primary "Approve launch" → CaseDialog "Make {business} live?" with the APPROVE-B body
 * (14-36). `aria-disabled` with the APPROVE-BLOCKED line next to it unless the move is Prepared
 * and the owner's review is sent. Open change requests add the warning and a required "Launch
 * anyway" box.
 */
export type ApproveLaunch = typeof approveLaunchAction;

export function ApproveLaunchButton({
  row,
  canLaunch,
  approve: approveAction = approveLaunchAction,
}: {
  row: LaunchView;
  canLaunch: boolean;
  /** The 13-27 action (the Launch panel passes approveLaunchAction). */
  approve?: ApproveLaunch;
}) {
  const toast = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const business = row.name || row.orgId;
  const approve = useStaffAction(approveAction, {
    describe: () => `${C.launch.approve}: ${business}`,
  });
  if (!canLaunch) {
    return <SuperOnly id={`${id}-launch`} label={C.launch.approve} />;
  }
  if (row.approveBlocked) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          aria-disabled="true"
          aria-label={`${C.launch.approve}: ${business}`}
          aria-describedby={`${id}-blocked`}
          className="cursor-not-allowed opacity-60"
          onClick={(e) => e.preventDefault()}
        >
          {C.launch.approve}
        </Button>
        <span id={`${id}-blocked`} className="text-sm text-hub-ink-muted">
          {row.approveBlocked}
        </span>
      </span>
    );
  }
  const notDone = row.checklist.informational
    ? 0
    : row.checklist.total - row.checklist.done;
  const warn = C.launch.warning(notDone, row.openChangeTickets);
  const d = P13_DIALOGS.approve_launch;
  return (
    <>
      <Button
        size="sm"
        variant="primary"
        aria-label={`${C.launch.approve}: ${business}`}
        onClick={() => setOpen(true)}
      >
        {C.launch.approve}
      </Button>
      {open ? (
        <CaseDialog
          open
          onClose={() => setOpen(false)}
          title={fillCopy(d.title, { business })}
          consequence={`${row.approveBody} ${C.launch.liveLine}`}
          caseRows={[
            [C.building.cols.business, business],
            [
              LAUNCH_MOVE_WORDS.column,
              `${LAUNCH_MOVE_WORDS.state(row.move)}${row.move.domain ? ` · ${row.move.domain}` : ""}`,
            ],
            [
              C.launch.checklist,
              `${C.launch.progress(row.checklist.done, row.checklist.total)}${
                row.checklist.informational ? ` ${row.checklist.note}` : ""
              }`,
            ],
            ...(warn ? ([[C.launch.changeRequests, warn]] as const) : []),
          ]}
          confirmLabel={d.confirm}
          safeLabel={d.safe}
          destructive
          checkbox={warn ? { label: P13_COPY.LAUNCH_ANYWAY } : undefined}
          onConfirm={async (v) => {
            const res = await approve(row.orgId, {
              launchAnyway: v.checked === true,
            });
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
    </>
  );
}

/** One ready_for_review site: progress, change requests, the checklist on expand. */
export function LaunchItem({
  row,
  now,
  canLaunch,
  approve,
}: {
  row: LaunchView;
  now: string;
  canLaunch: boolean;
  approve?: ApproveLaunch;
}) {
  const business = row.name || row.orgId;
  return (
    <li className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a
          href={`/staff/sites/${row.orgId}`}
          className="rounded text-base font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          {business}
        </a>
        <span className="text-sm">
          <span className="text-hub-ink-muted">{C.launch.checklist}: </span>
          <LaunchChecklist checklist={row.checklist} compact />
        </span>
        <span className="text-sm">
          <span className="text-hub-ink-muted">
            {C.launch.changeRequests}:{" "}
          </span>
          {row.openChangeTicketNumbers.length > 0 ? (
            row.openChangeTicketNumbers.map((n, i) => (
              <span key={n}>
                {i > 0 ? ", " : null}
                <a
                  href={`/staff/tickets/${n}`}
                  className="rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                >
                  {C.launch.ticket(n)}
                </a>
              </span>
            ))
          ) : (
            <span className="tabular-nums">
              {row.openChangeTickets > 0
                ? row.openChangeTickets
                : C.launch.noChanges}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-2 text-sm">
          <span className="text-hub-ink-muted">
            {LAUNCH_MOVE_WORDS.column}:{" "}
          </span>
          <LaunchMoveBadge move={row.move} />
          {row.move.domain ? (
            <span className="font-mono text-sm">{row.move.domain}</span>
          ) : null}
        </span>
        <span className="text-sm">
          <span className="text-hub-ink-muted">{C.launch.inReview}: </span>
          <span className="tabular-nums">{ago(row.inReviewSince, now)}</span>
        </span>
        <span className="ml-auto inline-flex flex-wrap items-center gap-2">
          <PreviewLink url={row.previewUrl} label={C.launch.viewPreview} />
          <ApproveLaunchButton
            row={row}
            canLaunch={canLaunch}
            {...(approve ? { approve } : {})}
          />
        </span>
      </div>
      <details className="group">
        <summary className="cursor-pointer rounded text-sm font-semibold text-hub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
          {C.launch.checklist}
        </summary>
        <div className="pt-3">
          <LaunchChecklist
            checklist={row.checklist}
            move={row.move}
            reviewSent={row.reviewSent}
          />
        </div>
      </details>
    </li>
  );
}
