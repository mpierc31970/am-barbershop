"use client";
// Contact drawer Newsletter line (07-16; D132, D271; 07-UI-SPEC "Contacts" drawer Newsletter,
// "Destructive actions" Mark as unsubscribed). Read-only: the status badge and where, when and
// with what wording the person agreed. Its one action is ghost "Mark as unsubscribed" (owner
// and admin, only while they agreed or are subscribed), confirmed in a Dialog because the
// owner can't undo it. There is no control here, or anywhere in Contacts, that subscribes
// someone: only the person can, on a form or through the Newsletter add-on (D132).
import { useEffect, useId, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import {
  UNSUBSCRIBE_COPY,
  canUnsubscribe,
  consentLine,
  newsletterBadge,
  type ConsentView,
} from "./copy";

export interface ConsentStatusLineProps {
  consent: ConsentView;
  /** The contact's name or email, for the dialog title. */
  label: string;
  timeZone: string;
  formName?: string | null;
  canWrite: boolean;
  onUnsubscribe?: () => Promise<HubActionResult<null>>;
}

export function ConsentStatusLine({
  consent,
  label,
  timeZone,
  formName = null,
  canWrite,
  onUnsubscribe,
}: ConsentStatusLineProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  // The confirm stays mounted (the native dialog returns focus to its opener), so its safe
  // choice is focused when it opens.
  useEffect(() => {
    if (!confirming) return;
    document
      .querySelector<HTMLElement>(`[data-keep-subscribed="${CSS.escape(uid)}"]`)
      ?.focus();
  }, [confirming, uid]);
  const badge = newsletterBadge(consent.status);
  const line = consentLine(consent, { formName, timeZone });
  const rest = badge
    ? line.slice(badge.label.length).replace(/^ · /, "")
    : line;
  const showAction =
    canWrite && canUnsubscribe(consent.status) && onUnsubscribe;

  async function confirm(): Promise<void> {
    if (!onUnsubscribe) return;
    setBusy(true);
    setError(null);
    const res = await onUnsubscribe().catch((): HubActionResult<null> => ({
      ok: false,
      code: "save_failed",
      message: "That didn't save. Try again.",
    }));
    setBusy(false);
    if (res.ok) setConfirming(false);
    else setError(res.message);
  }

  return (
    <div className="flex flex-col gap-2 font-hub" data-consent-line="">
      <p className="flex flex-wrap items-center gap-2 text-base text-hub-ink">
        {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
        <span className={badge ? "" : "text-hub-ink-muted"}>{rest}</span>
      </p>
      {showAction ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            {UNSUBSCRIBE_COPY.action}
          </Button>
        </div>
      ) : null}
      {showAction ? (
        <Dialog
          open={confirming}
          onClose={() => (busy ? undefined : setConfirming(false))}
          title={UNSUBSCRIBE_COPY.title(label)}
          footer={
            <>
              <Button
                variant="ghost"
                data-keep-subscribed={uid}
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {UNSUBSCRIBE_COPY.keep}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void confirm()}
              >
                {UNSUBSCRIBE_COPY.confirm}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
            <p>{UNSUBSCRIBE_COPY.body}</p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
