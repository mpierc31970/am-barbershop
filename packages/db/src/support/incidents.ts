// P12 incidents (12-21; COMM-12, D103, P12-P6). A known problem that several tickets share.
//
// Staff side (STAFF-12 mechanics pulled forward; the CLI is 12-30, the console P13):
// - staffOpenIncident: title + public text, display code `I-<seq>` (max + 1, retry on the
//   unique index), audited with no organization.
// - staffLinkTicketToIncident: sets the ticket's `incident`, posts the public system line
//   "Linked to a known problem", audited under the ticket's org. No alert.
// - staffResolveIncident: every linked ticket that is not Resolved or Closed moves to Resolved
//   through the one core table (applyTicketTransition, staff_set), with an optional public
//   staff message, and raises one `support.status` alert per ticket. Then the incident is
//   marked resolved. Re-running sweeps any ticket a failed run left behind.
// - staffListIncidents: the CLI list (linked counts are staff-only).
//
// Tenant side: incidentForTicket returns `{title, public_text, status}` only when the org's own
// ticket links an incident. Built field by field: never a count, never another org (T-12-21-01).
// Another org's number is the same NotFound as a missing one (T-12-21-02).
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  parseTicketNumber,
  statusSubject,
  type IncidentView,
  type TicketStatus,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { assertId, newRecordId, requirePermission } from "../repository";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import {
  THREADS,
  appendMessage,
  cleanBody,
  errName,
  staffFirstName,
} from "./shared";
import { applyTicketTransition, ratedAgentFor } from "./threads";

const INCIDENTS = "incidents";
const SEQ_RETRIES = 5;
const TITLE_MAX = 80;
const PUBLIC_TEXT_MAX = 2000;
const LINKED_MAX = 1000;
const ID_RE = /^[a-z0-9]{15}$/;
/** The system line a linked ticket shows (UI-SPEC IncidentBox sits above it). */
export const INCIDENT_LINKED_LINE = "Linked to a known problem";

export type IncidentClock = { now(): Date };
const SYSTEM_CLOCK: IncidentClock = { now: () => new Date() };

export type IncidentDeps = {
  clock?: IncidentClock;
  transport?: SupportNotifyDeps["transport"];
  push?: SupportNotifyDeps["push"];
  types?: SupportNotifyDeps["types"];
};

export type StaffIncidentRow = {
  id: string;
  code: string;
  title: string;
  publicText: string;
  status: "open" | "resolved";
  created: string;
  resolvedAt: string | null;
  /** Tickets linked to it, every org (staff only). */
  linked: number;
  /** Distinct sites those tickets belong to (13-36 list column). */
  sites: number;
};

/** One ticket linked to an incident (13-36 incident drawer). */
export type StaffIncidentTicket = {
  number: number;
  orgId: string;
  business: string;
  subject: string;
  status: TicketStatus;
  created: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function nowOf(clock?: IncidentClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function incidentCode(seq: number): string {
  return `I-${seq}`;
}

function cleanText(v: unknown, what: string, max: number): string {
  if (typeof v !== "string") throw new InvalidInput(`${what} must be text`);
  const s = what === "title" ? v.replace(/\s+/g, " ").trim() : v.trim();
  if (!s) throw new InvalidInput(`add a ${what}`);
  if (s.length > max) {
    throw new InvalidInput(`${what} must be at most ${max} characters`);
  }
  return s;
}

async function nextSeq(pb: PocketBase): Promise<number> {
  const res = await pb
    .collection(INCIDENTS)
    .getList(1, 1, { sort: "-seq", fields: "seq" });
  const top = res.items[0];
  return (top && typeof top.seq === "number" ? top.seq : 0) + 1;
}

/** An incident by record id or `I-<seq>` code. Junk and missing: NotFound. */
async function loadIncident(
  pb: PocketBase,
  raw: unknown,
): Promise<RecordModel> {
  if (typeof raw !== "string") throw new NotFound("incident not found");
  const v = raw.trim();
  const m = /^I-([1-9][0-9]{0,8})$/i.exec(v);
  let filter: string;
  if (m) filter = pb.filter("seq = {:seq}", { seq: Number(m[1]) });
  else if (ID_RE.test(v)) filter = pb.filter("id = {:id}", { id: v });
  else throw new NotFound("incident not found");
  try {
    return await pb.collection(INCIDENTS).getFirstListItem(filter);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("incident not found");
    }
    throw err;
  }
}

async function loadAnyTicket(
  pb: PocketBase,
  raw: unknown,
): Promise<RecordModel> {
  const n = parseTicketNumber(raw);
  try {
    return await pb
      .collection(THREADS)
      .getFirstListItem(pb.filter("number = {:n} && kind = 'ticket'", { n }));
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("ticket not found");
    }
    throw err;
  }
}

async function businessName(pb: PocketBase, orgId: string): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" })
    .catch(() => null);
  return str(org?.name) || "your site";
}

// ---------------------------------------------------------------------------------------
// Staff (choices 1-3)

/** Opens an incident (choice 1, `incident_run`). Returns its id and `I-<seq>` code. */
export async function staffOpenIncident(
  ctx: PlatformContext,
  input: { title: string; publicText: string },
  deps: Pick<IncidentDeps, "clock"> = {},
): Promise<{ id: string; code: string }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  const title = cleanText(input?.title, "title", TITLE_MAX);
  const publicText = cleanText(
    input?.publicText,
    "public text",
    PUBLIC_TEXT_MAX,
  );
  nowOf(deps.clock);
  return withSuperuser(async (pb) => {
    for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
      const seq = await nextSeq(pb);
      const id = newRecordId();
      const batch = pb.createBatch();
      batch.collection(INCIDENTS).create({
        id,
        seq,
        title,
        public_text: publicText,
        status: "open",
        resolved_at: "",
        created_by: ctx.actor,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.incident_opened",
          organization: null,
          targetCollection: INCIDENTS,
          targetId: id,
          meta: { code: incidentCode(seq) },
        }),
      );
      try {
        await batch.send();
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      return { id, code: incidentCode(seq) };
    }
    throw new InvalidInput("incident numbers are busy; try again");
  });
}

/**
 * Links a ticket to an open incident (choice 2, `incident_run`): sets `incident`, posts the
 * public system line, audits under the ticket's org. No alert. Linking the same pair again
 * changes nothing (`linked: false`). Closed tickets and resolved incidents are refused.
 */
export async function staffLinkTicketToIncident(
  ctx: PlatformContext,
  input: { incident: string; number: unknown },
  deps: Pick<IncidentDeps, "clock"> = {},
): Promise<{ code: string; number: number; orgId: string; linked: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  const now = nowOf(deps.clock);
  return withSuperuser(async (pb) => {
    const incident = await loadIncident(pb, input?.incident);
    const code = incidentCode(Number(incident.seq) || 0);
    if (incident.status === "resolved") {
      throw new InvalidInput(`${code} is already resolved`);
    }
    const thread = await loadAnyTicket(pb, input?.number);
    const orgId = str(thread.organization);
    const number = Number(thread.number) || 0;
    if (str(thread.incident) === incident.id) {
      return { code, number, orgId, linked: false };
    }
    if (thread.status === "closed") {
      throw new InvalidInput("this ticket is closed");
    }
    const batch = pb.createBatch();
    const messageId = appendMessage(
      pb,
      batch,
      {
        orgId,
        thread,
        authorKind: "system",
        authorName: "CDS",
        body: "",
        visibility: "public",
        event: { kind: "incident_linked", label: INCIDENT_LINKED_LINE },
      },
      now,
    );
    batch.collection(THREADS).update(thread.id, { incident: incident.id });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.incident_linked",
        organization: orgId,
        targetCollection: THREADS,
        targetId: thread.id,
        meta: { code, number, message: messageId },
      }),
    );
    await batch.send();
    return { code, number, orgId, linked: true };
  });
}

export type StaffResolveIncidentResult = {
  code: string;
  /** Linked tickets moved to Resolved. */
  moved: number;
  /** support.status alerts raised (one per moved ticket). */
  alerts: number;
  /** Linked tickets the move refused (e.g. a paid-service guard) or that failed to save. */
  skipped: number;
};

/**
 * Resolves an incident (choice 3, `incident_run`). Each linked ticket not Resolved or Closed:
 * optional public staff message, then staff_set → Resolved (system line + `support.ticket_status`
 * audit), one batch per ticket, then one `support.status` alert. Then the incident is marked
 * resolved and `support.incident_resolved` is audited with the counts.
 */
export async function staffResolveIncident(
  ctx: PlatformContext,
  input: { incident: string; message?: string },
  deps: IncidentDeps = {},
): Promise<StaffResolveIncidentResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  const now = nowOf(deps.clock);
  const hasMessage =
    typeof input?.message === "string" && input.message.trim() !== "";
  const message = hasMessage ? cleanBody(input.message, 0) : "";

  const swept = await withSuperuser(async (pb) => {
    const incident = await loadIncident(pb, input?.incident);
    const code = incidentCode(Number(incident.seq) || 0);
    const authorName = hasMessage ? await staffFirstName(pb, ctx.actor) : "";
    const tickets = await pb.collection(THREADS).getFullList({
      filter: pb.filter(
        "incident = {:id} && kind = 'ticket' && status != 'resolved' && status != 'closed'",
        { id: incident.id },
      ),
      sort: "number",
      batch: LINKED_MAX,
    });
    const moved: {
      orgId: string;
      threadId: string;
      number: number;
      subject: string;
      filer: string;
      to: TicketStatus;
    }[] = [];
    let skipped = 0;
    for (const thread of tickets) {
      const orgId = str(thread.organization);
      try {
        // 13-16 choice 4: credit the assignee, else this public reply, else the last one.
        const ratedAgent = await ratedAgentFor(pb, thread, {
          pendingReplier: hasMessage ? ctx.actor : undefined,
        });
        const batch = pb.createBatch();
        let messageId: string | undefined;
        if (hasMessage) {
          messageId = appendMessage(
            pb,
            batch,
            {
              orgId,
              thread,
              authorKind: "staff",
              authorStaff: ctx.actor,
              authorName,
              body: message,
              visibility: "public",
            },
            now,
          );
          if (!iso(thread.first_replied_at)) {
            batch
              .collection(THREADS)
              .update(thread.id, { first_replied_at: now.toISOString() });
          }
        }
        // Throws before anything is sent when the core table refuses the move.
        const r = applyTicketTransition(pb, batch, {
          thread,
          event: "staff_set",
          to: "resolved",
          actor: ctx,
          now: messageId ? new Date(now.getTime() + 1) : now,
          afterMessageId: messageId,
          ratedAgent,
        });
        if (r.to === r.from) {
          skipped++;
          continue;
        }
        await batch.send();
        moved.push({
          orgId,
          threadId: thread.id,
          number: Number(thread.number) || 0,
          subject: str(thread.subject),
          filer: str(thread.opened_by),
          to: r.to,
        });
      } catch (err) {
        skipped++;
        console.error(`[support] incident ticket move refused ${errName(err)}`);
      }
    }
    const wasOpen = incident.status !== "resolved";
    const batch = pb.createBatch();
    if (wasOpen) {
      batch.collection(INCIDENTS).update(incident.id, {
        status: "resolved",
        resolved_at: now.toISOString(),
      });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.incident_resolved",
        organization: null,
        targetCollection: INCIDENTS,
        targetId: incident.id,
        meta: { code, moved: moved.length, skipped, rerun: !wasOpen },
      }),
    );
    await batch.send();
    const names = new Map<string, string>();
    for (const m of moved) {
      if (!names.has(m.orgId))
        names.set(m.orgId, await businessName(pb, m.orgId));
    }
    return { code, moved, skipped, names };
  });

  let alerts = 0;
  for (const m of swept.moved) {
    try {
      await notifySupport(
        {
          orgId: m.orgId,
          as: ctx,
          type: "support.status",
          ticket: {
            number: m.number,
            subject: m.subject,
            ...(m.filer ? { filer: m.filer } : {}),
            status: m.to,
            threadId: m.threadId,
          },
          title: statusSubject(m.number, m.to),
          href: `/hub/support/tickets/${m.number}`,
          businessName: swept.names.get(m.orgId) ?? "your site",
        },
        {
          now,
          transport: deps.transport,
          push: deps.push,
          types: deps.types,
        },
      );
      alerts++;
    } catch (err) {
      // The move is saved; a failed alert never undoes it.
      console.error(`[support] support.status alert failed ${errName(err)}`);
    }
  }
  return {
    code: swept.code,
    moved: swept.moved.length,
    alerts,
    skipped: swept.skipped,
  };
}

/** Staff list (choice 4, `incident_run`): open first, newest first; resolved only on request. */
export async function staffListIncidents(
  ctx: PlatformContext,
  opts: { includeResolved?: boolean } = {},
): Promise<StaffIncidentRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(INCIDENTS).getFullList({
      ...(opts.includeResolved ? {} : { filter: "status = 'open'" }),
      sort: "-seq",
    });
    const out: StaffIncidentRow[] = [];
    for (const r of rows) {
      const linked = await pb.collection(THREADS).getFullList({
        filter: pb.filter("incident = {:id} && kind = 'ticket'", { id: r.id }),
        fields: "id,organization",
        batch: LINKED_MAX,
      });
      out.push({
        id: r.id,
        code: incidentCode(Number(r.seq) || 0),
        title: str(r.title),
        publicText: str(r.public_text),
        status: r.status === "resolved" ? "resolved" : "open",
        created: str(r.created),
        resolvedAt: iso(r.resolved_at),
        linked: linked.length,
        sites: new Set(linked.map((t) => str(t.organization))).size,
      });
    }
    return out.sort(
      (a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved"),
    );
  });
}

/**
 * 13-36: the tickets linked to one incident (id or `I-<seq>`), every org, by number, with the
 * business name. `incident_run`; unknown incident = NotFound.
 */
export async function staffIncidentTickets(
  ctx: PlatformContext,
  incident: string,
): Promise<StaffIncidentTicket[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  return withSuperuser(async (pb) => {
    const row = await loadIncident(pb, incident);
    const tickets = await pb.collection(THREADS).getFullList({
      filter: pb.filter("incident = {:id} && kind = 'ticket'", { id: row.id }),
      fields: "id,number,organization,subject,status,created",
      sort: "number",
      batch: LINKED_MAX,
    });
    const names = new Map<string, string>();
    const out: StaffIncidentTicket[] = [];
    for (const t of tickets) {
      const orgId = str(t.organization);
      if (!names.has(orgId)) names.set(orgId, await businessName(pb, orgId));
      out.push({
        number: Number(t.number) || 0,
        orgId,
        business: names.get(orgId) ?? "",
        subject: str(t.subject),
        status: str(t.status) as TicketStatus,
        created: str(t.created),
      });
    }
    return out;
  });
}

/**
 * 13-36: takes one ticket off an incident (`incident_run`): clears `incident` and audits
 * `support.incident_unlinked` under the ticket's org. The owner's "What happened" box goes
 * with it; the earlier "Linked to a known problem" line stays in the thread as history. A
 * ticket not on this incident changes nothing (`unlinked: false`).
 */
export async function staffUnlinkTicketFromIncident(
  ctx: PlatformContext,
  input: { incident: string; number: unknown },
): Promise<{ code: string; number: number; orgId: string; unlinked: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "incident_run");
  return withSuperuser(async (pb) => {
    const incident = await loadIncident(pb, input?.incident);
    const code = incidentCode(Number(incident.seq) || 0);
    const thread = await loadAnyTicket(pb, input?.number);
    const orgId = str(thread.organization);
    const number = Number(thread.number) || 0;
    if (str(thread.incident) !== incident.id) {
      return { code, number, orgId, unlinked: false };
    }
    const batch = pb.createBatch();
    batch.collection(THREADS).update(thread.id, { incident: "" });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.incident_unlinked",
        organization: orgId,
        targetCollection: THREADS,
        targetId: thread.id,
        meta: { code, number },
      }),
    );
    await batch.send();
    return { code, number, orgId, unlinked: true };
  });
}

// ---------------------------------------------------------------------------------------
// Tenant (choice 4)

/**
 * The incident on this org's own ticket (`support:read`), or null when it links none. Junk,
 * missing and another org's number are the same NotFound. Field by field: title, public text
 * and status only.
 */
export async function incidentForTicket(
  ctx: OrgContext,
  number: unknown,
): Promise<IncidentView | null> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "read");
  const n = parseTicketNumber(number);
  assertId(ctx.orgId);
  return withSuperuser(async (pb) => {
    let thread: RecordModel;
    try {
      thread = await pb
        .collection(THREADS)
        .getFirstListItem(
          pb.filter(
            "number = {:n} && organization = {:org} && kind = 'ticket'",
            { n, org: ctx.orgId },
          ),
          { fields: "id,incident" },
        );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound("ticket not found");
      }
      throw err;
    }
    const id = str(thread.incident);
    if (!ID_RE.test(id)) return null;
    let row: RecordModel;
    try {
      row = await pb
        .collection(INCIDENTS)
        .getOne(id, { fields: "id,title,public_text,status" });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
    const view: IncidentView = {
      title: str(row.title),
      public_text: str(row.public_text),
      status: row.status === "resolved" ? "resolved" : "open",
    };
    return view;
  });
}
