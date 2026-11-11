"use client";
// Get help form (12-20 choice 2; COMM-06, COMM-08, D94, D119, SUPPORT-02; 12-UI-SPEC lines
// 376-417, states 740-741, copy 757-807, nav guard 820). One page, no wizard:
//   1. What do you need? (TicketTypeCards; Billing only for Owner/Admin; nothing preselected
//      unless `?type=`). Change request adds the paid-service rule panel (CdsSurface + PAID-RULE
//      + What support includes). Suggest a feature sets `?type=suggestion` and swaps the rest
//      of the form in place to IdeaFields (12-27; H1 "Suggest a feature"; the cards stay so the
//      person can switch back, and the text typed in either form is kept).
//   2. What is it about? (TargetSelect, server options; `?target=` preselects).
//   3. Subject (80) + HelpDeflect: up to 3 matching help articles that open in the
//      TrainingDrawer (the form keeps its state); not for Billing.
//   4. Tell us more (5,000) with a per-type helper; pasting an image while typing here
//      attaches it as a screenshot.
//   5. Screenshots or files: Attach files, drop, paste; one XHR per file (useSupportUploads).
//   6. Footer: SLA-LINE (Problem, Question) or "CDS replies here and lets you know by email."
//      (Change, Billing), CONTEXT-NOTE, primary Send to CDS, ghost Discard.
// Validation on submit, inline, first error focused. Files still uploading: "Sending…" waits
// (60 s max). Success: Toast "Ticket #1042 sent. …" and the ticket opens. RATE-TICKETS shows
// at the top with focus moved there; the text is kept. Leaving with text asks "Leave without
// sending?" (Keep writing first, so it takes focus).
// Post idea (12-27 choice 3): submitIdeaAction; success → Toast "Idea posted. Your site voted
// for it." and Ideas → Suggested with ?new=<id> highlighted; a held idea → D-UI-P12-26 toast,
// no highlight; RATE-TICKETS on the shared ticket limit.
import type { IdeaCard, TargetGroup, TicketType } from "@cds/core/support";
import {
  Button,
  Dialog,
  IconButton,
  InlineAlert,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { CdsSurface } from "@cds/ui/hub/cds";
import { useHelpOpener } from "@cds/ui/hub/shell";
import {
  HelpDeflect,
  SUPPORT_UI_COPY,
  SUPPORT_UPLOAD_ACCEPT,
  TargetSelect,
  THREAD_COPY,
  TicketTypeCards,
  screenshotName,
  ticketHref,
  useSupportUploads,
  type SupportUploadItem,
} from "@cds/ui/hub/support";
import { Paperclip, SendHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { submitIdeaAction } from "../../../../../actions/ideas";
import { fileTicketAction } from "../../../../../actions/support-tickets";
import { GuardedLink } from "../../../GuardedLink";
import { useRegisterNavGuard } from "../../../nav-guard";
import { IDEA_FORM_COPY, IdeaFields, type IdeaField } from "./IdeaFields";

export type DeflectArticle = {
  id: string;
  title: string;
  summary: string;
  href: string;
};

export interface NewTicketFormProps {
  types: readonly TicketType[];
  targets: readonly TargetGroup[];
  articles: readonly DeflectArticle[];
  initialType: TicketType | null;
  /** `kind:id`, already validated against `targets`. */
  initialTarget: string;
  /** `?ref=`: the closed ticket this follows up on. */
  refNumber: number | null;
  /** `?from=` as given; fileTicket keeps it only when it is a same-origin /hub path. */
  fromUrl: string | null;
  /** Where Discard goes (a safe /hub path). */
  backHref: string;
  timeZone: string;
  /** Visible, not-built ideas for SimilarIdeas (empty when the role cannot suggest). */
  ideas: readonly IdeaCard[];
  /** Back link + ScreenHeader "Get help" (server-built). */
  header: ReactNode;
  /** Back link + ScreenHeader "Suggest a feature", shown while the type is `suggestion`. */
  ideaHeader: ReactNode;
}

export const SUBJECT_MAX = 80;
export const BODY_MAX = 5000;
const UPLOAD_WAIT_MS = 60_000;

export const NEW_TICKET_COPY = Object.freeze({
  ruleHead: "Some changes are a paid service",
  aboutHead: "What is it about?",
  subject: "Subject",
  body: "Tell us more",
  files: "Screenshots or files",
  replyByEmail: "Support replies here and lets you know by email.",
  ideasHref: "/hub/support?tab=ideas",
  /** Where Post idea lands: Ideas → Suggested, the new row highlighted when it is listed. */
  ideaPostedHref: (id: string | null) =>
    id
      ? `/hub/support?tab=ideas&status=suggested&new=${encodeURIComponent(id)}`
      : "/hub/support?tab=ideas&status=suggested",
  whatSupportIncludesHref: "/hub/help/what-support-includes",
  followsUp: (n: number) => `Follows up on ticket #${n}.`,
  sent: (n: number, type: TicketType) =>
    type === "problem" || type === "question"
      ? `Ticket #${n} sent. ${SUPPORT_UI_COPY.SLA_LINE}`
      : `Ticket #${n} sent.`,
  helper: {
    problem: "What did you expect, and what happened instead?",
    change: "What should change, and where?",
    question: "What are you trying to do?",
    billing: "Which charge or invoice is it about?",
    suggestion: "",
  } satisfies Record<TicketType, string>,
});

const LINK =
  "rounded font-semibold text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const it of Array.from(data.items ?? [])) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  if (out.length === 0) {
    for (const f of Array.from(data.files ?? [])) {
      if (f.type.startsWith("image/")) out.push(f);
    }
  }
  return out;
}

/** True for the types with the 2-business-day first reply (SUPPORT-02). */
export function hasSla(type: TicketType | null): boolean {
  return type === "problem" || type === "question";
}

type Field = "type" | "subject" | "body";
const FIELD_ORDER: readonly Field[] = ["type", "subject", "body"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function FileChip({
  item,
  onRemove,
  onRetry,
}: {
  item: SupportUploadItem;
  onRemove(): void;
  onRetry(): void;
}) {
  const busy = item.status === "queued" || item.status === "uploading";
  return (
    <li
      data-upload={item.key}
      className="flex max-w-full min-w-0 flex-wrap items-center gap-2 rounded border border-hub-border bg-hub-surface py-1 pr-1 pl-3 text-sm"
    >
      <span className="min-w-0 truncate text-base" title={item.name}>
        {item.name}
      </span>
      {busy ? (
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.pct}
          aria-valuetext={THREAD_COPY.uploadingValue(item.name, item.pct)}
          className="text-hub-ink-muted tabular-nums"
        >
          {THREAD_COPY.uploading(item.pct)}
        </span>
      ) : null}
      {item.status === "error" ? (
        <>
          <span className="text-hub-danger">
            {item.message ?? SUPPORT_UI_COPY.FILE_FAILED(item.name)}
          </span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {SUPPORT_UI_COPY.BUTTONS.tryAgain}
          </Button>
        </>
      ) : null}
      <IconButton
        size="sm"
        label={SUPPORT_UI_COPY.BUTTONS.remove(item.name)}
        icon={<X aria-hidden size={16} strokeWidth={2} />}
        tooltipAlign="end"
        onClick={onRemove}
      />
    </li>
  );
}

export function NewTicketForm({
  types,
  targets,
  articles,
  initialType,
  initialTarget,
  refNumber,
  fromUrl,
  backHref,
  timeZone,
  ideas,
  header,
  ideaHeader,
}: NewTicketFormProps) {
  const router = useRouter();
  const toast = useToast();
  const openHelp = useHelpOpener();
  const initialBody = refNumber
    ? `${NEW_TICKET_COPY.followsUp(refNumber)}\n\n`
    : "";

  const [type, setType] = useState<TicketType | null>(initialType);
  const [target, setTarget] = useState(initialTarget);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(initialBody);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaBody, setIdeaBody] = useState("");
  const [ideaErrors, setIdeaErrors] = useState<
    Partial<Record<IdeaField, string>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [topAlert, setTopAlert] = useState<{
    tone: "warning" | "error";
    text: string;
  } | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [over, setOver] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(
    null,
  );
  const uploads = useSupportUploads();

  const rootRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef(false);
  // Latest upload state for the submit wait loop.
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  const dirty =
    !sentRef.current &&
    (subject.trim() !== "" ||
      body.trim() !== initialBody.trim() ||
      ideaTitle.trim() !== "" ||
      ideaBody.trim() !== "" ||
      uploads.items.length > 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useRegisterNavGuard((go) => {
    if (!dirtyRef.current) return false;
    setPendingNav({ run: go });
    return true;
  });

  // A reload or tab close with text asks the browser's own question.
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  useEffect(() => {
    if (topAlert) alertRef.current?.focus();
  }, [topAlert]);

  useEffect(() => {
    if (refusals.length > 0) refusalRef.current?.focus();
  }, [refusals]);

  function chooseType(next: TicketType) {
    const was = type;
    setType(next);
    setErrors((e) => ({ ...e, type: undefined }));
    setTopAlert(null);
    // The swap is link-state: `?type=suggestion` opens the idea form, and switching back
    // drops it (the server ignores ?type for a role that may not file that type).
    if (next === "suggestion" || was === "suggestion") {
      const q = new URLSearchParams(window.location.search);
      q.set("type", next);
      router.replace(`${window.location.pathname}?${q.toString()}`, {
        scroll: false,
      });
    }
  }

  function take(files: readonly File[]) {
    if (files.length === 0) return;
    setRefusals(uploads.add(files));
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const data = e.clipboardData;
    const images = clipboardImages(data);
    if (images.length === 0) return;
    if (!data?.getData?.("text/plain")) e.preventDefault();
    const at = new Date();
    take(
      images.map(
        (f) =>
          new File(
            [f],
            screenshotName(at, timeZone, IMAGE_EXT[f.type] ?? "png"),
            { type: f.type },
          ),
      ),
    );
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    take(Array.from(e.dataTransfer?.files ?? []));
  }

  function focusField(field: Field) {
    const root = rootRef.current;
    if (!root) return;
    const el =
      field === "type"
        ? root.querySelector<HTMLElement>("[data-ticket-types] input")
        : root.querySelector<HTMLElement>(`#ticket-${field}`);
    el?.focus();
  }

  function validate(): Partial<Record<Field, string>> {
    const out: Partial<Record<Field, string>> = {};
    if (!type) out.type = SUPPORT_UI_COPY.TYPE_REQUIRED;
    if (!subject.trim()) out.subject = SUPPORT_UI_COPY.SUBJECT_REQUIRED;
    if (!body.trim() || body.trim() === initialBody.trim()) {
      out.body = SUPPORT_UI_COPY.BODY_REQUIRED;
    }
    return out;
  }

  async function submit() {
    if (sending || !type || type === "suggestion") return;
    setTopAlert(null);
    setSending(true);
    // Files still uploading: wait (60 s max), then flag the slow chip.
    const started = Date.now();
    while (uploadsRef.current.busy && Date.now() - started < UPLOAD_WAIT_MS) {
      await sleep(200);
    }
    if (uploadsRef.current.busy) {
      setSending(false);
      setRefusals([THREAD_COPY.waitForUploads]);
      return;
    }
    // IN-C03: a file that didn't upload is never left out without the person knowing (the
    // same rule as the Composer, WR-D04): remove or retry it first.
    if (uploadsRef.current.items.some((t) => t.status === "error")) {
      setSending(false);
      setRefusals([THREAD_COPY.failedUploads]);
      return;
    }
    const res = await fileTicketAction({
      type,
      target,
      subject,
      body,
      uploadTokens: uploadsRef.current.tokens,
      from: fromUrl,
    }).catch(() => null);
    if (!res) {
      setSending(false);
      setTopAlert({ tone: "error", text: SUPPORT_UI_COPY.ERR_SEND });
      return;
    }
    if (!res.ok) {
      setSending(false);
      setTopAlert(
        res.code === "rate_limited"
          ? { tone: "warning", text: SUPPORT_UI_COPY.RATE_TICKETS }
          : {
              tone: "error",
              text:
                res.code === "save_failed"
                  ? SUPPORT_UI_COPY.ERR_SEND
                  : res.message || SUPPORT_UI_COPY.ERR_SEND,
            },
      );
      return;
    }
    sentRef.current = true;
    dirtyRef.current = false;
    uploads.clear();
    toast.show({
      message: NEW_TICKET_COPY.sent(res.data.number, res.data.type),
    });
    router.push(ticketHref(res.data.number));
  }

  function validateIdea(): Partial<Record<IdeaField, string>> {
    const out: Partial<Record<IdeaField, string>> = {};
    if (!ideaTitle.trim()) out.ideaTitle = IDEA_FORM_COPY.titleRequired;
    if (!ideaBody.trim())
      out.ideaDescription = IDEA_FORM_COPY.descriptionRequired;
    return out;
  }

  async function postIdea() {
    if (sending) return;
    setTopAlert(null);
    setSending(true);
    const res = await submitIdeaAction({
      title: ideaTitle,
      description: ideaBody,
    }).catch(() => null);
    if (!res) {
      setSending(false);
      setTopAlert({ tone: "error", text: SUPPORT_UI_COPY.ERR_SEND });
      return;
    }
    if (!res.ok) {
      setSending(false);
      setTopAlert(
        res.code === "rate_limited"
          ? { tone: "warning", text: SUPPORT_UI_COPY.RATE_TICKETS }
          : {
              tone: "error",
              text:
                res.code === "save_failed"
                  ? SUPPORT_UI_COPY.ERR_SEND
                  : res.message || SUPPORT_UI_COPY.ERR_SEND,
            },
      );
      return;
    }
    sentRef.current = true;
    dirtyRef.current = false;
    // A held idea is not listed until CDS reviews it (D-UI-P12-26): no highlight.
    toast.show({
      message: res.data.held ? IDEA_FORM_COPY.held : IDEA_FORM_COPY.posted,
    });
    router.push(
      NEW_TICKET_COPY.ideaPostedHref(res.data.held ? null : res.data.id),
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (type === "suggestion") {
      const found = validateIdea();
      setIdeaErrors(found);
      const firstBad = (["ideaTitle", "ideaDescription"] as const).find(
        (f) => found[f],
      );
      if (firstBad) {
        rootRef.current
          ?.querySelector<HTMLElement>(
            firstBad === "ideaTitle" ? "#idea-title" : "#idea-description",
          )
          ?.focus();
        return;
      }
      void postIdea();
      return;
    }
    const found = validate();
    setErrors(found);
    const firstBad = FIELD_ORDER.find((f) => found[f]);
    if (firstBad) {
      focusField(firstBad);
      return;
    }
    void submit();
  }

  function discard() {
    const go = () => router.push(backHref);
    if (dirtyRef.current) setPendingNav({ run: go });
    else go();
  }

  const suggestion = type === "suggestion";
  const footerLine = !type
    ? null
    : hasSla(type)
      ? SUPPORT_UI_COPY.SLA_LINE
      : NEW_TICKET_COPY.replyByEmail;

  return (
    <>
      {suggestion ? ideaHeader : header}
      <form
        ref={rootRef}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-8"
        data-new-ticket=""
      >
        {topAlert ? (
          <div
            ref={alertRef}
            tabIndex={-1}
            className="outline-none"
            data-ticket-alert=""
          >
            <InlineAlert tone={topAlert.tone}>{topAlert.text}</InlineAlert>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          <TicketTypeCards
            types={types}
            value={type}
            onChange={chooseType}
            name="ticket-type"
            error={errors.type ?? null}
          />
          {type === "change" ? (
            <div data-cds-identity="" data-paid-rule="">
              <CdsSurface padding="lg" className="flex flex-col gap-2">
                <p className="text-base font-semibold">
                  {NEW_TICKET_COPY.ruleHead}
                </p>
                <p className="text-base">{SUPPORT_UI_COPY.PAID_RULE}</p>
                <GuardedLink
                  href={NEW_TICKET_COPY.whatSupportIncludesHref}
                  className={`${LINK} self-start text-base`}
                >
                  {SUPPORT_UI_COPY.BUTTONS.whatSupportIncludes}
                </GuardedLink>
              </CdsSurface>
            </div>
          ) : null}
        </div>

        {suggestion ? (
          <IdeaFields
            title={ideaTitle}
            description={ideaBody}
            onTitle={(next) => {
              setIdeaTitle(next);
              if (ideaErrors.ideaTitle) {
                setIdeaErrors((x) => ({ ...x, ideaTitle: undefined }));
              }
            }}
            onDescription={(next) => {
              setIdeaBody(next);
              if (ideaErrors.ideaDescription) {
                setIdeaErrors((x) => ({ ...x, ideaDescription: undefined }));
              }
            }}
            errors={ideaErrors}
            ideas={ideas}
            sending={sending}
            onDiscard={discard}
          />
        ) : (
          <>
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-4 text-xl font-semibold">
                {NEW_TICKET_COPY.aboutHead}
              </legend>
              <TargetSelect
                options={targets}
                value={target}
                onChange={setTarget}
                id="ticket-target"
              />
            </fieldset>

            <div className="flex flex-col gap-2">
              <TextField
                id="ticket-subject"
                label={NEW_TICKET_COPY.subject}
                value={subject}
                maxLength={SUBJECT_MAX}
                required
                readOnly={sending}
                error={errors.subject}
                onChange={(e) => {
                  setSubject(e.currentTarget.value);
                  if (errors.subject) {
                    setErrors((x) => ({ ...x, subject: undefined }));
                  }
                }}
              />
              <HelpDeflect
                query={subject}
                articles={articles}
                disabled={type === "billing"}
                onOpen={openHelp ? (id) => openHelp(id) : undefined}
              />
            </div>

            <TextArea
              id="ticket-body"
              label={NEW_TICKET_COPY.body}
              value={body}
              rows={6}
              maxLength={BODY_MAX}
              required
              readOnly={sending}
              helper={
                type ? NEW_TICKET_COPY.helper[type] || undefined : undefined
              }
              error={errors.body}
              onPaste={onPaste}
              onChange={(e) => {
                setBody(e.currentTarget.value);
                if (errors.body) setErrors((x) => ({ ...x, body: undefined }));
              }}
            />

            <div
              className="relative flex flex-col gap-2 rounded-lg"
              data-ticket-files=""
              data-over={over || undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (!next || !e.currentTarget.contains(next)) setOver(false);
              }}
              onDrop={onDrop}
            >
              <p className="text-sm font-semibold">{NEW_TICKET_COPY.files}</p>
              <p className="text-sm text-hub-ink-muted">
                {SUPPORT_UI_COPY.ATTACH_HINT} {SUPPORT_UI_COPY.FILE_RULES}
              </p>
              {uploads.items.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {uploads.items.map((item) => (
                    <FileChip
                      key={item.key}
                      item={item}
                      onRemove={() => uploads.remove(item.key)}
                      onRetry={() => uploads.retry(item.key)}
                    />
                  ))}
                </ul>
              ) : null}
              {refusals.length > 0 ? (
                <div
                  ref={refusalRef}
                  tabIndex={-1}
                  role="alert"
                  data-upload-errors=""
                  className="flex flex-col gap-1 text-sm text-hub-danger outline-none"
                >
                  {refusals.map((r, i) => (
                    <p key={i}>{r}</p>
                  ))}
                </div>
              ) : null}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Paperclip aria-hidden size={16} strokeWidth={2} />}
                  onClick={() => fileRef.current?.click()}
                  disabled={sending}
                >
                  {SUPPORT_UI_COPY.BUTTONS.attachFiles}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={SUPPORT_UPLOAD_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const picked = Array.from(e.currentTarget.files ?? []);
                    e.currentTarget.value = "";
                    take(picked);
                  }}
                />
              </div>
              {over ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-hub-accent bg-hub-surface/80"
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-4 border-t border-hub-border pt-6">
              {footerLine ? (
                <p
                  className="text-sm text-hub-ink-muted"
                  data-ticket-reply-line=""
                >
                  {footerLine}
                </p>
              ) : null}
              <p className="text-sm text-hub-ink-muted" data-context-note="">
                {SUPPORT_UI_COPY.CONTEXT_NOTE}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  icon={
                    <SendHorizontal aria-hidden size={16} strokeWidth={2} />
                  }
                  loading={sending}
                  loadingLabel={SUPPORT_UI_COPY.BUTTONS.sending}
                >
                  {SUPPORT_UI_COPY.BUTTONS.sendToCds}
                </Button>
                <Button variant="ghost" onClick={discard} disabled={sending}>
                  {SUPPORT_UI_COPY.BUTTONS.discard}
                </Button>
              </div>
            </div>
          </>
        )}
      </form>

      {pendingNav ? (
        <Dialog
          open
          onClose={() => setPendingNav(null)}
          title={SUPPORT_UI_COPY.LEAVE_H}
          footer={
            <>
              <Button
                autoFocus
                onClick={() => setPendingNav(null)}
                data-keep-writing=""
              >
                {SUPPORT_UI_COPY.BUTTONS.keepWriting}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const go = pendingNav.run;
                  dirtyRef.current = false;
                  sentRef.current = true;
                  setPendingNav(null);
                  go();
                }}
              >
                {SUPPORT_UI_COPY.BUTTONS.leave}
              </Button>
            </>
          }
        >
          {SUPPORT_UI_COPY.LEAVE_B}
        </Dialog>
      ) : null}
    </>
  );
}
