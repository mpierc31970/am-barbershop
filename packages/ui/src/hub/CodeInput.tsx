"use client";
// CodeInput + CodeStep: the emailed 6-digit code (06-UI-SPEC "Submit › Step B", "Sign in
// with a code", Typography code-input exception, Accessibility CodeInput bullet; D213,
// D-UI-P6-3, D-UI-P6-12; T-06-82, T-06-83). Donor contract from tarotafterdark: ONE text
// field (never six boxes, which break paste, iOS autofill and webviews), inputmode numeric,
// "one-time" code autocomplete, digits only (a pasted "123 456" becomes "123456"), 56px tall
// with 0.25em tracking. The sixth digit auto-submits, but a visible primary button is always
// there: auto-submit is an accelerator, never the only path.
//
// CodeStep is the whole "Check your email" step. Its body is one string with one
// substitution and no branching on whether the address exists (T-01-17a): the screen reads
// the same for a new and an existing address. Resend has a cooldown (30s by default) shown
// as "Resend code (0:24)", and a status line announces "Code sent" after a resend. An error
// renders in an InlineAlert above the button, is tied to the field by aria-describedby and
// takes focus.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./Button";
import { InlineAlert } from "./feedback";

export const CODE_LENGTH = 6;
export const CODE_SENT_COPY = "Code sent";
export const RESEND_COOLDOWN_SEC = 30;
export const CODE_STEP_TITLE = "Check your email";

/** UI-SPEC "Code step body": identical for new and existing addresses. */
export function codeStepBody(email: string): string {
  return `We sent a 6-digit code to ${email}. It expires in 5 minutes.`;
}

/** Digits only, at most six. */
export function sanitiseCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export interface CodeInputProps {
  id: string;
  name: string;
  value: string;
  onChange(v: string): void;
  /** Called once the field holds six digits. */
  onComplete?(v: string): void;
  disabled?: boolean;
  /** Id of the error message; sets aria-describedby and aria-invalid. */
  errorId?: string;
}

export function CodeInput({
  id,
  name,
  value,
  onChange,
  onComplete,
  disabled,
  errorId,
}: CodeInputProps) {
  return (
    <div className="flex flex-col gap-2 font-hub">
      <label htmlFor={id} className="text-sm font-semibold text-hub-ink">
        6-digit code
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-describedby={errorId || undefined}
        aria-invalid={errorId ? true : undefined}
        onChange={(e) => {
          // maxLength does not cap a paste of "123 456" (7 characters) before we clean it,
          // so the value is sanitised here rather than trusted.
          const next = sanitiseCode(e.target.value);
          onChange(next);
          if (next.length === CODE_LENGTH && next !== value) onComplete?.(next);
        }}
        className={
          "h-14 w-full rounded border bg-hub-surface px-4 font-hub text-xl font-semibold " +
          "tracking-[0.25em] text-hub-ink tabular-nums transition-colors duration-150 " +
          "disabled:cursor-not-allowed disabled:bg-hub-surface-2 disabled:text-hub-ink-muted " +
          (errorId
            ? "border-hub-danger"
            : "border-hub-border-strong hover:border-hub-ink-muted")
        }
      />
    </div>
  );
}

export interface CodeStepProps {
  email: string;
  /** "Create my account" (Submit) or "Sign in" (/sign-in). */
  primaryLabel: string;
  /** "Creating your account…" / "Signing in…". */
  pendingLabel: string;
  onSubmit(code: string): void;
  /** Resolve false when the resend failed, so "Code sent" is not announced. */
  onResend(): void | Promise<boolean | void>;
  onBack(): void;
  error: string | null;
  /** Changes on every attempt, so a repeated error message takes focus again. */
  errorKey?: unknown;
  pending: boolean;
  resendCooldownSec?: number;
  /** The step heading's level: h1 on its own screen, h2 inside a titled card. */
  headingLevel?: 1 | 2;
  /** Prefix for element ids (one CodeStep per page). */
  idPrefix?: string;
}

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const TEXT_BUTTON =
  "inline-flex min-h-11 items-center rounded px-1 font-hub text-sm text-hub-ink-muted " +
  "underline-offset-4 hover:text-hub-ink hover:underline " +
  "disabled:cursor-not-allowed disabled:no-underline disabled:opacity-70";

export function CodeStep({
  email,
  primaryLabel,
  pendingLabel,
  onSubmit,
  onResend,
  onBack,
  error,
  errorKey,
  pending,
  resendCooldownSec = RESEND_COOLDOWN_SEC,
  headingLevel = 1,
  idPrefix = "code-step",
}: CodeStepProps) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [until, setUntil] = useState(
    () => Date.now() + resendCooldownSec * 1000,
  );
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const inputId = `${idPrefix}-code`;
  const errorId = `${idPrefix}-error`;
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));

  // The step replaces the one before it in place: move focus to its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // A new error (a fresh string or a repeat after a new attempt) takes focus.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, errorKey]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  function submitCode(value: string): void {
    if (pending) return;
    setStatus("");
    onSubmit(value);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    submitCode(code);
  }

  function handleResend(): void {
    if (remaining > 0 || pending) return;
    const start = Date.now();
    setUntil(start + resendCooldownSec * 1000);
    setNow(start);
    setStatus("");
    const result = onResend();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      void (result as Promise<boolean | void>).then((ok) => {
        if (ok !== false) setStatus(CODE_SENT_COPY);
      });
    } else {
      setStatus(CODE_SENT_COPY);
    }
  }

  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <Heading
        ref={headingRef}
        tabIndex={-1}
        className={
          headingLevel === 1
            ? "text-[1.75rem] leading-tight font-semibold outline-none md:text-[2rem]"
            : "text-xl leading-tight font-semibold outline-none"
        }
      >
        {CODE_STEP_TITLE}
      </Heading>
      <p className="text-base">{codeStepBody(email)}</p>
      <CodeInput
        id={inputId}
        name="code"
        value={code}
        onChange={setCode}
        onComplete={submitCode}
        disabled={pending}
        errorId={error ? errorId : undefined}
      />
      {error ? (
        <div id={errorId} ref={errorRef} tabIndex={-1}>
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={pending}
        loadingLabel={pendingLabel}
      >
        {primaryLabel}
      </Button>
      <div className="flex flex-wrap items-center gap-x-6">
        <button
          type="button"
          className={TEXT_BUTTON}
          disabled={remaining > 0 || pending}
          onClick={handleResend}
        >
          {remaining > 0 ? `Resend code (${mmss(remaining)})` : "Resend code"}
        </button>
        <button
          type="button"
          className={TEXT_BUTTON}
          disabled={pending}
          onClick={onBack}
        >
          Use a different email
        </button>
      </div>
      <p role="status" className="text-sm text-hub-ink-muted">
        {status}
      </p>
    </form>
  );
}
