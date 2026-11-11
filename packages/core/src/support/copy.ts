// SUPPORT_COPY (P12): the CONTEXT copy anchors verbatim plus labels and email subjects the hub,
// the db layer, the CLIs and the job share. UI-SPEC Copywriting Contract lines 757-824.
// Screen-only copy lives in @cds/ui/hub/support/copy (12-06).
import type { PaidCategory, TicketStatus, TicketType } from "./types";

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_you: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

/** Card names (UI-SPEC lines 383-387); `suggestion` is "Feature idea" in lists. */
const TYPE_LABELS: Record<TicketType, string> = {
  problem: "Something isn't working",
  change: "Change request",
  question: "Question",
  billing: "Billing",
  suggestion: "Feature idea",
};

/** One-line card descriptions (UI-SPEC lines 383-387). */
const TYPE_HINTS: Record<TicketType, string> = {
  problem: "A page, form or feature is broken or looks wrong.",
  change: "Ask Support to change something on your site.",
  question: "Ask how to do something.",
  billing: "A question about your bill or plan.",
  suggestion: "An idea for something Support could build.",
};

const PAID_CATEGORY_LABELS: Record<PaidCategory, string> = {
  copywriting: "Copywriting",
  design: "Design changes",
  page_building: "Page building",
  product_entry: "Product entry",
  newsletters: "Newsletters",
  photos: "Photos",
  logos: "Logos",
  seo: "SEO",
  custom: "Custom work",
};

export const SUPPORT_COPY = {
  /** SLA-LINE (CONTEXT anchor, verbatim). */
  SLA_LINE: "Support replies within 2 business days.",
  /** PAID-RULE (CONTEXT anchor, verbatim). */
  PAID_RULE:
    "Things you can do in your dashboard are yours; we'll show you how. Doing it for you is a paid service.",
  PAID_ASK_OWNER: "Ask your site owner. Only they can choose a paid option.",
  /** NO-REPLY-FOOTER (CONTEXT anchor, verbatim). */
  NO_REPLY_FOOTER: "Replies to this email aren't read. Reply in your hub.",
  /** CLOSED-NOTE (CONTEXT anchor, verbatim). */
  CLOSED_NOTE: "This ticket is closed. Open a new one.",
  /**
   * Refusals the ticket rules throw as InvalidInput. toActionError shows an invalid_input
   * message word for word, so each is UI copy, never a developer string (WR-B02).
   */
  ALREADY_RESOLVED: "This ticket is already resolved.",
  UNDO_TOO_LATE: "It's too late to undo. Reply to reopen it.",
  NOTHING_TO_UNDO:
    "There's nothing to undo. Reload the page to see the latest.",
  TARGET_UNKNOWN: "Choose what this is about from the list.",
  STATUS_NOT_ALLOWED:
    "That status change isn't allowed. Reload the page to see the latest.",
  PAID_BLOCKS_PROGRESS:
    "This is a paid service. Work can't start until the owner accepts a quote or chooses a Care hour.",
  RESOLVED_NOTE:
    "Support marked this resolved. If it isn't, reply and it reopens. It closes by itself after 7 days.",
  /** IDEA-PUBLIC (CONTEXT anchor, verbatim). */
  IDEA_PUBLIC: "Every site can see this idea, without your business name.",
  /** HELD-KEPT (CONTEXT anchor, verbatim). */
  HELD_KEPT:
    "Your unsaved changes are kept. You can apply them when Support is done.",
  /** NOTICE-ACTIVE template: {target} {end} {message}. */
  NOTICE_ACTIVE: "Support is working on {target} until {end}. {message}",
  /** NOTICE-PLANNED template: {target} {when} {message}. */
  NOTICE_PLANNED: "Planned work on {target} {when}. {message}",
  STATUS_LABELS,
  TYPE_LABELS,
  TYPE_HINTS,
  PAID_CATEGORY_LABELS,
} as const;

export function statusLabel(s: TicketStatus): string {
  return STATUS_LABELS[s];
}

export function typeLabel(t: TicketType): string {
  return TYPE_LABELS[t];
}

/** Email subject when CDS replies on a ticket: "CDS replied to ticket #1042". */
export function replySubject(n: number): string {
  return `Support replied to ticket #${n}`;
}

/** Email subject on a status change: "Ticket #1042 is now Waiting on you". */
export function statusSubject(n: number, status: TicketStatus): string {
  return `Ticket #${n} is now ${STATUS_LABELS[status]}`;
}

/**
 * Fill every `{name}` placeholder in one pass with a replacer function (WR-B03): the values
 * are tenant page titles and staff messages, so they are never re-scanned for placeholders
 * and `$&`-style patterns stay literal.
 */
function fillTemplate(tpl: string, vals: Record<string, string>): string {
  return tpl
    .replace(/\{(\w+)\}/g, (m, k: string) =>
      Object.hasOwn(vals, k) ? vals[k]! : m,
    )
    .trim();
}

/** Fill NOTICE-ACTIVE; an empty message leaves no trailing space. */
export function noticeActiveText(
  target: string,
  end: string,
  message: string,
): string {
  return fillTemplate(SUPPORT_COPY.NOTICE_ACTIVE, {
    target,
    end,
    message: message.trim(),
  });
}

/** Fill NOTICE-PLANNED; an empty message leaves no trailing space. */
export function noticePlannedText(
  target: string,
  when: string,
  message: string,
): string {
  return fillTemplate(SUPPORT_COPY.NOTICE_PLANNED, {
    target,
    when,
    message: message.trim(),
  });
}
