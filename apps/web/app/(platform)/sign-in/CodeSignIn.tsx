"use client";
// Sign in with an emailed code (06-UI-SPEC "Sign in with a code"; D-UI-P6-3; T-06-82,
// T-06-83). Owners created at Submit have no password. "Email me a sign-in code" swaps the
// card to an email field + primary "Email me a code", then the shared CodeStep with primary
// "Sign in". "Use a password instead" returns to the password form. The code step reads the
// same whether or not the address has an account (the server never creates a user here).
// Errors reuse ERR-EMAIL, ERR-CODE*, ERR-SEND-CODE and the P3 sign-in rows.
import { Button, CodeStep, InlineAlert, TextField } from "@cds/ui/hub";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  completeMemberCodeAction,
  requestMemberCodeAction,
  type MemberCodeState,
} from "../../actions/session";

export const CODE_SIGN_IN_LABEL = "Email me a sign-in code";

const INITIAL: MemberCodeState = { step: "email", email: "", error: null };

const TEXT_LINK =
  "inline-flex min-h-11 items-center self-start rounded px-1 text-sm text-hub-accent underline underline-offset-4";

export interface CodeSignInProps {
  /** Back to the password form. */
  onPassword(): void;
  /** A validated `/invite/<token>` to return to after sign-in (WR-E02). */
  next?: string;
}

export function CodeSignIn({ onPassword, next }: CodeSignInProps) {
  const [sent, sendDispatch, sending] = useActionState(
    requestMemberCodeAction,
    INITIAL,
  );
  const [done, doneDispatch, checking] = useActionState(
    completeMemberCodeAction,
    { step: "code" as const, email: "", error: null },
  );
  const [email, setEmail] = useState("");
  const [backFrom, setBackFrom] = useState<MemberCodeState | null>(null);
  const [attemptFor, setAttemptFor] = useState<MemberCodeState | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const view: "email" | "code" =
    sent.step === "code" && backFrom !== sent ? "code" : "email";
  const emailError = backFrom === sent ? null : sent.error;

  // The email step: focus the field when it appears, the alert when it has an error.
  useEffect(() => {
    if (view !== "email") return;
    if (emailError) alertRef.current?.focus();
    else document.getElementById("sign-in-code-email")?.focus();
  }, [view, emailError, sent]);

  function handleEmail(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const fd = new FormData();
    fd.set("email", email);
    setBackFrom(null);
    setResendError(null);
    startTransition(() => sendDispatch(fd));
  }

  function handleCode(code: string): void {
    const fd = new FormData();
    fd.set("code", code);
    if (next) fd.set("next", next);
    setAttemptFor(sent);
    setResendError(null);
    startTransition(() => doneDispatch(fd));
  }

  async function handleResend(): Promise<boolean> {
    const fd = new FormData();
    fd.set("email", sent.email);
    const next = await requestMemberCodeAction(sent, fd);
    setResendError(next.error);
    return next.error === null;
  }

  if (view === "code") {
    return (
      <div className="flex flex-col gap-2">
        <CodeStep
          email={sent.email}
          primaryLabel="Sign in"
          pendingLabel="Signing in…"
          onSubmit={handleCode}
          onResend={handleResend}
          onBack={() => setBackFrom(sent)}
          error={resendError ?? (attemptFor === sent ? done.error : null)}
          errorKey={resendError ? resendError : done}
          pending={checking}
          headingLevel={2}
          idPrefix="sign-in-code"
        />
        <button type="button" className={TEXT_LINK} onClick={onPassword}>
          Use a password instead
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleEmail} noValidate className="flex flex-col gap-4">
      <TextField
        id="sign-in-code-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={sending}
      />
      {emailError ? (
        <div ref={alertRef} tabIndex={-1}>
          <InlineAlert tone="error">{emailError}</InlineAlert>
        </div>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={sending}
        loadingLabel="Sending code…"
      >
        Email me a code
      </Button>
      <button type="button" className={TEXT_LINK} onClick={onPassword}>
        Use a password instead
      </button>
    </form>
  );
}
