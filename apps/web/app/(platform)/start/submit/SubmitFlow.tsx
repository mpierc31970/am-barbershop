"use client";
// /start/submit client flow (ONB-08, ONB-12; D213, D215, D286; 06-UI-SPEC "Submit";
// D-UI-P6-9, D-UI-P6-12, D-UI-P6-14; T-06-82). Three steps in one place:
//   A · Your details: business name, the one sentence (200 characters, counter), email
//       (prefilled from the saved quote). Primary "Email me a code" ("Sending code…").
//       No terms checkbox: a line says the agreement comes at checkout (D-UI-P6-9).
//       The Turnstile human check rides along (interaction-only; A-WR-02), reset after
//       every Step A answer because tokens are single use.
//   B · Check your email: the shared CodeStep (auto-submit on the sixth digit and a
//       visible "Create my account"). Success redirects server-side.
//   C · Blocked: BlockedOutcome.
// Each step replaces the one before in place and moves focus to its heading. Field errors
// sit on their field (focus moves to it); other errors show in one InlineAlert above the
// button that takes focus. Fields keep their values when going back.
import {
  Button,
  CodeStep,
  InlineAlert,
  TextArea,
  TextField,
} from "@cds/ui/hub";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  completeSubmitAction,
  resendSubmitCodeAction,
  startSubmitAction,
  type SubmitState,
} from "../../../actions/submit";
import { Turnstile } from "../_components/Turnstile";
import { BlockedOutcome } from "./BlockedOutcome";

export const SUBMIT_TITLE = "Almost there";
export const SUBMIT_INTRO =
  "Tell us who you are. We'll email you a code to create your account. Nothing is charged today.";
export const AGREEMENT_LINE =
  "Next you'll set up your site's details. You'll see the agreement and pay only at checkout, after CDS has confirmed your site.";
export const DESCRIPTION_MAX = 200;

export interface SubmitFlowProps {
  /** The saved quote's email, or "". */
  initialEmail: string;
  /** A code is already pending (reload): open on Step B for this address. */
  pendingEmail: string | null;
  /** Where "Contact CDS" writes to (CDS_SUPPORT_EMAIL). */
  supportEmail: string;
}

export function SubmitFlow({
  initialEmail,
  pendingEmail,
  supportEmail,
}: SubmitFlowProps) {
  const [initial] = useState<SubmitState>(() =>
    pendingEmail
      ? { step: "code", email: pendingEmail, error: null }
      : { step: "details", email: initialEmail, error: null },
  );
  const [startState, startDispatch, startPending] = useActionState(
    startSubmitAction,
    initial,
  );
  const [doneState, doneDispatch, donePending] = useActionState(
    completeSubmitAction,
    initial,
  );
  // "Use a different email" returns to Step A for this Step A result only; the next
  // result (a fresh code) shows Step B again.
  const [backFrom, setBackFrom] = useState<SubmitState | null>(null);
  // Which Step A result the latest code attempt belongs to, so an old error never shows
  // against a newly sent code.
  const [attemptFor, setAttemptFor] = useState<SubmitState | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [humanToken, setHumanToken] = useState("");

  const view: "details" | "code" | "blocked" =
    doneState.step === "blocked"
      ? "blocked"
      : startState.step === "code" && backFrom !== startState
        ? "code"
        : "details";

  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Step A: back from Step B moves focus to the heading; an error moves it to the field
  // or the alert. Never on first render (the page opens at the top).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (view !== "details") return;
    if (startState.error && backFrom !== startState) {
      if (startState.field) {
        document.getElementById(`submit-${startState.field}`)?.focus();
      } else {
        alertRef.current?.focus();
      }
    } else {
      headingRef.current?.focus();
    }
  }, [view, startState, backFrom]);

  function handleDetails(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const fd = new FormData();
    fd.set("businessName", businessName);
    fd.set("description", description);
    fd.set("email", email);
    fd.set("cf-turnstile-response", humanToken);
    setBackFrom(null);
    setResendError(null);
    startTransition(() => startDispatch(fd));
  }

  function handleCode(code: string): void {
    const fd = new FormData();
    fd.set("code", code);
    setAttemptFor(startState);
    setResendError(null);
    startTransition(() => doneDispatch(fd));
  }

  async function handleResend(): Promise<boolean> {
    const { error } = await resendSubmitCodeAction();
    setResendError(error);
    return error === null;
  }

  if (view === "blocked") {
    return (
      <BlockedOutcome
        category={doneState.category ?? ""}
        supportEmail={supportEmail}
      />
    );
  }

  if (view === "code") {
    const codeError =
      resendError ?? (attemptFor === startState ? doneState.error : null);
    return (
      <CodeStep
        email={startState.email}
        primaryLabel="Create my account"
        pendingLabel="Creating your account…"
        onSubmit={handleCode}
        onResend={handleResend}
        onBack={() => setBackFrom(startState)}
        error={codeError}
        errorKey={resendError ? resendError : doneState}
        pending={donePending}
        idPrefix="submit-code"
      />
    );
  }

  const shown = backFrom === startState ? null : startState;
  const fieldError = (f: NonNullable<SubmitState["field"]>) =>
    shown?.error && shown.field === f ? shown.error : undefined;
  const formError = shown?.error && !shown.field ? shown.error : null;

  return (
    <form
      onSubmit={handleDetails}
      noValidate
      aria-labelledby="submit-title"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1
          id="submit-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.75rem] leading-tight font-semibold outline-none md:text-[2rem]"
        >
          {SUBMIT_TITLE}
        </h1>
        <p className="text-base text-hub-ink-muted">{SUBMIT_INTRO}</p>
      </div>
      <TextField
        id="submit-businessName"
        name="businessName"
        label="Business name"
        autoComplete="organization"
        maxLength={120}
        required
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        disabled={startPending}
        error={fieldError("businessName")}
      />
      <TextArea
        id="submit-description"
        name="description"
        label="What does your business do?"
        rows={2}
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        counter={{ value: description.length, max: DESCRIPTION_MAX }}
        helper="One sentence, like 'Family bakery in Austin, known for sourdough.'"
        disabled={startPending}
        error={fieldError("description")}
      />
      <TextField
        id="submit-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        helper="This is how you'll sign in. No password needed."
        disabled={startPending}
        error={fieldError("email")}
      />
      <Turnstile onToken={setHumanToken} resetKey={startState} />
      {formError ? (
        <div ref={alertRef} tabIndex={-1}>
          <InlineAlert tone="error">{formError}</InlineAlert>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          variant="primary"
          className="w-full md:w-auto md:self-start"
          loading={startPending}
          loadingLabel="Sending code…"
        >
          Email me a code
        </Button>
        <p className="text-sm text-hub-ink-muted">{AGREEMENT_LINE}</p>
      </div>
    </form>
  );
}
