"use client";
// "Save your quote? Just your email." (ONB-08, D213; CONTEXT A1-Q3; 06-UI-SPEC "Save your
// quote card"; D-UI-P6-10). Inline in the flow, never a modal: the parent shows it after
// the visitor's second choice and hides it for the session after No thanks or a save. The
// save needs the Turnstile token (T-06-74) and sends quote.saved from the server. The
// button is secondary: the one accent button on /start is Review and submit.
import { Button, InlineAlert, TextField } from "@cds/ui/hub";
import { CircleCheck } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveQuoteAction, type SaveQuoteState } from "../../../actions/quote";
import { Turnstile } from "./Turnstile";

export const SAVE_CARD_TITLE = "Save your quote? Just your email.";
export const SAVE_CARD_BODY =
  "We'll send you a link back to this exact quote, and two reminders: tomorrow and in 3 days. Unsubscribe any time.";
export const SAVE_EMAIL_ID = "save-quote-email";

const RATE_SAVE_COPY =
  "You're going a little fast. Wait a minute, then try again.";

const INITIAL: SaveQuoteState = { status: "idle", email: null, error: null };

export interface SaveQuoteCardProps {
  onSaved: (email: string) => void;
  onDismiss: () => void;
}

export function SaveQuoteCard({ onSaved, onDismiss }: SaveQuoteCardProps) {
  const [state, formAction, pending] = useActionState(saveQuoteAction, INITIAL);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const savedCb = useRef(onSaved);
  useEffect(() => {
    savedCb.current = onSaved;
  }, [onSaved]);

  // A fresh state object arrives on every submit: a save collapses the card, an error
  // takes focus (so a repeated error is announced again).
  useEffect(() => {
    if (state.status === "saved" && state.email) {
      setEditing(false);
      savedCb.current(state.email);
    } else if (state.error) {
      alertRef.current?.focus();
    }
  }, [state]);

  const saved = state.status === "saved" && !editing;

  if (saved) {
    return (
      <div
        role="status"
        className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-hub-surface-2 px-6 py-4 transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
      >
        <p className="flex items-center gap-2">
          <CircleCheck
            aria-hidden
            size={20}
            strokeWidth={2}
            className="shrink-0 text-hub-success"
          />
          <span>Quote saved. We sent a link to {state.email}.</span>
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-hub-accent underline underline-offset-4"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="save-quote-title"
      className="mt-12 flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6"
    >
      <div>
        <h3
          id="save-quote-title"
          className="text-xl leading-tight font-semibold"
        >
          {SAVE_CARD_TITLE}
        </h3>
        <p className="mt-2 text-base text-hub-ink-muted">{SAVE_CARD_BODY}</p>
      </div>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <TextField
              id={SAVE_EMAIL_ID}
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              required
              disabled={pending}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              loading={pending}
              loadingLabel="Saving…"
            >
              Save quote
            </Button>
            <Button variant="ghost" onClick={onDismiss} disabled={pending}>
              No thanks
            </Button>
          </div>
        </div>
        <input type="hidden" name="cf-turnstile-response" value={token} />
        <Turnstile onToken={setToken} resetKey={state} />
        {state.error ? (
          <div ref={alertRef} tabIndex={-1}>
            <InlineAlert
              tone={state.error === RATE_SAVE_COPY ? "warning" : "error"}
            >
              {state.error}
            </InlineAlert>
          </div>
        ) : null}
      </form>
    </section>
  );
}
