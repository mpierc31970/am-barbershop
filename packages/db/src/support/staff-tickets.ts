// P12 tickets, staff side (12-18; COMM-06, COMM-09, COMM-10, SUPPORT-02; D210). The `@cds/db`
// functions the staff CLIs (12-28) and later the P13 console call:
//
// - staffReplyToTicket: public reply or internal note, plus status / assignee / priority and
//   staff files, in one batch with one audit row. A public reply sets first_replied_at once
//   (SUPPORT-02) and raises `support.reply`; a status move raises `support.status` (both may
//   fire, COMM-10). Internal-only changes notify nobody (T-12-18-02).
// - staffOpenTicket: a ticket on a tenant's behalf (D210), "Opened by CDS", already answered.
// - staffListTickets / staffGetTicket: every org, SLA state, internal notes included.
// - jobAutoCloseTickets / jobSlaWarnings: support:run steps (12-31), each with an injected `now`.
//
// Every function checks its staff feature (T-12-18-01). Status moves go through the one core
// table via applyTicketTransition, so the paid-service guard applies (T-12-18-04). Logs carry
// error class names only.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  WHOLE_SITE,
  buildTargetOptions,
  isTicketStatus,
  nextStatus,
  parseTicketNumber,
  replySubject,
  slaState,
  statusSubject,
  typeLabel,
  validateTarget,
  type PaidService,
  type Priority,
  type SlaState,
  type TargetRef,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type { PushSender } from "../alerts/push";
import { activeSet } from "../addons/entitlements";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  mintSystemContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { supportEmail } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { assertId } from "../repository";
import type { ObjectStore } from "../storage";
import type { StaffThreadMessage } from "./messages";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import {
  MESSAGES,
  THREADS,
  cleanBody,
  errName,
  filesByThread,
  postWithStaffFiles,
  staffFirstName,
  toTenantMessage,
  type StaffFile,
} from "./shared";
import {
  TICKET_SUBJECT_MAX,
  applyTicketTransition,
  ratedAgentFor,
  createTicketRow,
  ticketPaidView,
  type TicketContext,
} from "./threads";

/** COMM-09: a Resolved ticket closes after this long with no tenant reply. */
export const SUPPORT_AUTO_CLOSE_MS = 7 * 24 * 3_600_000;
/** Rows one job step reads per run (the next hourly run takes the rest). */
const JOB_SCAN_MAX = 500;
/** Staff list page (10-50 tenants: every open ticket fits). */
const STAFF_LIST_MAX = 1000;

const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];
/** Types staff may open on a tenant's behalf (suggestions are ideas, 12-22). */
const STAFF_OPEN_TYPES: readonly TicketType[] = [
  "problem",
  "change",
  "question",
  "billing",
];

export type StaffTicketClock = { now(): Date };
const SYSTEM_CLOCK: StaffTicketClock = { now: () => new Date() };

export type StaffTicketDeps = {
  store?: ObjectStore;
  clock?: StaffTicketClock;
  transport?: EmailTransport;
  push?: PushSender;
  types?: SupportNotifyDeps["types"];
};

/** The hub link for one ticket (bell rows and emails). */
export function staffTicketHref(number: number): string {
  return `/hub/support/tickets/${number}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function clockNow(clock?: StaffTicketClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function validNow(now: Date): Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return now;
}

function statusOf(v: unknown): TicketStatus {
  return isTicketStatus(v) ? v : "open";
}

function typeOf(v: unknown): TicketType {
  return v === "change" ||
    v === "question" ||
    v === "billing" ||
    v === "suggestion"
    ? v
    : "problem";
}

function priorityOf(v: unknown): Priority {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : "normal";
}

function targetOf(v: unknown): TargetRef {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    if (
      (r.kind === "site" ||
        r.kind === "page" ||
        r.kind === "addon" ||
        r.kind === "part") &&
      typeof r.id === "string"
    ) {
      return { kind: r.kind, id: r.id, label: str(r.label) || r.id };
    }
  }
  return { ...WHOLE_SITE };
}

function contextOf(v: unknown): TicketContext | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  return {
    url: iso(r.url),
    browser: iso(r.browser),
    captured_at: str(r.captured_at),
  };
}

function cleanSubject(v: unknown): string {
  if (typeof v !== "string") throw new InvalidInput("subject must be text");
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) throw new InvalidInput("add a subject");
  if (s.length > TICKET_SUBJECT_MAX) {
    throw new InvalidInput(
      `subject must be at most ${TICKET_SUBJECT_MAX} characters`,
    );
  }
  return s;
}

/** Any org's ticket by number (staff). Junk and missing: NotFound. */
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

async function orgNameOf(pb: PocketBase, orgId: string): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" })
    .catch((err: unknown) => {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound("organization not found");
      }
      throw err;
    });
  return str(org.name) || "your site";
}

async function orgNames(
  pb: PocketBase,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => /^[a-z0-9]{15}$/.test(id));
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const params: Record<string, string> = {};
    // Placeholders only: every id is bound through params.
    const expr = chunk
      .map((id, j) => {
        params[`o${j}`] = id;
        return `id = {:o${j}}`;
      })
      .join(" || ");
    const rows = await pb
      .collection("organizations")
      .getFullList({ filter: pb.filter(expr, params), fields: "id,name" });
    for (const r of rows) out.set(r.id, str(r.name));
  }
  return out;
}

/** Display names for staff and member ids (first word for staff), one read per 50 ids. */
async function userNames(
  pb: PocketBase,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => /^[a-z0-9]{15}$/.test(id));
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const params: Record<string, string> = {};
    const expr = chunk
      .map((id, j) => {
        params[`u${j}`] = id;
        return `id = {:u${j}}`;
      })
      .join(" || ");
    const rows = await pb
      .collection("users")
      .getFullList({ filter: pb.filter(expr, params), fields: "id,name" });
    for (const r of rows) out.set(r.id, str(r.name).trim());
  }
  return out;
}

function firstWord(name: string | undefined, fallback: string): string {
  const w = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return w || fallback;
}

/**
 * The staff user an assignment names: a users id or email of a user with a staff role.
 * `""` / `"none"` unassigns (returns ""). Anything else: InvalidInput.
 */
async function resolveAssignee(pb: PocketBase, raw: unknown): Promise<string> {
  if (typeof raw !== "string") throw new InvalidInput("assignee must be text");
  const v = raw.trim();
  if (v === "" || v.toLowerCase() === "none") return "";
  if (v.length > 200) throw new InvalidInput("unknown staff member");
  const filter = /^[a-z0-9]{15}$/.test(v)
    ? pb.filter("id = {:v} && staff_role != ''", { v })
    : pb.filter("email = {:v} && staff_role != ''", { v: v.toLowerCase() });
  const row = await pb
    .collection("users")
    .getFirstListItem(filter, { fields: "id" })
    .catch(() => null);
  if (!row) throw new InvalidInput("unknown staff member");
  return row.id;
}

function slaOf(row: RecordModel, now: Date): SlaState {
  return slaState({
    dueAt: iso(row.first_reply_due_at),
    repliedAt: iso(row.first_replied_at),
    now,
  });
}

// ---------------------------------------------------------------------------------------
// Reply, status (choices 1-2)

export type StaffReplyInput = {
  number: unknown;
  body?: string;
  /** An internal note: the tenant never sees it and nobody is notified. */
  internal?: boolean;
  status?: TicketStatus;
  /** A staff users id or email; `""` or `"none"` unassigns. */
  assign?: string;
  priority?: Priority;
  files?: readonly StaffFile[];
};

export type StaffReplyResult = {
  messageId: string | null;
  orgId: string;
  /** People alerted (the largest audience of the alerts raised). */
  recipients: number;
  /** Bell raises across both alerts (a reply and a status move each raise). */
  raised: number;
  emailed: number;
  statusFrom: TicketStatus;
  statusTo: TicketStatus;
};

/**
 * A staff reply on any org's ticket (`support_reply`). Closed → InvalidInput. The body is
 * optional only when files, a status, an assignee or a priority come with it. Public replies
 * set first_replied_at once and alert `support.reply`; a status move alerts `support.status`.
 * One batch: message, thread fields, status move and the `support.staff_reply` audit row.
 */
export async function staffReplyToTicket(
  ctx: PlatformContext,
  input: StaffReplyInput,
  deps: StaffTicketDeps = {},
): Promise<StaffReplyResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_reply");
  const files = Array.isArray(input?.files) ? input.files : [];
  const internal = input?.internal === true;
  const status = input?.status;
  if (status !== undefined && !isTicketStatus(status)) {
    throw new InvalidInput("unknown status");
  }
  const priority = input?.priority;
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    throw new InvalidInput("priority must be low, normal, high or urgent");
  }
  const hasBody = typeof input?.body === "string" && input.body.trim() !== "";
  const hasOther =
    status !== undefined ||
    priority !== undefined ||
    input?.assign !== undefined;
  const hasMessage = hasBody || files.length > 0;
  if (!hasMessage && !hasOther) {
    throw new InvalidInput("write a reply or change the ticket");
  }
  const body = hasMessage ? cleanBody(input.body, files.length) : "";
  const now = clockNow(deps.clock);

  const done = await withSuperuser(async (pb) => {
    const thread = await loadAnyTicket(pb, input.number);
    const from = statusOf(thread.status);
    if (from === "closed") {
      throw new InvalidInput("this ticket is closed; open a new one");
    }
    // Validate the move before anything is written (paid guard included, T-12-18-04).
    if (status !== undefined) {
      nextStatus(from, "staff_set", status, {
        paid: ticketPaidView(thread.paid_service),
      });
    }
    const assignee =
      input.assign !== undefined
        ? await resolveAssignee(pb, input.assign)
        : undefined;
    const orgId = str(thread.organization);
    const number = Number(thread.number) || 0;
    const business = await orgNameOf(pb, orgId);
    const authorName = await staffFirstName(pb, ctx.actor);
    const isPublicReply = hasMessage && !internal;
    // 13-16 choice 4: who is credited if this move resolves the ticket.
    const ratedAgent =
      status === "resolved"
        ? await ratedAgentFor(pb, thread, {
            assignee,
            pendingReplier: isPublicReply ? ctx.actor : undefined,
          })
        : undefined;

    let to: TicketStatus = from;
    const extra = (
      batch: ReturnType<PocketBase["createBatch"]>,
      messageId: string | null,
      fileCount: number,
    ) => {
      const fields: Record<string, unknown> = {};
      if (isPublicReply && !iso(thread.first_replied_at)) {
        fields.first_replied_at = now.toISOString();
      }
      if (assignee !== undefined) fields.assignee = assignee;
      if (priority !== undefined) fields.priority = priority;
      if (Object.keys(fields).length > 0) {
        batch.collection(THREADS).update(thread.id, fields);
      }
      if (status !== undefined) {
        // After the reply's own touch, so the system line sorts after it.
        const moved = applyTicketTransition(pb, batch, {
          thread,
          event: "staff_set",
          to: status,
          actor: ctx,
          now: messageId ? new Date(now.getTime() + 1) : now,
          afterMessageId: messageId ?? undefined,
          ratedAgent,
        });
        to = moved.to;
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.staff_reply",
          organization: orgId,
          targetCollection: THREADS,
          targetId: thread.id,
          meta: {
            number,
            internal,
            message: messageId,
            files: fileCount,
            status: status !== undefined ? { from, to: status } : null,
            assigned: assignee !== undefined,
            priority: priority ?? null,
          },
        }),
      );
    };

    let messageId: string | null = null;
    if (hasMessage) {
      const posted = await postWithStaffFiles(
        pb,
        ctx,
        {
          orgId,
          thread,
          authorKind: "staff",
          authorStaff: ctx.actor,
          authorName,
          body,
          visibility: internal ? "internal" : "public",
        },
        files,
        (batch, id, n) => extra(batch, id, n),
        now,
        { store: deps.store },
      );
      messageId = posted.id;
    } else {
      const batch = pb.createBatch();
      extra(batch, null, 0);
      await batch.send();
    }
    return {
      orgId,
      threadId: thread.id,
      number,
      subject: str(thread.subject),
      filer: str(thread.opened_by),
      business,
      authorName,
      messageId,
      isPublicReply,
      from,
      to,
    };
  });

  let recipients = 0;
  let raised = 0;
  let emailed = 0;
  const notifyDeps = {
    now,
    transport: deps.transport,
    push: deps.push,
    types: deps.types,
  };
  const ticket = {
    number: done.number,
    subject: done.subject,
    ...(done.filer ? { filer: done.filer } : {}),
  };
  if (done.isPublicReply) {
    try {
      const r = await notifySupport(
        {
          orgId: done.orgId,
          as: ctx,
          type: "support.reply",
          ticket,
          title: replySubject(done.number),
          href: staffTicketHref(done.number),
          excerpt: body.slice(0, 300),
          authorFirstName: done.authorName,
          businessName: done.business,
        },
        notifyDeps,
      );
      recipients = Math.max(recipients, r.raised);
      raised += r.raised;
      emailed += r.emailed;
    } catch (err) {
      // The reply is saved; a failed alert never undoes it.
      console.error(`[support] support.reply alert failed ${errName(err)}`);
    }
  }
  if (done.to !== done.from) {
    try {
      const r = await notifySupport(
        {
          orgId: done.orgId,
          as: ctx,
          type: "support.status",
          ticket: { ...ticket, status: done.to, threadId: done.threadId },
          title: statusSubject(done.number, done.to),
          href: staffTicketHref(done.number),
          businessName: done.business,
        },
        notifyDeps,
      );
      recipients = Math.max(recipients, r.raised);
      raised += r.raised;
      emailed += r.emailed;
    } catch (err) {
      console.error(`[support] support.status alert failed ${errName(err)}`);
    }
  }
  return {
    messageId: done.messageId,
    orgId: done.orgId,
    recipients,
    raised,
    emailed,
    statusFrom: done.from,
    statusTo: done.to,
  };
}

/** A status move only (choice 2): staffReplyToTicket with `status` and nothing else. */
export async function staffSetTicketStatus(
  ctx: PlatformContext,
  input: { number: unknown; to: TicketStatus },
  deps: StaffTicketDeps = {},
): Promise<StaffReplyResult> {
  if (input?.to === undefined) throw new InvalidInput("choose a status");
  return staffReplyToTicket(
    ctx,
    { number: input.number, status: input.to },
    deps,
  );
}

// ---------------------------------------------------------------------------------------
// Open on a tenant's behalf (choice 3, D210)

export type StaffOpenTicketInput = {
  orgId: string;
  type: TicketType;
  subject: string;
  body: string;
  /** `{kind,id}` or `"kind:id"`, checked against the org's own options; default Whole site. */
  target?: unknown;
  files?: readonly StaffFile[];
  /** Add-on labels for the target (the caller has the registry). */
  addonNames?: Readonly<Record<string, string>>;
};

/**
 * Opens a ticket for an org (`support_open`, D210): "Opened by CDS", first message CDS-authored
 * and public, already answered for SLA (first_replied_at = now), status Open. Audited
 * `support.ticket_opened_by_cds` with the staff actor; raises `support.reply` to Owners and
 * Admins.
 */
export async function staffOpenTicket(
  ctx: PlatformContext,
  input: StaffOpenTicketInput,
  deps: StaffTicketDeps = {},
): Promise<{ number: number; id: string; raised: number; emailed: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_open");
  assertId(input?.orgId);
  const type = input.type;
  if (!STAFF_OPEN_TYPES.includes(type)) {
    throw new InvalidInput("type must be problem, change, question or billing");
  }
  const subject = cleanSubject(input.subject);
  const files = Array.isArray(input.files) ? input.files : [];
  if (typeof input.body !== "string" || !input.body.trim()) {
    throw new InvalidInput("tell the owner what this is about");
  }
  const body = cleanBody(input.body, files.length);
  const now = clockNow(deps.clock);
  const orgId = input.orgId;

  const opened = await withSuperuser(async (pb) => {
    const business = await orgNameOf(pb, orgId);
    const pages = await pb.collection("pages").getFullList({
      filter: pb.filter(
        "organization = {:org} && status = 'published' && deleted_at = '' && kind != 'system-404'",
        { org: orgId },
      ),
      sort: "title,id",
      fields: "id,title,slug",
    });
    const names = input.addonNames ?? {};
    const options = buildTargetOptions({
      pages: pages.map((p) => ({
        id: p.id,
        title: str(p.title).trim() || str(p.slug) || "Untitled page",
      })),
      addons: [...(await activeSet(pb, orgId))].sort().map((slug) => ({
        slug,
        name:
          (Object.hasOwn(names, slug) ? str(names[slug]).trim() : "") || slug,
      })),
    });
    const target = validateTarget(input.target, options);
    const authorName = await staffFirstName(pb, ctx.actor);
    const thread = await createTicketRow(pb, {
      orgId,
      type,
      subject,
      target,
      context: null,
      openedByCds: true,
      openedByStaff: ctx.actor,
      now,
    });
    const number = Number(thread.number);
    try {
      await postWithStaffFiles(
        pb,
        ctx,
        {
          orgId,
          thread,
          authorKind: "staff",
          authorStaff: ctx.actor,
          authorName,
          body,
          visibility: "public",
        },
        files,
        (batch, messageId, n) => {
          // Already answered: CDS wrote the first message (CONTEXT SLA).
          batch
            .collection(THREADS)
            .update(thread.id, { first_replied_at: now.toISOString() });
          batch.collection("audit_log").create(
            auditBody(ctx, {
              action: "support.ticket_opened_by_cds",
              organization: orgId,
              targetCollection: THREADS,
              targetId: thread.id,
              meta: { number, type, files: n, message: messageId },
            }),
          );
        },
        now,
        { store: deps.store },
      );
    } catch (err) {
      await pb
        .collection(THREADS)
        .delete(thread.id)
        .catch(() => undefined);
      throw err;
    }
    return { number, id: thread.id, business, authorName };
  });

  let raised = 0;
  let emailed = 0;
  try {
    const r = await notifySupport(
      {
        orgId,
        as: ctx,
        type: "support.reply",
        ticket: { number: opened.number, subject },
        title: replySubject(opened.number),
        href: staffTicketHref(opened.number),
        excerpt: body.slice(0, 300),
        authorFirstName: opened.authorName,
        businessName: opened.business,
      },
      { now, transport: deps.transport, push: deps.push, types: deps.types },
    );
    raised = r.raised;
    emailed = r.emailed;
  } catch (err) {
    console.error(`[support] support.reply alert failed ${errName(err)}`);
  }
  return { number: opened.number, id: opened.id, raised, emailed };
}

// ---------------------------------------------------------------------------------------
// List and read (choice 4)

export type StaffTicketStatusFilter = TicketStatus | "active" | "all";

export type StaffListInput = {
  orgId?: string;
  /** Default `active` (everything but Closed). */
  status?: StaffTicketStatusFilter;
  type?: TicketType;
  /** at-risk = due within 4 business hours; missed = past due or answered late. */
  sla?: "at-risk" | "missed";
  now?: Date;
};

export type StaffTicketRow = {
  id: string;
  number: number;
  orgId: string;
  orgName: string;
  type: TicketType;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  ageMs: number;
  sla: SlaState;
  dueAt: string | null;
  /** Assigned staff member's first name, or null. */
  assignee: string | null;
  assigneeId: string | null;
  paid: PaidService | null;
  openedByCds: boolean;
};

const SLA_RANK: Record<SlaState, number> = {
  missed: 0,
  due_soon: 1,
  on_track: 2,
  met: 3,
  none: 3,
};

/**
 * Tickets across orgs (`support_read`) with SLA state, sorted by SLA urgency (missed, due
 * soon, on track, then the rest), then oldest first.
 */
export async function staffListTickets(
  ctx: PlatformContext,
  input: StaffListInput = {},
): Promise<StaffTicketRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  const now = validNow(input.now ?? new Date());
  const status = input.status ?? "active";
  if (status !== "active" && status !== "all" && !isTicketStatus(status)) {
    throw new InvalidInput("unknown status");
  }
  if (
    input.type !== undefined &&
    !["problem", "change", "question", "billing", "suggestion"].includes(
      input.type,
    )
  ) {
    throw new InvalidInput("unknown type");
  }
  if (
    input.sla !== undefined &&
    input.sla !== "at-risk" &&
    input.sla !== "missed"
  ) {
    throw new InvalidInput("sla must be at-risk or missed");
  }
  if (input.orgId !== undefined) assertId(input.orgId);

  const parts = ["kind = 'ticket'"];
  const params: Record<string, string> = {};
  if (input.orgId !== undefined) {
    parts.push("organization = {:org}");
    params.org = input.orgId;
  }
  if (status === "active") parts.push("status != 'closed'");
  else if (status !== "all") {
    parts.push("status = {:status}");
    params.status = status;
  }
  if (input.type !== undefined) {
    parts.push("type = {:type}");
    params.type = input.type;
  }

  return withSuperuser(async (pb) => {
    const res = await pb.collection(THREADS).getList(1, STAFF_LIST_MAX, {
      filter: pb.filter(parts.join(" && "), params),
      sort: "created,number",
      skipTotal: true,
    });
    const orgs = await orgNames(
      pb,
      res.items.map((r) => str(r.organization)),
    );
    const staff = await userNames(
      pb,
      res.items.map((r) => str(r.assignee)).filter(Boolean),
    );
    const rows: StaffTicketRow[] = res.items.map((r) => {
      const created = Date.parse(str(r.created).replace(" ", "T"));
      const assigneeId = str(r.assignee) || null;
      return {
        id: r.id,
        number: Number(r.number) || 0,
        orgId: str(r.organization),
        orgName: orgs.get(str(r.organization)) ?? "",
        type: typeOf(r.type),
        subject: str(r.subject),
        status: statusOf(r.status),
        priority: priorityOf(r.priority),
        ageMs: Number.isFinite(created)
          ? Math.max(0, now.getTime() - created)
          : 0,
        sla: slaOf(r, now),
        dueAt: iso(r.first_reply_due_at),
        assignee: assigneeId ? firstWord(staff.get(assigneeId), "staff") : null,
        assigneeId,
        paid: ticketPaidView(r.paid_service),
        openedByCds: r.opened_by_cds === true,
      };
    });
    const filtered =
      input.sla === "at-risk"
        ? rows.filter((r) => r.sla === "due_soon")
        : input.sla === "missed"
          ? rows.filter((r) => r.sla === "missed")
          : rows;
    return filtered.sort(
      (a, b) =>
        SLA_RANK[a.sla] - SLA_RANK[b.sla] ||
        b.ageMs - a.ageMs ||
        a.number - b.number,
    );
  });
}

export type StaffTicketDetail = StaffTicketRow & {
  target: TargetRef;
  /** "Opened by CDS · Mara" or the member's name. */
  openedBy: { cds: boolean; name: string; userId: string | null };
  context: TicketContext | null;
  firstRepliedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  created: string;
  incident: string | null;
  /** Every message in time order, internal notes included, attachments with scan state. */
  messages: StaffThreadMessage[];
};

/** One ticket of any org by number, the full thread included (`support_read`). */
export async function staffGetTicket(
  ctx: PlatformContext,
  number: unknown,
  opts: { now?: Date } = {},
): Promise<StaffTicketDetail> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  const now = validNow(opts.now ?? new Date());
  return withSuperuser(async (pb) => {
    const r = await loadAnyTicket(pb, number);
    const orgId = str(r.organization);
    const orgName = await orgNameOf(pb, orgId);
    const openerId = str(r.opened_by) || str(r.opened_by_staff);
    const assigneeId = str(r.assignee) || null;
    const names = await userNames(
      pb,
      [openerId, assigneeId ?? ""].filter(Boolean),
    );
    const res = await pb.collection(MESSAGES).getList(1, 500, {
      filter: pb.filter("thread = {:t} && organization = {:org}", {
        t: r.id,
        org: orgId,
      }),
      sort: "created,id",
      skipTotal: true,
    });
    const files = await filesByThread(pb, orgId, r.id);
    const created = Date.parse(str(r.created).replace(" ", "T"));
    const cds = r.opened_by_cds === true;
    return {
      id: r.id,
      number: Number(r.number) || 0,
      orgId,
      orgName,
      type: typeOf(r.type),
      subject: str(r.subject),
      status: statusOf(r.status),
      priority: priorityOf(r.priority),
      ageMs: Number.isFinite(created)
        ? Math.max(0, now.getTime() - created)
        : 0,
      sla: slaOf(r, now),
      dueAt: iso(r.first_reply_due_at),
      assignee: assigneeId ? firstWord(names.get(assigneeId), "staff") : null,
      assigneeId,
      paid: ticketPaidView(r.paid_service),
      openedByCds: cds,
      target: targetOf(r.target),
      openedBy: {
        cds,
        name: cds
          ? `CDS · ${firstWord(names.get(openerId), "staff")}`
          : names.get(openerId) || "Team member",
        userId: openerId || null,
      },
      context: contextOf(r.context),
      firstRepliedAt: iso(r.first_replied_at),
      resolvedAt: iso(r.resolved_at),
      closedAt: iso(r.closed_at),
      created: str(r.created),
      incident: iso(r.incident),
      messages: res.items.map((m) => ({
        ...toTenantMessage(m, files.get(m.id) ?? []),
        visibility: m.visibility === "internal" ? "internal" : "public",
        authorStaff: str(m.author_staff),
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------
// Job steps (choice 5; support:run, 12-31)

export type JobAutoCloseResult = {
  closed: number;
  kept: number;
  failed: number;
};

/**
 * Closes tickets Resolved for 7 days (resolved_at ≤ now − 7 d) with no tenant message after
 * resolved_at (COMM-09): system line "Closed after 7 days with no reply", audited under a
 * system context, `support.status` alert to the filer, Owners and Admins.
 */
export async function jobAutoCloseTickets(
  now: Date,
  deps: Omit<StaffTicketDeps, "store" | "clock"> = {},
): Promise<JobAutoCloseResult> {
  validNow(now);
  const sys = mintSystemContext({ job: "support" });
  const cutoff = new Date(now.getTime() - SUPPORT_AUTO_CLOSE_MS);
  const out: JobAutoCloseResult = { closed: 0, kept: 0, failed: 0 };
  const due = await withSuperuser((pb) =>
    pb.collection(THREADS).getList(1, JOB_SCAN_MAX, {
      filter: pb.filter(
        "kind = 'ticket' && status = 'resolved' && resolved_at != '' && resolved_at <= {:cut}",
        { cut: cutoff },
      ),
      sort: "resolved_at,id",
      skipTotal: true,
    }),
  );
  for (const row of due.items) {
    try {
      const closed = await withSuperuser(async (pb) => {
        const thread = await pb.collection(THREADS).getOne(row.id);
        if (thread.status !== "resolved") return null;
        const resolvedAt = new Date(str(thread.resolved_at).replace(" ", "T"));
        if (Number.isNaN(resolvedAt.getTime())) return null;
        if (await tenantRepliedSinceResolved(pb, thread.id, resolvedAt)) {
          return null;
        }
        const batch = pb.createBatch();
        applyTicketTransition(pb, batch, {
          thread,
          event: "auto_close",
          actor: sys,
          now,
        });
        await batch.send();
        return {
          orgId: str(thread.organization),
          number: Number(thread.number) || 0,
          subject: str(thread.subject),
          filer: str(thread.opened_by),
          business: await orgNameOf(pb, str(thread.organization)),
        };
      });
      if (!closed) {
        out.kept += 1;
        continue;
      }
      out.closed += 1;
      await notifyClosed(sys, closed, now, deps);
    } catch (err) {
      out.failed += 1;
      console.error(`[jobs/support] auto-close failed ${errName(err)}`);
    }
  }
  return out;
}

/**
 * True when a member wrote after the ticket was resolved. Walks the thread newest first: a
 * member message before (newer than) the latest "→ Resolved" system line means a reply; the
 * line itself means none. Without such a line, falls back to `created > resolved_at`.
 */
async function tenantRepliedSinceResolved(
  pb: PocketBase,
  threadId: string,
  resolvedAt: Date,
): Promise<boolean> {
  const recent = await pb.collection(MESSAGES).getList(1, 200, {
    filter: pb.filter("thread = {:t} && visibility = 'public'", {
      t: threadId,
    }),
    sort: "-created,-id",
    fields: "id,author_kind,event,created",
    skipTotal: true,
  });
  for (const m of recent.items) {
    if (m.author_kind === "member") return true;
    const ev = m.event as { to?: unknown } | null;
    if (m.author_kind === "system" && ev && ev.to === "resolved") return false;
  }
  const late = await pb.collection(MESSAGES).getList(1, 1, {
    filter: pb.filter(
      "thread = {:t} && author_kind = 'member' && created > {:r}",
      { t: threadId, r: resolvedAt },
    ),
    skipTotal: true,
  });
  return late.items.length > 0;
}

async function notifyClosed(
  sys: SystemContext,
  t: {
    orgId: string;
    number: number;
    subject: string;
    filer: string;
    business: string;
  },
  now: Date,
  deps: Omit<StaffTicketDeps, "store" | "clock">,
): Promise<void> {
  try {
    await notifySupport(
      {
        orgId: t.orgId,
        as: sys,
        type: "support.status",
        ticket: {
          number: t.number,
          subject: t.subject,
          status: "closed",
          ...(t.filer ? { filer: t.filer } : {}),
        },
        title: statusSubject(t.number, "closed"),
        href: staffTicketHref(t.number),
        businessName: t.business,
      },
      { now, transport: deps.transport, push: deps.push, types: deps.types },
    );
  } catch (err) {
    // The ticket is closed; a failed alert never reopens it.
    console.error(`[jobs/support] support.status alert failed ${errName(err)}`);
  }
}

export type JobSlaWarningResult = {
  warned: number;
  /** No CDS support address configured, or the address is suppressed. */
  skipped: number;
  failed: number;
};

export type JobSlaWarningDeps = {
  transport?: EmailTransport;
  send?: typeof sendEmail;
};

/** "1 day 20 hours", "4 hours", "35 minutes". */
function formatAge(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days > 0) {
    return hours > 0
      ? `${plural(days, "day")} ${plural(hours, "hour")}`
      : plural(days, "day");
  }
  if (hours > 0) return plural(hours, "hour");
  return plural(mins, "minute");
}

/** "3:00 pm today", "9:00 am tomorrow", "3:00 pm Tue Oct 20" (business time zone). */
function formatDue(due: Date, now: Date): string {
  const tz = BUSINESS_TIME_ZONE;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(due)
    .replace(/\s?AM$/i, " am")
    .replace(/\s?PM$/i, " pm");
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  if (day(due) === day(now)) return `${time} today`;
  if (day(due) === day(new Date(now.getTime() + 86_400_000))) {
    return `${time} tomorrow`;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(due)
    .replace(",", "");
  return `${time} ${date}`;
}

/**
 * Emails CDS staff (`support.sla_risk`, to the CDS_SUPPORT_EMAIL address) once per unanswered
 * Problem/Question ticket that is due within 4 business hours or already past due, stamping
 * `sla_warned_at` so the next run stays quiet. No address: nothing is sent or stamped (the
 * warning goes out once the address is set).
 */
export async function jobSlaWarnings(
  now: Date,
  deps: JobSlaWarningDeps = {},
): Promise<JobSlaWarningResult> {
  validNow(now);
  const sys = mintSystemContext({ job: "support" });
  const out: JobSlaWarningResult = { warned: 0, skipped: 0, failed: 0 };
  const rows = await withSuperuser((pb) =>
    pb.collection(THREADS).getList(1, JOB_SCAN_MAX, {
      filter:
        "kind = 'ticket' && status != 'closed' && status != 'resolved' && " +
        "first_reply_due_at != '' && first_replied_at = '' && sla_warned_at = ''",
      sort: "first_reply_due_at,id",
      skipTotal: true,
    }),
  );
  const atRisk = rows.items.filter((r) => {
    const s = slaOf(r, now);
    return s === "due_soon" || s === "missed";
  });
  if (atRisk.length === 0) return out;
  const to = supportEmail();
  const names = await withSuperuser((pb) =>
    orgNames(
      pb,
      atRisk.map((r) => str(r.organization)),
    ),
  );
  for (const r of atRisk) {
    if (!to) {
      out.skipped += 1;
      continue;
    }
    const created = Date.parse(str(r.created).replace(" ", "T"));
    const due = new Date(str(r.first_reply_due_at).replace(" ", "T"));
    try {
      const sent = await (deps.send ?? sendEmail)(
        { kind: "cds", ctx: sys, noReply: true },
        "support.sla_risk",
        to,
        {
          ticketNumber: Number(r.number) || 0,
          business: names.get(str(r.organization)) || "a site",
          typeLabel: typeLabel(typeOf(r.type)),
          age: formatAge(
            Number.isFinite(created) ? now.getTime() - created : 0,
          ),
          due: formatDue(due, now),
        },
        { transport: deps.transport, now },
      );
      if (sent.status !== "sent") {
        out.skipped += 1;
        continue;
      }
      await withSuperuser((pb) =>
        pb
          .collection(THREADS)
          .update(r.id, { sla_warned_at: now.toISOString() }),
      );
      out.warned += 1;
    } catch (err) {
      out.failed += 1;
      console.error(`[jobs/support] sla warning failed ${errName(err)}`);
    }
  }
  if (!to && out.skipped > 0) {
    console.warn("[jobs/support] sla warnings not sent: no support address");
  }
  return out;
}
