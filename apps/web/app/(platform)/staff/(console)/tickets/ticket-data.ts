// Server-side ticket shaping for the console (13-35 choice 3; STAFF-05, STAFF-08). Shared by the
// inbox panel (split pane) and /staff/tickets/<number>: the caller reads the ticket with
// staffGetTicket (the support:show read) and this maps it into the client views, plus the
// rail's options:
//   - staff options: the signed-in staff member and every assignee seen on any ticket
//     (staffListTickets status all; there is no staff roster read in P13 before 13-46);
//   - incidents: staffListIncidents (resolved included, to name the linked code), only when
//     the role has incident_run; a failed read leaves the control out.
//   - composer (13-41 choice 6): canned replies (staffListCanned) and the placeholder values
//     (staffCannedVarsFor), only with support_reply and never on a Closed ticket; a failed read
//     falls back to no canned replies and values taken from the ticket.
// Every failed side read logs the class name only and degrades; the ticket read itself is
// the caller's. Server-only by use (imports @cds/db).
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  SUPPORT_COPY,
  isPaidCategory,
  parseTicketNumber,
  type IncidentView,
} from "@cds/core/support";
import type { CannedVars } from "@cds/core/staff";
import {
  staffCannedVarsFor,
  staffListCanned,
  staffListIncidents,
  staffListTickets,
  type StaffIncidentRow,
  type StaffTicketDetail,
  type StaffTicketRow,
} from "@cds/db";
import type {
  CannedOption,
  IncidentOption,
  StaffComposerTicket,
  StaffOption,
  StaffThreadMessageView,
  TicketHeaderView,
  TicketRailView,
} from "@cds/ui/staff";
import {
  staffCan,
  type StaffWebSession,
} from "../../../../../lib/staff-session";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export type TicketDetailData = {
  number: number;
  header: TicketHeaderView;
  rail: TicketRailView;
  messages: StaffThreadMessageView[];
  incidentView: IncidentView | null;
  incidentAt: string | null;
  incidents: IncidentOption[] | null;
  staff: StaffOption[];
  meId: string;
  timeZone: string;
  now: string;
  /** 13-41: the composer's data; null = no composer (role or Closed). */
  composer: TicketComposerData | null;
};

export type TicketComposerData = {
  ticket: StaffComposerTicket;
  canned: CannedOption[];
  vars: CannedVars;
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Me first, then every other assignee seen (first names), alphabetical. */
export function staffOptionsFrom(
  rows: readonly Pick<StaffTicketRow, "assignee" | "assigneeId">[],
  session: Pick<StaffWebSession, "ctx" | "name">,
): StaffOption[] {
  const me = session.ctx.actor;
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.assigneeId && r.assigneeId !== me && !seen.has(r.assigneeId)) {
      seen.set(r.assigneeId, r.assignee ?? r.assigneeId);
    }
  }
  const others = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [{ id: me, name: firstName(session.name) || "Me" }, ...others];
}

/** Every ticket (any status) once, for the assignee and site options. Failure → []. */
export async function allTicketRows(
  session: StaffWebSession,
  now: Date,
): Promise<StaffTicketRow[]> {
  try {
    return await staffListTickets(session.ctx, { status: "all", now });
  } catch (err) {
    console.error("[staff tickets] option read failed", errName(err));
    return [];
  }
}

async function incidentRows(
  session: StaffWebSession,
): Promise<StaffIncidentRow[] | null> {
  if (!staffCan(session.role, "incident_run")) return null;
  try {
    return await staffListIncidents(session.ctx, { includeResolved: true });
  } catch (err) {
    console.error("[staff tickets] incident read failed", errName(err));
    return null;
  }
}

async function composerData(
  session: StaffWebSession,
  t: StaffTicketDetail,
  now: Date,
): Promise<TicketComposerData | null> {
  if (t.status === "closed" || !staffCan(session.role, "support_reply")) {
    return null;
  }
  const [canned, vars] = await Promise.all([
    staffCan(session.role, "canned_replies")
      ? staffListCanned(session.ctx).catch((err: unknown) => {
          console.error("[staff tickets] canned read failed", errName(err));
          return [];
        })
      : Promise.resolve([]),
    staffCannedVarsFor(session.ctx, t.number, { now }).catch(
      (err: unknown): CannedVars => {
        console.error("[staff tickets] canned vars read failed", errName(err));
        return {
          first_name: t.openedBy.cds
            ? "there"
            : firstName(t.openedBy.name) || "there",
          business: t.orgName,
          ticket: t.number,
          agent: firstName(session.name) || "CDS",
        };
      },
    ),
  ]);
  return {
    ticket: {
      number: t.number,
      business: t.orgName,
      ownerFirstName:
        t.openedBy.cds || vars.first_name === "there" ? "" : vars.first_name,
      status: t.status,
    },
    canned: canned.map((c) => ({ id: c.id, title: c.title, body: c.body })),
    vars,
  };
}

export async function ticketDetailData(
  session: StaffWebSession,
  t: StaffTicketDetail,
  opts: { now: Date; rows?: StaffTicketRow[] },
): Promise<TicketDetailData> {
  const [rows, incidents, composer] = await Promise.all([
    opts.rows ? Promise.resolve(opts.rows) : allTicketRows(session, opts.now),
    incidentRows(session),
    composerData(session, t, opts.now),
  ]);
  const linked = t.incident
    ? (incidents?.find((i) => i.id === t.incident) ?? null)
    : null;
  const paidCategory =
    t.paid && isPaidCategory(t.paid.category) ? t.paid.category : null;
  return {
    number: t.number,
    header: {
      number: t.number,
      subject: t.subject,
      status: t.status,
      type: t.type,
      target: { kind: t.target.kind, label: t.target.label },
      orgId: t.orgId,
      orgName: t.orgName,
      openedBy: { cds: t.openedBy.cds, name: t.openedBy.name },
      created: t.created,
      sla: t.sla,
      dueAt: t.dueAt,
      firstRepliedAt: t.firstRepliedAt,
      paidLabel: paidCategory
        ? SUPPORT_COPY.PAID_CATEGORY_LABELS[paidCategory]
        : null,
      incidentCode: linked?.code ?? null,
    },
    rail: {
      id: t.id,
      number: t.number,
      status: t.status,
      type: t.type,
      priority: t.priority,
      assigneeId: t.assigneeId,
      assignee: t.assignee,
      paidCategory,
      incidentCode: linked?.code ?? null,
      orgId: t.orgId,
      orgName: t.orgName,
      created: t.created,
      firstRepliedAt: t.firstRepliedAt,
      dueAt: t.dueAt,
      context: t.context,
    },
    // Only the fields the client renders (authorStaff ids stay on the server).
    messages: t.messages.map((m) => ({
      id: m.id,
      authorKind: m.authorKind,
      authorName: m.authorName,
      body: m.body,
      event: m.event,
      attachments: m.attachments,
      created: m.created,
      visibility: m.visibility,
    })),
    incidentView: linked
      ? {
          title: linked.title,
          public_text: linked.publicText,
          status: linked.status,
        }
      : null,
    incidentAt: linked ? (linked.resolvedAt ?? linked.created) : null,
    incidents: incidents
      ? incidents
          .filter((i) => i.status === "open")
          .map((i) => ({ code: i.code, title: i.title }))
      : null,
    staff: staffOptionsFrom(rows, session),
    meId: session.ctx.actor,
    timeZone: BUSINESS_TIME_ZONE,
    now: opts.now.toISOString(),
    composer,
  };
}

/** "1042", "#1042" or "%231042" → 1042; null for anything else. */
export function ticketNumberFromSegment(raw: string): number | null {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  try {
    return parseTicketNumber(text.trim());
  } catch {
    return null;
  }
}

/** The ticket segment of a /staff/tickets/<n> request path (not-found page); null if junk. */
export function ticketSegmentOf(path: string | null): string | null {
  if (!path) return null;
  const m = /^\/staff\/tickets\/([^/?#]{1,24})/.exec(path);
  if (!m) return null;
  let seg = m[1]!;
  try {
    seg = decodeURIComponent(seg);
  } catch {
    return null;
  }
  return /^#?\d{1,10}$/.test(seg) ? seg.replace(/^#/, "") : null;
}
