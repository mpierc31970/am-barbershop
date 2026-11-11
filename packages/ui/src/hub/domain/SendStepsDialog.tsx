"use client";
// SendStepsDialog (14-30 choice 3; 14-UI-SPEC "S3", SendStepsDialog). Dialog titled Send
// these steps to someone; Body "For the person who manages riverabakery.com. They get the
// two nameservers and the steps for GoDaddy."; TextField Their email, TextArea Add a note
// (optional) capped at 500 characters; primary Send steps (pending Sending…), secondary
// Don't send. An address that isn't name@example.com shaped shows INVITE-INVALID under the
// field without calling the action. The server action enforces the sender rules (D173) and
// the rate limit (14-29); on success the caller shows the toast with the `sent` words.
import { P14_COPY } from "@cds/core/dns";
import { useId, useState, type FormEvent } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { TextArea, TextField } from "../fields";
import { DOMAIN_UI_COPY as C } from "./copy";

export const SEND_NOTE_MAX = 500;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendStepsDialogProps {
  open: boolean;
  onClose(): void;
  domain: string;
  /** Registrar owner display name ("GoDaddy"). */
  registrar: string;
  action(input: {
    email: string;
    note: string;
  }): Promise<HubActionResult<unknown>>;
  /** After a send: the toast words ("Steps sent to sam@example.com."). */
  onSent?(message: string): void;
}

export function SendStepsDialog({
  open,
  onClose,
  domain,
  registrar,
  action,
  onSent,
}: SendStepsDialogProps) {
  const id = useId();
  const formId = `${id}-form`;
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const to = email.trim();
    if (!EMAIL.test(to)) {
      setFieldError(C.invalidEmail);
      return;
    }
    setFieldError(null);
    setFormError(null);
    setPending(true);
    try {
      const res = await action({
        email: to,
        note: note.slice(0, SEND_NOTE_MAX),
      });
      if (res.ok) {
        onSent?.(C.sent(to));
        setEmail("");
        setNote("");
        onClose();
      } else if (res.field === "email") {
        setFieldError(res.message);
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={P14_COPY.BTN_SEND_STEPS_SOMEONE}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {P14_COPY.BTN_DONT_SEND}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            loadingLabel={C.sending}
          >
            {P14_COPY.BTN_SEND_STEPS}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <p className="text-base">{C.sendBody(domain, registrar)}</p>
        {formError ? <InlineAlert tone="error">{formError}</InlineAlert> : null}
        <TextField
          id={`${id}-email`}
          name="email"
          type="email"
          label={C.theirEmail}
          autoComplete="off"
          value={email}
          error={fieldError ?? undefined}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <TextArea
          id={`${id}-note`}
          name="note"
          label={C.addNote}
          maxLength={SEND_NOTE_MAX}
          counter={{ value: note.length, max: SEND_NOTE_MAX }}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </form>
    </Dialog>
  );
}
