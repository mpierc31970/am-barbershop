// P12 paid-services boundary inside tickets (12-23; SUPPORT-03, D297, D299, BILL-19, BILL-20).
//
// - staffMarkPaidService: staff mark a Change request paid with a category; the ticket moves to
//   Waiting on you and the filer, Owners and Admins hear `support.status`.
// - paidPanelFor: the panel state for the hub (any member who reads Support); Care Plan minutes
//   only for callers with billing:read (the Owner).
// - requestPaidQuote / useCareHourForTicket: the Owner's choice (billing:write, never under
//   impersonation, D285; T-12-23-01). Choosing the Care hour counts as acceptance.
// - onWorkOrderSentForTicket / onWorkOrderAcceptedForTicket: work-order hooks (work-orders.ts)
//   that add their writes to the work order's own batch, so a quote and its ticket line commit
//   together. Accepting the quote is the only path that moves a paid ticket to In progress on
//   its own (T-12-23-02); otherwise the core guard keeps In progress shut until acceptance.
//
// `paid_service` holds tenant-safe data only (P12-P7). Every write carries a public system line
// and an audit row naming the actor (T-12-23-04). Logs carry error class names only.
import { InvalidInput, NotFound, authorizeStaff, can } from "@cds/core";
import { CARE_PLAN_MINUTES } from "@cds/core/payments";
import {
  isPaidCategory,
  paidAccepted,
  paidHelpId,
  parseTicketNumber,
  statusSubject,
  SUPPORT_COPY,
  type PaidPanelState,
  type PaidService,
  type TicketStatus,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import {
  ClientResponseError,
  type BatchService,
  type RecordModel,
} from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { carePlanUsage } from "../payments/care-time";
import { newRecordId, requirePermission } from "../repository";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import {
  MESSAGES,
  THREADS,
  assertMemberWriter,
  errName,
  firstNameOf,
  memberDisplayName,
} from "./shared";
import { staffTicketHref } from "./staff-tickets";
import { applyTicketTransition, ticketPaidView } from "./threads";

/** System lines (UI-SPEC "Paid service"). */
export const PAID_LINES = {
  MARKED: "This is a paid service",
  QUOTE_REQUESTED: "Quote requested",
  QUOTE_SENT: "CDS sent a quote",
  QUOTE_ACCEPTED: "Quote accepted",
} as const;

export function careChosenLine(firstName: string): string {
  return `${firstName} chose the Care hour`;
}

export function noCareMinutesCopy(monthLabel: string): string {
  return `No Care minutes left in ${monthLabel}.`;
}

export const PAID_NOT_ON_CARE_COPY = "This site doesn't have the Care Plan.";
export const PAID_ALREADY_CHOSEN_COPY =
  "You already chose how to handle this request.";

/** 12-REVIEW WR-A04: one open Care-hour request at a time (the hour is not split). */
export function careHourInUseCopy(number: number): string {
  return `Your Care hour is already on request #${number}. You can use it here once that one is resolved.`;
}

export type PaidClock = { now(): Date };
const SYSTEM_CLOCK: PaidClock = { now: () => new Date() };

export type PaidDeps = {
  clock?: PaidClock;
  transport?: SupportNotifyDeps["transport"];
  push?: SupportNotifyDeps["push"];
  types?: SupportNotifyDeps["types"];
};

export type PaidPanelStep =
  "none" | "quote_requested" | "quote_sent" | "accepted" | "care_chosen";

export type PaidCareView = {
  onPlan: boolean;
  minutesLeft: number;
  minutesIncluded: number;
  /** "October" (business time). */
  monthLabel: string;
};

/** The core PaidPanelState plus the dates and amounts the panel prints (choice 2). */
export type PaidPanelView = PaidPanelState & {
  state: PaidPanelStep;
  amountCents: number | null;
  quoteRequestedAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  careChosenAt: string | null;
  /** Only for callers with billing:read (the Owner); null otherwise. */
  care: PaidCareView | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clockNow(clock?: PaidClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function statusOf(v: unknown): TicketStatus {
  return v === "in_progress" ||
    v === "waiting_on_you" ||
    v === "resolved" ||
    v === "closed"
    ? v
    : "open";
}

function lockKey(number: number): string {
  return `support-paid:${number}`;
}

async function loadTicket(
  pb: PocketBase,
  number: number,
  orgId?: string,
): Promise<RecordModel> {
  const expr = orgId
    ? "number = {:n} && organization = {:org} && kind = 'ticket'"
    : "number = {:n} && kind = 'ticket'";
  try {
    return await pb
      .collection(THREADS)
      .getFirstListItem(pb.filter(expr, { n: number, org: orgId ?? "" }));
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
    .catch(() => null);
  return str(org?.name) || "your site";
}

/**
 * Adds one public system line (a paid event) to `batch` plus the thread's activity stamps.
 * CDS-side events also move last_cds_activity_at (the tenant's unread dot).
 */
function addPaidLine(
  batch: BatchService,
  thread: RecordModel,
  kind: string,
  label: string,
  now: Date,
  cdsSide: boolean,
): string {
  const id = newRecordId();
  const at = now.toISOString();
  batch.collection(MESSAGES).create({
    id,
    organization: thread.organization,
    thread: thread.id,
    author_kind: "system",
    author_user: "",
    author_staff: "",
    author_name: "CDS",
    body: "",
    visibility: "public",
    event: { kind, label, at },
    attachments: [],
  });
  batch.collection(THREADS).update(thread.id, {
    last_activity_at: at,
    ...(cdsSide ? { last_cds_activity_at: at } : {}),
  });
  return id;
}

function stepOf(p: PaidService): PaidPanelStep {
  if (p.care_chosen_at) return "care_chosen";
  if (p.accepted_at) return "accepted";
  if (p.work_order) return "quote_sent";
  if (p.quote_requested_at) return "quote_requested";
  return "none";
}

/** A member who chooses for the site: Owner (billing:write), a real person, never impersonated. */
function assertOwnerChooser(ctx: OrgContext): void {
  assertOrgContext(ctx);
  requirePermission(ctx, "billing", "write");
  assertMemberWriter(ctx);
}

// ---------------------------------------------------------------------------------------
// Staff (choice 1)

export type StaffMarkPaidInput = { number: number | string; category: string };

/**
 * Staff: mark a Change request a paid service. Only `change` tickets (InvalidInput otherwise),
 * category from PAID_CATEGORIES. Sets `paid_service = {category, marked_at}`, posts "This is a
 * paid service", moves the ticket to Waiting on you, writes `support.paid_marked`, then raises
 * `support.status` to the filer, Owners and Admins.
 */
export async function staffMarkPaidService(
  ctx: PlatformContext,
  input: StaffMarkPaidInput,
  deps: PaidDeps = {},
): Promise<{ orgId: string; number: number; raised: number; emailed: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_reply");
  const number = parseTicketNumber(input?.number);
  const category = input?.category;
  if (!isPaidCategory(category)) {
    throw new InvalidInput("unknown paid-service category");
  }
  const now = clockNow(deps.clock);

  const done = await withOrgLock(lockKey(number), () =>
    withSuperuser(async (pb) => {
      const thread = await loadTicket(pb, number);
      if (str(thread.type) !== "change") {
        throw new InvalidInput("only a Change request can be a paid service");
      }
      const from = statusOf(thread.status);
      if (from === "closed" || from === "resolved") {
        throw new InvalidInput("this ticket is finished; open a new one");
      }
      if (ticketPaidView(thread.paid_service)) {
        throw new InvalidInput("this ticket is already a paid service");
      }
      const paid: PaidService = { category, marked_at: now.toISOString() };
      const orgId = str(thread.organization);
      const batch = pb.createBatch();
      batch.collection(THREADS).update(thread.id, { paid_service: paid });
      const lineId = addPaidLine(
        batch,
        thread,
        "paid_marked",
        PAID_LINES.MARKED,
        now,
        true,
      );
      if (from !== "waiting_on_you") {
        applyTicketTransition(pb, batch, {
          thread: { ...thread, paid_service: paid } as RecordModel,
          event: "staff_set",
          to: "waiting_on_you",
          actor: ctx,
          now: new Date(now.getTime() + 1),
          afterMessageId: lineId,
        });
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.paid_marked",
          organization: orgId,
          targetCollection: THREADS,
          targetId: thread.id,
          meta: { number, category, from },
        }),
      );
      await batch.send();
      return {
        orgId,
        subject: str(thread.subject),
        filer: str(thread.opened_by),
        business: await orgNameOf(pb, orgId),
      };
    }),
  );

  let raised = 0;
  let emailed = 0;
  try {
    const r = await notifySupport(
      {
        orgId: done.orgId,
        as: ctx,
        type: "support.status",
        ticket: {
          number,
          subject: done.subject,
          status: "waiting_on_you",
          ...(done.filer ? { filer: done.filer } : {}),
        },
        title: statusSubject(number, "waiting_on_you"),
        href: staffTicketHref(number),
        businessName: done.business,
      },
      {
        now,
        transport: deps.transport,
        push: deps.push,
        types: deps.types,
      },
    );
    raised = r.raised;
    emailed = r.emailed;
  } catch (err) {
    // The mark is saved; a failed alert never undoes it.
    console.error(`[support] paid support.status alert failed ${errName(err)}`);
  }
  return { orgId: done.orgId, number, raised, emailed };
}

// ---------------------------------------------------------------------------------------
// Panel (choice 2)

/**
 * The paid panel for one ticket of the caller's org, or null when it is not a paid service.
 * `support:read`. `care` only when the caller has billing:read (the Owner), from carePlanUsage.
 */
export async function paidPanelFor(
  ctx: OrgContext,
  numberRaw: number | string,
  deps: { clock?: PaidClock } = {},
): Promise<PaidPanelView | null> {
  assertOrgContext(ctx);
  requirePermission(ctx, "support", "read");
  const number = parseTicketNumber(numberRaw);
  const now = clockNow(deps.clock);
  const paid = await withSuperuser(async (pb) =>
    ticketPaidView((await loadTicket(pb, number, ctx.orgId)).paid_service),
  );
  if (!paid) return null;

  let care: PaidCareView | null = null;
  if (can(ctx, "billing", "read")) {
    const usage = await carePlanUsage(ctx, { now: () => now });
    care = {
      onPlan: usage.on,
      minutesLeft: usage.on
        ? Math.max(0, CARE_PLAN_MINUTES - usage.usedMinutes)
        : 0,
      minutesIncluded: CARE_PLAN_MINUTES,
      monthLabel: usage.monthLabel,
    };
  }
  const accepted = paidAccepted(paid);
  return {
    category: paid.category,
    canChoose: can(ctx, "billing", "write") && !ctx.impersonator,
    helpId: paidHelpId(paid.category),
    quoteRequested: !!paid.quote_requested_at,
    quoteId: paid.work_order ?? null,
    accepted,
    careHourAvailable:
      !accepted && !!care && care.onPlan && care.minutesLeft > 0,
    careChosen: !!paid.care_chosen_at,
    state: stepOf(paid),
    amountCents: paid.amount_cents ?? null,
    quoteRequestedAt: paid.quote_requested_at ?? null,
    sentAt: paid.quote_sent_at ?? null,
    acceptedAt: paid.accepted_at ?? null,
    careChosenAt: paid.care_chosen_at ?? null,
    care,
  };
}

// ---------------------------------------------------------------------------------------
// Owner choices (choices 3 and 4)

/**
 * Owner: ask CDS for a quote (billing:write, never impersonated). Sets `quote_requested_at`
 * and posts "Quote requested"; staff see it in the CLI list. Idempotent: a second request
 * changes nothing. Refused once the request is accepted or the Care hour is chosen.
 */
export async function requestPaidQuote(
  ctx: OrgContext,
  numberRaw: number | string,
  deps: { clock?: PaidClock } = {},
): Promise<{ requested: boolean }> {
  assertOwnerChooser(ctx);
  const number = parseTicketNumber(numberRaw);
  const now = clockNow(deps.clock);
  return withOrgLock(lockKey(number), () =>
    withSuperuser(async (pb) => {
      const thread = await loadTicket(pb, number, ctx.orgId);
      const paid = ticketPaidView(thread.paid_service);
      if (!paid) throw new InvalidInput("this ticket is not a paid service");
      if (statusOf(thread.status) === "closed") {
        throw new InvalidInput(SUPPORT_COPY.CLOSED_NOTE);
      }
      if (paidAccepted(paid)) throw new InvalidInput(PAID_ALREADY_CHOSEN_COPY);
      if (paid.quote_requested_at) return { requested: false };
      const next: PaidService = {
        ...paid,
        quote_requested_at: now.toISOString(),
      };
      const batch = pb.createBatch();
      batch.collection(THREADS).update(thread.id, { paid_service: next });
      addPaidLine(
        batch,
        thread,
        "paid_quote_requested",
        PAID_LINES.QUOTE_REQUESTED,
        now,
        false,
      );
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "support.paid_quote_requested",
          targetCollection: THREADS,
          targetId: thread.id,
          meta: { number, category: paid.category },
        }),
      );
      await batch.send();
      return { requested: true };
    }),
  );
}

/**
 * Owner: use this month's Care hour on the request (billing:write, never impersonated). Needs
 * the Care Plan with minutes left (InvalidInput "No Care minutes left in {month}." otherwise).
 * Sets `care_chosen_at` / `care_chosen_by` and posts "{first name} chose the Care hour". This
 * counts as acceptance: staff may now move the ticket to In progress. Idempotent.
 */
export async function useCareHourForTicket(
  ctx: OrgContext,
  numberRaw: number | string,
  deps: { clock?: PaidClock } = {},
): Promise<{ chosen: boolean; minutesLeft: number; monthLabel: string }> {
  assertOwnerChooser(ctx);
  const number = parseTicketNumber(numberRaw);
  const now = clockNow(deps.clock);
  // 12-REVIEW WR-A04: the org-wide care lock makes "one open Care-hour request" race-free.
  return withOrgLock(`support-care:${ctx.orgId}`, () =>
    withOrgLock(lockKey(number), () => chooseCareHour(ctx, number, now)),
  );
}

async function chooseCareHour(
  ctx: OrgContext,
  number: number,
  now: Date,
): Promise<{ chosen: boolean; minutesLeft: number; monthLabel: string }> {
  const usage = await carePlanUsage(ctx, { now: () => now });
  const minutesLeft = usage.on
    ? Math.max(0, CARE_PLAN_MINUTES - usage.usedMinutes)
    : 0;
  return withSuperuser(async (pb) => {
    const thread = await loadTicket(pb, number, ctx.orgId);
    const paid = ticketPaidView(thread.paid_service);
    if (!paid) throw new InvalidInput("this ticket is not a paid service");
    if (statusOf(thread.status) === "closed") {
      throw new InvalidInput(SUPPORT_COPY.CLOSED_NOTE);
    }
    if (paid.care_chosen_at) {
      return { chosen: false, minutesLeft, monthLabel: usage.monthLabel };
    }
    if (paid.accepted_at) throw new InvalidInput(PAID_ALREADY_CHOSEN_COPY);
    if (!usage.on) throw new InvalidInput(PAID_NOT_ON_CARE_COPY);
    if (minutesLeft <= 0) {
      throw new InvalidInput(noCareMinutesCopy(usage.monthLabel));
    }
    // 12-REVIEW WR-A04: choosing reserves the hour. Logged minutes only count once CDS
    // logs them, so another open request already on the Care hour holds it until resolved.
    const busy = await openCareTicket(pb, ctx.orgId, thread.id);
    if (busy !== null) throw new InvalidInput(careHourInUseCopy(busy));
    const next: PaidService = {
      ...paid,
      care_chosen_at: now.toISOString(),
      care_chosen_by: ctx.actor,
    };
    const first = firstNameOf(
      await memberDisplayName(pb, ctx.actor),
      "Your owner",
    );
    const batch = pb.createBatch();
    batch.collection(THREADS).update(thread.id, { paid_service: next });
    addPaidLine(
      batch,
      thread,
      "paid_care_chosen",
      careChosenLine(first),
      now,
      false,
    );
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "support.paid_care_chosen",
        targetCollection: THREADS,
        targetId: thread.id,
        meta: {
          number,
          category: paid.category,
          minutesLeft,
          workOrder: paid.work_order ?? null,
        },
      }),
    );
    await batch.send();
    return { chosen: true, minutesLeft, monthLabel: usage.monthLabel };
  });
}

/** The number of another open (not resolved or closed) ticket on the Care hour, or null. */
async function openCareTicket(
  pb: PocketBase,
  orgId: string,
  exceptId: string,
): Promise<number | null> {
  const rows = await pb.collection(THREADS).getFullList({
    filter: pb.filter(
      "organization = {:org} && kind = 'ticket' && status != 'resolved' && status != 'closed' && id != {:id}",
      { org: orgId, id: exceptId },
    ),
    fields: "id,number,paid_service",
    sort: "number",
  });
  for (const r of rows) {
    if (ticketPaidView(r.paid_service)?.care_chosen_at) {
      return typeof r.number === "number" ? r.number : Number(r.number);
    }
  }
  return null;
}

/**
 * 12-REVIEW WR-A04: a quote linked to a ticket whose Care hour was chosen cannot be accepted
 * (the work is already covered). Called by acceptWorkOrder before anything is invoiced.
 */
export async function assertQuoteAcceptableForTicket(
  pb: PocketBase,
  orgId: string,
  ticket: number,
): Promise<void> {
  const found = await hookThread(pb, orgId, ticket);
  if (found?.paid.care_chosen_at) {
    throw new InvalidInput(PAID_ALREADY_CHOSEN_COPY);
  }
}

// ---------------------------------------------------------------------------------------
// Work-order hooks (choice 5). Called by payments/work-orders.ts inside its own superuser
// client; each loads the ticket, then adds its writes to the caller's batch (nothing is sent
// here), so the quote and the ticket commit together.

export type TicketLinkCheck = { threadId: string; paid: PaidService };

/**
 * The ticket a new work order links to: a ticket of the same org (T-12-23-03), marked paid,
 * not yet accepted. InvalidInput otherwise (a foreign ticket reads as "not a ticket of this
 * site", the same as a missing one).
 */
export async function checkWorkOrderTicket(
  pb: PocketBase,
  orgId: string,
  ticket: unknown,
): Promise<TicketLinkCheck> {
  if (
    typeof ticket !== "number" ||
    !Number.isSafeInteger(ticket) ||
    ticket < 1
  ) {
    throw new InvalidInput("ticket must be a ticket number");
  }
  let thread: RecordModel;
  try {
    thread = await loadTicket(pb, ticket, orgId);
  } catch (err) {
    if (err instanceof NotFound) {
      throw new InvalidInput(`ticket #${ticket} is not a ticket of this site`);
    }
    throw err;
  }
  const paid = ticketPaidView(thread.paid_service);
  if (!paid) {
    throw new InvalidInput(
      `ticket #${ticket} is not marked as a paid service (mark it first)`,
    );
  }
  if (statusOf(thread.status) === "closed") {
    throw new InvalidInput(`ticket #${ticket} is closed`);
  }
  if (paidAccepted(paid)) {
    throw new InvalidInput(
      `ticket #${ticket} is already accepted or uses the Care hour`,
    );
  }
  return { threadId: thread.id, paid };
}

async function hookThread(
  pb: PocketBase,
  orgId: string,
  ticket: number,
): Promise<{ thread: RecordModel; paid: PaidService } | null> {
  if (!Number.isSafeInteger(ticket) || ticket < 1) return null;
  const thread = await loadTicket(pb, ticket, orgId).catch((err: unknown) => {
    if (err instanceof NotFound) return null;
    throw err;
  });
  if (!thread || statusOf(thread.status) === "closed") return null;
  const paid = ticketPaidView(thread.paid_service);
  return paid ? { thread, paid } : null;
}

export type WorkOrderTicketHookInput = {
  orgId: string;
  ticket: number;
  workOrderId: string;
  amountCents: number;
  now: Date;
  actor: PlatformContext | OrgContext;
};

/**
 * A linked quote was sent: `work_order`, `quote_sent_at`, `amount_cents` and "CDS sent a
 * quote" join the caller's batch. Skipped (false) when the ticket is gone, closed, unmarked,
 * or already accepted.
 */
export async function onWorkOrderSentForTicket(
  pb: PocketBase,
  batch: BatchService,
  input: WorkOrderTicketHookInput,
): Promise<boolean> {
  const found = await hookThread(pb, input.orgId, input.ticket);
  if (!found || paidAccepted(found.paid)) return false;
  const { thread, paid } = found;
  const next: PaidService = {
    ...paid,
    work_order: input.workOrderId,
    quote_sent_at: input.now.toISOString(),
    amount_cents: input.amountCents,
  };
  batch.collection(THREADS).update(thread.id, { paid_service: next });
  addPaidLine(
    batch,
    thread,
    "paid_quote_sent",
    PAID_LINES.QUOTE_SENT,
    input.now,
    true,
  );
  batch.collection("audit_log").create(
    auditBody(input.actor, {
      action: "support.paid_quote_sent",
      organization: input.orgId,
      targetCollection: THREADS,
      targetId: thread.id,
      meta: {
        number: input.ticket,
        workOrder: input.workOrderId,
        amountCents: input.amountCents,
      },
    }),
  );
  return true;
}

/**
 * The owner accepted the linked quote: `accepted_at`, "Quote accepted" and the move to In
 * progress join the caller's batch. Only for the quote the ticket shows (`work_order`); the
 * accepted view is what opens the core guard.
 */
export async function onWorkOrderAcceptedForTicket(
  pb: PocketBase,
  batch: BatchService,
  input: Omit<WorkOrderTicketHookInput, "amountCents">,
): Promise<boolean> {
  const found = await hookThread(pb, input.orgId, input.ticket);
  if (!found || found.paid.work_order !== input.workOrderId) return false;
  const { thread, paid } = found;
  if (paid.accepted_at) return false;
  const next: PaidService = { ...paid, accepted_at: input.now.toISOString() };
  batch.collection(THREADS).update(thread.id, { paid_service: next });
  const lineId = addPaidLine(
    batch,
    thread,
    "paid_quote_accepted",
    PAID_LINES.QUOTE_ACCEPTED,
    input.now,
    false,
  );
  const from = statusOf(thread.status);
  if (from !== "in_progress") {
    applyTicketTransition(pb, batch, {
      thread: { ...thread, paid_service: next } as RecordModel,
      event: "staff_set",
      to: "in_progress",
      actor: input.actor,
      now: new Date(input.now.getTime() + 1),
      afterMessageId: lineId,
    });
  }
  batch.collection("audit_log").create(
    auditBody(input.actor, {
      action: "support.paid_quote_accepted",
      organization: input.orgId,
      targetCollection: THREADS,
      targetId: thread.id,
      meta: { number: input.ticket, workOrder: input.workOrderId, from },
    }),
  );
  return true;
}

// ---------------------------------------------------------------------------------------
// care:log --ticket (choice 6)

/**
 * Staff (`care_log`): the ticket ref to store with Care Plan time. A ref that parses as a
 * ticket number ("1042", "#1042") must be a ticket of `orgId` (InvalidInput otherwise) and is
 * stored as the bare number; any other ref is free text, returned as given.
 */
export async function staffCareTicketRef(
  ctx: PlatformContext,
  orgId: string,
  raw: string,
): Promise<string> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "care_log");
  const ref = raw.trim();
  if (!/^#?\d{1,10}$/.test(ref)) return ref;
  let number: number;
  try {
    number = parseTicketNumber(ref);
  } catch {
    return ref;
  }
  await withSuperuser(async (pb) => {
    try {
      await loadTicket(pb, number, orgId);
    } catch (err) {
      if (err instanceof NotFound) {
        throw new InvalidInput(
          `ticket #${number} is not a ticket of this site`,
        );
      }
      throw err;
    }
  });
  return String(number);
}
