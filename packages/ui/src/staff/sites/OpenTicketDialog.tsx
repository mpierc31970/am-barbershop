"use client";
// OpenTicketDialog (13-43 choice 1; STAFF-19, D210; 13-UI-SPEC "Open a ticket for a site" lines
// 529-536; T-13-43-02). Opened from Site › Actions with the site locked: Type (compact radio
// cards: Problem · Change · Question · Billing), About (the P12 TargetSelect fed by the site's
// pages and add-ons), Subject (80), Message, the "Opened by CDS" label line and an inline
// preview of the ticket as the business sees it. Primary "Open ticket" · ghost "Discard
// ticket". The action is staffOpenTicketAction (support_open, the support:open CLI's
// function); a failure stays in the dialog with the inputs kept. The success toast carries a
// "View ticket" action rather than leaving the page.
import { fillCopy } from "@cds/core/staff";
import type { TargetGroup } from "@cds/core/support";
import { useEffect, useId, useState } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { Dialog } from "../../hub/Dialog";
import { InlineAlert } from "../../hub/feedback";
import { TextArea, TextField } from "../../hub/fields";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { MessageBody } from "../../hub/support/thread";
import { TargetSelect } from "../../hub/support/tickets/TargetSelect";
import { useToast } from "../../hub/Toast";
import { useStaffAction, type StaffActionResult } from "../dialogs";
import { SITE_ACTIONS_COPY } from "./actions-copy";

const C = SITE_ACTIONS_COPY.openTicket;

export const OPEN_TICKET_TYPES = [
  "problem",
  "change",
  "question",
  "billing",
] as const;
export type OpenTicketType = (typeof OPEN_TICKET_TYPES)[number];
export const OPEN_TICKET_SUBJECT_MAX = 80;
export const OPEN_TICKET_BODY_MAX = 10_000;

export interface OpenTicketInput {
  orgId: string;
  type: OpenTicketType;
  subject: string;
  body: string;
  /** `page:<id>` · `addon:<slug>` · `part:<key>`; absent = whole site. */
  target?: string;
}

export type OpenTicketAction = (
  input: OpenTicketInput,
) => Promise<StaffActionResult<{ number: number; message: string }>>;

export interface OpenTicketDialogProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  business: string;
  targets: readonly TargetGroup[];
  openTicket: OpenTicketAction;
  /** Where "View ticket" goes (default location.assign). */
  navigate?: (href: string) => void;
}

function targetLabel(groups: readonly TargetGroup[], value: string): string {
  for (const g of groups) {
    for (const o of g.options) {
      if (`${o.kind}:${o.id}` === value) return o.label;
    }
  }
  return "";
}

export function OpenTicketDialog({
  open,
  onClose,
  orgId,
  business,
  targets,
  openTicket,
  navigate,
}: OpenTicketDialogProps) {
  const base = useId();
  const toast = useToast();
  const [type, setType] = useState<OpenTicketType>("question");
  const [target, setTarget] = useState("site:site");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useStaffAction(openTicket, {
    describe: () => `${C.primary}: ${business}`,
  });

  useEffect(() => {
    if (!open) return;
    setType("question");
    setTarget("site:site");
    setSubject("");
    setBody("");
    setError(null);
    setPending(false);
  }, [open]);

  const subjectOk =
    subject.trim().length > 0 && subject.length <= OPEN_TICKET_SUBJECT_MAX;
  const bodyOk = body.trim().length > 0 && body.length <= OPEN_TICKET_BODY_MAX;
  const ready = subjectOk && bodyOk && !pending;
  const about = targetLabel(targets, target);

  async function submit() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const input: OpenTicketInput = {
        orgId,
        type,
        subject: subject.trim(),
        body: body.trim(),
        ...(target && !target.startsWith("site:") ? { target } : {}),
      };
      const res = await run(input);
      if (res.ok) {
        const href = `/staff/tickets/${res.data.number}`;
        toast.show({
          message: res.data.message,
          action: {
            label: `View ticket #${res.data.number}`,
            onClick: () =>
              navigate ? navigate(href) : window.location.assign(href),
          },
        });
        onClose();
        return;
      }
      if (res.code !== "step_up_needed" && res.code !== "session_ended") {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  const typeLabel = C.types[type];

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title={fillCopy(C.title, { business })}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={pending}
            className="max-sm:w-full"
          >
            {C.safe}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!ready}
            loading={pending}
            loadingLabel={C.working}
            className="max-sm:w-full"
          >
            {C.primary}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 font-hub">
        <p className="text-sm text-hub-ink-muted">
          <span className="font-semibold text-hub-ink">{C.site}:</span>{" "}
          {business}
        </p>
        <RadioCardGroup
          name={`${base}-type`}
          legend={C.type}
          value={type}
          onChange={setType}
          options={OPEN_TICKET_TYPES.map((t) => ({
            value: t,
            title: C.types[t],
          }))}
        />
        <TargetSelect options={targets} value={target} onChange={setTarget} />
        <TextField
          id={`${base}-subject`}
          label={C.subject}
          value={subject}
          maxLength={OPEN_TICKET_SUBJECT_MAX}
          counter={{ value: subject.length, max: OPEN_TICKET_SUBJECT_MAX }}
          onChange={(e) => setSubject(e.currentTarget.value)}
        />
        <TextArea
          id={`${base}-body`}
          label={C.message}
          value={body}
          rows={6}
          maxLength={OPEN_TICKET_BODY_MAX}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
        <p className="text-sm text-hub-ink-muted">{C.label}</p>
        {subjectOk && bodyOk ? (
          <section
            aria-label={fillCopy(C.preview, { business })}
            data-ticket-preview=""
            className="rounded border border-hub-border bg-hub-surface-2 p-4"
          >
            <h3 className="text-sm font-semibold text-hub-ink-muted">
              {fillCopy(C.preview, { business })}
            </h3>
            <p className="mt-2 text-base font-semibold break-words text-hub-ink">
              {subject.trim()}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-hub-ink-muted">
              <Badge tone="role">{C.openedBy}</Badge>
              <span>{typeLabel}</span>
              {about ? <span>· {about}</span> : null}
            </p>
            <MessageBody text={body.trim()} className="mt-3" />
          </section>
        ) : null}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
