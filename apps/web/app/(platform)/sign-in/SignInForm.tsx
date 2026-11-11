"use client";
// Sign-in form (UI-SPEC "Sign-in", "Accessibility contract"). Email + password with a
// Show/Hide toggle; one full-width primary Sign in. While pending the button reads
// "Signing in…" and the fields are disabled. An error renders in one InlineAlert above the
// button (role=alert) and focus moves to it. No forgot-password link in P3 (D-UI-9).
// P6 (06-17, D-UI-P6-3): under the form, an "or" divider and a secondary full-width
// "Email me a sign-in code" swap the card to CodeSignIn; "Use a password instead" returns.
// Staff MFA sign-in is untouched (staff sign in on the staff flows, never here).
import { Button, InlineAlert, TextField } from "@cds/ui/hub";
import { useActionState, useEffect, useRef, useState } from "react";
import { signInAction, type SignInState } from "../../actions/session";
import { CODE_SIGN_IN_LABEL, CodeSignIn } from "./CodeSignIn";

const INITIAL: SignInState = { error: null };
const CODE_BUTTON_ID = "sign-in-with-code";

export function SignInForm({
  next,
  startWithCode = false,
}: {
  /** A validated `/invite/<token>` to return to after sign-in (WR-E02). */
  next?: string;
  /** Open the emailed-code form first (`/sign-in?method=code`). */
  startWithCode?: boolean;
} = {}) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"password" | "code">(
    startWithCode ? "code" : "password",
  );
  const alertRef = useRef<HTMLDivElement>(null);
  const swapped = useRef(false);

  // A fresh state object arrives on every failed submit, so a repeated error refocuses.
  useEffect(() => {
    if (state.error) alertRef.current?.focus();
  }, [state]);

  // Back from the code path: focus returns to the button that opened it.
  useEffect(() => {
    if (mode === "password" && swapped.current)
      document.getElementById(CODE_BUTTON_ID)?.focus();
  }, [mode]);

  if (mode === "code") {
    return (
      <CodeSignIn
        next={next}
        onPassword={() => {
          swapped.current = true;
          setMode("password");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <TextField
          id="sign-in-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          required
          disabled={pending}
        />
        <div className="relative">
          <TextField
            id="sign-in-password"
            name="password"
            type={showPassword ? "text" : "password"}
            label="Password"
            autoComplete="current-password"
            required
            disabled={pending}
            className="pr-20"
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 bottom-1"
            aria-controls="sign-in-password"
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={pending}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
        {state.error ? (
          <div ref={alertRef} tabIndex={-1}>
            <InlineAlert tone="error">{state.error}</InlineAlert>
          </div>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={pending}
          loadingLabel="Signing in…"
        >
          Sign in
        </Button>
      </form>
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-hub-border" />
        <span className="text-sm text-hub-ink-muted">or</span>
        <span className="h-px flex-1 bg-hub-border" />
      </div>
      <Button
        id={CODE_BUTTON_ID}
        variant="secondary"
        className="w-full"
        disabled={pending}
        onClick={() => setMode("code")}
      >
        {CODE_SIGN_IN_LABEL}
      </Button>
    </div>
  );
}
