// Inbox URL params (13-28 choice 1; STAFF-05, STAFF-20; D82, D92, D211; T-13-28-02). Pure and
// browser-safe. Every inbox filter is a URL param, so a filtered view is a link:
//   ?type=&status=&priority=&assignee=&org=&quick=&sla=&q=&sort=&page=
// Parsing maps untrusted strings onto closed enums and drops anything unknown (never throws).
// `toStaffListInput` turns the params into the @cds/db `staffListTickets` input plus the
// refinements that function does not filter on (number, subject, priority, assignee, waiting
// on CDS) and the sort; `refineInboxRows` applies them to the returned rows.
import { parseTicketNumber } from "../support/numbers";
import { isTicketStatus } from "../support/transitions";
import type { SlaState } from "../support/sla";
import {
  TICKET_TYPES,
  type Priority,
  type TicketStatus,
  type TicketType,
} from "../support/types";

/** Saved quick filters (UI-SPEC: Mine · Unassigned · At risk · Waiting on CDS; none = All open). */
export const QUICK_FILTERS = [
  "mine",
  "unassigned",
  "at-risk",
  "waiting",
] as const;
export type InboxQuickFilter = (typeof QUICK_FILTERS)[number];

export const INBOX_SORTS = ["sla", "priority", "age"] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

export const INBOX_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const INBOX_SLA_FILTERS = ["at-risk", "missed"] as const;
export type InboxSlaFilter = (typeof INBOX_SLA_FILTERS)[number];

/** Status param: a ticket status, or `all` (Closed included). Absent = everything but Closed. */
export type InboxStatusParam = TicketStatus | "all";

/** Rows per inbox page (UI-SPEC: 50, "Show 50 more"). */
export const INBOX_PAGE_SIZE = 50;
export const INBOX_PAGE_MAX = 100;
/** Search text cap (a subject is 80; longer input is cut, never refused). */
export const INBOX_Q_MAX = 200;

export type InboxParams = {
  type?: TicketType;
  status?: InboxStatusParam;
  priority?: Priority;
  /** `me`, `none` (unassigned) or a staff user id. */
  assignee?: string;
  org?: string;
  quick?: InboxQuickFilter;
  sla?: InboxSlaFilter;
  q?: string;
  sort?: InboxSort;
  page?: number;
};

/** URLSearchParams, or the Next.js `searchParams` record (arrays take the first value). */
export type InboxSearchInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

const ID_RE = /^[a-z0-9]{15}$/;
/** Serialization order (stable, so a link reads the same every time). */
const KEYS = [
  "type",
  "status",
  "priority",
  "assignee",
  "org",
  "quick",
  "sla",
  "q",
  "sort",
  "page",
] as const;

function read(input: InboxSearchInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  if (!Object.prototype.hasOwnProperty.call(input, key)) return undefined;
  const v = input[key];
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === "string" ? first : undefined;
}

function oneOf<T extends string>(
  list: readonly T[],
  v: string | undefined,
): T | undefined {
  return v !== undefined && (list as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

/** Parse untrusted URL params; unknown or malformed values are dropped. */
export function parseInboxParams(input: InboxSearchInput): InboxParams {
  const out: InboxParams = {};
  const type = oneOf(TICKET_TYPES, read(input, "type"));
  if (type) out.type = type;
  const status = read(input, "status");
  if (status === "all" || isTicketStatus(status)) out.status = status;
  const priority = oneOf(INBOX_PRIORITIES, read(input, "priority"));
  if (priority) out.priority = priority;
  const assignee = read(input, "assignee");
  if (
    assignee === "me" ||
    assignee === "none" ||
    (assignee && ID_RE.test(assignee))
  ) {
    out.assignee = assignee;
  }
  const org = read(input, "org");
  if (org && ID_RE.test(org)) out.org = org;
  const quick = oneOf(QUICK_FILTERS, read(input, "quick"));
  if (quick) out.quick = quick;
  const sla = oneOf(INBOX_SLA_FILTERS, read(input, "sla"));
  if (sla) out.sla = sla;
  const q = (read(input, "q") ?? "").trim().slice(0, INBOX_Q_MAX).trim();
  if (q) out.q = q;
  const sort = oneOf(INBOX_SORTS, read(input, "sort"));
  // The default sort is not written to the URL.
  if (sort && sort !== "sla") out.sort = sort;
  const page = read(input, "page");
  if (page && /^[1-9]\d{0,2}$/.test(page)) {
    const n = Number(page);
    if (n > 1 && n <= INBOX_PAGE_MAX) out.page = n;
  }
  return out;
}

/** Params → query string without the leading "?" ("" when nothing is set). Round-trips. */
export function inboxParamsToSearch(p: InboxParams): string {
  const sp = new URLSearchParams();
  for (const key of KEYS) {
    const v = p[key];
    if (v === undefined || v === "") continue;
    if (key === "sort" && v === "sla") continue;
    if (key === "page" && v === 1) continue;
    sp.set(key, String(v));
  }
  return sp.toString();
}

/** True when any filter (not sort or page) is set: shows "Clear filters". */
export function hasInboxFilters(p: InboxParams): boolean {
  return (
    p.type !== undefined ||
    p.status !== undefined ||
    p.priority !== undefined ||
    p.assignee !== undefined ||
    p.org !== undefined ||
    p.quick !== undefined ||
    p.sla !== undefined ||
    p.q !== undefined
  );
}

/** Structural mirror of the @cds/db `StaffListInput` (core never imports @cds/db). */
export type InboxListInput = {
  orgId?: string;
  status?: TicketStatus | "active" | "all";
  type?: TicketType;
  sla?: InboxSlaFilter;
};

export type InboxQuery = {
  /** Pass straight to `staffListTickets`. */
  list: InboxListInput;
  /** `q` was a ticket number (1042 or #1042): only that ticket. */
  number?: number;
  /** `q` otherwise: subject contains (case-insensitive). */
  subject?: string;
  priority?: Priority;
  /** A staff id, or null for unassigned. Absent = anyone. */
  assigneeId?: string | null;
  /** Waiting on CDS: Open or In progress. */
  waiting?: boolean;
  sort: InboxSort;
  page: number;
};

/**
 * Params → list input + refinements. `me` is the signed-in staff user's id. A quick filter
 * wins over the matching explicit filter. A ticket-number search looks across every status
 * (Closed included), so `#1042` always finds that ticket.
 */
export function toStaffListInput(p: InboxParams, me: string): InboxQuery {
  const list: InboxListInput = {};
  const query: InboxQuery = { list, sort: p.sort ?? "sla", page: p.page ?? 1 };
  if (p.org) list.orgId = p.org;
  if (p.type) list.type = p.type;
  if (p.status) list.status = p.status;
  if (p.sla) list.sla = p.sla;
  if (p.priority) query.priority = p.priority;
  if (p.assignee === "me") query.assigneeId = me;
  else if (p.assignee === "none") query.assigneeId = null;
  else if (p.assignee) query.assigneeId = p.assignee;

  switch (p.quick) {
    case "mine":
      query.assigneeId = me;
      break;
    case "unassigned":
      query.assigneeId = null;
      break;
    case "at-risk":
      list.sla = "at-risk";
      break;
    case "waiting":
      query.waiting = true;
      if (list.status === "all") delete list.status;
      break;
    default:
      break;
  }

  if (p.q) {
    let number: number | null = null;
    try {
      number = parseTicketNumber(p.q);
    } catch {
      number = null;
    }
    if (number !== null) {
      query.number = number;
      list.status = "all";
    } else {
      query.subject = p.q.toLowerCase();
    }
  }
  return query;
}

/** The fields `refineInboxRows` reads (the @cds/db `StaffTicketRow` satisfies it). */
export type InboxRowLike = {
  number: number;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  assigneeId: string | null;
  ageMs: number;
  sla: SlaState;
};

const SLA_RANK: Record<SlaState, number> = {
  missed: 0,
  due_soon: 1,
  on_track: 2,
  met: 3,
  none: 3,
};
const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Order two rows: sla = SLA urgency, priority, age; priority = priority, SLA, age; age = oldest. */
export function compareInboxRows(
  a: InboxRowLike,
  b: InboxRowLike,
  sort: InboxSort = "sla",
): number {
  const sla = SLA_RANK[a.sla] - SLA_RANK[b.sla];
  const pri = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const age = b.ageMs - a.ageMs;
  const tie = a.number - b.number;
  if (sort === "priority") return pri || sla || age || tie;
  if (sort === "age") return age || tie;
  return sla || pri || age || tie;
}

/** Apply the refinements and the sort (all pages; slice with `inboxPage`). */
export function refineInboxRows<R extends InboxRowLike>(
  rows: readonly R[],
  query: InboxQuery,
): R[] {
  const out = rows.filter((r) => {
    if (query.number !== undefined && r.number !== query.number) return false;
    if (
      query.subject !== undefined &&
      !r.subject.toLowerCase().includes(query.subject)
    ) {
      return false;
    }
    if (query.priority !== undefined && r.priority !== query.priority) {
      return false;
    }
    if (query.assigneeId !== undefined && r.assigneeId !== query.assigneeId) {
      return false;
    }
    if (query.waiting && r.status !== "open" && r.status !== "in_progress") {
      return false;
    }
    return true;
  });
  return out.sort((a, b) => compareInboxRows(a, b, query.sort));
}

/** Rows shown for `page` (1-based, cumulative: page 2 shows 100 rows, "Show 50 more"). */
export function inboxPage<R>(rows: readonly R[], page: number): R[] {
  const n = Math.min(Math.max(1, Math.floor(page) || 1), INBOX_PAGE_MAX);
  return rows.slice(0, n * INBOX_PAGE_SIZE);
}
