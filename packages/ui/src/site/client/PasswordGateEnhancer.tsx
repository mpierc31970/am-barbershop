"use client";
// PasswordGateEnhancer: the password gate's form island (CONT-28, D235 #12; 07-UI-SPEC lines
// 531-533; 07-32 choice 14).
//
// SSR'd by PasswordGate, so the form works without JS (POST + 303, status in the URL). The
// password is never echoed back after a no-JS submit. Once it runs it adds the Show/Hide
// toggle (absent from the server markup), submits with Accept: application/json, keeps and
// selects the typed value on a wrong answer, announces errors in an aria-live region, and on a
// rate limit disables **View page** and counts down once a minute, re-enabling it at zero. A
// right answer navigates to the same-site path the server returned. Copy only from GATE_COPY.
import { GATE_COPY } from "@cds/core/content";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { siteButtonClasses } from "../SiteButton";

export type GateUiStatus =
  | { kind: "idle" }
  | { kind: "wrong" }
  | { kind: "rate"; waitMinutes: number }
  /** Network or server failure: never reported as a wrong password (WR-D06). */
  | { kind: "error" };

export interface PasswordGateEnhancerProps {
  /** POST target: /api/gate/<pageId>. */
  action: string;
  /** Server-parsed no-JS status, so SSR and the first client render match. */
  initial: GateUiStatus;
  /** Element id prefix (one gate per page). */
  idPrefix?: string;
}

/** Only "/"-relative, non-protocol-relative paths may be navigated to. */
function isSamePath(href: unknown): href is string {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.startsWith("/\\") &&
    !/[\r\n]/.test(href)
  );
}

const CONTROL =
  "w-full min-h-12 rounded-site-button border bg-site-surface px-4 py-3 " +
  "text-[length:var(--site-text-body)] text-site-text";
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

export function PasswordGateEnhancer({
  action,
  initial,
  idPrefix = "gate",
}: PasswordGateEnhancerProps) {
  const [status, setStatus] = useState<GateUiStatus>(initial);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `${idPrefix}-password`;
  const errorId = `${idPrefix}-error`;

  useEffect(() => setMounted(true), []);

  // Count the rate-limit wait down once a minute; re-enable at zero.
  const waiting = status.kind === "rate" ? status.waitMinutes : 0;
  useEffect(() => {
    if (waiting <= 0) return;
    const t = setTimeout(() => {
      setStatus(
        waiting - 1 <= 0
          ? { kind: "idle" }
          : { kind: "rate", waitMinutes: waiting - 1 },
      );
    }, 60_000);
    return () => clearTimeout(t);
  }, [waiting]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || status.kind === "rate") return;
    const value = inputRef.current?.value ?? "";
    setBusy(true);
    try {
      const res = await fetch(action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ password: value }).toString(),
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as {
        location?: unknown;
        retryAfterS?: unknown;
      };
      if (res.ok && isSamePath(body.location)) {
        window.location.assign(body.location);
        return;
      }
      if (res.status === 429) {
        const s = Number(body.retryAfterS);
        const minutes = Number.isFinite(s)
          ? Math.min(15, Math.max(1, Math.ceil(s / 60)))
          : 15;
        setStatus({ kind: "rate", waitMinutes: minutes });
      } else if (res.status === 401 || res.status === 403) {
        // Only the gate route's explicit refusal means the password is wrong.
        setStatus({ kind: "wrong" });
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      } else {
        // 5xx, 404, or a 2xx without a safe location.
        setStatus({ kind: "error" });
      }
    } catch {
      // Offline, blocked, or an unreadable response.
      setStatus({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  const wrong = status.kind === "wrong";
  const rate = status.kind === "rate";
  const failed = status.kind === "error";
  return (
    <form
      method="post"
      action={action}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
      data-cds-gate-form=""
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="font-semibold text-site-text">
          {GATE_COPY.label}
        </label>
        <div className="flex items-stretch gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name="password"
            type={shown ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={128}
            aria-invalid={wrong ? true : undefined}
            aria-describedby={wrong || rate || failed ? errorId : undefined}
            className={`${CONTROL} ${wrong ? "border-2 border-site-text" : "border-site-text-muted"} ${FOCUS}`}
          />
          {mounted ? (
            <button
              type="button"
              data-gate-toggle=""
              aria-controls={inputId}
              aria-pressed={shown}
              onClick={() => setShown((v) => !v)}
              className={`min-h-12 min-w-11 shrink-0 rounded-site-button px-3 font-semibold text-site-primary underline-offset-4 hover:underline ${FOCUS}`}
            >
              {shown ? GATE_COPY.hide : GATE_COPY.show}
            </button>
          ) : null}
        </div>
        <div id={errorId} aria-live="polite" className="text-site-text">
          {wrong ? (
            <p className="flex items-start gap-2" data-gate-error="wrong">
              <CircleAlert
                aria-hidden
                size={20}
                strokeWidth={2}
                className="mt-0.5 shrink-0"
              />
              <span>{GATE_COPY.wrong}</span>
            </p>
          ) : null}
          {failed ? (
            <p className="flex items-start gap-2" data-gate-error="error">
              <CircleAlert
                aria-hidden
                size={20}
                strokeWidth={2}
                className="mt-0.5 shrink-0"
              />
              <span>{GATE_COPY.error}</span>
            </p>
          ) : null}
          {rate ? (
            <p className="flex flex-col gap-1" data-gate-error="rate">
              <span className="flex items-start gap-2">
                <CircleAlert
                  aria-hidden
                  size={20}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0"
                />
                <span>{GATE_COPY.rate}</span>
              </span>
              <span className="text-site-text-muted">
                {GATE_COPY.tryAgainIn(status.waitMinutes)}
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <button
        type="submit"
        disabled={rate || busy}
        className={`${siteButtonClasses("primary")} w-full disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {GATE_COPY.submit}
      </button>
    </form>
  );
}
