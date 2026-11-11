"use client";
// Step-up dialog (13-09; STAFF-06; 13-UI-SPEC "StepUpDialog", "Accessibility contract";
// CONTEXT Area 1). Shown when a super_admin action's server check answers step_up_needed
// (sign-in or last step-up older than 15 minutes). A 480px native modal <dialog> that traps
// focus and is NOT dismissed by an outside click; Esc means "Stop this action". Title
// "Confirm it's you" + KeyRound, the masked staff email, the pending action named in a Label
// line ("Then: Approve launch for Rivera Bakery"), the hub CodeInput (sixth digit submits; the
// primary button stays the visible path), primary Confirm and continue, secondary Stop this
// action, ghost Send a new code with a 30s cooldown. Errors render inside the dialog in an
// InlineAlert that takes focus. Presentational: StaffActionProvider owns the requests.
import { KeyRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "../../hub/Button";
import {
  CodeInput,
  CODE_LENGTH,
  RESEND_COOLDOWN_SEC,
} from "../../hub/CodeInput";
import { InlineAlert } from "../../hub/feedback";
import { STAFF_DIALOG_COPY } from "./copy";

export interface StepUpDialogProps {
  open: boolean;
  /** m•••@connectionsdesignstudios.com; null while the code is being requested. */
  maskedEmail: string | null;
  /** The pending action ("Approve launch for Rivera Bakery"); omitted → no Then line. */
  thenLabel?: string;
  pending: boolean;
  /** Fixed copy (CODE-WRONG …) or null. */
  error: string | null;
  /** Changes on every failed attempt so a repeated error takes focus again. */
  errorKey?: unknown;
  onSubmit: (code: string) => void;
  /** Resolve false when the resend failed, so "Code sent" is not announced. */
  onResend: () => void | Promise<boolean | void>;
  onStop: () => void;
  resendCooldownSec?: number;
}

/** A modal <dialog> that ignores backdrop clicks; Esc goes to onCancel. */
function useStrictModal(open: boolean, onCancel: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      cancelRef.current();
    };
    dialog.addEventListener("cancel", onCancelEvent);
    return () => dialog.removeEventListener("cancel", onCancelEvent);
  }, []);
  return ref;
}

export function StepUpDialog(props: StepUpDialogProps) {
  const ref = useStrictModal(props.open, props.onStop);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      data-step-up=""
      aria-labelledby={titleId}
      className={
        "m-auto w-[calc(100%-32px)] max-w-[480px] rounded bg-hub-surface p-0 font-hub " +
        "text-hub-ink shadow-xl backdrop:bg-hub-ink/40 max-sm:h-full max-sm:max-h-none " +
        "max-sm:w-full max-sm:rounded-none"
      }
    >
      {props.open ? <StepUpBody {...props} titleId={titleId} /> : null}
    </dialog>
  );
}

function StepUpBody({
  maskedEmail,
  thenLabel,
  pending,
  error,
  errorKey,
  onSubmit,
  onResend,
  onStop,
  resendCooldownSec = RESEND_COOLDOWN_SEC,
  titleId,
}: StepUpDialogProps & { titleId: string }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [until, setUntil] = useState(
    () => Date.now() + resendCooldownSec * 1000,
  );
  const [now, setNow] = useState(() => Date.now());
  const errorRef = useRef<HTMLDivElement>(null);
  const base = useId();
  const inputId = `${base}-code`;
  const errorId = `${base}-error`;
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const waiting = maskedEmail === null;
  // WR-E02: the first code request failed. Nothing was sent, so Send a new code is the way on
  // (no cooldown to sit out) and the body stops saying "Sending…".
  const noCode = waiting && error !== null;

  useEffect(() => {
    if (noCode) {
      const t = Date.now();
      setUntil(t);
      setNow(t);
    }
  }, [noCode, errorKey]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, errorKey]);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  function submit(value: string) {
    if (pending || waiting || value.length !== CODE_LENGTH) return;
    setStatus("");
    onSubmit(value);
  }

  function onForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit(code);
  }

  function resend() {
    if (remaining > 0 || pending) return;
    const start = Date.now();
    setUntil(start + resendCooldownSec * 1000);
    setNow(start);
    setStatus("");
    setCode("");
    void Promise.resolve(onResend()).then((ok) => {
      if (ok !== false) setStatus(STAFF_DIALOG_COPY.stepUpSent);
    });
  }

  return (
    <form onSubmit={onForm} noValidate className="flex flex-col gap-4 p-6">
      <h2
        id={titleId}
        className="flex items-center gap-2 text-xl leading-tight font-semibold"
      >
        <KeyRound aria-hidden="true" size={16} strokeWidth={2} />
        {STAFF_DIALOG_COPY.stepUpTitle}
      </h2>
      <p className="text-base">
        {noCode
          ? STAFF_DIALOG_COPY.stepUpNoCode
          : waiting
            ? STAFF_DIALOG_COPY.stepUpSending
            : STAFF_DIALOG_COPY.stepUpBody(maskedEmail)}
      </p>
      {thenLabel ? (
        <p className="text-sm font-semibold text-hub-ink-muted">
          {STAFF_DIALOG_COPY.stepUpThen(thenLabel)}
        </p>
      ) : null}
      <CodeInput
        id={inputId}
        name="code"
        value={code}
        onChange={setCode}
        onComplete={submit}
        disabled={pending || waiting}
        errorId={error ? errorId : undefined}
      />
      {error ? (
        <div id={errorId} ref={errorRef} tabIndex={-1}>
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onStop} className="max-sm:w-full">
          {STAFF_DIALOG_COPY.stepUpStop}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          loadingLabel={STAFF_DIALOG_COPY.stepUpConfirming}
          disabled={waiting || code.length !== CODE_LENGTH}
          className="max-sm:w-full"
        >
          {STAFF_DIALOG_COPY.stepUpConfirm}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <Button
          variant="ghost"
          size="sm"
          disabled={remaining > 0 || pending || (waiting && !noCode)}
          onClick={resend}
        >
          {STAFF_DIALOG_COPY.stepUpResend}
        </Button>
        {remaining > 0 ? (
          <span className="text-sm text-hub-ink-muted">
            {STAFF_DIALOG_COPY.stepUpCooldown(remaining)}
          </span>
        ) : null}
      </div>
      <p role="status" className="text-sm text-hub-ink-muted">
        {status}
      </p>
    </form>
  );
}
