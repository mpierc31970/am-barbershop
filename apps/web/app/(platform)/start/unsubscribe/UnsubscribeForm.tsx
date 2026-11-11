"use client";
// Unsubscribe confirm form (06-UI-SPEC "Quote links" unsubscribe rows; D-UI-P6-15). The
// page (GET) only shows this; the Unsubscribe button POSTs unsubscribeAction. The state
// swaps the panel's content to Done ("You're unsubscribed" + Open my quote) or Link
// expired, and focus moves to the new heading so screen readers hear the result.
import { Button, InlineAlert } from "@cds/ui/hub";
import { useActionState, useEffect, useRef } from "react";
import {
  unsubscribeAction,
  type LinkActionState,
} from "../../../actions/quote-links";
import { LinkAction, LinkBody, LinkTitle } from "../_components/LinkPanel";
import {
  LINK_EXPIRED_TITLE,
  UNSUB_BODY,
  UNSUB_DONE_BODY,
  UNSUB_DONE_TITLE,
  UNSUB_EXPIRED_BODY,
  UNSUB_OPEN_QUOTE,
  UNSUB_TITLE,
  UNSUB_TITLE_ID,
} from "../_components/link-copy";

const INITIAL: LinkActionState = { status: "idle", error: null };

/** Plain /start: never a reopen link derived from the unsubscribe token (B-WR-02). */
const UNSUB_REOPEN_HREF = "/start";

export function UnsubscribeDone() {
  return (
    <>
      <LinkTitle id={UNSUB_TITLE_ID}>{UNSUB_DONE_TITLE}</LinkTitle>
      <LinkBody>{UNSUB_DONE_BODY}</LinkBody>
      <LinkAction href={UNSUB_REOPEN_HREF}>{UNSUB_OPEN_QUOTE}</LinkAction>
    </>
  );
}

export function UnsubscribeExpired() {
  return (
    <>
      <LinkTitle id={UNSUB_TITLE_ID}>{LINK_EXPIRED_TITLE}</LinkTitle>
      <LinkBody>{UNSUB_EXPIRED_BODY}</LinkBody>
    </>
  );
}

export interface UnsubscribeFormProps {
  token: string;
  /** "Your link keeps working until 28 Oct." or "". */
  until: string;
}

export function UnsubscribeForm({ token, until }: UnsubscribeFormProps) {
  const [state, formAction, pending] = useActionState(
    unsubscribeAction,
    INITIAL,
  );
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle")
      document.getElementById(UNSUB_TITLE_ID)?.focus();
    else if (state.error) alertRef.current?.focus();
  }, [state]);

  if (state.status === "done") return <UnsubscribeDone />;
  if (state.status === "expired") return <UnsubscribeExpired />;

  return (
    <>
      <LinkTitle id={UNSUB_TITLE_ID}>{UNSUB_TITLE}</LinkTitle>
      <LinkBody>{until ? `${UNSUB_BODY} ${until}` : UNSUB_BODY}</LinkBody>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="t" value={token} />
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
          loadingLabel="Unsubscribing…"
        >
          Unsubscribe
        </Button>
      </form>
    </>
  );
}
