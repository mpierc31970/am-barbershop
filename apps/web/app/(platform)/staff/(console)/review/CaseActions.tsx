"use client";
// Case page client controls (13-38 choice 3; STAFF-23, STAFF-24; D249, D-UI-P13-10, -25;
// 13-UI-SPEC "Case page" lines 693-719, "Destructive and irreversible actions"). Every control
// runs its 13-38 action through useStaffAction (step-up retried once), inside a CaseDialog with
// the safe button focused for destructive outcomes:
// - CaseOutcomes: OutcomeBar (secondary only) → Clear hold · Ask to fix (P13_DIALOGS
//   suspend_notice + what the owner reads) · Remove content (unpublish_page / media_takedown,
//   destructive) · Suspend… (suspend_now, destructive, staff note);
// - CaseTimelineActions: CaseTimeline + one small dialog per step (Set restore date has a date
//   field); Mark upheld / Mark restored are outcomes (they feed the repeat-infringer count);
// - SpotPages: each changed page with View and OK · Issue (Issue asks for a note), then the one
//   primary Close spot check when every page is marked;
// - AssignControl: Assign to me / Unassign.
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import {
  Button,
  Dialog,
  InlineAlert,
  SegmentedControl,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import {
  CaseDialog,
  CaseTimeline,
  OutcomeBar,
  REVIEW_COPY,
  useStaffAction,
  type CaseTimelineEntry,
  type CaseTimelineKind,
  type CaseTimelineStep,
  type OutcomeBarOutcome,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  addCaseStepAction,
  assignCaseAction,
  caseOutcomeAction,
  flagOutcomeAction,
  markSpotPageAction,
} from "../../../../actions/staff/review";

const C = REVIEW_COPY;

export type CaseTargetRef =
  { type: "case"; ref: string } | { type: "flag"; id: string };

export type CaseOutcomesProps = {
  target: CaseTargetRef;
  business: string;
  /** "About us" / "hero.jpg" (empty when the case names no page or file). */
  title: string;
  targetKind: "page" | "media" | "other" | "none";
  /** A held page or photo (Clear hold publishes it). */
  held: boolean;
  canSuspend: boolean;
  canTakeDown: boolean;
  closed: boolean;
  /** Media takedown case lines (describeTakedown): size and pages using it. */
  takedown?: { size: string; usedOn: number } | null;
};

type Dialogs = OutcomeBarOutcome | null;

export function CaseOutcomes(p: CaseOutcomesProps) {
  const router = useRouter();
  const toast = useToast();
  const runCase = useStaffAction(caseOutcomeAction);
  const runFlag = useStaffAction(flagOutcomeAction);
  const [open, setOpen] = useState<Dialogs>(null);
  const site = p.business || C.noSite;

  async function apply(
    outcome: OutcomeBarOutcome,
    opts: Record<string, string> = {},
  ) {
    const res =
      p.target.type === "case"
        ? await runCase(p.target.ref, outcome, opts)
        : await runFlag(p.target.id, outcome, opts);
    if (res.ok) {
      toast.show({ message: res.data.message });
      router.refresh();
    }
    return res;
  }

  const hidden: OutcomeBarOutcome[] = [];
  if (p.targetKind !== "page" && p.targetKind !== "media")
    hidden.push("removed");
  if (!p.business) hidden.push("fix_requested", "suspended");
  // WR-D04: an irreversible takedown is never confirmed against an unknown page count. When
  // the takedown case couldn't be read, Remove content is not offered (reload to retry).
  if (p.targetKind === "media" && p.canTakeDown && !p.takedown)
    hidden.push("removed");
  const superOnly: OutcomeBarOutcome[] = [];
  if (!p.canSuspend) superOnly.push("suspended");
  if (p.targetKind === "media" && !p.canTakeDown) superOnly.push("removed");

  const rows: (readonly [string, string])[] = [[C.cols.site, site]];
  if (p.title) rows.push([C.cols.what, p.title]);
  const media = p.targetKind === "media";
  const remove = media
    ? P13_DIALOGS.media_takedown
    : P13_DIALOGS.unpublish_page;
  const removeRows: (readonly [string, string])[] = media
    ? [
        ...rows,
        ...(p.takedown
          ? ([
              ["Size", p.takedown.size],
              ["Pages using it", String(p.takedown.usedOn)],
            ] as const)
          : []),
      ]
    : rows;

  return (
    <>
      <OutcomeBar
        onOutcome={setOpen}
        hidden={hidden}
        superOnly={superOnly}
        disabled={p.closed}
      />
      <CaseDialog
        open={open === "cleared"}
        onClose={() => setOpen(null)}
        title={C.clearTitle}
        consequence={p.held ? C.clearBody : C.clearCaseBody}
        caseRows={rows}
        confirmLabel={C.clearConfirm}
        safeLabel={C.clearSafe}
        onConfirm={() => apply("cleared")}
      />
      <CaseDialog
        open={open === "fix_requested"}
        onClose={() => setOpen(null)}
        title={fillCopy(P13_DIALOGS.suspend_notice.title, { business: site })}
        consequence={P13_DIALOGS.suspend_notice.body}
        caseRows={rows}
        confirmLabel={P13_DIALOGS.suspend_notice.confirm}
        safeLabel={P13_DIALOGS.suspend_notice.safe}
        reasonField={{ label: C.fixMessage, helper: C.fixHelper, max: 500 }}
        onConfirm={(v) => apply("fix_requested", { message: v.reason ?? "" })}
      />
      <CaseDialog
        open={open === "removed"}
        onClose={() => setOpen(null)}
        title={fillCopy(remove.title, {
          page: p.title || C.none,
          file: p.title || C.none,
        })}
        consequence={fillCopy(remove.body, {
          pages: p.takedown ? p.takedown.usedOn : 0,
        })}
        caseRows={removeRows}
        confirmLabel={remove.confirm}
        safeLabel={remove.safe}
        destructive
        onConfirm={() => apply("removed")}
      />
      <CaseDialog
        open={open === "suspended"}
        onClose={() => setOpen(null)}
        title={fillCopy(P13_DIALOGS.suspend_now.title, { business: site })}
        consequence={P13_DIALOGS.suspend_now.body}
        caseRows={rows}
        confirmLabel={P13_DIALOGS.suspend_now.confirm}
        safeLabel={P13_DIALOGS.suspend_now.safe}
        destructive
        reasonField={{ label: C.suspendNote, helper: C.suspendHelper }}
        onConfirm={(v) => apply("suspended", { note: v.reason ?? "" })}
      />
    </>
  );
}

type StepDialog = Exclude<CaseTimelineStep, "received"> | null;

function RestoreDateDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (date: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const id = useId();
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await onSave(date);
      if (res.ok) onClose();
      else if (res.message) setError(res.message);
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
      title={C.stepTitle(C.stepActions.restore_date_set)}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {C.stepCancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pending}
            disabled={!date}
            onClick={() => void save()}
          >
            {C.stepSave}
          </Button>
        </>
      }
    >
      <TextField
        id={`${id}-restore`}
        label={C.restoreDate}
        helper={C.restoreHelper}
        type="date"
        value={date}
        onChange={(ev) => setDate(ev.target.value)}
        error={error ?? undefined}
      />
    </Dialog>
  );
}

export function CaseTimelineActions({
  caseRef,
  kind,
  entries,
  timeZone,
  closed,
}: {
  caseRef: string;
  kind: CaseTimelineKind;
  entries: readonly CaseTimelineEntry[];
  timeZone: string;
  closed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const runStep = useStaffAction(addCaseStepAction);
  const runOutcome = useStaffAction(caseOutcomeAction);
  const [open, setOpen] = useState<StepDialog>(null);

  async function record(step: Exclude<CaseTimelineStep, "received">) {
    const res =
      step === "upheld" || step === "restored"
        ? await runOutcome(caseRef, step)
        : await runStep(caseRef, step);
    if (res.ok) {
      toast.show({ message: res.data.message });
      router.refresh();
    }
    return res;
  }

  const plain = open && open !== "restore_date_set" ? open : null;
  return (
    <>
      <CaseTimeline
        kind={kind}
        entries={entries}
        timeZone={timeZone}
        readOnly={closed}
        onStep={(s) => {
          if (s !== "received") setOpen(s);
        }}
      />
      <CaseDialog
        open={plain !== null}
        onClose={() => setOpen(null)}
        title={plain ? C.stepTitle(C.stepActions[plain]) : ""}
        consequence={C.stepBody}
        caseRows={[[C.cols.case, caseRef]]}
        confirmLabel={plain ? C.stepActions[plain] : C.stepSave}
        safeLabel={C.stepCancel}
        onConfirm={() => (plain ? record(plain) : undefined)}
      />
      <RestoreDateDialog
        open={open === "restore_date_set"}
        onClose={() => setOpen(null)}
        onSave={async (date) => {
          const res = await runStep(
            caseRef,
            "restore_date_set",
            undefined,
            date,
          );
          if (res.ok) {
            toast.show({ message: res.data.message });
            router.refresh();
            return { ok: true };
          }
          return { ok: false, message: res.message };
        }}
      />
    </>
  );
}

export type SpotPageView = {
  pageId: string;
  title: string;
  state: "unchecked" | "ok" | "issue";
  note?: string;
  url: string | null;
};

function SpotPageRow({
  caseRef,
  page,
  closed,
}: {
  caseRef: string;
  page: SpotPageView;
  closed: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const run = useStaffAction(markSpotPageAction);
  const [issueOpen, setIssueOpen] = useState(page.state === "issue");
  const [note, setNote] = useState(page.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function mark(state: "ok" | "issue") {
    setPending(true);
    setError(null);
    try {
      const res = await run(caseRef, page.pageId, state, note);
      if (res.ok) {
        toast.show({ message: res.data.message });
        router.refresh();
      } else if (res.code !== "session_ended") setError(res.message);
    } finally {
      setPending(false);
    }
  }

  const value =
    page.state === "unchecked" ? (issueOpen ? "issue" : "") : page.state;
  return (
    <li className="flex flex-col gap-3 border-b border-hub-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-base font-semibold">{page.title || C.none}</span>
        <div className="flex items-center gap-3">
          {page.url ? (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-hub-accent underline underline-offset-2"
            >
              {C.view}
            </a>
          ) : null}
          <SegmentedControl
            name={`${id}-mark`}
            label={C.spotMarkLabel(page.title || C.none)}
            options={[
              { value: "ok", label: C.spotOk },
              { value: "issue", label: C.spotIssue },
            ]}
            value={value as "ok" | "issue"}
            disabled={closed || pending}
            onChange={(v) => {
              if (v === "ok") {
                setIssueOpen(false);
                void mark("ok");
              } else setIssueOpen(true);
            }}
          />
        </div>
      </div>
      {issueOpen && !closed ? (
        <div className="flex flex-col gap-2">
          <TextArea
            id={`${id}-note`}
            label={C.spotIssueNote}
            rows={3}
            value={note}
            counter={{ value: note.trim().length, max: 1000 }}
            onChange={(ev) => setNote(ev.target.value)}
          />
          <div>
            <Button
              type="button"
              variant="secondary"
              loading={pending}
              onClick={() => void mark("issue")}
            >
              {C.spotSaveIssue}
            </Button>
          </div>
        </div>
      ) : page.note ? (
        <p className="whitespace-pre-wrap text-sm">{page.note}</p>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </li>
  );
}

export function SpotPages({
  caseRef,
  pages,
  closed,
}: {
  caseRef: string;
  pages: readonly SpotPageView[];
  closed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const run = useStaffAction(caseOutcomeAction);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allMarked =
    pages.length > 0 && pages.every((pg) => pg.state !== "unchecked");
  async function close() {
    setPending(true);
    setError(null);
    try {
      const res = await run(caseRef, "cleared");
      if (res.ok) {
        toast.show({ message: C.closeSpotDone });
        router.refresh();
      } else if (res.code !== "session_ended") setError(res.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{C.spotPages}</h2>
      <ul className="flex flex-col">
        {pages.map((pg) => (
          <SpotPageRow
            key={pg.pageId}
            caseRef={caseRef}
            page={pg}
            closed={closed}
          />
        ))}
      </ul>
      {allMarked && !closed ? (
        <div>
          <Button
            type="button"
            variant="primary"
            loading={pending}
            onClick={() => void close()}
          >
            {C.closeSpot}
          </Button>
        </div>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </section>
  );
}

export function AssignControl({
  caseRef,
  label,
  mine,
  assigned,
  closed,
}: {
  caseRef: string;
  label: string;
  mine: boolean;
  assigned: boolean;
  closed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const run = useStaffAction(assignCaseAction);
  const [pending, setPending] = useState(false);
  async function assign(to: "me" | "none") {
    setPending(true);
    try {
      const res = await run(caseRef, to);
      if (res.ok) {
        toast.show({ message: res.data.message });
        router.refresh();
      } else if (res.code !== "session_ended" && res.message) {
        // WR-D07: a refusal (case closed elsewhere, role, stale case) is said, not dropped.
        toast.show({ message: res.message });
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{label}</span>
      {closed ? null : (
        <div className="flex flex-wrap gap-2">
          {mine ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={pending}
              onClick={() => void assign("me")}
            >
              {C.rail.assignMe}
            </Button>
          )}
          {assigned ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void assign("none")}
            >
              {C.rail.unassign}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
