"use client";
// Invite join form (11-38; UI-SPEC "Invite page", D-UI-P11-28). Three modes:
//   - create: Your name + Password (Show/Hide, PASSWORD-RULE helper), primary "Join {org}"
//   - signin: the invited email is fixed (shown by the page); Password, "Sign in and join"
//   - join:   already signed in as the invited email; one primary "Join {org}"
// Errors render in one InlineAlert above the button (role=alert) and focus moves to it, the
// P3 sign-in pattern. The email is never a form field: the server reads it from the invite.
import { Button, InlineAlert, TextField } from "@cds/ui/hub";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  joinInviteAction,
  type InviteJoinState,
} from "../../../actions/invite";

const INITIAL: InviteJoinState = { error: null };

export const PASSWORD_RULE_COPY = "At least 10 characters.";

export type InviteFormMode = "create" | "signin" | "join";

export function InviteForm({
  token,
  mode,
  orgName,
}: {
  token: string;
  mode: InviteFormMode;
  orgName: string;
}) {
  const [state, formAction, pending] = useActionState(
    joinInviteAction,
    INITIAL,
  );
  const [showPassword, setShowPassword] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.error) alertRef.current?.focus();
  }, [state]);

  const joinLabel = mode === "signin" ? "Sign in and join" : `Join ${orgName}`;
  const pendingLabel = mode === "signin" ? "Signing in…" : "Joining…";

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="mode" value={mode} />
      {mode === "create" ? (
        <TextField
          id="invite-name"
          name="name"
          label="Your name"
          autoComplete="name"
          maxLength={80}
          required
          disabled={pending}
        />
      ) : null}
      {mode !== "join" ? (
        <div className="relative">
          <TextField
            id="invite-password"
            name="password"
            type={showPassword ? "text" : "password"}
            label="Password"
            autoComplete={
              mode === "create" ? "new-password" : "current-password"
            }
            helper={mode === "create" ? PASSWORD_RULE_COPY : undefined}
            minLength={mode === "create" ? 10 : undefined}
            required
            disabled={pending}
            className="pr-20"
          />
          <Button
            variant="ghost"
            size="sm"
            className={
              mode === "create"
                ? "absolute top-7 right-1"
                : "absolute right-1 bottom-1"
            }
            aria-controls="invite-password"
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={pending}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
      ) : null}
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
        loadingLabel={pendingLabel}
      >
        {joinLabel}
      </Button>
    </form>
  );
}
