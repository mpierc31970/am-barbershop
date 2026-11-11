"use client";
// SendingDomainStatus (14-25 choice 4; 14-UI-SPEC "Sending from your domain"; ONB-10, D112,
// D173, D119). One more row under Settings › Email's From / Reply-to preview, in four states:
//   none     "Once your domain is connected, emails can come from hello@…" + Connect your domain
//   pending  Clock 14 + SEND-PENDING
//   verified CircleCheck 14 success + SEND-ON, then the Send from field (local part, the
//            "@domain" suffix as a non-editable adornment), helper "Replies still go to …" and
//            primary Save sending address (pending Saving…); the caller toasts the saved words
//   failed   warning InlineAlert SEND-FAILED
// The local part is checked here with the send path's own rule (isSendingLocalPart) and again
// on the server; an invalid one shows SEND-LOCAL-INVALID under the field without a request.
// Hub tokens only (impeccable standard; no new tokens).
import { P14_COPY } from "@cds/core/dns";
import { isSendingLocalPart } from "@cds/core/email";
import { CircleCheck, Clock } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { fieldAria } from "../fields";

export type SendingDomainState = "none" | "pending" | "verified" | "failed";

export const SENDING_UI_COPY = {
  connectLink: "Connect your domain",
  connectHref: "/hub/settings?tab=domain",
  sendFrom: "Send from",
  saving: "Saving…",
  none: (domain: string) =>
    domain !== ""
      ? `Once your domain is connected, emails can come from hello@${domain}.`
      : "Once your domain is connected, emails can come from an address on it, like hello@yourbusiness.com.",
  repliesTo: (address: string) => `Replies still go to ${address}.`,
} as const;

export interface SendingDomainStatusProps {
  state: SendingDomainState;
  /** The own sending domain; for `none`, the domain the owner plans to use ("" if unknown). */
  domain: string;
  /** The stored local part ("hello" when unset). */
  localPart: string;
  /** The routed Reply-To address ("" when none is confirmed yet). */
  replyTo: string;
  /** Owner only; without it the verified state is read-only. */
  save?(localPart: string): Promise<HubActionResult<{ localPart: string }>>;
  /** After a save: the toast words ("Emails now send from bookings@…"). */
  onSaved?(message: string, localPart: string): void;
  /** Where "Connect your domain" goes (default Settings › Domain). */
  connectHref?: string;
}

const ROW = "flex items-start gap-2 font-hub text-sm text-hub-ink";

export function SendingDomainStatus({
  state,
  domain,
  localPart,
  replyTo,
  save,
  onSaved,
  connectHref = SENDING_UI_COPY.connectHref,
}: SendingDomainStatusProps) {
  const id = useId();
  const fieldId = `${id}-local`;
  const [saved, setSaved] = useState(localPart);
  const [value, setValue] = useState(localPart);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (state === "none") {
    return (
      <p className={ROW} data-sending-state="none">
        <span className="max-w-[68ch]">
          {SENDING_UI_COPY.none(domain)}{" "}
          <a
            href={connectHref}
            className="rounded font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
          >
            {SENDING_UI_COPY.connectLink}
          </a>
        </span>
      </p>
    );
  }

  if (state === "pending") {
    return (
      <p className={ROW} data-sending-state="pending">
        <Clock
          aria-hidden
          size={14}
          strokeWidth={2}
          className="mt-[3px] shrink-0 text-hub-ink-muted"
        />
        <span className="max-w-[68ch]">
          {P14_COPY.SEND_PENDING({ domain })}
        </span>
      </p>
    );
  }

  if (state === "failed") {
    return (
      <div data-sending-state="failed">
        <InlineAlert tone="warning">
          {P14_COPY.SEND_FAILED({ domain })}
        </InlineAlert>
      </div>
    );
  }

  const address = `${saved}@${domain}`;
  const [lead, tail] = splitOn(P14_COPY.SEND_ON({ address }), address);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !save) return;
    const next = value.trim().toLowerCase();
    if (!isSendingLocalPart(next)) {
      setError(P14_COPY.SEND_LOCAL_INVALID);
      return;
    }
    setError(null);
    setFormError(null);
    setPending(true);
    try {
      const res = await save(next);
      if (res.ok) {
        setSaved(res.data.localPart);
        setValue(res.data.localPart);
        onSaved?.(
          P14_COPY.SEND_ON({ address: `${res.data.localPart}@${domain}` }),
          res.data.localPart,
        );
      } else if (res.field === "localPart") {
        setError(res.message);
      } else {
        setFormError(res.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setFormError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  const helper = replyTo !== "" ? SENDING_UI_COPY.repliesTo(replyTo) : null;

  return (
    <div className="flex flex-col gap-3" data-sending-state="verified">
      <p className={ROW}>
        <CircleCheck
          aria-hidden
          size={14}
          strokeWidth={2}
          className="mt-[3px] shrink-0 text-hub-success"
        />
        <span className="max-w-[68ch] break-all">
          {lead}
          <strong>{address}</strong>
          {tail}
        </span>
      </p>
      {save ? (
        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-3"
          aria-label={SENDING_UI_COPY.sendFrom}
        >
          {formError ? (
            <InlineAlert tone="error">{formError}</InlineAlert>
          ) : null}
          <div className="flex flex-col gap-2 font-hub">
            <label
              htmlFor={fieldId}
              className="text-sm font-semibold text-hub-ink"
            >
              {SENDING_UI_COPY.sendFrom}
            </label>
            <div
              className={`flex h-10 w-full max-w-md items-stretch overflow-hidden rounded border bg-hub-surface transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-hub-accent ${error ? "border-hub-danger" : "border-hub-border-strong hover:border-hub-ink-muted"}`}
            >
              <input
                id={fieldId}
                name="localPart"
                type="text"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={64}
                value={value}
                onChange={(e) => setValue(e.currentTarget.value)}
                {...fieldAria(fieldId, helper, error)}
                className="min-w-0 flex-1 bg-transparent px-3 font-hub text-base text-hub-ink outline-none placeholder:text-hub-ink-muted"
              />
              <span
                data-adornment
                className="flex shrink-0 items-center border-l border-hub-border bg-hub-surface-2 px-3 font-mono text-sm text-hub-ink-muted"
              >
                @{domain}
              </span>
            </div>
            {helper ? (
              <p
                id={`${fieldId}-helper`}
                className="text-sm text-hub-ink-muted"
              >
                {helper}
              </p>
            ) : null}
            {error ? (
              <p id={`${fieldId}-error`} className="text-sm text-hub-danger">
                {error}
              </p>
            ) : null}
          </div>
          <div>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel={SENDING_UI_COPY.saving}
            >
              {P14_COPY.BTN_SAVE_SENDING}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** "Emails now send from X." -> ["Emails now send from ", "."] (bold the address). */
function splitOn(sentence: string, address: string): [string, string] {
  const at = sentence.indexOf(address);
  if (at < 0) return [sentence, ""];
  return [sentence.slice(0, at), sentence.slice(at + address.length)];
}
