// Staff ticket words (13-35; STAFF-05, STAFF-08, STAFF-20; 13-UI-SPEC "Ticket inbox", "Ticket
// detail", D-UI-P13-17). The inbox, header strip, rail and staff thread vocabulary in one place.
// Copy IDs (INBOX-EMPTY, INTERNAL-LINE, bulk status dialog) stay in P13_COPY / P13_DIALOGS
// (@cds/core/staff); P11/P12 copy (ERR-SAVE, ERR-LOAD) stays in SUPPORT_UI_COPY. Browser-safe.
import type { TicketStatus } from "@cds/core/support";

/** Staff words for a ticket status: Waiting on you reads "Waiting on owner" (D-UI-P13-17). */
export const STAFF_TICKET_STATUS_LABELS: Readonly<
  Record<TicketStatus, string>
> = Object.freeze({
  open: "Open",
  in_progress: "In progress",
  waiting_on_you: "Waiting on owner",
  resolved: "Resolved",
  closed: "Closed",
});

export function staffStatusLabel(s: TicketStatus): string {
  return STAFF_TICKET_STATUS_LABELS[s];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const STAFF_TICKETS_COPY = {
  caption: "Tickets, sorted by SLA urgency",
  captionBy: {
    sla: "Tickets, sorted by SLA urgency",
    priority: "Tickets, sorted by priority",
    age: "Tickets, oldest first",
  },
  cols: {
    number: "#",
    site: "Site",
    type: "Type",
    subject: "Subject",
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    age: "Age",
    sla: "SLA",
    ticket: "Ticket",
  },
  quickLabel: "Quick filters",
  quick: {
    mine: "Mine",
    unassigned: "Unassigned",
    "at-risk": "At risk",
    waiting: "Waiting on CDS",
    all: "All open",
  },
  search: "Search",
  searchHelper: "Ticket number or subject",
  filters: {
    type: "Type",
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    org: "Site",
  },
  statusAll: "All, Closed included",
  filterEmpty: "No tickets match these filters.",
  showMore: "Show 50 more",
  resultLine: (total: number, atRisk: number, missed: number) =>
    `${plural(total, "ticket")} · ${atRisk} at risk · ${missed} missed`,
  newRows: (n: number) => plural(n, "new ticket"),
  newBadge: "New",
  unassigned: "Unassigned",
  none: "—",
  me: (first: string) => (first ? `Me (${first})` : "Me"),
  // Bulk bar
  selected: (n: number) => `${n} selected`,
  bulkLabel: "Bulk changes",
  bulkAssign: "Assign to",
  bulkPriority: "Priority",
  bulkStatus: "Status",
  choose: "Choose…",
  clearSelection: "Clear selection",
  undone: "Undone. Each ticket is back as it was.",
  // Header strip
  openedByCds: "Opened by CDS",
  openedBy: (name: string, day: string) =>
    day ? `Opened by ${name} ${day}` : `Opened by ${name}`,
  openAsAdmin: "Open as admin",
  openOwnPage: "Open on its own page",
  closeSplit: "Close ticket",
  backToInbox: "Back to the inbox",
  notFoundUnknown: "No ticket.",
  notFound: (n: string) => `No ticket ${n.startsWith("#") ? n : `#${n}`}.`,
  ticketRef: (n: number) => `#${n}`,
  targetKind: {
    site: "Whole site",
    page: "Page",
    addon: "Add-on",
    part: "Site part",
  },
  paidLine: (label: string) => `Paid service · ${label}`,
  viewQuote: "View quote",
  openIncident: (code: string) => `Open ${code}`,
  // Rail
  rail: {
    heading: "Ticket details",
    status: "Status",
    assignee: "Assignee",
    assignMe: "Assign to me",
    priority: "Priority",
    paid: "Paid service",
    notPaid: "Not paid",
    paidChangeOnly: "Change requests only",
    incident: "Link to incident",
    noIncident: "Not linked",
    newIncident: "Open a new incident",
    site: "Site",
    opened: "Opened",
    firstReply: "First CDS reply",
    slaDue: "SLA due",
    context: "Context",
    ticketId: "Ticket id",
    saved: "Saved",
    saving: "Saving…",
  },
  statusDialog: {
    title: (n: number, status: string) => `Set #${n} to ${status}?`,
    body: "The site's Owners and Admins get an alert.",
    confirm: "Set status",
    safe: "Keep as is",
  },
  /** sr-only prefix of a staff-only system line (the EyeOff icon carries it visually). */
  staffOnlyLine: "Only CDS sees this:",
  threadLabel: "Messages, internal notes included",
  newMessages: (n: number) => `${plural(n, "new message")}`,
  /** Reason prefill for Open as admin (UI-SPEC "Open as admin from a ticket"). */
  adminReason: (n: number) => `Ticket #${n}`,
} as const;
