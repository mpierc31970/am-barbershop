"use client";
// A&M fork: change your own sign-in email (current password required).
import { Button, InlineAlert, TextField } from "@cds/ui/hub";
import { useActionState } from "react";
import { changeEmailAction, type EmailState } from "../../../actions/password";

const INITIAL: EmailState = { error: null, done: false };

export function EmailForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    changeEmailAction,
    INITIAL,
  );
  return (
    <section aria-labelledby="profile-email" className="flex flex-col gap-4">
      <h2 id="profile-email" className="text-xl leading-tight font-semibold">
        Sign-in email
      </h2>
      <form
        key={state.done ? "done" : "form"}
        action={formAction}
        className="flex max-w-md flex-col gap-4"
        noValidate
      >
        <TextField
          id="email-next"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          defaultValue={email}
          required
          disabled={pending}
        />
        <TextField
          id="email-current"
          name="current"
          type="password"
          label="Current password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
        {state.error ? (
          <InlineAlert tone="error">{state.error}</InlineAlert>
        ) : null}
        {state.done ? (
          <InlineAlert tone="success">Your email is changed.</InlineAlert>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          loadingLabel="Saving…"
        >
          Change email
        </Button>
      </form>
    </section>
  );
}
