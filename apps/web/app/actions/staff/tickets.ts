"use server";
// Ticket actions (13-28 choice 2; STAFF-05, STAFF-08, STAFF-19, STAFF-20; D82, D92, D96, D210,
// D211; T-13-28-01..03). Public POST endpoints: every argument is untrusted. Each action is a
// thin caller of the exact @cds/db function its CLI calls, so the console never drifts from
// the CLI rules:
//   support:reply              -> staffReplyToTicket         (support_reply)
//   support:reply --paid       -> staffMarkPaidService       (support_reply)
//   incident:run link          -> staffLinkTicketToIncident  (incident_run)
//   support:open               -> staffOpenTicket            (support_open; "Opened by CDS",
//                                                             audited support.ticket_opened_by_cds)
//   support:list / support:show -> staffListTickets / staffGetTicket (support_read)
// No step-up (support work is everyday work). runStaffAction re-reads the staff session and
// STAFF_MATRIX before any call; the @cds/db functions check the matrix again and write the
// audit rows. Internal notes stay out of every tenant read in the repository (P12 rowFilter);
// replies with files go through the 13-41 route handler (P13-P20), never this action. Result
// lines mirror the CLIs. Errors are logged by class name only; bodies are never logged.
import { CdsError, NotFound } from "@cds/core";
import {
  isPaidCategory,
  isTicketStatus,
  parseTicketNumber,
  statusLabel,
  type Priority,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import {
  staffGetTicket,
  staffLinkTicketToIncident,
  staffListTickets,
  staffMarkPaidService,
  staffOpenTicket,
  staffReplyToTicket,
  staffSupportLabels,
  type PlatformContext,
  type StaffReplyInput,
  type StaffTicketDetail,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { toActionError } from "../../../lib/action";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
const STAFF_ID_RE = /^[a-z0-9]{15}$/;
const INCIDENT_RE = /^I-[1-9]\d{0,6}$/i;
/** Chokepoint caps are 80 / 5,000; refuse far larger payloads before they get there. */
const MAX_SUBJECT = 400;
const MAX_BODY = 10_000;
const MAX_TARGET = 200;
const MAX_QUERY = 200;
const MAX_CURSOR = 32;
/** Bulk select is one inbox page (50) at most; leave room for two pages. */
const BULK_MAX = 100;
const SEARCH_LIMIT = 5;
const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];
const OPEN_TYPES: readonly TicketType[] = [
  "problem",
  "change",
  "question",
  "billing",
];

const TICKET_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That ticket wasn't found.",
};
const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};

// CLI result lines (support-reply.ts, support-open.ts, incident-run.ts), verbatim where they
// fit a browser.
const INTERNAL_SAVED = "Saved as an internal note. The owner never sees it.";
const CDS_ONLY_UPDATED =
  "Updated. Assignee and priority are CDS-only; nobody was alerted.";

function bad(message: string, field?: string): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function numberOf(raw: unknown): number | null {
  try {
    return parseTicketNumber(raw);
  } catch {
    return null;
  }
}

function alerts(n: number): string {
  return `${n} alert${n === 1 ? "" : "s"} raised`;
}

function tickets(n: number): string {
  return `${n} ticket${n === 1 ? "" : "s"}`;
}

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff tickets] revalidate failed", errorName(err));
  }
}

/** The business name for a result line; best effort (a failed read never fails the write). */
async function businessOf(
  ctx: PlatformContext,
  orgId: string,
  fallback: string,
): Promise<string> {
  try {
    const labels = await staffSupportLabels(ctx, { orgIds: [orgId] });
    return labels.orgs[orgId]?.trim() || fallback;
  } catch (err) {
    console.error("[staff tickets] business name read failed", errorName(err));
    return fallback;
  }
}

/** `me` → the signed-in staff user; `none` / "" unassign; else a staff id. null = refused. */
function assignOf(raw: unknown, me: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "me") return me;
  if (raw === "none" || raw === "") return "none";
  return typeof raw === "string" && STAFF_ID_RE.test(raw) ? raw : null;
}

function optionalText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw.length > max) return null;
  return raw;
}

// ------------------------------------------------------------------ reply (STAFF-08)

export type StaffReplyActionResult = {
  message: string;
  messageId: string | null;
  raised: number;
  statusFrom: TicketStatus;
  statusTo: TicketStatus;
};

/**
 * Public reply or internal note (support:reply). `input` = `{ number, body?, internal?,
 * status?, assign? ("me" | "none" | staff id), priority? }`. An internal note alerts nobody
 * and never reaches the tenant (D96).
 */
export async function staffReplyAction(
  input: unknown,
): Promise<ActionResult<StaffReplyActionResult>> {
  const number = numberOf(own(input, "number"));
  if (number === null) return TICKET_NOT_FOUND;
  const body = optionalText(own(input, "body"), MAX_BODY);
  if (body === null) return bad("That message is too long.", "body");
  const internal = own(input, "internal") === true;
  const status = own(input, "status");
  if (status !== undefined && !isTicketStatus(status)) {
    return bad("Choose a status from the list.", "status");
  }
  const priority = own(input, "priority");
  if (priority !== undefined && !PRIORITIES.includes(priority as Priority)) {
    return bad("Choose a priority from the list.", "priority");
  }
  const result = await runStaffAction("support_reply", {}, async (ctx) => {
    const assign = assignOf(own(input, "assign"), ctx.actor);
    if (assign === null) throw new NotFound("staff member not found");
    const reply: StaffReplyInput = { number, internal };
    if (body !== undefined && body.trim() !== "") reply.body = body;
    if (status !== undefined) reply.status = status;
    if (priority !== undefined) reply.priority = priority as Priority;
    if (assign !== undefined) reply.assign = assign;
    const r = await staffReplyToTicket(ctx, reply);
    const moved = r.statusTo !== r.statusFrom;
    let message: string;
    if (internal) {
      message = moved
        ? `${INTERNAL_SAVED} Status ${statusLabel(r.statusFrom)} → ${statusLabel(r.statusTo)}; ${alerts(r.raised)}.`
        : INTERNAL_SAVED;
    } else if (reply.body === undefined && !moved) {
      message = CDS_ONLY_UPDATED;
    } else {
      const business = await businessOf(ctx, r.orgId, "The owner");
      message = `${reply.body !== undefined ? "Sent" : "Updated"}. ${business} sees it in the hub; ${alerts(r.raised)}.`;
    }
    return {
      message,
      messageId: r.messageId,
      raised: r.raised,
      statusFrom: r.statusFrom,
      statusTo: r.statusTo,
    };
  });
  if (result.ok) refresh();
  return result;
}

// ------------------------------------------------------------------ bulk (D119)

export type StaffBulkFailure = { number: number; message: string };
export type StaffBulkResult = {
  message: string;
  changed: number;
  alerted: number;
  failed: StaffBulkFailure[];
};

/**
 * Bulk assign / priority / status (Inbox bulk bar). `input` = `{ numbers[], assign? |
 * priority? | status? }`, exactly one change. Loops staffReplyToTicket per ticket (each one
 * audited and alerted on its own, as support:reply would) and reports failures per number.
 */
export async function staffBulkAction(
  input: unknown,
): Promise<ActionResult<StaffBulkResult>> {
  const raw = own(input, "numbers");
  if (!Array.isArray(raw) || raw.length === 0) {
    return bad("Select at least one ticket.");
  }
  if (raw.length > BULK_MAX) {
    return bad(`Select at most ${BULK_MAX} tickets at a time.`);
  }
  const assignRaw = own(input, "assign");
  const priority = own(input, "priority");
  const status = own(input, "status");
  const chosen = [assignRaw, priority, status].filter((v) => v !== undefined);
  if (chosen.length !== 1) return bad("Choose one change to apply.");
  if (priority !== undefined && !PRIORITIES.includes(priority as Priority)) {
    return bad("Choose a priority from the list.", "priority");
  }
  if (status !== undefined && !isTicketStatus(status)) {
    return bad("Choose a status from the list.", "status");
  }

  const result = await runStaffAction(
    "support_reply",
    {},
    async (ctx, session) => {
      const assign = assignOf(assignRaw, ctx.actor);
      if (assign === null) throw new NotFound("staff member not found");
      const failed: StaffBulkFailure[] = [];
      const seen = new Set<number>();
      let changed = 0;
      let alerted = 0;
      for (const item of raw) {
        const number = numberOf(item);
        if (number === null) {
          failed.push({ number: 0, message: TICKET_NOT_FOUND.message });
          continue;
        }
        if (seen.has(number)) continue;
        seen.add(number);
        const reply: StaffReplyInput = { number };
        if (assign !== undefined) reply.assign = assign;
        if (priority !== undefined) reply.priority = priority as Priority;
        if (status !== undefined) reply.status = status;
        try {
          const r = await staffReplyToTicket(ctx, reply);
          changed += 1;
          alerted += r.raised;
        } catch (err) {
          if (err instanceof CdsError) {
            failed.push({
              number,
              message:
                err.code === "not_found"
                  ? TICKET_NOT_FOUND.message
                  : toActionError(err).message,
            });
          } else {
            console.error("[staff tickets] bulk item failed", errorName(err));
            failed.push({ number, message: "That change didn't save." });
          }
        }
      }
      let what: string;
      if (assign === "none") what = `${tickets(changed)} unassigned.`;
      else if (assign !== undefined) {
        const who =
          assign === ctx.actor
            ? (session.name.trim().split(/\s+/)[0] ?? "you")
            : "";
        what = who
          ? `${tickets(changed)} assigned to ${who}.`
          : `${tickets(changed)} assigned.`;
      } else if (priority !== undefined) {
        what = `${tickets(changed)} set to ${priority} priority.`;
      } else {
        what = `${tickets(changed)} set to ${statusLabel(status as TicketStatus)}; ${alerts(alerted)}.`;
      }
      const tail =
        failed.length > 0
          ? ` ${failed.length} didn't change: ${failed.map((f) => (f.number ? `#${f.number}` : "unknown")).join(", ")}.`
          : "";
      return { message: `${what}${tail}`, changed, alerted, failed };
    },
  );
  if (result.ok && result.data.changed > 0) refresh();
  return result;
}

// ------------------------------------------------------------------ paid mark, incident

/** Paid-service mark (support:reply --paid): Change requests only; moves to Waiting on you. */
export async function staffMarkPaidAction(
  numberRaw: unknown,
  category: unknown,
): Promise<ActionResult<{ message: string; raised: number }>> {
  const number = numberOf(numberRaw);
  if (number === null) return TICKET_NOT_FOUND;
  if (!isPaidCategory(category)) {
    return bad("Choose a paid-service category.", "category");
  }
  const result = await runStaffAction("support_reply", {}, async (ctx) => {
    const r = await staffMarkPaidService(ctx, { number, category });
    const business = await businessOf(ctx, r.orgId, "The owner");
    return {
      message: `Marked as a paid service. ${business} sees it in the hub; ${alerts(r.raised)}.`,
      raised: r.raised,
    };
  });
  if (result.ok) refresh();
  return result;
}

/** Link to a known problem (incident:run link). No alert; the owner sees the public text. */
export async function staffLinkIncidentAction(
  numberRaw: unknown,
  incidentCode: unknown,
): Promise<ActionResult<{ message: string; linked: boolean; code: string }>> {
  const number = numberOf(numberRaw);
  if (number === null) return TICKET_NOT_FOUND;
  if (typeof incidentCode !== "string" || !INCIDENT_RE.test(incidentCode)) {
    return bad("Choose an open known problem.", "incident");
  }
  const result = await runStaffAction("incident_run", {}, async (ctx) => {
    const r = await staffLinkTicketToIncident(ctx, {
      incident: incidentCode.toUpperCase(),
      number,
    });
    const business = await businessOf(ctx, r.orgId, r.orgId);
    return {
      message: r.linked
        ? `Linked #${r.number} (${business}) to ${r.code}. The owner sees "Linked to a known problem" and the public text.`
        : `#${r.number} (${business}) was already linked to ${r.code}; nothing changed.`,
      linked: r.linked,
      code: r.code,
    };
  });
  if (result.ok && result.data.linked) refresh();
  return result;
}

// ------------------------------------------------------------------ open for a site (D210)

/**
 * Open a ticket on a site's behalf (support:open, D210). `input` = `{ orgId, type: problem |
 * change | question | billing, subject, body, target? ("page:<id>" | "addon:<slug>" |
 * "part:<key>") }`. Shows as "Opened by CDS", already answered for SLA, Owners and Admins
 * alerted, audited `support.ticket_opened_by_cds`. Returns the new number.
 */
export async function staffOpenTicketAction(
  input: unknown,
): Promise<ActionResult<{ number: number; message: string }>> {
  const orgId = own(input, "orgId");
  if (typeof orgId !== "string" || !ORG_RE.test(orgId)) return SITE_NOT_FOUND;
  const type = own(input, "type");
  if (!OPEN_TYPES.includes(type as TicketType)) {
    return bad("Choose Problem, Change, Question or Billing.", "type");
  }
  const subject = own(input, "subject");
  if (typeof subject !== "string" || subject.length > MAX_SUBJECT) {
    return bad("Write a subject of up to 80 characters.", "subject");
  }
  const body = own(input, "body");
  if (typeof body !== "string" || body.length > MAX_BODY) {
    return bad("Tell the owner what this is about.", "body");
  }
  const target = optionalText(own(input, "target"), MAX_TARGET);
  if (target === null) return bad("Choose what this is about.", "target");

  const result = await runStaffAction("support_open", {}, async (ctx) => {
    const opened = await staffOpenTicket(ctx, {
      orgId,
      type: type as TicketType,
      subject,
      body,
      ...(target ? { target } : {}),
      addonNames: Object.fromEntries(
        ADDON_REGISTRY.list().map((m) => [m.slug, m.name]),
      ),
    });
    const business = await businessOf(ctx, orgId, "the site");
    return {
      number: opened.number,
      message: `Ticket #${opened.number} opened for ${business} (Opened by CDS).`,
    };
  });
  if (result.ok) refresh();
  return result;
}

// ------------------------------------------------------------------ search, poll (D211)

export type StaffTicketSearchHit = {
  number: number;
  orgName: string;
  subject: string;
  status: TicketStatus;
  href: string;
};

function hitOf(r: {
  number: number;
  orgName: string;
  subject: string;
  status: TicketStatus;
}): StaffTicketSearchHit {
  return {
    number: r.number,
    orgName: r.orgName,
    subject: r.subject,
    status: r.status,
    href: `/staff/tickets/${r.number}`,
  };
}

/**
 * Find (Ctrl K) and inbox search: up to 5 tickets. `1042` or `#1042` puts that ticket first
 * (any status, Closed included); the rest match the subject (case-insensitive contains).
 */
export async function searchTicketsAction(
  q: unknown,
): Promise<ActionResult<StaffTicketSearchHit[]>> {
  const text = typeof q === "string" ? q.trim().slice(0, MAX_QUERY) : "";
  if (!text) return { ok: true, data: [] };
  return runStaffAction("support_read", {}, async (ctx) => {
    const hits: StaffTicketSearchHit[] = [];
    const number = numberOf(text);
    if (number !== null) {
      try {
        hits.push(hitOf(await staffGetTicket(ctx, number)));
      } catch (err) {
        if (!(err instanceof NotFound)) throw err;
      }
    }
    const needle = text.toLowerCase();
    const rows = await staffListTickets(ctx, { status: "all" });
    for (const r of rows) {
      if (hits.length >= SEARCH_LIMIT) break;
      if (r.number === number) continue;
      if (r.subject.toLowerCase().includes(needle)) hits.push(hitOf(r));
    }
    return hits;
  });
}

export type StaffPollResult = {
  status: TicketStatus;
  /** Messages after the cursor (internal notes included; staff read). */
  messages: StaffTicketDetail["messages"];
  /** The id of the newest message (pass back on the next poll). */
  cursor: string;
  /** The cursor was not found (e.g. a message was removed): `messages` is the full thread. */
  reset: boolean;
};

/**
 * The open ticket's 20 s poll (D-UI-P13-20): new messages since `sinceCursor` (the last
 * message id the client has). An empty cursor returns no messages, only the current cursor.
 */
export async function pollTicketAction(
  numberRaw: unknown,
  sinceCursor: unknown,
): Promise<ActionResult<StaffPollResult>> {
  const number = numberOf(numberRaw);
  if (number === null) return TICKET_NOT_FOUND;
  const since =
    typeof sinceCursor === "string" && sinceCursor.length <= MAX_CURSOR
      ? sinceCursor
      : "";
  return runStaffAction("support_read", {}, async (ctx) => {
    const t = await staffGetTicket(ctx, number);
    const all = t.messages;
    const cursor = all.at(-1)?.id ?? "";
    if (!since) return { status: t.status, messages: [], cursor, reset: false };
    const at = all.findIndex((m) => m.id === since);
    if (at < 0) return { status: t.status, messages: all, cursor, reset: true };
    return {
      status: t.status,
      messages: all.slice(at + 1),
      cursor,
      reset: false,
    };
  });
}
