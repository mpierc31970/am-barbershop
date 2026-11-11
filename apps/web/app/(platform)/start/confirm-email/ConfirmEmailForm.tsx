"use client";
// Confirm-address form (ONB-09, D173; 06-UI-SPEC "Quote links" confirm rows; D-UI-P6-15).
// The page (GET) shows who and what; "Confirm this address" POSTs confirmEmailAction.
// Done shows "Address confirmed" + Back to your site's settings; a used or expired token
// shows Link expired. Focus moves to the new heading after each result.
import { Button, InlineAlert } from "@cds/ui/hub";
import { useActionState, useEffect, useRef } from "react";
import {
  confirmEmailAction,
  type LinkActionState,
} from "../../../actions/quote-links";
import { LinkAction, LinkBody, LinkTitle } from "../_components/LinkPanel";
import {
  CONFIRM_BACK,
  CONFIRM_DONE_TITLE,
  CONFIRM_SETTINGS_HREF,
  CONFIRM_TITLE,
  LINK_EXPIRED_ACTION,
  LINK_EXPIRED_BODY,
  LINK_EXPIRED_TITLE,
  confirmDoneBody,
  confirmLead,
  CONFIRM_TITLE_ID,
} from "../_components/link-copy";

const INITIAL: LinkActionState = { status: "idle", error: null };

export interface RouteDetails {
  orgName: string;
  address: string;
  purposeLabel: string;
}

export function ConfirmEmailDone({
  orgName,
  address,
  purposeLabel,
}: RouteDetails) {
  return (
    <>
      <LinkTitle id={CONFIRM_TITLE_ID}>{CONFIRM_DONE_TITLE}</LinkTitle>
      <LinkBody>{confirmDoneBody(orgName, address, purposeLabel)}</LinkBody>
      <LinkAction href={CONFIRM_SETTINGS_HREF}>{CONFIRM_BACK}</LinkAction>
    </>
  );
}

export function LinkExpired() {
  return (
    <>
      <LinkTitle id={CONFIRM_TITLE_ID}>{LINK_EXPIRED_TITLE}</LinkTitle>
      <LinkBody>{LINK_EXPIRED_BODY}</LinkBody>
      <LinkAction href={CONFIRM_SETTINGS_HREF}>
        {LINK_EXPIRED_ACTION}
      </LinkAction>
    </>
  );
}

export function ConfirmEmailForm({
  token,
  ...route
}: RouteDetails & { token: string }) {
  const [state, formAction, pending] = useActionState(
    confirmEmailAction,
    INITIAL,
  );
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle")
      document.getElementById(CONFIRM_TITLE_ID)?.focus();
    else if (state.error) alertRef.current?.focus();
  }, [state]);

  if (state.status === "done") return <ConfirmEmailDone {...route} />;
  if (state.status === "expired") return <LinkExpired />;

  return (
    <>
      <LinkTitle id={CONFIRM_TITLE_ID}>{CONFIRM_TITLE}</LinkTitle>
      <LinkBody>
        {confirmLead(route.orgName, route.purposeLabel)}
        <strong className="font-semibold break-all text-hub-ink">
          {route.address}
        </strong>
        .
      </LinkBody>
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
          loadingLabel="Confirming…"
        >
          Confirm this address
        </Button>
      </form>
    </>
  );
}
