// Ticket component words and helpers (12-10; 12-UI-SPEC Tickets 355-372, Get help form
// 376-417, detail 421-455). Contract IDs (SLA-LINE, CLOSED-NOTE …) come from SUPPORT_UI_COPY;
// these are the screen words that are not contract IDs. Browser-safe; no @cds/db.
import type {
  TargetRef,
  TenantTicket,
  TicketStatus,
  TicketType,
} from "@cds/core/support";
import type { BadgeTone } from "../../Badge";

export const TICKETS_COPY = Object.freeze({
  /** Type cards fieldset legend (UI-SPEC line 380). */
  typeLegend: "What do you need?",
  /** The suggestion card's name on the form (the list says "Feature idea"). */
  suggestCard: "Suggest a feature",
  targetLabel: "About",
  targetHelper: "Pick the closest. You can explain below.",
  deflectHead: "This might answer it",
  deflectCount: (n: number) =>
    n === 1
      ? "1 help article might answer this"
      : `${n} help articles might answer this`,
  newReply: "New reply",
  newReplySr: "New reply from CDS",
  openedByCds: "Opened by CDS",
  updated: (age: string) => `Updated ${age}`,
  closedEmpty: "No closed tickets.",
  listLabel: "Your tickets",
  meta: {
    status: "Status",
    about: "About",
    type: "Type",
    opened: "Opened",
    lastUpdate: "Last update",
  },
  openedBy: (day: string, who: string) => `${day} by ${who}`,
  firstReplied: (day: string) => `CDS first replied ${day}.`,
});

/** List and rail type words (UI-SPEC line 362: "Problem · Whole site"). */
const SHORT_TYPE: Record<TicketType, string> = {
  problem: "Problem",
  change: "Change request",
  question: "Question",
  billing: "Billing",
  suggestion: "Feature idea",
};

export function ticketTypeShort(t: TicketType): string {
  return SHORT_TYPE[t];
}

/** Status tone map (UI-SPEC lines 178-184): the badge word is the status. */
const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  open: "t-open",
  in_progress: "t-progress",
  waiting_on_you: "t-waiting",
  resolved: "t-resolved",
  closed: "t-closed",
};

export function ticketStatusTone(s: TicketStatus): BadgeTone {
  return STATUS_TONE[s];
}

/** Statuses where the person can still say "This is solved". */
export function canMarkSolved(s: TicketStatus): boolean {
  return s === "open" || s === "in_progress" || s === "waiting_on_you";
}

/** The ticket detail route. */
export function ticketHref(n: number): string {
  return `/hub/support/tickets/${n}`;
}

export const NEW_TICKET_HREF = "/hub/support/tickets/new";

/** `kind:id`, the select's option value and the `?target=` form (validateTarget reads it). */
export function targetValue(t: Pick<TargetRef, "kind" | "id">): string {
  return `${t.kind}:${t.id}`;
}

/** Open a new ticket from a closed one: same target and type, `ref` = the old number. */
export function followUpHref(
  t: Pick<TenantTicket, "number" | "type" | "target">,
): string {
  const q = new URLSearchParams({
    target: targetValue(t.target),
    type: t.type,
    ref: String(t.number),
  });
  return `${NEW_TICKET_HREF}?${q.toString()}`;
}
