"use client";
// SiteTicketsTable (13-33 choice 3; STAFF-02; 13-UI-SPEC site detail "Support" line 790): the
// Inbox columns for one site, most urgent first (the @cds/db order): # (link to
// /staff/tickets/<n>) · Subject · Type · Status (staff word "Waiting on owner") · Priority ·
// SLA · Assignee. Subjects are tenant text and stay React text.
import type {
  Priority,
  SlaState,
  TicketStatus,
  TicketType,
} from "@cds/core/support";
import { Badge } from "../../hub/Badge";
import {
  ticketStatusTone,
  ticketTypeShort,
} from "../../hub/support/tickets/copy";
import { useShortcutsEnabled } from "../shell";
import { PriorityCell, SlaCell, StaffTable, type StaffColumn } from "../table";
import { SITES_COPY as C } from "./copy";

export interface SiteTicketRowView {
  number: number;
  subject: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  sla: SlaState;
  dueAt: string | null;
  assignee: string | null;
}

export interface SiteTicketsTableProps {
  rows: readonly SiteTicketRowView[];
  /** ISO time of the read (SLA reference). */
  now: string;
}

const STAFF_STATUS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_you: "Waiting on owner",
  resolved: "Resolved",
  closed: "Closed",
};

export function SiteTicketsTable({ rows, now }: SiteTicketsTableProps) {
  const [shortcuts] = useShortcutsEnabled();
  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">
        {C.tickets.empty}
      </p>
    );
  }
  const at = new Date(now);
  const ref = Number.isNaN(at.getTime()) ? new Date() : at;
  const T = C.tickets.cols;
  const columns: StaffColumn<SiteTicketRowView>[] = [
    {
      id: "number",
      header: T.number,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "80px",
      cell: (r) => `#${r.number}`,
    },
    {
      id: "subject",
      header: T.subject,
      priority: 1,
      stack: true,
      cell: (r) => r.subject,
    },
    {
      id: "type",
      header: T.type,
      priority: 3,
      cell: (r) => ticketTypeShort(r.type),
    },
    {
      id: "status",
      header: T.status,
      priority: 1,
      stack: true,
      nowrap: true,
      cell: (r) => (
        <Badge tone={ticketStatusTone(r.status)}>
          {STAFF_STATUS[r.status]}
        </Badge>
      ),
    },
    {
      id: "priority",
      header: T.priority,
      priority: 3,
      cell: (r) => <PriorityCell priority={r.priority} />,
    },
    {
      id: "sla",
      header: T.sla,
      priority: 2,
      nowrap: true,
      cell: (r) => <SlaCell state={r.sla} dueAt={r.dueAt} now={ref} />,
    },
    {
      id: "assignee",
      header: T.assignee,
      priority: 4,
      cell: (r) => r.assignee ?? C.tickets.unassigned,
    },
  ];
  return (
    <StaffTable
      caption={C.tickets.caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => String(r.number)}
      rowLabel={(r) => `#${r.number}`}
      rowAnnouncement={(r) =>
        `#${r.number}, ${r.subject}, ${STAFF_STATUS[r.status]}`
      }
      primaryHref={(r) => `/staff/tickets/${r.number}`}
      shortcutsEnabled={shortcuts}
    />
  );
}
