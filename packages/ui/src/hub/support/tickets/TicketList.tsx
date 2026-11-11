// TicketList (12-10 choice 2; COMM-06, COMM-09; 12-UI-SPEC Tickets lines 355-372, tone map
// 174-190). A <ul> with 1px dividers; each row is ONE link to the ticket: line 1 "#1042" ·
// subject · New reply (sr "New reply from CDS") · status badge, line 2 "Problem · Whole site ·
// Updated 2 hours ago" (+ " · Opened by CDS", D210). The server sorts (Waiting on you first,
// then newest activity); this keeps its order and only applies the Open/Closed/All filter.
// Server-safe: no hooks. Every cell is React text.
import type { TenantTicket } from "@cds/core/support";
import { statusLabel } from "@cds/core/support";
import type { HubLinkComponent } from "../../AddonCard";
import { Badge } from "../../Badge";
import { EmptyState } from "../../feedback";
import { relativeAge } from "../../today/copy";
import { SUPPORT_UI_COPY } from "../copy";
import {
  NEW_TICKET_HREF,
  TICKETS_COPY,
  ticketHref,
  ticketStatusTone,
  ticketTypeShort,
} from "./copy";

export type TicketListShow = "open" | "closed" | "all";

export interface TicketListProps {
  tickets: readonly TenantTicket[];
  /** `?show=` (default Open = every status except Closed). */
  show: TicketListShow;
  /** "Updated 2 hours ago" is decided against this instant (server's, so SSR agrees). */
  now: number;
  LinkComponent?: HubLinkComponent;
  /** Get help link in the empty state. */
  newTicketHref?: string;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function filterTickets(
  tickets: readonly TenantTicket[],
  show: TicketListShow,
): TenantTicket[] {
  if (show === "all") return [...tickets];
  return tickets.filter((t) =>
    show === "closed" ? t.status === "closed" : t.status !== "closed",
  );
}

/** Line 2: "Problem · Whole site · Updated 2 hours ago" (+ " · Opened by CDS"). */
export function ticketSubline(t: TenantTicket, now: number): string {
  const parts = [ticketTypeShort(t.type), t.target.label];
  const age = relativeAge(t.lastActivityAt, now);
  if (age) parts.push(TICKETS_COPY.updated(age));
  if (t.openedByCds) parts.push(TICKETS_COPY.openedByCds);
  return parts.join(" · ");
}

export function TicketList({
  tickets,
  show,
  now,
  LinkComponent,
  newTicketHref = NEW_TICKET_HREF,
}: TicketListProps) {
  const Link = LinkComponent ?? "a";
  const rows = filterTickets(tickets, show);

  if (rows.length === 0) {
    if (show === "closed") {
      return (
        <p className="font-hub text-base text-hub-ink-muted">
          {TICKETS_COPY.closedEmpty}
        </p>
      );
    }
    return (
      <EmptyState
        heading={SUPPORT_UI_COPY.TICKETS_EMPTY_H}
        body={
          <>
            {SUPPORT_UI_COPY.TICKETS_EMPTY_B}{" "}
            <Link href={newTicketHref} className={LINK}>
              {SUPPORT_UI_COPY.BUTTONS.getHelp}
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <ul
      aria-label={TICKETS_COPY.listLabel}
      className="flex flex-col divide-y divide-hub-border border-y border-hub-border font-hub"
      data-ticket-list=""
    >
      {rows.map((t) => (
        <li key={t.id}>
          <Link
            href={ticketHref(t.number)}
            data-ticket-row={t.number}
            className={
              "flex min-h-[72px] flex-col justify-center gap-1 px-2 py-4 text-hub-ink " +
              "transition-colors duration-150 hover:bg-hub-surface-2 " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            }
          >
            <span className="flex items-start gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                #{t.number}
              </span>
              <span className="min-w-0 flex-1 line-clamp-1 text-base font-semibold sm:line-clamp-2">
                {t.subject}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {t.unread ? (
                  <Badge tone="unread">
                    <span aria-hidden="true">{TICKETS_COPY.newReply}</span>
                    <span className="sr-only">{TICKETS_COPY.newReplySr}</span>
                  </Badge>
                ) : null}
                <Badge tone={ticketStatusTone(t.status)}>
                  {statusLabel(t.status)}
                </Badge>
              </span>
            </span>
            <span className="text-sm text-hub-ink-muted">
              {ticketSubline(t, now)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
