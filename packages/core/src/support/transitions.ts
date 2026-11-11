// Ticket lifecycle (D95, COMM-09, SUPPORT-03): one pure table decides every status move, for
// the tenant, staff and the job alike. Closed is final. Started from RESEARCH "Transition table
// (pure)"; adds undo_solved (P12-P9) and the paid-service guard (T-12-03-03).
import { InvalidInput } from "../errors";
import { SUPPORT_COPY, statusLabel } from "./copy";
import { paidBlocksProgress } from "./paid";
import type { PaidService, TicketStatus } from "./types";

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_you",
  "resolved",
  "closed",
] as const satisfies readonly TicketStatus[];

export const TICKET_EVENTS = [
  "staff_set",
  "tenant_reply",
  "tenant_solved",
  "undo_solved",
  "auto_close",
] as const;
export type TicketEvent = (typeof TICKET_EVENTS)[number];

/** System-line labels posted with a move (the thread shows them as events). */
export const SYSTEM_EVENTS = {
  BACK_TO_CDS: "Back to Support",
  REOPENED: "Reopened by your reply",
  AUTO_CLOSED: "Closed after 7 days with no reply",
  SOLVED: "Marked as solved",
} as const;

export function isTicketStatus(v: unknown): v is TicketStatus {
  return (
    typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * The status after `ev`. `to` is the staff target for `staff_set`, and the stored previous
 * status for `undo_solved`. Throws InvalidInput for every move the table does not allow; the
 * message is UI copy (SUPPORT_COPY), since tenant actions show it word for word (WR-B02).
 */
export function nextStatus(
  from: TicketStatus,
  ev: TicketEvent,
  to?: TicketStatus,
  opts: { paid?: PaidService | null } = {},
): TicketStatus {
  if (from === "closed") throw new InvalidInput(SUPPORT_COPY.CLOSED_NOTE);
  switch (ev) {
    case "tenant_reply":
      if (from !== "waiting_on_you" && from !== "resolved") return from;
      // A paid service still waits on the owner's choice: a reply never starts the work.
      return paidBlocksProgress(opts.paid) ? "waiting_on_you" : "in_progress";
    case "tenant_solved":
      if (from === "resolved")
        throw new InvalidInput(SUPPORT_COPY.ALREADY_RESOLVED);
      return "resolved";
    case "undo_solved":
      if (from !== "resolved")
        throw new InvalidInput(SUPPORT_COPY.NOTHING_TO_UNDO);
      if (!to || to === "resolved" || to === "closed" || !isTicketStatus(to)) {
        throw new InvalidInput(SUPPORT_COPY.NOTHING_TO_UNDO);
      }
      return to;
    case "auto_close":
      if (from !== "resolved") {
        throw new InvalidInput(SUPPORT_COPY.STATUS_NOT_ALLOWED);
      }
      return "closed";
    case "staff_set":
      if (!to || !isTicketStatus(to) || to === "open" || to === from) {
        throw new InvalidInput(SUPPORT_COPY.STATUS_NOT_ALLOWED);
      }
      if (to === "in_progress" && paidBlocksProgress(opts.paid)) {
        throw new InvalidInput(SUPPORT_COPY.PAID_BLOCKS_PROGRESS);
      }
      return to;
    default: {
      const never: never = ev;
      void never;
      throw new InvalidInput(SUPPORT_COPY.STATUS_NOT_ALLOWED);
    }
  }
}

/** The system line for a move, or null when nothing moved or the move is an undo. */
export function systemLineFor(
  from: TicketStatus,
  to: TicketStatus,
  ev: TicketEvent,
): string | null {
  if (from === to) return null;
  switch (ev) {
    case "tenant_reply":
      return from === "resolved"
        ? SYSTEM_EVENTS.REOPENED
        : SYSTEM_EVENTS.BACK_TO_CDS;
    case "tenant_solved":
      return SYSTEM_EVENTS.SOLVED;
    case "auto_close":
      return SYSTEM_EVENTS.AUTO_CLOSED;
    case "undo_solved":
      return null;
    case "staff_set":
      return `Support changed the status to ${statusLabel(to)}`;
    default:
      return null;
  }
}
