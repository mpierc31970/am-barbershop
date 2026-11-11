"use client";
// Suspension dialogs (13-43 choice 4; STAFF-22; D215, D218; 13-UI-SPEC "Suspension" lines
// 731-751, dialogs table lines 1073-1075; T-13-43-01).
// - SuspendOrWarnDialog "Suspend or warn {business}": a RadioCardGroup between **Send a notice
//   to fix** (both roles; Category, What to fix (owner sees it, 1,000), optional staff note;
//   the fix-by is shown and the notice is previewed as the business sees it: SUSP-NOTICE +
//   what to fix + MAIL-MISTAKE-LINE; primary Send notice · secondary Don't send) and
//   **Suspend now** (super_admin; agents see it disabled with SUPER-ONLY; Reason, required
//   staff note, prefilled message to the owner, the consequence list; destructive Suspend now
//   · secondary Don't suspend, focused). Suspend now goes through useStaffAction, so a stale
//   sign-in asks for an emailed code first and retries the same call.
// - MarkFixedDialog / LiftSuspensionDialog: CaseDialogs ("Mark fixed?" · "Lift the
//   suspension?"); lift is super_admin + step-up on the server.
import { fillCopy, P13_COPY, P13_DIALOGS } from "@cds/core/staff";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../hub/Button";
import { CdsMark, CdsSurface } from "../../hub/cds";
import { Dialog } from "../../hub/Dialog";
import { InlineAlert } from "../../hub/feedback";
import { Select, TextArea } from "../../hub/fields";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { formatFixBy } from "../../hub/shell/SuspensionNotice";
import { MessageBody } from "../../hub/support/thread";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { SITE_ACTIONS_COPY } from "./actions-copy";

const S = SITE_ACTIONS_COPY.suspension;
const CENTRAL = "America/Chicago";

export const SUSPENSION_TEXT_LIMIT = 1000;
export const NOTICE_CATEGORY_IDS = ["guideline", "dmca"] as const;
export const SUSPEND_CATEGORY_IDS = [
  "illegal",
  "legal_demand",
  "dmca",
] as const;
export type NoticeCategoryId = (typeof NOTICE_CATEGORY_IDS)[number];
export type SuspendCategoryId = (typeof SUSPEND_CATEGORY_IDS)[number];

export type SendNoticeAction = (
  orgId: string,
  input: { category: NoticeCategoryId; message: string; note?: string },
) => Promise<StaffActionResult<{ message: string }>>;
export type SuspendNowAction = (
  orgId: string,
  input: { category: SuspendCategoryId; note: string; message?: string },
) => Promise<StaffActionResult<{ message: string }>>;
export type SiteOrgAction = (
  orgId: string,
) => Promise<StaffActionResult<{ message: string }>>;

export interface SuspendOrWarnDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  /** Which choice is selected when it opens. */
  initial?: "notice" | "now";
  /** A notice is possible (no open notice, not suspended). */
  canNotice: boolean;
  /** staffCan(role, "suspend_now"): super_admin only. */
  canSuspendNow: boolean;
  /** ISO fix-by a notice sent now gets (computed server-side, suspensionFixBy). */
  noticeFixBy: string;
  sendNotice: SendNoticeAction;
  suspendNow: SuspendNowAction;
}

/** "Thu 16 Oct, 5:00 pm Central" (the dialog's fix-by line and preview). */
export function noticeWhen(iso: string): string {
  const at = formatFixBy(iso, CENTRAL);
  return at ? `${at} Central` : "";
}

export function SuspendOrWarnDialog({
  open,
  onClose,
  orgId,
  business,
  initial = "notice",
  canNotice,
  canSuspendNow,
  noticeFixBy,
  sendNotice,
  suspendNow,
}: SuspendOrWarnDialogProps) {
  const base = useId();
  const toast = useToast();
  const safeRef = useRef<HTMLButtonElement>(null);
  const [choice, setChoice] = useState<"notice" | "now">(initial);
  const [noticeCategory, setNoticeCategory] =
    useState<NoticeCategoryId>("guideline");
  const [whatToFix, setWhatToFix] = useState("");
  const [noticeNote, setNoticeNote] = useState("");
  const [nowCategory, setNowCategory] = useState<SuspendCategoryId>("illegal");
  const [nowNote, setNowNote] = useState("");
  const [nowMessage, setNowMessage] = useState<string>(S.now.messageDefault);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runNotice = useStaffAction(sendNotice, {
    describe: () => `${S.notice.title}: ${business}`,
  });
  const runNow = useStaffAction(suspendNow, {
    describe: () => `${S.now.title}: ${business}`,
  });

  useEffect(() => {
    if (!open) return;
    const first =
      initial === "now" && canSuspendNow ? "now" : canNotice ? "notice" : "now";
    setChoice(first);
    setNoticeCategory("guideline");
    setWhatToFix("");
    setNoticeNote("");
    setNowCategory("illegal");
    setNowNote("");
    setNowMessage(S.now.messageDefault);
    setError(null);
    setPending(false);
  }, [open, initial, canNotice, canSuspendNow]);

  useEffect(() => {
    if (open && choice === "now") safeRef.current?.focus();
  }, [open, choice]);

  const when = noticeWhen(noticeFixBy);
  const fixText = whatToFix.trim();
  const noticeReady =
    canNotice &&
    fixText !== "" &&
    whatToFix.length <= SUSPENSION_TEXT_LIMIT &&
    noticeNote.length <= SUSPENSION_TEXT_LIMIT;
  const nowReady =
    canSuspendNow &&
    nowNote.trim() !== "" &&
    nowNote.length <= SUSPENSION_TEXT_LIMIT &&
    nowMessage.length <= SUSPENSION_TEXT_LIMIT;
  const ready = !pending && (choice === "notice" ? noticeReady : nowReady);

  async function submit() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const res =
        choice === "notice"
          ? await runNotice(orgId, {
              category: noticeCategory,
              message: fixText,
              ...(noticeNote.trim() ? { note: noticeNote.trim() } : {}),
            })
          : await runNow(orgId, {
              category: nowCategory,
              note: nowNote.trim(),
              ...(nowMessage.trim() ? { message: nowMessage.trim() } : {}),
            });
      if (res.ok) {
        toast.show({ message: res.data.message });
        onClose();
        return;
      }
      if (res.code !== "step_up_needed" && res.code !== "session_ended") {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  const d =
    choice === "notice" ? P13_DIALOGS.suspend_notice : P13_DIALOGS.suspend_now;
  const previewHeading = fillCopy(S.notice.preview, { business });

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={fillCopy(S.title, { business })}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            ref={safeRef}
            variant="secondary"
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {d.safe}
          </Button>
          <Button
            variant={choice === "now" ? "destructive" : "primary"}
            onClick={() => void submit()}
            disabled={!ready}
            loading={pending}
            loadingLabel={S.working}
            className="max-sm:w-full"
          >
            {d.confirm}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 font-hub">
        <RadioCardGroup
          name={`${base}-choice`}
          legend={S.choice}
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setError(null);
          }}
          options={[
            {
              value: "notice",
              title: S.notice.title,
              description: S.notice.description,
              disabled: !canNotice,
            },
            {
              value: "now",
              title: S.now.title,
              description: canSuspendNow
                ? S.now.description
                : `${S.now.description} ${P13_COPY.SUPER_ONLY}.`,
              disabled: !canSuspendNow,
            },
          ]}
        />
        <p className="text-base">
          {fillCopy(d.title, { business })} {d.body}
        </p>
        {choice === "notice" ? (
          <>
            <Select
              id={`${base}-ncat`}
              label={S.notice.category}
              value={noticeCategory}
              onChange={(e) =>
                setNoticeCategory(e.currentTarget.value as NoticeCategoryId)
              }
              options={NOTICE_CATEGORY_IDS.map((c) => ({
                value: c,
                label: S.categories[c] ?? c,
              }))}
            />
            <TextArea
              id={`${base}-fix`}
              label={S.notice.whatToFix}
              helper={S.notice.whatHelper}
              value={whatToFix}
              rows={4}
              maxLength={SUSPENSION_TEXT_LIMIT}
              counter={{ value: whatToFix.length, max: SUSPENSION_TEXT_LIMIT }}
              onChange={(e) => setWhatToFix(e.currentTarget.value)}
            />
            <TextArea
              id={`${base}-nnote`}
              label={S.notice.note}
              helper={S.notice.noteHelper}
              value={noticeNote}
              rows={2}
              maxLength={SUSPENSION_TEXT_LIMIT}
              onChange={(e) => setNoticeNote(e.currentTarget.value)}
            />
            <p className="text-sm font-semibold text-hub-ink" data-fix-by="">
              {fillCopy(S.notice.fixBy, { when })}
            </p>
            {fixText ? (
              <section
                aria-label={previewHeading}
                data-notice-preview=""
                className="flex flex-col gap-2"
              >
                <h3 className="text-sm font-semibold text-hub-ink-muted">
                  {previewHeading}
                </h3>
                <CdsSurface padding="md">
                  <div className="flex items-center gap-2">
                    <CdsMark size={20} />
                    <span className="font-semibold text-hub-ink">
                      {S.notice.cardTitle}
                    </span>
                  </div>
                  <MessageBody
                    className="mt-2"
                    text={[
                      fillCopy(P13_COPY.SUSP_NOTICE, { when }),
                      fixText,
                      P13_COPY.MAIL_MISTAKE_LINE,
                    ].join("\n\n")}
                  />
                </CdsSurface>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <Select
              id={`${base}-scat`}
              label={S.now.reason}
              value={nowCategory}
              onChange={(e) =>
                setNowCategory(e.currentTarget.value as SuspendCategoryId)
              }
              options={SUSPEND_CATEGORY_IDS.map((c) => ({
                value: c,
                label: S.categories[c] ?? c,
              }))}
            />
            <TextArea
              id={`${base}-snote`}
              label={S.now.note}
              helper={S.now.noteHelper}
              value={nowNote}
              rows={2}
              maxLength={SUSPENSION_TEXT_LIMIT}
              onChange={(e) => setNowNote(e.currentTarget.value)}
            />
            <TextArea
              id={`${base}-smsg`}
              label={S.now.message}
              value={nowMessage}
              rows={3}
              maxLength={SUSPENSION_TEXT_LIMIT}
              onChange={(e) => setNowMessage(e.currentTarget.value)}
            />
            <ul
              className="list-disc pl-5 text-sm text-hub-ink-muted"
              data-consequences=""
            >
              {S.now.consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

export interface SuspensionCaseDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  action: SiteOrgAction;
}

export function MarkFixedDialog({
  open,
  onClose,
  orgId,
  business,
  action,
}: SuspensionCaseDialogProps) {
  const toast = useToast();
  const C = SITE_ACTIONS_COPY.markFixed;
  const run = useStaffAction(action, {
    describe: () => `${C.confirm}: ${business}`,
  });
  return (
    <CaseDialog
      open={open}
      onClose={onClose}
      title={C.title}
      consequence={C.body}
      caseRows={[[SITE_ACTIONS_COPY.openTicket.site, business]]}
      confirmLabel={C.confirm}
      safeLabel={C.safe}
      onConfirm={async () => {
        const res = await run(orgId);
        if (res.ok) toast.show({ message: res.data.message });
        return res;
      }}
    />
  );
}

export function LiftSuspensionDialog({
  open,
  onClose,
  orgId,
  business,
  action,
}: SuspensionCaseDialogProps) {
  const toast = useToast();
  const d = P13_DIALOGS.suspend_lift;
  const run = useStaffAction(action, {
    describe: () => `${d.confirm}: ${business}`,
  });
  return (
    <CaseDialog
      open={open}
      onClose={onClose}
      title={d.title}
      consequence={d.body}
      caseRows={[[SITE_ACTIONS_COPY.openTicket.site, business]]}
      confirmLabel={d.confirm}
      safeLabel={d.safe}
      onConfirm={async () => {
        const res = await run(orgId);
        if (res.ok) toast.show({ message: res.data.message });
        return res;
      }}
    />
  );
}
