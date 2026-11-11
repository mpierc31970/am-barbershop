"use client";
// Composer (12-09 choices 3, 4; COMM-01, COMM-08, D119; 12-UI-SPEC lines 335-351, a11y
// 832-838, responsive 859-867). Messages and ticket detail write through this:
//   - A labelled TextArea ("Write to CDS" / "Your reply"), 5,000 characters, the counter
//     ("4,620 of 5,000") from 4,500 in aria-describedby; Ctrl/Cmd+Enter sends
//     (aria-keyshortcuts), Enter is a new line.
//   - Attach files (the keyboard path), paste a screenshot (renamed "Screenshot 12 Oct,
//     2:14 pm.png"; text paste untouched), and drop files anywhere on the composer.
//   - Pending files as chips with progress (role="progressbar"), Remove, Try again; limits
//     inline under the chips (role="alert", focus moved there).
//   - Send: MSG-REQUIRED when there is nothing to send; "Sending…" and a read-only field
//     while busy; success clears the composer (no toast); a refusal keeps the text
//     (ERR-SEND, or RATE-MESSAGES on `code: "rate_limited"`).
//   - The draft lives in sessionStorage under `support-draft:<threadKey>` until sent.
//   - `readOnlyReason` (IMPERSONATING-SUPPORT) or `disabled` (VIEWER-READONLY) replaces it.
// The page owns the server call through `onSend(body, uploadTokens)`; no @cds/db import.
import { Paperclip, SendHorizontal, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "../../Button";
import { InlineAlert } from "../../feedback";
import { TextArea } from "../../fields";
import { IconButton } from "../../IconButton";
import { SUPPORT_UI_COPY } from "../copy";
import { screenshotName, THREAD_COPY } from "./copy";
import {
  SUPPORT_UPLOAD_ACCEPT,
  useSupportUploads,
  type SupportUploadItem,
} from "./useSupportUploads";

export const COMPOSER_MAX = 5000;
export const COMPOSER_COUNTER_FROM = 4500;
export const DRAFT_PREFIX = "support-draft:";

export type ComposerSendResult =
  { ok: true } | { ok: false; code?: string; error?: string };

export interface ComposerProps {
  /** Draft key: the thread id, or e.g. "new-ticket". */
  threadKey: string;
  /** Visible label: "Write to CDS" (Messages) or "Your reply" (ticket detail). */
  label: string;
  /** Primary "Send reply" (tickets) vs secondary "Send message" (Messages, D-UI-P12-6). */
  primary?: boolean;
  /**
   * Keep the "Send reply" label but render it secondary: the paid-service panel holds the
   * view's primary while the Owner still has a choice to make (D-UI-P12-12, 12-26).
   */
  sendSecondary?: boolean;
  /** Business time zone, for pasted screenshot names. */
  timeZone: string;
  /** Injectable clock. */
  now?: () => Date;
  onSend(body: string, uploadTokens: string[]): Promise<ComposerSendResult>;
  /** Viewer: render VIEWER-READONLY instead of the composer. */
  disabled?: boolean;
  /** A specific reason instead (IMPERSONATING-SUPPORT). */
  readOnlyReason?: string | null;
  uploadUrl?: string;
  /** Shown under the composer (e.g. the SLA line on Messages). */
  footer?: ReactNode;
}

function readDraft(key: string): string {
  try {
    return typeof sessionStorage === "undefined"
      ? ""
      : (sessionStorage.getItem(DRAFT_PREFIX + key) ?? "");
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (value) sessionStorage.setItem(DRAFT_PREFIX + key, value);
    else sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage full or blocked: the draft is a convenience only.
  }
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  const items = Array.from(data.items ?? []);
  for (const it of items) {
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

/** The drag carries files (not selected text). */
function draggingFiles(e: DragEvent<HTMLElement>): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function UploadChip({
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
      className={
        "flex max-w-full min-w-0 flex-wrap items-center gap-2 rounded border " +
        "border-hub-border bg-hub-surface py-1 pr-1 pl-3 font-hub text-sm text-hub-ink"
      }
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
          className="flex items-center gap-2 text-hub-ink-muted tabular-nums"
        >
          <span
            aria-hidden
            className="relative h-1 w-16 overflow-hidden rounded bg-hub-surface-2"
          >
            <span
              className="absolute inset-y-0 left-0 bg-hub-accent motion-safe:transition-[width] motion-safe:ease-linear"
              style={{ width: `${item.pct}%` }}
            />
          </span>
          {THREAD_COPY.uploading(item.pct)}
        </span>
      ) : null}
      {item.status === "error" ? (
        <>
          {/* UI-SPEC a11y: chip errors are role="alert" (12-REVIEW WR-D05). */}
          <span role="alert" className="text-hub-danger">
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

export function Composer({
  threadKey,
  label,
  primary = false,
  sendSecondary = false,
  timeZone,
  now = () => new Date(),
  onSend,
  disabled = false,
  readOnlyReason,
  uploadUrl,
  footer,
}: ComposerProps) {
  const fieldId = useId();
  const [body, setBody] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [sendError, setSendError] = useState<{
    tone: "error" | "warning";
    text: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const uploads = useSupportUploads({ url: uploadUrl });

  // Restore the draft after mount (sessionStorage is browser-only; no hydration mismatch).
  useEffect(() => {
    const draft = readDraft(threadKey);
    setBody(draft);
  }, [threadKey]);

  useEffect(() => {
    if (refusals.length > 0) refusalRef.current?.focus();
  }, [refusals]);

  const reason =
    readOnlyReason ?? (disabled ? SUPPORT_UI_COPY.VIEWER_READONLY : null);
  if (reason) {
    return (
      <div data-composer="" data-readonly="">
        <InlineAlert tone="info">{reason}</InlineAlert>
      </div>
    );
  }

  function take(files: readonly File[]) {
    // While sending, Attach is disabled; paste and drop are refused too, or the files would
    // be discarded by the clear on success (WR-D04).
    if (files.length === 0 || sending) return;
    setRefusals(uploads.add(files));
    setFieldError(null);
  }

  async function send() {
    if (sending) return;
    setSendError(null);
    if (uploads.busy) {
      setFieldError(THREAD_COPY.waitForUploads);
      return;
    }
    // A failed file is never dropped from the message without the person knowing (WR-D04).
    if (uploads.items.some((t) => t.status === "error")) {
      setFieldError(THREAD_COPY.failedUploads);
      return;
    }
    const tokens = uploads.tokens;
    if (!body.trim() && tokens.length === 0) {
      setFieldError(SUPPORT_UI_COPY.MSG_REQUIRED);
      return;
    }
    setFieldError(null);
    setSending(true);
    let res: ComposerSendResult;
    try {
      res = await onSend(body, tokens);
    } catch {
      res = { ok: false };
    }
    setSending(false);
    if (res.ok) {
      setBody("");
      writeDraft(threadKey, "");
      uploads.clear();
      setRefusals([]);
      return;
    }
    setSendError(
      res.code === "rate_limited"
        ? { tone: "warning", text: SUPPORT_UI_COPY.RATE_MESSAGES }
        : { tone: "error", text: res.error || SUPPORT_UI_COPY.ERR_SEND },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (sending) return;
    const data = e.clipboardData;
    const images = clipboardImages(data);
    if (images.length === 0) return;
    const hasText = Boolean(data?.getData?.("text/plain"));
    if (!hasText) e.preventDefault();
    const at = now();
    take(
      images.map((f, i) => {
        const ext = IMAGE_EXT[f.type] ?? "png";
        const name = screenshotName(at, timeZone, ext);
        // Several images in one paste share the minute: " (2)", " (3)" keep the chips,
        // Remove buttons and progress names apart (12-REVIEW IN-D03).
        const unique =
          i === 0
            ? name
            : `${name.slice(0, -(ext.length + 1))} (${i + 1}).${ext}`;
        return new File([f], unique, { type: f.type });
      }),
    );
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    // A text drag drops into the textarea as usual (12-REVIEW IN-D04).
    if (!draggingFiles(e)) return;
    e.preventDefault();
    setOver(false);
    take(Array.from(e.dataTransfer?.files ?? []));
  }

  const counter =
    body.length >= COMPOSER_COUNTER_FROM
      ? THREAD_COPY.counter(body.length, COMPOSER_MAX)
      : undefined;
  const sendLabel = primary
    ? SUPPORT_UI_COPY.BUTTONS.sendReply
    : SUPPORT_UI_COPY.BUTTONS.sendMessage;

  return (
    <div
      data-composer=""
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
      onDrop={onDrop}
      className={
        "relative flex flex-col gap-4 font-hub max-sm:focus-within:bg-hub-surface " +
        "max-sm:focus-within:sticky max-sm:focus-within:bottom-0 " +
        "max-sm:focus-within:z-10 max-sm:focus-within:border-t " +
        "max-sm:focus-within:border-hub-border max-sm:focus-within:p-4"
      }
    >
      <TextArea
        id={fieldId}
        label={label}
        value={body}
        rows={3}
        maxLength={COMPOSER_MAX}
        readOnly={sending}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        helper={counter}
        error={fieldError ?? undefined}
        className="min-h-24 max-h-64 resize-none overflow-y-auto field-sizing-content"
        onChange={(e) => {
          const v = e.currentTarget.value;
          setBody(v);
          writeDraft(threadKey, v);
          if (fieldError) setFieldError(null);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />

      {uploads.items.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {uploads.items.map((item) => (
            <UploadChip
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

      {sendError ? (
        <InlineAlert tone={sendError.tone}>{sendError.text}</InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
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
        <span className="hidden text-sm text-hub-ink-muted sm:inline">
          {SUPPORT_UI_COPY.ATTACH_HINT}
        </span>
        <span className="flex-1" />
        <Button
          variant={primary && !sendSecondary ? "primary" : "secondary"}
          icon={<SendHorizontal aria-hidden size={16} strokeWidth={2} />}
          loading={sending}
          loadingLabel={SUPPORT_UI_COPY.BUTTONS.sending}
          onClick={() => void send()}
        >
          {sendLabel}
        </Button>
      </div>

      {footer ? (
        <div className="text-sm text-hub-ink-muted">{footer}</div>
      ) : null}

      {over ? (
        <div
          aria-hidden
          className={
            "pointer-events-none absolute inset-0 flex items-center justify-center rounded " +
            "border-2 border-dashed border-hub-border-strong bg-hub-surface/90 text-base text-hub-ink"
          }
        >
          {THREAD_COPY.dropOverlay}
        </div>
      ) : null}
    </div>
  );
}
