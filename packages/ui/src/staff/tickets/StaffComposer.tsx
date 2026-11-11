"use client";
// StaffComposer (13-41 choice 1; STAFF-08, STAFF-09, D96, D119; D-UI-P13-6, -7, -8; 13-UI-SPEC
// "StaffComposer" lines 476-501, states 1012, a11y 1100-1101; T-13-41-01). The reply box at the
// foot of a staff ticket:
//   - Radio group "Reply type": Public reply (default) · Internal note. Internal note recolours
//     the box (decorative hatch + dashed warning border; forced colours keep the border and the
//     words), labels it "Internal note" with "Only CDS sees this." under it, announces
//     "Internal note. Only CDS sees this." and stays selected after a note is saved (D-UI-P13-7).
//   - Attach files (in memory, P12 types / 10 MB / 5 files; sent through the reply route since
//     the Server Action body cap is 2 MB, P13-P20), Canned reply (`/` from the page), Then set
//     (Keep status · In progress · Waiting on owner · Resolved; an Open ticket defaults to In
//     progress for a public reply), primary Send reply / Save note (Ctrl/Cmd Enter).
//   - Public replies preview first (D-UI-P13-6): the first Send reply expands "Maria will see"
//     with the message exactly as P12 ThreadMessage renders it, the owner-words status line and
//     who sees it; the second Send reply sends; Edit reply goes back. "Skip preview next time"
//     is a per-browser switch (localStorage). Internal notes never preview.
//   - Known placeholders still in the text are filled on send ({first_name} …). Any other
//     `{word}` is sent as typed, with a non-blocking hint under the box (WR-E09: quoted owner
//     text, snippets and log lines must never block a reply). Empty → MSG-REQUIRED. A failed
//     send keeps the text (ERR-SEND). Pending: Sending… / Saving….
//   - The draft is kept per ticket and mode in sessionStorage.
// The page owns the server calls: `onSend` (Server Action, no files) and `onSendWithFiles`
// (multipart to /staff/api/tickets/<n>/reply). No @cds/db import.
import {
  cannedPlaceholders,
  fillKnownCanned,
  isCannedToken,
  P13_COPY,
  type CannedVars,
} from "@cds/core/staff";
import {
  statusLabel,
  type TenantAttachment,
  type TicketStatus,
} from "@cds/core/support";
import { MessageSquareText, Paperclip, SendHorizontal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { Select, TextArea } from "../../hub/fields";
import { IconButton } from "../../hub/IconButton";
import { SegmentedControl } from "../../hub/SegmentedControl";
import { Switch } from "../../hub/Switch";
import { SUPPORT_UI_COPY } from "../../hub/support/copy";
import {
  INTERNAL_HATCH,
  ThreadMessage,
} from "../../hub/support/thread/ThreadMessage";
import {
  SUPPORT_UPLOAD_ACCEPT,
  SUPPORT_UPLOAD_MAX_FILES,
  checkSupportFile,
} from "../../hub/support/thread/useSupportUploads";
import { CannedPicker, type CannedOption } from "./CannedPicker";
import { staffStatusEnabled } from "./TicketRail";
import { staffStatusLabel } from "./copy";

export type ComposerMode = "public" | "internal";

export const STAFF_COMPOSER_MAX = 5000;
export const STAFF_DRAFT_PREFIX = "staff-draft:";
export const SKIP_PREVIEW_STORAGE_KEY = "cds_staff_skip_preview";

export const STAFF_COMPOSER_COPY = {
  modeLabel: "Reply type",
  modePublic: "Public reply",
  modeInternal: "Internal note",
  replyTo: (first: string) =>
    first ? `Reply to ${first}` : "Reply to the owner",
  internalLabel: "Internal note",
  publicLine: (business: string) =>
    `${business || "The owner"} sees this in the hub and by email.`,
  internalAnnounce: `Internal note. ${P13_COPY.INTERNAL_LINE}`,
  publicAnnounce: "Public reply.",
  attach: "Attach files",
  canned: "Canned reply",
  unknownKept: (token: string) =>
    `${token} isn't a placeholder, so it's sent as typed.`,
  thenSet: "Then set",
  keepStatus: "Keep status",
  send: "Send reply",
  save: "Save note",
  sending: "Sending…",
  saving: "Saving…",
  willSee: (first: string) =>
    first ? `${first} will see` : "The owner will see",
  statusChanges: (ownerWords: string) => `Status changes to ${ownerWords}`,
  edit: "Edit reply",
  skipPreview: "Skip preview next time",
  remove: (name: string) => `Remove ${name}`,
} as const;

const C = STAFF_COMPOSER_COPY;

export type StaffComposerTicket = {
  number: number;
  business: string;
  /** The filer's first name ("" for a CDS-opened ticket). */
  ownerFirstName: string;
  status: TicketStatus;
};

export type StaffComposerSendInput = {
  number: number;
  body: string;
  internal: boolean;
  status?: TicketStatus;
};

export type StaffComposerResult =
  | { ok: true; message: string }
  | { ok: false; code?: string; message?: string };

export interface StaffComposerHandle {
  /** Focus the field, switching mode first when given (`r` / `n`). */
  focus(mode?: ComposerMode): void;
  /** Open the canned picker (`/`). */
  openCanned(): void;
}

export interface StaffComposerProps {
  ticket: StaffComposerTicket;
  canned: readonly CannedOption[];
  /** From staffCannedVarsFor (first_name, business, ticket, agent). */
  vars: CannedVars;
  timeZone: string;
  onSend(input: StaffComposerSendInput): Promise<StaffComposerResult>;
  /** Multipart: body, internal ("1" | "0"), status, file (repeated). */
  onSendWithFiles(form: FormData): Promise<StaffComposerResult>;
  /** Then set choices (Keep status is always first). */
  statusOptions?: readonly TicketStatus[];
  /** Preview before a public send when the staff member has not chosen (default on). */
  previewDefault?: boolean;
  /** After a successful send: the CLI result line (the page toasts and refreshes). */
  onSent?(message: string): void;
  handleRef?: Ref<StaffComposerHandle>;
  manageHref?: string;
}

const DEFAULT_STATUS_OPTIONS: readonly TicketStatus[] = [
  "in_progress",
  "waiting_on_you",
  "resolved",
];

function draftKey(n: number, mode: ComposerMode): string {
  return `${STAFF_DRAFT_PREFIX}${n}:${mode}`;
}

function readDraft(key: string): string {
  try {
    return typeof sessionStorage === "undefined"
      ? ""
      : (sessionStorage.getItem(key) ?? "");
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // The draft is a convenience only.
  }
}

/** Stored choice: true = skip, false = preview, null = not chosen. */
function readSkip(): boolean | null {
  try {
    const v = window.localStorage.getItem(SKIP_PREVIEW_STORAGE_KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

function writeSkip(skip: boolean): void {
  try {
    window.localStorage.setItem(SKIP_PREVIEW_STORAGE_KEY, skip ? "on" : "off");
  } catch {
    // Private mode: the choice lasts until reload.
  }
}

function defaultThen(
  mode: ComposerMode,
  status: TicketStatus,
  options: readonly TicketStatus[],
): TicketStatus | "" {
  return mode === "public" &&
    status === "open" &&
    options.includes("in_progress")
    ? "in_progress"
    : "";
}

function draggingFiles(e: DragEvent<HTMLElement>): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function StaffComposer({
  ticket,
  canned,
  vars,
  timeZone,
  onSend,
  onSendWithFiles,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  previewDefault = true,
  onSent,
  handleRef,
  manageHref,
}: StaffComposerProps) {
  const fieldId = useId();
  const switchId = useId();
  const allowed = statusOptions.filter((s) =>
    staffStatusEnabled(ticket.status, s),
  );
  const [mode, setMode] = useState<ComposerMode>("public");
  const [body, setBody] = useState("");
  const [thenPicked, setThen] = useState<TicketStatus | "">(() =>
    defaultThen("public", ticket.status, allowed),
  );
  // WR-E10: a poll or refresh can move the ticket so the pick is no longer offered. Then the
  // shown and sent value is the default for the new status, never a hidden stale one.
  const then =
    thenPicked === "" || allowed.includes(thenPicked)
      ? thenPicked
      : defaultThen(mode, ticket.status, allowed);
  const [files, setFiles] = useState<File[]>([]);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [skipPreview, setSkipPreview] = useState(!previewDefault);
  const [announce, setAnnounce] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const caretAfter = useRef<number | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const internal = mode === "internal";

  const field = useCallback(
    () => document.getElementById(fieldId) as HTMLTextAreaElement | null,
    [fieldId],
  );

  useEffect(() => {
    const stored = readSkip();
    if (stored !== null) setSkipPreview(stored);
  }, []);

  // Restore the draft for this ticket and mode after mount (browser-only storage).
  useEffect(() => {
    setBody(readDraft(draftKey(ticket.number, mode)));
  }, [ticket.number, mode]);

  useEffect(() => {
    if (focusTick === 0) return;
    const el = field();
    if (!el) return;
    el.focus();
    if (caretAfter.current !== null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  }, [focusTick, field]);

  function changeMode(next: ComposerMode) {
    if (next === mode) return;
    setMode(next);
    setThen(defaultThen(next, ticket.status, allowed));
    setPreviewing(false);
    setFieldError(null);
    setSendError(null);
    setAnnounce(next === "internal" ? C.internalAnnounce : C.publicAnnounce);
  }

  function rememberSelection() {
    const el = field();
    selection.current = el
      ? {
          start: el.selectionStart ?? body.length,
          end: el.selectionEnd ?? body.length,
        }
      : { start: body.length, end: body.length };
  }

  function openCanned() {
    rememberSelection();
    setPickerOpen(true);
  }

  useImperativeHandle(handleRef, () => ({
    focus(m?: ComposerMode) {
      if (m) changeMode(m);
      setFocusTick((t) => t + 1);
    },
    openCanned,
  }));

  function setText(v: string) {
    setBody(v);
    writeDraft(draftKey(ticket.number, mode), v);
    setPreviewing(false);
    if (fieldError) setFieldError(null);
  }

  function insertCanned(text: string) {
    const sel = selection.current ?? { start: body.length, end: body.length };
    const next = body.slice(0, sel.start) + text + body.slice(sel.end);
    setText(next);
    setPickerOpen(false);
    caretAfter.current = sel.start + text.length;
    setFocusTick((t) => t + 1);
  }

  function take(picked: readonly File[]) {
    if (picked.length === 0 || sending) return;
    const out: string[] = [];
    const kept = [...files];
    let tooMany = false;
    for (const f of picked) {
      const refused = checkSupportFile(f);
      if (refused) {
        out.push(refused);
        continue;
      }
      if (kept.length >= SUPPORT_UPLOAD_MAX_FILES) {
        tooMany = true;
        continue;
      }
      kept.push(f);
    }
    if (tooMany) out.push(SUPPORT_UI_COPY.FILE_TOO_MANY);
    setFiles(kept);
    setRefusals(out);
    setPreviewing(false);
    setFieldError(null);
  }

  /** The text as it will be sent (known placeholders filled), or null when empty. */
  function prepared(): string | null {
    setSendError(null);
    if (!body.trim() && files.length === 0) {
      setFieldError(SUPPORT_UI_COPY.MSG_REQUIRED);
      return null;
    }
    setFieldError(null);
    return fillKnownCanned(body, vars);
  }

  async function deliver(text: string) {
    setSending(true);
    let res: StaffComposerResult;
    try {
      if (files.length > 0) {
        const form = new FormData();
        form.set("body", text);
        form.set("internal", internal ? "1" : "0");
        if (then) form.set("status", then);
        for (const f of files) form.append("file", f, f.name);
        res = await onSendWithFiles(form);
      } else {
        res = await onSend({
          number: ticket.number,
          body: text,
          internal,
          ...(then ? { status: then } : {}),
        });
      }
    } catch {
      res = { ok: false };
    }
    setSending(false);
    if (res.ok) {
      setBody("");
      writeDraft(draftKey(ticket.number, mode), "");
      setFiles([]);
      setRefusals([]);
      setPreviewing(false);
      setThen(defaultThen(mode, ticket.status, allowed));
      onSent?.(res.message);
      return;
    }
    setPreviewing(false);
    setSendError(
      res.code === "invalid_input" && res.message
        ? res.message
        : P13_COPY.ERR_SEND,
    );
  }

  function submit() {
    if (sending) return;
    const text = prepared();
    if (text === null) return;
    if (!internal && !skipPreview && !previewing) {
      setPreviewing(true);
      return;
    }
    void deliver(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      if (previewing) {
        e.preventDefault();
        setPreviewing(false);
      } else {
        e.currentTarget.blur();
      }
    }
  }

  const preview = previewing ? fillKnownCanned(body, vars) : null;
  const unknownToken = cannedPlaceholders(body).find((t) => !isCannedToken(t));
  const attachments: TenantAttachment[] = files.map((f, i) => ({
    id: `pending-${i}`,
    name: f.name,
    size: f.size,
    mime: f.type,
    scan: "staff",
  }));

  return (
    <div
      data-staff-composer={ticket.number}
      data-mode={mode}
      data-over={over || undefined}
      onDragOver={(e) => {
        if (!draggingFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) setOver(false);
      }}
      onDrop={(e) => {
        if (!draggingFiles(e)) return;
        e.preventDefault();
        setOver(false);
        take(Array.from(e.dataTransfer?.files ?? []));
      }}
      className="relative flex flex-col gap-3 font-hub text-hub-ink"
    >
      <SegmentedControl
        name="reply-type"
        label={C.modeLabel}
        options={[
          { value: "public", label: C.modePublic },
          { value: "internal", label: C.modeInternal },
        ]}
        value={mode}
        onChange={changeMode}
        disabled={sending}
      />
      <p aria-live="polite" className="sr-only" data-composer-announce="">
        {announce}
      </p>

      <div
        data-composer-box=""
        style={internal ? INTERNAL_HATCH : undefined}
        className={
          "flex flex-col gap-3 rounded-lg p-4 " +
          (internal
            ? "border border-dashed border-hub-warning bg-(image:--hub-internal-hatch) forced-colors:bg-none"
            : "border border-hub-border bg-hub-surface")
        }
      >
        <TextArea
          id={fieldId}
          label={internal ? C.internalLabel : C.replyTo(ticket.ownerFirstName)}
          value={body}
          rows={4}
          maxLength={STAFF_COMPOSER_MAX}
          readOnly={sending}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          counter={
            body.length >= 4500
              ? { value: body.length, max: STAFF_COMPOSER_MAX }
              : undefined
          }
          helper={
            internal ? (
              <span className="font-semibold text-hub-ink">
                {P13_COPY.INTERNAL_LINE}
              </span>
            ) : (
              C.publicLine(ticket.business)
            )
          }
          error={fieldError ?? undefined}
          className="max-h-80 min-h-24 resize-y"
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {unknownToken !== undefined ? (
          <p
            data-placeholder-kept=""
            className="font-hub text-sm text-hub-ink-muted"
          >
            {C.unknownKept(`{${unknownToken}}`)}
          </p>
        ) : null}

        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-2" data-composer-files="">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex max-w-full min-w-0 items-center gap-2 rounded border border-hub-border bg-hub-surface py-1 pr-1 pl-3 text-sm"
              >
                <span className="min-w-0 truncate" title={f.name}>
                  {f.name}
                </span>
                <IconButton
                  size="sm"
                  label={C.remove(f.name)}
                  icon={<X aria-hidden size={16} strokeWidth={2} />}
                  tooltipAlign="end"
                  onClick={() => {
                    setFiles((list) => list.filter((_, j) => j !== i));
                    setPreviewing(false);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {refusals.length > 0 ? (
          <div
            role="alert"
            className="flex flex-col gap-1 text-sm text-hub-danger"
          >
            {refusals.map((r, i) => (
              <p key={i}>{r}</p>
            ))}
          </div>
        ) : null}

        {preview !== null ? (
          <section
            data-composer-preview=""
            aria-label={C.willSee(ticket.ownerFirstName)}
            className="flex flex-col gap-2 rounded border border-hub-border bg-hub-surface-2 p-3"
          >
            <p className="text-sm font-semibold text-hub-ink">
              {C.willSee(ticket.ownerFirstName)}
            </p>
            <ThreadMessage
              message={{
                id: "preview",
                authorKind: "staff",
                authorName: vars.agent,
                body: preview,
                attachments,
                created: new Date().toISOString(),
              }}
              timeZone={timeZone}
              onDownload={() => undefined}
            />
            {then ? (
              <p className="text-sm text-hub-ink">
                {C.statusChanges(statusLabel(then))}
              </p>
            ) : null}
            <p className="text-sm text-hub-ink-muted">
              {C.publicLine(ticket.business)}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPreviewing(false);
                  setFocusTick((t) => t + 1);
                }}
              >
                {C.edit}
              </Button>
              <Switch
                id={switchId}
                label={C.skipPreview}
                checked={skipPreview}
                onChange={(v) => {
                  setSkipPreview(v);
                  writeSkip(v);
                }}
              />
            </div>
          </section>
        ) : null}

        {sendError ? <InlineAlert tone="error">{sendError}</InlineAlert> : null}

        <div className="flex flex-wrap items-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Paperclip aria-hidden size={16} strokeWidth={2} />}
            onClick={() => fileRef.current?.click()}
            disabled={sending}
          >
            {C.attach}
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
          <Button
            variant="secondary"
            size="sm"
            icon={<MessageSquareText aria-hidden size={16} strokeWidth={2} />}
            aria-keyshortcuts="/"
            onClick={openCanned}
            disabled={sending}
          >
            {C.canned}
          </Button>
          {allowed.length > 0 ? (
            <div className="w-48">
              <Select
                id={`${fieldId}-then`}
                label={C.thenSet}
                value={then}
                disabled={sending}
                options={[
                  { value: "", label: C.keepStatus },
                  ...allowed.map((s) => ({
                    value: s,
                    label: staffStatusLabel(s),
                  })),
                ]}
                onChange={(e) => {
                  setThen(e.currentTarget.value as TicketStatus | "");
                  setPreviewing(false);
                }}
              />
            </div>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="primary"
            icon={<SendHorizontal aria-hidden size={16} strokeWidth={2} />}
            loading={sending}
            loadingLabel={internal ? C.saving : C.sending}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onClick={submit}
          >
            {internal ? C.save : C.send}
          </Button>
        </div>
      </div>

      <CannedPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setFocusTick((t) => t + 1);
        }}
        canned={canned}
        vars={vars}
        timeZone={timeZone}
        onInsert={insertCanned}
        manageHref={manageHref}
      />

      {over ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded border-2 border-dashed border-hub-border-strong bg-hub-surface/90 text-base text-hub-ink"
        >
          {SUPPORT_UI_COPY.ATTACH_HINT}
        </div>
      ) : null}
    </div>
  );
}
