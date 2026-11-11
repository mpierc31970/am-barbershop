"use client";
// TicketMeta rail (12-10 choice 5; COMM-09, SUPPORT-02, D95, D-UI-P12-10; 12-UI-SPEC ticket
// detail lines 427-433). A description list: Status (badge) · About · Type · Opened ("9 Oct by
// Maria" / "9 Oct by CDS") · Last update ("2 hours ago"). Problem and Question tickets then show
// SLA-LINE until CDS first replies, and "CDS first replied 10 Oct." after: never a countdown,
// never missed/met wording. "This is solved" (secondary, CircleCheck 16) only while the ticket
// is Open / In progress / Waiting on you and the person can write. ≥ 1024px it is the 360px
// sticky rail; below, the page renders it above the thread (2 columns ≥ 640px).
import { statusLabel, type TenantTicket } from "@cds/core/support";
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../Badge";
import { Button } from "../../Button";
import { formatDayMonth, relativeAge } from "../../today/copy";
import { SUPPORT_UI_COPY } from "../copy";
import {
  TICKETS_COPY,
  canMarkSolved,
  ticketStatusTone,
  ticketTypeShort,
} from "./copy";

export interface TicketMetaProps {
  ticket: TenantTicket;
  /** First name of the member who opened it; ignored when `ticket.openedByCds`. */
  openedBy?: string | null;
  /** Time of CDS's first public reply, or null before it. */
  firstReplyAt: string | null;
  /** Can write support (not Viewer, not impersonating). */
  canWrite: boolean;
  onSolved: () => void;
  /** Marking solved is in flight. */
  solving?: boolean;
  timeZone: string;
  now: number;
}

export function TicketMeta({
  ticket,
  openedBy,
  firstReplyAt,
  canWrite,
  onSolved,
  solving = false,
  timeZone,
  now,
}: TicketMetaProps) {
  const who = ticket.openedByCds ? "CDS" : openedBy?.trim() || "";
  const openedDay = formatDayMonth(ticket.created, timeZone);
  const opened = who ? TICKETS_COPY.openedBy(openedDay, who) : openedDay;
  const slaType = ticket.type === "problem" || ticket.type === "question";
  const repliedDay = firstReplyAt ? formatDayMonth(firstReplyAt, timeZone) : "";
  const rows: { term: string; detail: ReactNode }[] = [
    {
      term: TICKETS_COPY.meta.status,
      detail: (
        <Badge tone={ticketStatusTone(ticket.status)}>
          {statusLabel(ticket.status)}
        </Badge>
      ),
    },
    { term: TICKETS_COPY.meta.about, detail: ticket.target.label },
    { term: TICKETS_COPY.meta.type, detail: ticketTypeShort(ticket.type) },
    { term: TICKETS_COPY.meta.opened, detail: opened },
    {
      term: TICKETS_COPY.meta.lastUpdate,
      detail: relativeAge(ticket.lastActivityAt, now),
    },
  ];

  return (
    <aside
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink lg:sticky lg:top-20"
      data-ticket-meta=""
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {rows.map((r) => (
          <div key={r.term} className="flex flex-col gap-1">
            <dt className="text-sm text-hub-ink-muted">{r.term}</dt>
            <dd className="text-base">{r.detail}</dd>
          </div>
        ))}
      </dl>
      {slaType ? (
        firstReplyAt && repliedDay ? (
          <p className="text-sm text-hub-ink-muted">
            {TICKETS_COPY.firstReplied(repliedDay)}
          </p>
        ) : !firstReplyAt ? (
          <p className="text-sm">{SUPPORT_UI_COPY.SLA_LINE}</p>
        ) : null
      ) : null}
      {canWrite && canMarkSolved(ticket.status) ? (
        <Button
          variant="secondary"
          className="self-start"
          icon={<CircleCheck aria-hidden size={16} strokeWidth={2} />}
          loading={solving}
          onClick={onSolved}
        >
          {SUPPORT_UI_COPY.BUTTONS.thisIsSolved}
        </Button>
      ) : null}
    </aside>
  );
}
