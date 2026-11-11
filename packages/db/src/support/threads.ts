// P12 tickets, tenant side (12-15; COMM-06, COMM-07, COMM-08, COMM-09, SUPPORT-02; D94, D95,
// D211). Owners, Admins and Editors file typed tickets; every member reads them; replies and
// "This is solved" move the status through the one core table (`nextStatus`).
//
// - Numbers: one platform-wide sequence from #1001 (P12-P2). `platform_meta`
//   `support:ticket_seq` holds the last number; allocation takes max(seq, max(number), 1000) + 1
//   and retries on the unique index, then writes the counter.
// - Lookup by number filters by org in the query: another org's number is the same NotFound
//   as a missing one (T-12-15-01). The projection is an allowlist (T-12-15-04).
// - Silent context: a same-origin /hub path only, a short browser summary (never the full UA)
//   and the time (T-12-15-03).
// - Every move is audited `support.ticket_status` and posted as a system line (T-12-15-05).
import { InvalidInput, NotFound } from "@cds/core";
import {
  PAID_CATEGORY_KEYS,
  SUPPORT_COPY,
  TICKET_NUMBER_START,
  buildTargetOptions,
  businessDeadline,
  isTicketStatus,
  nextStatus,
  parseTicketNumber,
  slaApplies,
  systemLineFor,
  ticketTypesFor,
  validateTarget,
  type IncidentView,
  type PaidService,
  type TargetGroup,
  type TargetRef,
  type TenantTicket,
  type TicketEvent,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import {
  ClientResponseError,
  type BatchService,
  type RecordModel,
} from "pocketbase";
import { activeAddons } from "../addons/entitlements";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import type { OrgContext, PlatformContext, SystemContext } from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { beginSupportAction } from "../rate-limit";
import { assertId, newRecordId, requirePermission } from "../repository";
import type { ObjectStore } from "../storage";
import { readSupportRead } from "../today/prefs";
import {
  MESSAGES,
  THREADS,
  assertMemberWriter,
  cleanBody,
  memberDisplayName,
  postWithUploads,
  uploadTokens,
} from "./shared";

/** platform_meta key holding the last ticket number handed out (P12-P2). */
export const TICKET_SEQ_KEY = "support:ticket_seq";
/** Subject cap (P12-P5). */
export const TICKET_SUBJECT_MAX = 80;
/** "This is solved" undo window (P12-P9: 8 s toast plus grace). */
export const SOLVED_UNDO_MS = 30_000;
/** Number allocation attempts before giving up (P12-P2). */
const NUMBER_ATTEMPTS = 5;
const FROM_URL_MAX = 500;
const PLACEHOLDER_ORIGIN = "http://cds.invalid";

export type TicketClock = { now(): Date };
const SYSTEM_CLOCK: TicketClock = { now: () => new Date() };

export type TicketDeps = { store?: ObjectStore; clock?: TicketClock };

/** The silent context stored on the ticket (staff-only field). */
export type TicketContext = {
  url: string | null;
  browser: string | null;
  captured_at: string;
};

/** A ticket as the hub shows it, plus the detail-page extras (choice 3). */
export type TenantTicketDetail = TenantTicket & {
  firstRepliedAt: string | null;
  /** True when the ticket is linked to an incident (12-21 supplies the view). */
  hasIncident: boolean;
};

export type TicketListShow = "open" | "closed" | "all";

/** Who moved a ticket: the audit row's context. */
export type TransitionActor = OrgContext | PlatformContext | SystemContext;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function iso(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function clockNow(clock?: TicketClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function validNow(now: Date | undefined): Date {
  const d = now ?? new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput("now must be a valid date");
  }
  return d;
}

// ---------------------------------------------------------------------------------------
// Targets (choice 1)

/**
 * The target picker for this org (support:read): Whole site, the org's live pages (published,
 * not deleted, never the system 404 page) by title, active add-ons and site parts. Add-on
 * labels come from `opts.addonNames` (the caller has the registry; db never imports add-ons),
 * falling back to the slug.
 */
export async function ticketTargets(
  ctx: OrgContext,
  opts: { addonNames?: Readonly<Record<string, string>> } = {},
): Promise<TargetGroup[]> {
  requirePermission(ctx, "support", "read");
  const pages = await withSuperuser((pb) =>
    pb.collection("pages").getFullList({
      filter: pb.filter(
        "organization = {:org} && status = 'published' && deleted_at = '' && kind != 'system-404'",
        { org: ctx.orgId },
      ),
      sort: "title,id",
      fields: "id,title,slug",
    }),
  );
  const slugs = await activeAddons(ctx);
  const names = opts.addonNames ?? {};
  return buildTargetOptions({
    pages: pages.map((p) => ({
      id: p.id,
      title: str(p.title).trim() || str(p.slug) || "Untitled page",
    })),
    addons: slugs.map((slug) => ({
      slug,
      name: (Object.hasOwn(names, slug) ? str(names[slug]).trim() : "") || slug,
    })),
  });
}

// ---------------------------------------------------------------------------------------
// Silent context (choice 2, T-12-15-03)

/**
 * The referring hub path, or null. Accepts a relative `/hub…` path, or an absolute URL whose
 * origin equals `origin` (when the caller knows it). Never another site, never `//host`.
 */
export function ticketFromUrl(raw: unknown, origin?: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > FROM_URL_MAX || s.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (s.startsWith("/")) {
    if (s.startsWith("//") || url.origin !== PLACEHOLDER_ORIGIN) return null;
  } else {
    if (!origin) return null;
    let want: string;
    try {
      want = new URL(origin).origin;
    } catch {
      return null;
    }
    if (url.origin !== want) return null;
  }
  const path = url.pathname;
  if (path !== "/hub" && !path.startsWith("/hub/")) return null;
  return (path + url.search).slice(0, FROM_URL_MAX);
}

/** "Chrome on Windows": a short family + OS summary; never the full user-agent string. */
export function ticketBrowserSummary(ua: unknown): string | null {
  if (typeof ua !== "string" || !ua.trim()) return null;
  const u = ua.slice(0, 1000);
  let browser = "Other browser";
  if (/\bEdg(?:e|A|iOS)?\//.test(u)) browser = "Edge";
  else if (/\b(?:OPR|Opera)\//.test(u)) browser = "Opera";
  else if (/\bSamsungBrowser\//.test(u)) browser = "Samsung Internet";
  else if (/\b(?:Firefox|FxiOS)\//.test(u)) browser = "Firefox";
  else if (/\b(?:Chrome|CriOS|Chromium)\//.test(u)) browser = "Chrome";
  else if (/\bSafari\//.test(u) && /\bVersion\//.test(u)) browser = "Safari";
  let os = "";
  if (/\b(?:iPhone|iPad|iPod)\b/.test(u)) os = "iOS";
  else if (/\bAndroid\b/.test(u)) os = "Android";
  else if (/\bCrOS\b/.test(u)) os = "ChromeOS";
  else if (/\bWindows\b/.test(u)) os = "Windows";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(u)) os = "macOS";
  else if (/\bLinux\b/.test(u)) os = "Linux";
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------------------------------
// Numbers and the row (P12-P2)

async function highestNumber(pb: PocketBase): Promise<number> {
  const res = await pb.collection(THREADS).getList(1, 1, {
    filter: "number > 0",
    sort: "-number",
    fields: "number",
    skipTotal: true,
  });
  const n = Number(res.items[0]?.number ?? 0);
  return Number.isSafeInteger(n) ? n : 0;
}

async function metaRow(pb: PocketBase): Promise<RecordModel | null> {
  try {
    return await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:key}", { key: TICKET_SEQ_KEY }));
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

async function readSeq(pb: PocketBase): Promise<number> {
  const row = await metaRow(pb);
  const n = Number(str(row?.value) || 0);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Moves the counter forward to `n` (never backwards; a lost race is harmless). */
async function writeSeq(pb: PocketBase, n: number): Promise<void> {
  const row = await metaRow(pb);
  if (row) {
    const cur = Number(str(row.value) || 0);
    if (Number.isSafeInteger(cur) && cur >= n) return;
    await pb.collection("platform_meta").update(row.id, { value: String(n) });
    return;
  }
  try {
    await pb
      .collection("platform_meta")
      .create({ key: TICKET_SEQ_KEY, value: String(n) });
  } catch (err) {
    // Lost the create race on the unique key: move the winner's row instead.
    if (!(err instanceof ClientResponseError) || err.status !== 400) throw err;
    if (!(await metaRow(pb))) throw err;
    await writeSeq(pb, n);
  }
}

export type CreateTicketInput = {
  orgId: string;
  type: TicketType;
  subject: string;
  target: TargetRef;
  context?: TicketContext | null;
  /** The member who filed it (users id), when a member did. */
  openedBy?: string;
  /** CDS opened it (D210; staffOpenTicket, 12-18). */
  openedByCds?: boolean;
  openedByStaff?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  now: Date;
};

/**
 * Creates one ticket row with the next platform-wide number (P12-P2): status `open`, the SLA
 * due date for Problem and Question (SUPPORT-02), activity stamps at `now`. Retries the unique
 * index up to 5 times, then moves `support:ticket_seq`. Internal building block for
 * fileTicket, staffOpenTicket (12-18) and suggestions (12-22); callers check permissions.
 */
export async function createTicketRow(
  pb: PocketBase,
  input: CreateTicketInput,
): Promise<RecordModel> {
  assertId(input.orgId);
  const at = input.now.toISOString();
  const due = slaApplies(input.type)
    ? businessDeadline(input.now, 2).toISOString()
    : "";
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
    const number =
      Math.max(
        await readSeq(pb),
        await highestNumber(pb),
        TICKET_NUMBER_START - 1,
      ) + 1;
    try {
      const row = await pb.collection(THREADS).create({
        id: newRecordId(),
        organization: input.orgId,
        kind: "ticket",
        number,
        type: input.type,
        subject: input.subject,
        status: "open",
        target: {
          kind: input.target.kind,
          id: input.target.id,
          label: input.target.label,
        },
        context: input.context ?? null,
        opened_by: input.openedBy ?? "",
        opened_by_cds: input.openedByCds === true,
        opened_by_staff: input.openedByStaff ?? "",
        priority: input.priority ?? "normal",
        first_reply_due_at: due,
        last_activity_at: at,
      });
      await writeSeq(pb, number).catch(() => undefined);
      return row;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new InvalidInput("could not number the ticket; try again");
}

// ---------------------------------------------------------------------------------------
// Projection (choice 3, T-12-15-04)

function targetOf(v: unknown): TargetRef {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    const kind = r.kind;
    if (
      (kind === "site" ||
        kind === "page" ||
        kind === "addon" ||
        kind === "part") &&
      typeof r.id === "string"
    ) {
      return { kind, id: r.id, label: str(r.label) || r.id };
    }
  }
  return { kind: "site", id: "site", label: "Whole site" };
}

const PAID_STR_KEYS = [
  "marked_at",
  "quote_requested_at",
  "work_order",
  "quote_sent_at",
  "accepted_at",
  "care_chosen_at",
  "care_chosen_by",
] as const;

/** The P12-P7 shape only; anything else in the json is dropped. */
export function ticketPaidView(v: unknown): PaidService | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const category = r.category;
  if (
    typeof category !== "string" ||
    !(PAID_CATEGORY_KEYS as readonly string[]).includes(category)
  ) {
    return null;
  }
  const out: PaidService = {
    category: category as PaidService["category"],
    marked_at: str(r.marked_at),
  };
  for (const k of PAID_STR_KEYS) {
    if (k === "marked_at") continue;
    if (typeof r[k] === "string" && r[k] !== "") out[k] = r[k] as string;
  }
  if (
    typeof r.amount_cents === "number" &&
    Number.isSafeInteger(r.amount_cents)
  ) {
    out.amount_cents = r.amount_cents;
  }
  return out;
}

function typeOf(v: unknown): TicketType {
  return v === "change" ||
    v === "question" ||
    v === "billing" ||
    v === "suggestion"
    ? v
    : "problem";
}

function unreadOf(row: RecordModel, read: Readonly<Record<string, string>>) {
  const cds = Date.parse(str(row.last_cds_activity_at));
  if (!Number.isFinite(cds)) return false;
  const seen = Date.parse(read[row.id] ?? "");
  return !Number.isFinite(seen) || seen < cds;
}

/** Allowlist projection: never assignee, priority, staff ids, context or SLA stamps. */
export function toTenantTicket(
  row: RecordModel,
  unread: boolean,
  incident: IncidentView | null = null,
): TenantTicket {
  return {
    id: row.id,
    number: Number(row.number) || 0,
    type: typeOf(row.type),
    subject: str(row.subject),
    status: isTicketStatus(row.status) ? row.status : "open",
    target: targetOf(row.target),
    openedByCds: row.opened_by_cds === true,
    paid: ticketPaidView(row.paid_service),
    incident,
    lastActivityAt: str(row.last_activity_at),
    resolvedAt: iso(row.resolved_at),
    closedAt: iso(row.closed_at),
    created: str(row.created),
    unread,
  };
}

function toDetail(
  row: RecordModel,
  read: Readonly<Record<string, string>>,
): TenantTicketDetail {
  return {
    ...toTenantTicket(row, unreadOf(row, read)),
    firstRepliedAt: iso(row.first_replied_at),
    hasIncident: str(row.incident) !== "",
  };
}

/** The org's ticket with this number, or NotFound (missing and foreign look the same). */
async function loadTicketByNumber(
  pb: PocketBase,
  orgId: string,
  raw: unknown,
): Promise<RecordModel> {
  const n = parseTicketNumber(raw);
  assertId(orgId);
  try {
    return await pb.collection(THREADS).getFirstListItem(
      pb.filter("number = {:n} && organization = {:org} && kind = 'ticket'", {
        n,
        org: orgId,
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound("ticket not found");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------
// Transitions (choice 5)

export type TransitionInput = {
  thread: RecordModel;
  event: TicketEvent;
  /** staff_set target, or the stored previous status for undo_solved. */
  to?: TicketStatus;
  actor: TransitionActor;
  now: Date;
  /**
   * A message created in the same batch that the system line must follow. Rows created in one
   * batch can share a `created` millisecond; threads sort `created,id`, so the line's id is
   * made to sort after this one.
   */
  afterMessageId?: string;
  /**
   * 13-16 choice 4: the staff user credited for the ticket when this move lands on Resolved
   * (`rated_agent`). Callers compute it with `ratedAgentFor` before building the batch;
   * omitted falls back to the thread's assignee.
   */
  ratedAgent?: string;
};

const STAFF_ID_RE = /^[a-z0-9]{15}$/;

/**
 * Who gets the credit when a ticket is resolved (P13-P18): the assignee (the one being set in
 * the same move wins), else a public staff reply posted in the same batch, else the author of
 * the newest public staff-authored message. Empty when no staff member ever replied.
 */
export async function ratedAgentFor(
  pb: PocketBase,
  thread: RecordModel,
  opts: { assignee?: string; pendingReplier?: string } = {},
): Promise<string> {
  const assignee =
    opts.assignee !== undefined ? opts.assignee : str(thread.assignee);
  if (STAFF_ID_RE.test(assignee)) return assignee;
  if (opts.pendingReplier && STAFF_ID_RE.test(opts.pendingReplier)) {
    return opts.pendingReplier;
  }
  const last = await pb.collection(MESSAGES).getList(1, 1, {
    filter: pb.filter(
      "thread = {:t} && author_kind = 'staff' && visibility = 'public' && author_staff != ''",
      { t: thread.id },
    ),
    sort: "-created,-id",
    fields: "id,author_staff",
    skipTotal: true,
  });
  const who = str(last.items[0]?.author_staff);
  return STAFF_ID_RE.test(who) ? who : "";
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_ORDER = [...ID_CHARS].sort().join("");

/** A fresh record id that sorts after `after` (random when `after` starts with the last char). */
function idAfter(after: string | undefined): string {
  const id = newRecordId();
  if (!after) return id;
  const i = ID_ORDER.indexOf(after[0] ?? "");
  if (i < 0 || i >= ID_ORDER.length - 1) return id;
  const first =
    ID_ORDER[i + 1 + Math.floor(Math.random() * (ID_ORDER.length - 1 - i))]!;
  return first + id.slice(1);
}

type StoredEvent = {
  kind: TicketEvent;
  from: TicketStatus;
  to: TicketStatus;
  label: string;
  at: string;
};

/**
 * Adds one status move to `batch` through the core table: the thread update (resolved_at /
 * closed_at stamped, resolved_at cleared when it leaves Resolved), a public system line
 * (event `{kind, from, to, label, at}`; none for an undo), and an audit row
 * `support.ticket_status`. A move that changes nothing adds nothing. Returns `{from, to}`.
 * Staff moves (12-18) and the job (12-31) reuse it.
 */
export function applyTicketTransition(
  pb: PocketBase,
  batch: BatchService,
  input: TransitionInput,
): { from: TicketStatus; to: TicketStatus; messageId: string | null } {
  void pb;
  const { thread, event, actor, now } = input;
  if (str(thread.kind) !== "ticket") throw new InvalidInput("not a ticket");
  const from: TicketStatus = isTicketStatus(thread.status)
    ? thread.status
    : "open";
  const to = nextStatus(from, event, input.to, {
    paid: ticketPaidView(thread.paid_service),
  });
  if (to === from) return { from, to, messageId: null };
  const at = now.toISOString();
  const cdsMove = event === "staff_set" || event === "auto_close";
  const update: Record<string, unknown> = {
    status: to,
    last_activity_at: at,
  };
  if (to === "resolved") {
    update.resolved_at = at;
    // 13-16 choice 4 (P13-P18, P13-P32): credit the agent and reopen the follow-up flag.
    const agent = input.ratedAgent ?? str(thread.assignee);
    update.rated_agent = STAFF_ID_RE.test(agent) ? agent : "";
    update.rating_followed_at = "";
  } else if (to !== "closed") {
    update.resolved_at = "";
    // WR-A13: leaving Resolved for more work drops the old rating, so it is never credited
    // to whoever resolves it next. The audit log (`support.rated`) keeps the history.
    if (from === "resolved") {
      update.rating = "";
      update.rating_comment = "";
      update.rated_at = "";
      update.rated_by = "";
      update.rating_followed_at = "";
    }
  }
  if (to === "closed") update.closed_at = at;
  const label = systemLineFor(from, to, event);
  let messageId: string | null = null;
  if (label) {
    messageId = idAfter(input.afterMessageId);
    const ev: StoredEvent = { kind: event, from, to, label, at };
    batch.collection(MESSAGES).create({
      id: messageId,
      organization: thread.organization,
      thread: thread.id,
      author_kind: "system",
      author_user: "",
      author_staff: "",
      author_name: "CDS",
      body: "",
      visibility: "public",
      event: ev,
      attachments: [],
    });
    if (cdsMove) update.last_cds_activity_at = at;
  }
  batch.collection(THREADS).update(thread.id, update);
  batch.collection("audit_log").create(
    auditBody(actor, {
      action: "support.ticket_status",
      organization: str(thread.organization),
      targetCollection: THREADS,
      targetId: thread.id,
      meta: { number: Number(thread.number) || 0, event, from, to },
    }),
  );
  return { from, to, messageId };
}

// ---------------------------------------------------------------------------------------
// Members: file, read, list (choices 2-4)

export type FileTicketInput = {
  type: TicketType;
  /** `{kind,id}` or `"kind:id"`; validated against ticketTargets (never trusted). */
  target?: unknown;
  subject: string;
  body: string;
  uploadTokens?: readonly string[];
  /** The referring hub URL (`?from=`). Kept only when it is a same-origin /hub path. */
  fromUrl?: string | null;
  userAgent?: string | null;
  /** The app's own origin, to accept an absolute `fromUrl`. */
  origin?: string;
  addonNames?: Readonly<Record<string, string>>;
};

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

/**
 * Files a ticket (support:write; Viewers Forbidden, impersonation refused). Types come from
 * `ticketTypesFor(role)` minus `suggestion` (12-22 files those). 20 tickets a day per org.
 * The first message carries the description and up to 5 staged uploads; audited
 * `support.ticket_filed` (number and type, never the text). Returns the number.
 */
export async function fileTicket(
  ctx: OrgContext,
  input: FileTicketInput,
  deps: TicketDeps = {},
): Promise<{ number: number; id: string }> {
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  const type = input?.type;
  const allowed: TicketType[] = ticketTypesFor(ctx.role).filter(
    (t) => t !== "suggestion",
  );
  if (typeof type !== "string" || !allowed.includes(type as TicketType)) {
    throw new InvalidInput("choose a ticket type");
  }
  const subject = cleanSubject(input.subject);
  const tokens = uploadTokens(input.uploadTokens);
  if (typeof input.body !== "string" || !input.body.trim()) {
    throw new InvalidInput("tell us more");
  }
  const body = cleanBody(input.body, tokens.length);
  const options = await ticketTargets(ctx, { addonNames: input.addonNames });
  const target = validateTarget(input.target, options);
  const now = clockNow(deps.clock);
  beginSupportAction("ticket", { orgId: ctx.orgId });
  const context: TicketContext = {
    url: ticketFromUrl(input.fromUrl, input.origin),
    browser: ticketBrowserSummary(input.userAgent),
    captured_at: now.toISOString(),
  };
  return withSuperuser(async (pb) => {
    const authorName = await memberDisplayName(pb, ctx.actor);
    const thread = await createTicketRow(pb, {
      orgId: ctx.orgId,
      type: type as TicketType,
      subject,
      target,
      context,
      openedBy: ctx.actor,
      now,
    });
    const number = Number(thread.number);
    try {
      await postWithUploads(
        pb,
        ctx,
        {
          orgId: ctx.orgId,
          thread,
          authorKind: "member",
          authorUser: ctx.actor,
          authorName,
          body,
          visibility: "public",
        },
        tokens,
        (batch, messageId, files) => {
          batch.collection("audit_log").create(
            auditBody(ctx, {
              action: "support.ticket_filed",
              organization: ctx.orgId,
              targetCollection: THREADS,
              targetId: thread.id,
              meta: { number, type, files, message: messageId },
            }),
          );
        },
        now,
        { store: deps.store },
      );
    } catch (err) {
      // The first message failed: no ticket without its description.
      await pb
        .collection(THREADS)
        .delete(thread.id)
        .catch(() => undefined);
      throw err;
    }
    return { number, id: thread.id };
  });
}

/** One ticket of this org by number (support:read). Junk, missing and foreign: NotFound. */
export async function getTicketByNumber(
  ctx: OrgContext,
  raw: unknown,
): Promise<TenantTicketDetail> {
  requirePermission(ctx, "support", "read");
  const row = await withSuperuser((pb) =>
    loadTicketByNumber(pb, ctx.orgId, raw),
  );
  return toDetail(row, await readSupportRead(ctx));
}

/**
 * The org's tickets (support:read). `open` = not Closed (default), `closed`, or `all`.
 * Waiting on you first, then newest activity. `unread` = CDS activity after this person's
 * last read.
 */
export async function listTickets(
  ctx: OrgContext,
  opts: { show?: TicketListShow } = {},
): Promise<TenantTicket[]> {
  requirePermission(ctx, "support", "read");
  const show = opts.show ?? "open";
  if (show !== "open" && show !== "closed" && show !== "all") {
    throw new InvalidInput("show must be open, closed or all");
  }
  const filter =
    show === "open"
      ? "organization = {:org} && kind = 'ticket' && status != 'closed'"
      : show === "closed"
        ? "organization = {:org} && kind = 'ticket' && status = 'closed'"
        : "organization = {:org} && kind = 'ticket'";
  const rows = await withSuperuser((pb) =>
    pb.collection(THREADS).getList(1, 500, {
      filter: pb.filter(filter, { org: ctx.orgId }),
      sort: "-last_activity_at,-number",
      skipTotal: true,
    }),
  );
  const read = await readSupportRead(ctx);
  const tickets = rows.items.map((r) => toTenantTicket(r, unreadOf(r, read)));
  return [
    ...tickets.filter((t) => t.status === "waiting_on_you"),
    ...tickets.filter((t) => t.status !== "waiting_on_you"),
  ];
}

// ---------------------------------------------------------------------------------------
// Lifecycle (choices 6-7)

/**
 * A member's reply on a ticket (support:write, 60/hour/person). Closed → InvalidInput
 * CLOSED-NOTE. Waiting on you → In progress ("Back to CDS"); Resolved → In progress
 * ("Reopened by your reply"). Message, move and audit land in one batch. No tenant alert.
 */
export async function replyToTicket(
  ctx: OrgContext,
  number: unknown,
  input: { body?: string; uploadTokens?: readonly string[] },
  deps: TicketDeps = {},
): Promise<{ messageId: string; status: TicketStatus }> {
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  const tokens = uploadTokens(input?.uploadTokens);
  const body = cleanBody(input?.body, tokens.length);
  const now = clockNow(deps.clock);
  return withSuperuser(async (pb) => {
    const thread = await loadTicketByNumber(pb, ctx.orgId, number);
    if (thread.status === "closed") {
      throw new InvalidInput(SUPPORT_COPY.CLOSED_NOTE);
    }
    beginSupportAction("message", { orgId: ctx.orgId, actorId: ctx.actor });
    const authorName = await memberDisplayName(pb, ctx.actor);
    let status: TicketStatus = isTicketStatus(thread.status)
      ? thread.status
      : "open";
    const posted = await postWithUploads(
      pb,
      ctx,
      {
        orgId: ctx.orgId,
        thread,
        authorKind: "member",
        authorUser: ctx.actor,
        authorName,
        body,
        visibility: "public",
      },
      tokens,
      (batch, messageId, files) => {
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "support.message_posted",
            organization: ctx.orgId,
            targetCollection: MESSAGES,
            targetId: messageId,
            meta: {
              thread: thread.id,
              kind: "ticket",
              number: Number(thread.number) || 0,
              files,
            },
          }),
        );
        // Stamps after the reply's own touch, so the system line sorts after it.
        const moved = applyTicketTransition(pb, batch, {
          thread,
          event: "tenant_reply",
          actor: ctx,
          now: new Date(now.getTime() + 1),
          afterMessageId: messageId,
        });
        status = moved.to;
      },
      now,
      { store: deps.store },
    );
    return { messageId: posted.id, status };
  });
}

/**
 * "This is solved" (support:write): Open, In progress or Waiting on you → Resolved, with the
 * system line "Marked as solved" (its event stores the previous status for the undo).
 */
export async function markTicketSolved(
  ctx: OrgContext,
  number: unknown,
  now?: Date,
): Promise<{ from: TicketStatus; to: TicketStatus }> {
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  const at = validNow(now);
  return withSuperuser(async (pb) => {
    const thread = await loadTicketByNumber(pb, ctx.orgId, number);
    const status = str(thread.status);
    if (
      status !== "open" &&
      status !== "in_progress" &&
      status !== "waiting_on_you"
    ) {
      throw new InvalidInput(
        status === "closed"
          ? SUPPORT_COPY.CLOSED_NOTE
          : SUPPORT_COPY.ALREADY_RESOLVED,
      );
    }
    const ratedAgent = await ratedAgentFor(pb, thread);
    const batch = pb.createBatch();
    const moved = applyTicketTransition(pb, batch, {
      thread,
      event: "tenant_solved",
      actor: ctx,
      now: at,
      ratedAgent,
    });
    await batch.send();
    return { from: moved.from, to: moved.to };
  });
}

function storedEvent(v: unknown): StoredEvent | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.kind !== "string" ||
    !isTicketStatus(r.from) ||
    !isTicketStatus(r.to) ||
    typeof r.at !== "string"
  ) {
    return null;
  }
  return r as unknown as StoredEvent;
}

/**
 * Undo "This is solved" (P12-P9): within 30 s of the "Marked as solved" line and only while it
 * is still the ticket's latest message. Restores the stored previous status and deletes the
 * line; audited. Anything else → InvalidInput.
 */
export async function undoMarkTicketSolved(
  ctx: OrgContext,
  number: unknown,
  now?: Date,
): Promise<{ from: TicketStatus; to: TicketStatus }> {
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  const at = validNow(now);
  return withSuperuser(async (pb) => {
    const thread = await loadTicketByNumber(pb, ctx.orgId, number);
    if (thread.status !== "resolved") {
      throw new InvalidInput(
        thread.status === "closed"
          ? SUPPORT_COPY.CLOSED_NOTE
          : SUPPORT_COPY.NOTHING_TO_UNDO,
      );
    }
    const last = await pb.collection(MESSAGES).getList(1, 1, {
      filter: pb.filter(
        "thread = {:t} && organization = {:org} && visibility = 'public'",
        { t: thread.id, org: ctx.orgId },
      ),
      sort: "-created,-id",
      skipTotal: true,
    });
    const line = last.items[0];
    const ev = line ? storedEvent(line.event) : null;
    if (
      !line ||
      line.author_kind !== "system" ||
      !ev ||
      ev.kind !== "tenant_solved" ||
      ev.to !== "resolved"
    ) {
      // A reply or a staff move came after "Marked as solved": the undo window is gone.
      throw new InvalidInput(SUPPORT_COPY.UNDO_TOO_LATE);
    }
    const elapsed = at.getTime() - Date.parse(ev.at);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > SOLVED_UNDO_MS) {
      throw new InvalidInput(SUPPORT_COPY.UNDO_TOO_LATE);
    }
    const batch = pb.createBatch();
    const moved = applyTicketTransition(pb, batch, {
      thread,
      event: "undo_solved",
      to: ev.from,
      actor: ctx,
      now: at,
    });
    batch.collection(MESSAGES).delete(line.id);
    await batch.send();
    return { from: moved.from, to: moved.to };
  });
}
