"use client";
// A&M fork: change your own password (profile page).
import { Button, InlineAlert, TextField } from "@cds/ui/hub";
import { useActionState } from "react";
import {
  changePasswordAction,
  type PasswordState,
} from "../../../actions/password";

const INITIAL: PasswordState = { error: null, done: false };

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    INITIAL,
  );
  return (
    <section aria-labelledby="profile-password" className="flex flex-col gap-4">
      <h2 id="profile-password" className="text-xl leading-tight font-semibold">
        Change your password
      </h2>
      <form
        key={state.done ? "done" : "form"}
        action={formAction}
        className="flex max-w-md flex-col gap-4"
        noValidate
      >
        <TextField
          id="password-current"
          name="current"
          type="password"
          label="Current password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
        <TextField
          id="password-next"
          name="next"
          type="password"
          label="New password (10 or more characters)"
          autoComplete="new-password"
          required
          disabled={pending}
        />
        <TextField
          id="password-confirm"
          name="confirm"
          type="password"
          label="New password again"
          autoComplete="new-password"
          required
          disabled={pending}
        />
        {state.error ? (
          <InlineAlert tone="error">{state.error}</InlineAlert>
        ) : null}
        {state.done ? (
          <InlineAlert tone="success">Your password is changed.</InlineAlert>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          loadingLabel="Saving…"
        >
          Change password
        </Button>
      </form>
    </section>
  );
}
