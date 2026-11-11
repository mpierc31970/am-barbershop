"use client";
// Staff sign-in form (13-25 choice 2; STAFF-06, P13-P2, Invariant 10; 13-UI-SPEC "/staff/sign-in"
// lines 244-259). Step 1: Email + Password (show/hide) -> staffSignInAction emails a code.
// Step 2: the P11 CodeStep -> staffConfirmCodeAction (success redirects to a safe `next`, else
// /staff). "Send a new code" re-runs the password check (13-21 choice 4), so the form keeps the
// password in memory until the code step ends. Errors: one InlineAlert above the fields, focus
// moved (STAFF-SIGNIN-FAILED never says which field was wrong).
//
// RESEARCH Pitfall 2: the staff cookie is SameSite=Strict, so a staff email link (a cross-site
// top-level navigation) arrives without it and lands here. On mount, when document.referrer is
// cross-site and the URL has no `r=1`, the page re-navigates same-origin once with `r=1`; that
// second request carries the cookie and the server sends a signed-in person on to `next`.
import { P13_COPY } from "@cds/core/staff";
import { Button, CodeStep, InlineAlert, TextField } from "@cds/ui/hub";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  staffConfirmCodeAction,
  staffResendCodeAction,
  staffSignInAction,
} from "../../../actions/staff/session";

/** The once-only guard parameter. */
export const RENAV_PARAM = "r";

/**
 * The same-origin URL to re-navigate to, or null. Only when the referrer is a different
 * origin and the URL does not already carry `r=1` (so it happens at most once).
 */
export function crossSiteRenavHref(
  referrer: string,
  href: string,
): string | null {
  if (!referrer) return null;
  let here: URL;
  let from: URL;
  try {
    here = new URL(href);
    from = new URL(referrer);
  } catch {
    return null;
  }
  if (from.origin === here.origin) return null;
  if (here.searchParams.get(RENAV_PARAM) === "1") return null;
  here.searchParams.set(RENAV_PARAM, "1");
  return here.toString();
}

type CodeState = {
  mfaId: string;
  otpId: string;
  maskedEmail: string;
  next: string | null;
};

export interface StaffSignInFormProps {
  /** A validated `/staff/**` path (safeStaffNext) to return to. */
  next?: string;
  /** `?ended=1`: the session ended (idle / absolute / revoked). */
  ended?: boolean;
  /** Prefilled email (A&M fork: /sign-in hands a website-admin account over here). */
  email?: string;
}

/** Next's redirect / notFound travel as thrown errors with a NEXT_ digest. */
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

function logRequestFailure(what: string, err: unknown): void {
  console.error(
    `[staff sign-in] ${what} failed`,
    err instanceof Error ? err.name : typeof err,
  );
}

export function StaffSignInForm({
  next,
  ended = false,
  email: initialEmail = "",
}: StaffSignInFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState<CodeState | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // Pitfall 2: re-navigate same-origin once so the Strict cookie is sent.
  useEffect(() => {
    const to = crossSiteRenavHref(document.referrer, window.location.href);
    if (to) window.location.replace(to);
  }, []);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error, attempt]);

  async function handleSignIn(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await staffSignInAction(email, password, next);
      if (res.ok) {
        setCode(res.data);
        setCodeError(null);
      } else {
        setError(res.message || P13_COPY.STAFF_SIGNIN_FAILED);
        setAttempt((n) => n + 1);
      }
    } catch (err) {
      console.error(
        "[staff sign-in] request failed",
        err instanceof Error ? err.name : typeof err,
      );
      setError(P13_COPY.STAFF_SIGNIN_FAILED);
      setAttempt((n) => n + 1);
    } finally {
      setPending(false);
    }
  }

  async function handleCode(value: string): Promise<void> {
    if (!code) return;
    setConfirming(true);
    setCodeError(null);
    try {
      // Success redirects (the action never returns ok).
      const res = await staffConfirmCodeAction({
        mfaId: code.mfaId,
        otpId: code.otpId,
        code: value,
        next: code.next ?? next,
      });
      if (res && !res.ok) setCodeError(res.message || P13_COPY.CODE_WRONG);
    } catch (err) {
      // WR-D06: a failed confirm (network, a thrown action) says so on the code step.
      if (isNextControlFlow(err)) throw err;
      logRequestFailure("confirm", err);
      setCodeError(P13_COPY.ERR_SEND);
    } finally {
      setConfirming(false);
    }
  }

  async function handleResend(): Promise<boolean> {
    let res: Awaited<ReturnType<typeof staffResendCodeAction>>;
    try {
      res = await staffResendCodeAction(email, password, next);
    } catch (err) {
      if (isNextControlFlow(err)) throw err;
      logRequestFailure("resend", err);
      setCodeError(P13_COPY.ERR_SEND);
      return false;
    }
    if (res.ok) {
      setCode(res.data);
      setCodeError(null);
      return true;
    }
    setCodeError(res.message || P13_COPY.CODE_WRONG);
    return false;
  }

  function handleBack(): void {
    setCode(null);
    setCodeError(null);
    setPassword("");
    setError(null);
  }

  if (code) {
    return (
      <CodeStep
        email={code.maskedEmail}
        primaryLabel="Confirm code"
        pendingLabel="Confirming…"
        onSubmit={(v) => void handleCode(v)}
        onResend={handleResend}
        onBack={handleBack}
        error={codeError}
        errorKey={codeError}
        pending={confirming}
        headingLevel={2}
        idPrefix="staff-sign-in-code"
      />
    );
  }

  return (
    <form onSubmit={handleSignIn} noValidate className="flex flex-col gap-4">
      {ended && !error ? (
        <InlineAlert tone="info">{P13_COPY.SESSION_ENDED}</InlineAlert>
      ) : null}
      {error ? (
        <div ref={alertRef} tabIndex={-1}>
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      ) : null}
      <TextField
        id="staff-sign-in-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
        inputMode="email"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={pending}
      />
      <div className="relative">
        <TextField
          id="staff-sign-in-password"
          name="password"
          type={showPassword ? "text" : "password"}
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="pr-20"
        />
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-1 bottom-1"
          aria-controls="staff-sign-in-password"
          aria-label={showPassword ? "Hide password" : "Show password"}
          disabled={pending}
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? "Hide" : "Show"}
        </Button>
      </div>
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={pending}
        loadingLabel="Checking…"
      >
        Sign in
      </Button>
    </form>
  );
}
