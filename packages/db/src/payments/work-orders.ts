// P10 payments: one-off quotes and invoices for paid work (10-26; BILL-20, BILL-19, BILL-16;
// CONTEXT A4; D263, D297, D298, D299; invariants 1 and 10).
//
// `work_orders` is CDS's quote for extra work: design polish in 3-hour blocks, a fixed-price
// custom block, or a private / premium add-on (50% deposit, the balance on delivery, plus a
// monthly maintenance item). The lifecycle, and the gate staff check before any paid work:
//   draft --send--> sent --owner accepts--> accepted --invoice paid--> paid (polish, custom)
//                                                     \-> deposit_paid --deliver--> delivered
//                                                                       --balance paid--> paid
//   sent --owner declines--> declined;  sent past valid_until --> expired (lazy, choice 4)
// No paid work starts before acceptance: `deliverWorkOrder` refuses anything not paid.
//
// Staff (platform context): create / send need `work_quote` (super_admin, support_agent);
// deliver needs `work_deliver` (super_admin only, T-10-26-01). Owner (org context): accept
// and decline need `purchases:run` (Owner only, never under impersonation); reads need
// `billing:read`. Every owner lookup is by id AND organization = ctx.orgId (T-10-26-02).
// Every state change commits with its `work_order.*` audit row in one PB batch.
// Scope text is sanitised with the P3 sanitizer before storage (T-10-26-03). Provider
// invoice ids and the staff author never leave the server (toBrowser, D187).
//
// 12-23 (SUPPORT-03): an optional `ticket` links a quote to a paid-service support ticket of the
// same org (T-12-23-03). Sending and accepting add the ticket's panel update, system line and
// audit row to the work order's own batch (support/paid.ts); accepting moves the ticket to In
// progress. Without `ticket` nothing changes.
import { authorizeStaff, InvalidInput, NotFound, toBrowser } from "@cds/core";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import {
  BUSINESS_TIME_ZONE,
  type BillingLine,
  type CdsBilling,
} from "@cds/core/payments";
import { formatCents } from "@cds/core/pricing";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { installAddonAsStaff } from "../addons/installer";
import type { AddonDeps } from "../addons/types";
import { auditBody } from "../audit";
import { readPriceCatalog } from "../catalog";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  assertPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { newRecordId, requirePermission } from "../repository";
import { billingAccountByOrg, billingOwnerOf } from "./accounts";
import { getCdsBilling } from "./factory";
import { invoiceMirrorOf } from "./invoices";
import { staffAlertAddress } from "../media/ops/alerts";
import {
  assertQuoteAcceptableForTicket,
  checkWorkOrderTicket,
  onWorkOrderAcceptedForTicket,
  onWorkOrderSentForTicket,
} from "../support/paid";

const COLLECTION = "work_orders";
const ORG_RE = /^[a-z0-9]{15}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TITLE_MAX = 120;
const SCOPE_MAX = 8000;
const BLOCK_HOURS = 3;
const BLOCKS_MIN = 1;
const BLOCKS_MAX = 10;
/** D297: $110-135/hr while the catalog rate is unset (RESEARCH open question 1). */
const RATE_MIN = 11000;
const RATE_MAX = 13500;
/** Sanity cap on a quoted price ($50,000); D297 gives no ceiling. */
const TOTAL_MAX = 5_000_000;
/** D297 maintenance ranges, cents per month (choice 2). */
const MAINTENANCE: Record<
  "private_addon" | "premium_addon",
  { min: number; max: number }
> = {
  private_addon: { min: 2500, max: 7500 },
  premium_addon: { min: 7500, max: 15000 },
};
const VALID_DAYS = 30;
const DAY_MS = 86_400_000;
const QUOTES_PATH = "/hub/settings/quotes";
const BILLING_TAB = "/hub/settings?tab=billing";

export type WorkOrderKind =
  "polish" | "custom_block" | "private_addon" | "premium_addon";

export type WorkOrderStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "deposit_paid"
  | "delivered"
  | "paid"
  | "declined"
  | "expired";

/** What an owner ever sees: every status but draft. */
export type OwnerWorkOrderStatus = Exclude<WorkOrderStatus, "draft">;

const KINDS = new Set<string>([
  "polish",
  "custom_block",
  "private_addon",
  "premium_addon",
]);
const STATUSES = new Set<string>([
  "draft",
  "sent",
  "accepted",
  "deposit_paid",
  "delivered",
  "paid",
  "declined",
  "expired",
]);

/** Locked copy (UI-SPEC "Quote page" and CONTEXT A4). */
export const WORK_ORDER_EXPIRED_COPY =
  "This quote has expired. Ask Support for a new one.";
export const WORK_ORDER_ANSWERED_COPY = "This quote was already answered.";
export const WORK_ORDER_NOT_ACCEPTED_COPY =
  "No paid work starts before acceptance: the owner hasn't accepted this quote.";
export const WORK_ORDER_UNPAID_COPY =
  "No paid work starts before payment: the acceptance invoice isn't paid yet.";
export const WORK_ORDER_NO_CARD_COPY =
  "Finish checkout first: quotes are paid on the same account as your monthly bill.";

export type CreateWorkOrderInput = {
  orgId: string;
  kind: WorkOrderKind;
  title: string;
  /** HTML (the CLI renders the staff markdown); sanitised here before storage. */
  scope: string;
  /** polish only: 3-hour blocks, 1-10. */
  blocks?: number;
  /** polish only, and only while the catalog's polish-hour rate is unset (11000-13500). */
  rateCents?: number;
  /** custom_block, private_addon, premium_addon: the quoted price in cents. */
  totalCents?: number;
  /** private_addon (2500-7500) and premium_addon (7500-15000), cents per month. */
  maintenanceCents?: number;
  /** The add-on to install on delivery (required for private_addon). */
  addonSlug?: string;
  /**
   * 12-23 (SUPPORT-03): the support ticket number this quote answers. It must be a ticket of
   * the same org marked as a paid service and not yet accepted; send and accept then update
   * the ticket's paid panel.
   */
  ticket?: number;
};

export type WorkOrderPriceRow = { label: string; amountLabel: string };

/** The quote as the owner will see it (CLI preview and the quote page's receipt). */
export type WorkOrderPreview = {
  orgId: string;
  orgName: string;
  kind: WorkOrderKind;
  title: string;
  scopeHtml: string;
  blocks: number;
  rateCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  maintenanceCents: number;
  addonSlug: string;
  priceRows: WorkOrderPriceRow[];
  /** What the owner pays on acceptance: the full price or the deposit. */
  payNowCents: number;
  /** 12-23: the linked support ticket number, 0 for none. */
  ticket: number;
};

/** One quote in the owner's Billing tab list (UI `WorkOrderSummary`). */
export type WorkOrderSummary = {
  id: string;
  title: string;
  status: OwnerWorkOrderStatus;
  /** "8 Oct". */
  sentLabel: string;
  totalCents: number;
  href: string;
  /**
   * 11-19 (DASH-33, Today work-in-progress card): where open work stands. `ordered` =
   * accepted, waiting on its invoice; `setting_up` = paid (deposit, or in full and not yet
   * delivered); null = not open (sent, delivered, fully paid and delivered, declined, expired).
   */
  setup: "ordered" | "setting_up" | null;
  /** "9 Oct" when accepted, else "". */
  acceptedLabel: string;
};

/** The owner's quote page data (UI `QuoteView`). No provider ids. */
export type WorkOrderView = {
  id: string;
  title: string;
  status: OwnerWorkOrderStatus;
  metaLine: string;
  scopeHtml: string;
  kind: WorkOrderKind;
  priceRows: WorkOrderPriceRow[];
  payNowCents: number;
  acceptedLabel: string | null;
  deliveredLabel: string | null;
  statusDateLabel: string | null;
  payHref: string | null;
  canAct: boolean;
  impersonating: boolean;
};

export type WorkOrderDeps = {
  billing?: CdsBilling;
  now?: () => Date;
  transport?: EmailTransport;
  /** deliver: the add-on deps for a staff install (required when the order names an add-on). */
  addons?: AddonDeps;
};

/** Stored row (server-only: carries the invoice ids). */
type Row = {
  id: string;
  organization: string;
  kind: WorkOrderKind;
  title: string;
  scope: string;
  blocks: number;
  rateCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  maintenanceCents: number;
  addonSlug: string;
  status: WorkOrderStatus;
  sentAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  paidAt: string | null;
  declinedAt: string | null;
  depositInvoiceId: string;
  balanceInvoiceId: string;
  /** 12-23: linked support ticket number, 0 for none. */
  ticket: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : 0;
}

function dateOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s.replace(" ", "T");
}

function toRow(r: RecordModel): Row {
  const kind = str(r.kind);
  const status = str(r.status);
  return {
    id: r.id,
    organization: str(r.organization),
    kind: (KINDS.has(kind) ? kind : "custom_block") as WorkOrderKind,
    title: str(r.title),
    scope: str(r.scope),
    blocks: int(r.blocks),
    rateCents: int(r.rate_cents),
    totalCents: int(r.total_cents),
    depositCents: int(r.deposit_cents),
    balanceCents: int(r.balance_cents),
    maintenanceCents: int(r.maintenance_cents),
    addonSlug: str(r.addon_slug),
    status: (STATUSES.has(status) ? status : "draft") as WorkOrderStatus,
    sentAt: dateOrNull(r.sent_at),
    validUntil: dateOrNull(r.valid_until),
    acceptedAt: dateOrNull(r.accepted_at),
    deliveredAt: dateOrNull(r.delivered_at),
    paidAt: dateOrNull(r.paid_at),
    declinedAt: dateOrNull(r.declined_at),
    depositInvoiceId: str(r.deposit_invoice_id),
    balanceInvoiceId: str(r.balance_invoice_id),
    ticket: int(r.ticket),
  };
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "1 Nov" in the business time zone; "" for a missing date. */
export function workOrderDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY_MONTH.format(d);
}

function longDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY_MONTH_YEAR.format(d);
}

function nowOf(deps: WorkOrderDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

function isAddonKind(
  kind: WorkOrderKind,
): kind is "private_addon" | "premium_addon" {
  return kind === "private_addon" || kind === "premium_addon";
}

/** Choice 1: deposit = round(total / 2), balance = the rest (cents exact). */
export function workOrderSplit(totalCents: number): {
  depositCents: number;
  balanceCents: number;
} {
  const depositCents = Math.round(totalCents / 2);
  return { depositCents, balanceCents: totalCents - depositCents };
}

/** UI-SPEC "Price" mini receipt rows by kind. */
export function workOrderPriceRows(o: {
  kind: WorkOrderKind;
  blocks: number;
  rateCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  maintenanceCents: number;
}): WorkOrderPriceRow[] {
  if (o.kind === "polish") {
    const hours = o.blocks * BLOCK_HOURS;
    const what =
      o.blocks === 1
        ? "Design polish, 3-hour block"
        : `Design polish, ${o.blocks} × 3-hour blocks`;
    return [
      {
        label: `${what} · ${hours} h × ${formatCents(o.rateCents)}`,
        amountLabel: formatCents(o.totalCents),
      },
    ];
  }
  if (o.kind === "custom_block") {
    return [{ label: "Custom block", amountLabel: formatCents(o.totalCents) }];
  }
  return [
    { label: "Build price", amountLabel: formatCents(o.totalCents) },
    {
      label: "Deposit today (50%)",
      amountLabel: formatCents(o.depositCents),
    },
    {
      label: "Balance when delivered",
      amountLabel: formatCents(o.balanceCents),
    },
    {
      label: "Maintenance after delivery",
      amountLabel: `${formatCents(o.maintenanceCents)}/mo on your monthly bill`,
    },
  ];
}

function payOnAcceptCents(o: {
  kind: WorkOrderKind;
  totalCents: number;
  depositCents: number;
}): number {
  return isAddonKind(o.kind) ? o.depositCents : o.totalCents;
}

function centsIn(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new InvalidInput(
      `${what} must be whole cents from ${min} to ${max}.`,
    );
  }
  return v;
}

function absent(v: unknown): boolean {
  return v === undefined || v === null;
}

async function orgOf(
  pb: PocketBase,
  orgId: string,
): Promise<{ id: string; name: string; path: string }> {
  const res = await pb.collection("organizations").getList(1, 1, {
    filter: pb.filter("id = {:org}", { org: orgId }),
    fields: "id,name,path",
  });
  const r = res.items[0];
  if (!r) throw new NotFound();
  return { id: r.id, name: str(r.name), path: str(r.path) };
}

/** The catalog's polish-hour rate for the path, or null while unset (D264, D297). */
async function polishRate(path: string): Promise<number | null> {
  const row = (await readPriceCatalog()).find(
    (r) =>
      r.itemKind === "service" &&
      r.itemKey === "polish-hour" &&
      r.path === path,
  );
  return row?.oneTimeCents ?? null;
}

/** Validate and price a quote (choices 1-2); nothing is written. */
async function priceInput(
  pb: PocketBase,
  input: CreateWorkOrderInput,
): Promise<WorkOrderPreview> {
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("work order input must be an object");
  }
  if (typeof input.orgId !== "string" || !ORG_RE.test(input.orgId)) {
    throw new InvalidInput("organization id is not valid");
  }
  if (typeof input.kind !== "string" || !KINDS.has(input.kind)) {
    throw new InvalidInput(
      "kind must be polish, custom_block, private_addon or premium_addon",
    );
  }
  const kind = input.kind;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (
    title === "" ||
    title.length > TITLE_MAX ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) {
    throw new InvalidInput(
      `title must be 1-${TITLE_MAX} characters on one line`,
    );
  }
  const scopeHtml = sanitizeRichText(input.scope).trim();
  if (scopeHtml === "") throw new InvalidInput("scope is empty");
  if (scopeHtml.length > SCOPE_MAX) {
    throw new InvalidInput(`scope must be at most ${SCOPE_MAX} characters`);
  }
  const org = await orgOf(pb, input.orgId);

  let blocks = 0;
  let rateCents = 0;
  let totalCents: number;
  let maintenanceCents = 0;
  let addonSlug = "";
  if (kind === "polish") {
    if (!absent(input.totalCents) || !absent(input.maintenanceCents)) {
      throw new InvalidInput(
        "polish is priced from blocks × the hourly rate: no total or maintenance",
      );
    }
    blocks = centsIn(input.blocks, BLOCKS_MIN, BLOCKS_MAX, "blocks");
    const catalog = await polishRate(org.path);
    if (catalog !== null) {
      if (!absent(input.rateCents) && input.rateCents !== catalog) {
        throw new InvalidInput(
          `The catalog sets the polish rate (${formatCents(catalog)}/h): drop --rate-cents.`,
        );
      }
      rateCents = catalog;
    } else {
      if (absent(input.rateCents)) {
        throw new InvalidInput(
          `The polish rate isn't set in the catalog yet: give --rate-cents (${RATE_MIN}-${RATE_MAX}).`,
        );
      }
      rateCents = centsIn(input.rateCents, RATE_MIN, RATE_MAX, "rate");
    }
    totalCents = blocks * BLOCK_HOURS * rateCents;
  } else {
    if (!absent(input.blocks) || !absent(input.rateCents)) {
      throw new InvalidInput("blocks and rate apply to polish quotes only");
    }
    totalCents = centsIn(input.totalCents, 100, TOTAL_MAX, "total");
    if (isAddonKind(kind)) {
      const range = MAINTENANCE[kind];
      maintenanceCents = centsIn(
        input.maintenanceCents,
        range.min,
        range.max,
        "maintenance",
      );
      const slug =
        typeof input.addonSlug === "string" ? input.addonSlug.trim() : "";
      if (slug !== "" && !SLUG_RE.test(slug)) {
        throw new InvalidInput("add-on slug is not valid");
      }
      if (kind === "private_addon" && slug === "") {
        throw new InvalidInput("a private add-on quote names its add-on slug");
      }
      addonSlug = slug;
    } else if (!absent(input.maintenanceCents) || !absent(input.addonSlug)) {
      throw new InvalidInput(
        "maintenance and add-on apply to add-on quotes only",
      );
    }
  }
  const split = isAddonKind(kind)
    ? workOrderSplit(totalCents)
    : { depositCents: 0, balanceCents: 0 };
  const priced = {
    kind,
    blocks,
    rateCents,
    totalCents,
    ...split,
    maintenanceCents,
  };
  return {
    orgId: org.id,
    orgName: org.name,
    title,
    scopeHtml,
    addonSlug,
    ...priced,
    priceRows: workOrderPriceRows(priced),
    payNowCents: payOnAcceptCents(priced),
    ticket: 0,
  };
}

function staff(pctx: PlatformContext, feature: string): void {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, feature);
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
}

/** Staff read by id (any org). */
async function rowById(pb: PocketBase, id: string): Promise<Row> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("id = {:id}", { id }),
  });
  const r = res.items[0];
  if (!r) throw new NotFound();
  return toRow(r);
}

/** Owner read: id AND organization = ctx.orgId (T-10-26-02); drafts are not the owner's. */
async function ownedRecord(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<RecordModel> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter(
      "id = {:id} && organization = {:org} && status != 'draft'",
      {
        id,
        org: orgId,
      },
    ),
  });
  const r = res.items[0];
  if (!r) throw new NotFound();
  return r;
}

function isPastValid(row: Row, now: Date): boolean {
  return (
    row.status === "sent" &&
    row.validUntil !== null &&
    new Date(row.validUntil).getTime() < now.getTime()
  );
}

/** Choice 4: a sent quote past valid_until is persisted `expired` on first read. */
async function expireIfDue(pb: PocketBase, row: Row, now: Date): Promise<Row> {
  if (!isPastValid(row, now)) return row;
  const batch = pb.createBatch();
  batch.collection(COLLECTION).update(row.id, { status: "expired" });
  batch.collection("audit_log").create(
    auditBody(mintSystemContext({ job: "work_orders" }), {
      action: "work_order.expire",
      organization: row.organization,
      targetCollection: COLLECTION,
      targetId: row.id,
      meta: { validUntil: row.validUntil },
    }),
  );
  await batch.send();
  return { ...row, status: "expired" };
}

// ---------------------------------------------------------------------------------------
// Staff (platform context)

/** Staff: validate and price a quote without writing anything (the CLI's --dry-run). */
export async function previewWorkOrder(
  pctx: PlatformContext,
  input: CreateWorkOrderInput,
): Promise<WorkOrderPreview> {
  staff(pctx, "work_quote");
  return withSuperuser(async (pb) =>
    linkTicket(pb, await priceInput(pb, input), input),
  );
}

/** 12-23: validate `input.ticket` (same org, paid, not accepted; T-12-23-03) onto the preview. */
async function linkTicket(
  pb: PocketBase,
  p: WorkOrderPreview,
  input: CreateWorkOrderInput,
): Promise<WorkOrderPreview> {
  if (absent(input.ticket)) return p;
  await checkWorkOrderTicket(pb, p.orgId, input.ticket);
  return { ...p, ticket: input.ticket as number };
}

/** Staff: create a draft quote (BILL-20, D297). Returns its id and the owner's view. */
export async function createWorkOrder(
  pctx: PlatformContext,
  input: CreateWorkOrderInput,
): Promise<{ id: string; preview: WorkOrderPreview }> {
  staff(pctx, "work_quote");
  return withSuperuser(async (pb) => {
    const p = await linkTicket(pb, await priceInput(pb, input), input);
    const id = newRecordId();
    const batch = pb.createBatch();
    batch.collection(COLLECTION).create({
      id,
      organization: p.orgId,
      kind: p.kind,
      title: p.title,
      scope: p.scopeHtml,
      blocks: p.blocks,
      rate_cents: p.rateCents,
      total_cents: p.totalCents,
      deposit_cents: p.depositCents,
      balance_cents: p.balanceCents,
      maintenance_cents: p.maintenanceCents,
      addon_slug: p.addonSlug,
      ticket: p.ticket,
      status: "draft",
      created_by: pctx.actor,
    });
    batch.collection("audit_log").create(
      auditBody(pctx, {
        action: "work_order.create",
        organization: p.orgId,
        targetCollection: COLLECTION,
        targetId: id,
        meta: {
          kind: p.kind,
          totalCents: p.totalCents,
          depositCents: p.depositCents,
          maintenanceCents: p.maintenanceCents,
          addonSlug: p.addonSlug || null,
          ticket: p.ticket || null,
        },
      }),
    );
    await batch.send();
    return { id, preview: p };
  });
}

/** A one-line plain-text summary of the scope for the email. */
function scopeLine(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

/**
 * Staff: send a draft to the owner: status sent, valid 30 days, one `billing.quote_sent`
 * email (a lost email is logged; the Needs-you item and Billing tab still show it).
 */
export async function sendWorkOrder(
  pctx: PlatformContext,
  id: string,
  deps: WorkOrderDeps = {},
): Promise<{ validUntil: string; emailed: boolean }> {
  staff(pctx, "work_quote");
  assertId(id);
  const now = nowOf(deps);
  const validUntil = new Date(
    now.getTime() + VALID_DAYS * DAY_MS,
  ).toISOString();
  const row = await withSuperuser(async (pb) => {
    const r = await rowById(pb, id);
    if (r.status !== "draft") {
      throw new InvalidInput(`This quote is already ${r.status}.`);
    }
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(r.id, {
      status: "sent",
      sent_at: now.toISOString(),
      valid_until: validUntil,
    });
    batch.collection("audit_log").create(
      auditBody(pctx, {
        action: "work_order.send",
        organization: r.organization,
        targetCollection: COLLECTION,
        targetId: r.id,
        meta: { validUntil },
      }),
    );
    if (r.ticket > 0) {
      // 12-23: the ticket's panel shows View quote, committed with the send.
      await onWorkOrderSentForTicket(pb, batch, {
        orgId: r.organization,
        ticket: r.ticket,
        workOrderId: r.id,
        amountCents: r.totalCents,
        now,
        actor: pctx,
      });
    }
    await batch.send();
    return r;
  });
  let emailed = false;
  try {
    const owner = await withSuperuser((pb) =>
      billingOwnerOf(pb, row.organization),
    );
    if (!owner || owner.email === "") {
      console.error(
        `[payments] quote ${row.id}: org ${row.organization} has no owner email`,
      );
    } else {
      await sendEmail(
        { kind: "cds", ctx: mintSystemContext({ job: "billing" }) },
        "billing.quote_sent",
        owner.email,
        {
          title: row.title,
          scopeLine: scopeLine(row.scope),
          totalCents: row.totalCents,
          depositCents: isAddonKind(row.kind) ? row.depositCents : null,
          validUntil: longDay(validUntil),
          quoteUrl: platformUrl(`${QUOTES_PATH}/${row.id}`),
        },
        deps.transport ? { transport: deps.transport } : {},
      );
      emailed = true;
    }
  } catch (err) {
    console.error(
      `[payments] quote ${row.id} email not sent: ${err instanceof Error ? err.name : "Error"}`,
    );
  }
  return { validUntil, emailed };
}

const NO_SUBSCRIPTION_COPY =
  "This site has no subscription to add maintenance to. Finish checkout first.";

/** Why the order's status refuses delivery now, or null (shared by deliver and its case). */
function deliverStatusRefusal(row: Row): string | null {
  if (row.deliveredAt !== null || row.status === "delivered") {
    return "This work is already delivered.";
  }
  if (
    row.status === "draft" ||
    row.status === "sent" ||
    row.status === "declined" ||
    row.status === "expired"
  ) {
    return WORK_ORDER_NOT_ACCEPTED_COPY;
  }
  if (row.status === "accepted") return WORK_ORDER_UNPAID_COPY;
  if (isAddonKind(row.kind) && row.status !== "deposit_paid") {
    return WORK_ORDER_UNPAID_COPY;
  }
  return null;
}

/** Add-on kinds bill the account: it needs a customer, and a subscription for maintenance. */
function deliverAccountRefusal(
  row: Row,
  account: { customerId: string; subscriptionId: string } | null,
): string | null {
  if (!isAddonKind(row.kind)) return null;
  if (!account || account.customerId === "") return WORK_ORDER_NO_CARD_COPY;
  if (row.maintenanceCents > 0 && account.subscriptionId === "") {
    return NO_SUBSCRIPTION_COPY;
  }
  return null;
}

/** What work:deliver prints before it acts (review WR-A04). Read-only. */
export type DeliverCase = {
  id: string;
  orgId: string;
  orgName: string;
  kind: WorkOrderKind;
  title: string;
  status: WorkOrderStatus;
  /** Integer cents the balance invoice bills (add-on kinds), else 0. */
  balanceCents: number;
  /** A balance invoice already exists (a retry reuses it, WR-E06). */
  balanceInvoiced: boolean;
  /** Monthly maintenance added from the next bill (add-on kinds), else 0. */
  maintenanceCents: number;
  /** The add-on installed on delivery, else null. */
  addonSlug: string | null;
  /** Why deliver would refuse right now, or null when it can go ahead. */
  refusal: string | null;
};

/**
 * Staff (super_admin, work_deliver): the case work:deliver prints and confirms before it
 * invoices, changes the subscription and installs (review WR-A04). Writes nothing: a sent
 * quote past valid_until reads as expired without being persisted.
 */
export async function deliverCase(
  pctx: PlatformContext,
  id: string,
  deps: Pick<WorkOrderDeps, "now"> = {},
): Promise<DeliverCase> {
  staff(pctx, "work_deliver");
  assertId(id);
  return withSuperuser(async (pb) => {
    const stored = await rowById(pb, id);
    const row: Row = isPastValid(stored, nowOf(deps))
      ? { ...stored, status: "expired" }
      : stored;
    const org = await orgOf(pb, row.organization);
    const addon = isAddonKind(row.kind);
    const refusal =
      deliverStatusRefusal(row) ??
      (addon
        ? deliverAccountRefusal(
            row,
            await billingAccountByOrg(pb, row.organization),
          )
        : null);
    return {
      id: row.id,
      orgId: row.organization,
      orgName: org.name,
      kind: row.kind,
      title: row.title,
      status: row.status,
      balanceCents: addon ? row.balanceCents : 0,
      balanceInvoiced: addon && row.balanceInvoiceId !== "",
      maintenanceCents: addon ? row.maintenanceCents : 0,
      addonSlug: addon && row.addonSlug !== "" ? row.addonSlug : null,
      refusal,
    };
  });
}

export type DeliverResult = {
  /** Hosted page of the balance invoice (add-on kinds), else null. */
  balanceInvoiceUrl: string | null;
  /** Integer cents of the balance invoice, 0 when none. */
  balanceCents: number;
  /** ISO date the maintenance item first bills (the next bill), else null. */
  maintenanceFrom: string | null;
  maintenanceCents: number;
  /** The add-on slug installed through the staff path, else null. */
  installed: string | null;
};

/**
 * Staff (super_admin): deliver paid work. Polish / custom block: must be `paid`; only
 * `delivered_at` is stamped. Add-on kinds: must be `deposit_paid`; invoices the balance,
 * adds the maintenance item to the one subscription with no proration (choice 3, BILL-16)
 * and installs the add-on with source staff (D263), then status `delivered`. Each provider
 * step has a fixed idempotency key, so a retry after a partial failure repeats nothing.
 */
export async function deliverWorkOrder(
  pctx: PlatformContext,
  id: string,
  deps: WorkOrderDeps = {},
): Promise<DeliverResult> {
  staff(pctx, "work_deliver");
  assertId(id);
  const first = await withSuperuser((pb) => rowById(pb, id));
  const orgId = first.organization;
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const now = nowOf(deps);
      const row = await expireIfDue(pb, await rowById(pb, id), now);
      const none: DeliverResult = {
        balanceInvoiceUrl: null,
        balanceCents: 0,
        maintenanceFrom: null,
        maintenanceCents: 0,
        installed: null,
      };
      const refused = deliverStatusRefusal(row);
      if (refused !== null) throw new InvalidInput(refused);

      if (!isAddonKind(row.kind)) {
        // Paid in full on acceptance: deliver only records the date.
        const batch = pb.createBatch();
        batch
          .collection(COLLECTION)
          .update(row.id, { delivered_at: now.toISOString() });
        batch.collection("audit_log").create(
          auditBody(pctx, {
            action: "work_order.deliver",
            organization: orgId,
            targetCollection: COLLECTION,
            targetId: row.id,
            meta: { kind: row.kind },
          }),
        );
        await batch.send();
        return none;
      }
      const account = await billingAccountByOrg(pb, orgId);
      const noAccount = deliverAccountRefusal(row, account);
      if (noAccount !== null || !account) {
        throw new InvalidInput(noAccount ?? WORK_ORDER_NO_CARD_COPY);
      }
      if (row.addonSlug !== "" && !deps.addons) {
        throw new InvalidInput("deliver needs the add-on deps to install");
      }
      const billing = deps.billing ?? getCdsBilling();
      const org = await orgOf(pb, orgId);

      // 1. The balance invoice. WR-E06: made once. Its id is saved the moment it exists,
      // and a retry (even days later, past the provider's idempotency window) reuses it,
      // so a failure in the steps below never bills the balance twice.
      let balanceInvoiceId = row.balanceInvoiceId;
      let balanceInvoiceUrl: string | null = null;
      let balancePaid = false;
      if (row.balanceCents > 0 && balanceInvoiceId !== "") {
        const inv = await billing.fetchInvoice(balanceInvoiceId);
        balanceInvoiceUrl = inv.hostedUrl ?? platformUrl(BILLING_TAB);
        balancePaid = inv.status === "paid";
      } else if (row.balanceCents > 0) {
        const inv = await billing.createInvoice({
          orgId,
          customerId: account.customerId,
          lines: [
            {
              kind: "service",
              key: `work-order-${row.id}-balance`,
              label: `${row.title}, balance`,
              interval: "once",
              unitCents: row.balanceCents,
              quantity: 1,
              priceRef: null,
            },
          ],
          description: `Quote from Support: ${row.title} (balance)`,
          metadata: {
            kind: "work_order",
            work_order: row.id,
            work_order_part: "balance",
          },
          idempotencyKey: `work-order:${row.id}:balance`,
        });
        balanceInvoiceId = inv.id;
        balanceInvoiceUrl = inv.hostedUrl ?? platformUrl(BILLING_TAB);
        balancePaid = inv.status === "paid";
        await pb
          .collection(COLLECTION)
          .update(row.id, { balance_invoice_id: inv.id });
      }

      // 2. Maintenance on the one subscription, from the next bill (choice 3).
      let maintenanceFrom: string | null = null;
      if (row.maintenanceCents > 0) {
        const key = `maintenance-${row.id}`;
        const sub = await billing.fetchSubscription(account.subscriptionId);
        const existing = sub.items.find(
          (i) => i.kind === "service" && i.key === key,
        );
        if (existing) {
          maintenanceFrom = existing.currentPeriodEnd;
        } else {
          const { priceRef } = await billing.syncPrice({
            kind: "service",
            key,
            path: org.path,
            interval: "month",
            cents: row.maintenanceCents,
            productRef: null,
            previousPriceRef: null,
          });
          const line: BillingLine = {
            kind: "service",
            key,
            label: `${row.title} maintenance`,
            interval: "month",
            unitCents: row.maintenanceCents,
            quantity: 1,
            priceRef,
          };
          const res = await billing.changeItems({
            subscriptionId: account.subscriptionId,
            add: [line],
            remove: [],
            setQuantity: [],
            oneTime: [],
            proration: "none",
            chargeNow: false,
            idempotencyKey: `work-order:${row.id}:maintenance`,
          });
          if (!res.applied) {
            throw new InvalidInput(
              "The maintenance item could not be added. Try again.",
            );
          }
          const after = await billing.fetchSubscription(account.subscriptionId);
          maintenanceFrom =
            after.items.find((i) => i.kind === "service" && i.key === key)
              ?.currentPeriodEnd ??
            account.currentPeriodEnd ??
            null;
        }
      }

      // 3. The add-on, through the staff path (source staff: no hub charge).
      let installed: string | null = null;
      if (row.addonSlug !== "" && deps.addons) {
        await installAddonAsStaff(pctx, deps.addons, {
          orgId,
          slug: row.addonSlug,
          reason: `Work order ${row.id} delivered`,
        });
        installed = row.addonSlug;
      }

      // 4. Delivered (the balance invoice's payment moves it to paid). A balance already
      // paid during an earlier, failed run found the order not yet delivered: paid now.
      const batch = pb.createBatch();
      batch.collection(COLLECTION).update(row.id, {
        status: balancePaid ? "paid" : "delivered",
        delivered_at: now.toISOString(),
        balance_invoice_id: balanceInvoiceId,
        ...(balancePaid ? { paid_at: now.toISOString() } : {}),
      });
      batch.collection("audit_log").create(
        auditBody(pctx, {
          action: "work_order.deliver",
          organization: orgId,
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: {
            kind: row.kind,
            balanceCents: row.balanceCents,
            maintenanceCents: row.maintenanceCents,
            installed,
          },
        }),
      );
      await batch.send();
      return {
        balanceInvoiceUrl,
        balanceCents: row.balanceCents,
        maintenanceFrom,
        maintenanceCents: row.maintenanceCents,
        installed,
      };
    }),
  );
}

// ---------------------------------------------------------------------------------------
// Owner (org context)

function summaryOf(row: Row): WorkOrderSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as OwnerWorkOrderStatus,
    sentLabel: workOrderDay(row.sentAt),
    totalCents: row.totalCents,
    href: `${QUOTES_PATH}/${encodeURIComponent(row.id)}`,
    setup: setupOf(row),
    acceptedLabel: row.acceptedAt ? workOrderDay(row.acceptedAt) : "",
  };
}

/** 11-19 status mapping for the Today work-in-progress card (see WorkOrderSummary.setup). */
function setupOf(row: Row): WorkOrderSummary["setup"] {
  if (row.deliveredAt !== null) return null;
  if (row.status === "accepted") return "ordered";
  if (row.status === "deposit_paid" || row.status === "paid") {
    return "setting_up";
  }
  return null;
}

/** The owner's quotes, waiting ones first (sent_at oldest first), then newest. No drafts. */
export async function listWorkOrders(
  ctx: OrgContext,
  deps: WorkOrderDeps = {},
): Promise<WorkOrderSummary[]> {
  assertOrgContext(ctx);
  requirePermission(ctx, "billing", "read");
  const now = nowOf(deps);
  const rows = await withSuperuser(async (pb) => {
    const recs = await pb.collection(COLLECTION).getFullList({
      filter: pb.filter("organization = {:org} && status != 'draft'", {
        org: ctx.orgId,
      }),
      sort: "-sent_at,-id",
    });
    const out: Row[] = [];
    for (const r of recs) {
      out.push(
        await expireIfDue(
          pb,
          toRow(toBrowser(COLLECTION, r) as RecordModel),
          now,
        ),
      );
    }
    return out;
  });
  const waiting = rows
    .filter((r) => r.status === "sent")
    .sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
  return [...waiting, ...rows.filter((r) => r.status !== "sent")].map(
    summaryOf,
  );
}

async function hostedUrlOf(
  pb: PocketBase,
  orgId: string,
  invoiceId: string,
  deps: WorkOrderDeps,
): Promise<string | null> {
  if (invoiceId === "") return null;
  const mirror = await invoiceMirrorOf(pb, orgId, invoiceId);
  if (mirror?.hostedUrl) return mirror.hostedUrl;
  try {
    const inv = await (deps.billing ?? getCdsBilling()).fetchInvoice(invoiceId);
    return inv.orgId === null || inv.orgId === orgId ? inv.hostedUrl : null;
  } catch {
    return null;
  }
}

/** The owner's quote page (UI `QuoteView`). Owner only (`billing:read`). */
export async function readWorkOrder(
  ctx: OrgContext,
  id: string,
  deps: WorkOrderDeps = {},
): Promise<WorkOrderView> {
  assertOrgContext(ctx);
  requirePermission(ctx, "billing", "read");
  assertId(id);
  const now = nowOf(deps);
  return withSuperuser(async (pb) => {
    const raw = await ownedRecord(pb, ctx.orgId, id);
    // Invoice ids are read server-side for the pay link; the view never carries them.
    const stored = toRow(raw);
    const row = await expireIfDue(
      pb,
      toRow(toBrowser(COLLECTION, raw) as RecordModel),
      now,
    );
    let payHref: string | null = null;
    let payNowCents = 0;
    if (row.status === "sent" || row.status === "accepted") {
      payNowCents = payOnAcceptCents(row);
    } else if (row.status === "delivered") {
      payNowCents = row.balanceCents;
    }
    if (row.status === "accepted") {
      payHref = await hostedUrlOf(pb, ctx.orgId, stored.depositInvoiceId, deps);
    } else if (row.status === "delivered") {
      payHref = await hostedUrlOf(pb, ctx.orgId, stored.balanceInvoiceId, deps);
    }
    const statusDate =
      row.status === "paid"
        ? row.paidAt
        : row.status === "declined"
          ? row.declinedAt
          : row.status === "expired"
            ? row.validUntil
            : null;
    const meta = [
      "Quote from Support",
      row.sentAt ? `Sent ${longDay(row.sentAt)}` : "",
      row.validUntil ? `Valid until ${longDay(row.validUntil)}` : "",
    ].filter((s) => s !== "");
    return {
      id: row.id,
      title: row.title,
      status: row.status as OwnerWorkOrderStatus,
      metaLine: meta.join(" · "),
      // Sanitised before storage; sanitised again here (defence in depth, T-10-26-03).
      scopeHtml: sanitizeRichText(row.scope),
      kind: row.kind,
      priceRows: workOrderPriceRows(row),
      payNowCents,
      acceptedLabel: row.acceptedAt ? workOrderDay(row.acceptedAt) : null,
      deliveredLabel: row.deliveredAt ? workOrderDay(row.deliveredAt) : null,
      statusDateLabel: statusDate ? workOrderDay(statusDate) : null,
      payHref,
      canAct: ctx.role === "owner" && !ctx.impersonator,
      impersonating: Boolean(ctx.impersonator),
    };
  });
}

/** The answerable row for accept / decline, or the refusal (lazy expiry first). */
async function answerable(
  pb: PocketBase,
  ctx: OrgContext,
  id: string,
  now: Date,
): Promise<Row> {
  const row = await expireIfDue(
    pb,
    toRow(await ownedRecord(pb, ctx.orgId, id)),
    now,
  );
  if (row.status === "expired") throw new InvalidInput(WORK_ORDER_EXPIRED_COPY);
  if (row.status !== "sent") throw new InvalidInput(WORK_ORDER_ANSWERED_COPY);
  return row;
}

/**
 * Owner: accept a sent, unexpired quote (BILL-20, D299). Creates one CDS invoice for the
 * full price (polish, custom block) or the 50% deposit (add-on kinds), metadata
 * `work_order`, and returns its hosted page. The status is the gate: work starts when the
 * invoice's payment moves it to paid / deposit_paid (handlers/invoice.ts).
 */
export async function acceptWorkOrder(
  ctx: OrgContext,
  id: string,
  deps: WorkOrderDeps = {},
): Promise<{ payUrl: string }> {
  requirePermission(ctx, "purchases", "run");
  assertId(id);
  return withOrgLock(`billing:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const now = nowOf(deps);
      const row = await answerable(pb, ctx, id, now);
      // 12-REVIEW WR-A04: never invoice work the ticket's Care hour already covers.
      if (row.ticket > 0) {
        await assertQuoteAcceptableForTicket(pb, ctx.orgId, row.ticket);
      }
      const account = await billingAccountByOrg(pb, ctx.orgId);
      if (!account || account.customerId === "") {
        throw new InvalidInput(WORK_ORDER_NO_CARD_COPY);
      }
      const deposit = isAddonKind(row.kind);
      const cents = payOnAcceptCents(row);
      const billing = deps.billing ?? getCdsBilling();
      // WR-E06: an earlier accept whose save failed already made the invoice (the mirror
      // links it to this order). Reuse it, never invoice twice past the provider's
      // idempotency window.
      const prior = await pb.collection("billing_invoices").getList(1, 1, {
        filter: pb.filter(
          "organization = {:org} && work_order = {:wo} && (status = 'open' || status = 'paid')",
          { org: ctx.orgId, wo: row.id },
        ),
        fields: "id,provider_invoice_id",
      });
      const priorId = str(prior.items[0]?.provider_invoice_id);
      const inv =
        priorId !== ""
          ? await billing.fetchInvoice(priorId)
          : await billing.createInvoice({
              orgId: ctx.orgId,
              customerId: account.customerId,
              lines: [
                {
                  kind: "service",
                  key: `work-order-${row.id}`,
                  label: deposit ? `${row.title}, deposit (50%)` : row.title,
                  interval: "once",
                  unitCents: cents,
                  quantity: 1,
                  priceRef: null,
                },
              ],
              description: `Quote from Support: ${row.title}${deposit ? " (deposit)" : ""}`,
              metadata: {
                kind: "work_order",
                work_order: row.id,
                work_order_part: deposit ? "deposit" : "full",
              },
              idempotencyKey: `work-order:${row.id}:accept`,
            });
      const batch = pb.createBatch();
      batch.collection(COLLECTION).update(row.id, {
        status: "accepted",
        accepted_at: now.toISOString(),
        accepted_by: ctx.actor,
        deposit_invoice_id: inv.id,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "work_order.accept",
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { kind: row.kind, invoiceCents: cents, deposit },
        }),
      );
      if (row.ticket > 0) {
        // 12-23: accepting is what lets the ticket's work start (In progress).
        await onWorkOrderAcceptedForTicket(pb, batch, {
          orgId: ctx.orgId,
          ticket: row.ticket,
          workOrderId: row.id,
          now,
          actor: ctx,
        });
      }
      await batch.send();
      return { payUrl: inv.hostedUrl ?? platformUrl(BILLING_TAB) };
    }),
  );
}

/**
 * Owner: decline a sent, unexpired quote. No work starts; nothing is invoiced. CDS is told
 * (10-30, BILL-20): one `billing.staff_alert` (`quote_declined`) to the staff alert address;
 * a send failure is logged, never thrown to the owner (the decline is already saved).
 */
export async function declineWorkOrder(
  ctx: OrgContext,
  id: string,
  deps: WorkOrderDeps = {},
): Promise<void> {
  requirePermission(ctx, "purchases", "run");
  assertId(id);
  const declined = await withOrgLock(`billing:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const now = nowOf(deps);
      const row = await answerable(pb, ctx, id, now);
      const batch = pb.createBatch();
      batch.collection(COLLECTION).update(row.id, {
        status: "declined",
        declined_at: now.toISOString(),
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "work_order.decline",
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { kind: row.kind },
        }),
      );
      await batch.send();
      let orgName = "";
      try {
        const org = await pb
          .collection("organizations")
          .getOne(ctx.orgId, { fields: "id,name" });
        orgName = str(org.name);
      } catch {
        // The alert still names the org id.
      }
      return { id: row.id, title: row.title, orgName };
    }),
  );
  await alertQuoteDeclined(ctx.orgId, declined, deps);
}

async function alertQuoteDeclined(
  orgId: string,
  q: { id: string; title: string; orgName: string },
  deps: WorkOrderDeps,
): Promise<void> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn(`[payments] quote ${q.id}: no staff alert address`);
    return;
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: mintSystemContext({ job: "billing" }) },
      "billing.staff_alert",
      to,
      {
        event: "quote_declined",
        orgName: q.orgName === "" ? orgId : q.orgName,
        orgId,
        detail: `The owner declined the quote "${q.title}" (${q.id}). No work starts; nothing was invoiced.`,
      },
      deps.transport ? { transport: deps.transport } : {},
    );
  } catch (err) {
    console.error(
      `[payments] quote ${q.id} decline alert not sent: ${err instanceof Error ? err.name : "Error"}`,
    );
  }
}

// ---------------------------------------------------------------------------------------
// Internal: the invoice handler's transition (handlers/invoice.ts; superuser client)

/**
 * A paid invoice that names a work order moves it (state-idempotent): the acceptance
 * invoice `accepted -> paid` (full) or `accepted -> deposit_paid` (deposit); the balance
 * invoice `delivered -> paid`. Anything else (replay, other org, unknown part) is a no-op.
 * Also links the invoice mirror row to the order.
 */
export async function applyWorkOrderPayment(
  pb: PocketBase,
  sysCtx: OrgContext,
  invoice: {
    id: string;
    status: string;
    metadata: Readonly<Record<string, string>>;
  },
  now: Date = new Date(),
): Promise<"moved" | "unchanged"> {
  const id = invoice.metadata.work_order ?? "";
  if (!ID_RE.test(id)) return "unchanged";
  const orgId = sysCtx.orgId;
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id,
      org: orgId,
    }),
  });
  const rec = res.items[0];
  if (!rec) {
    console.warn(
      `[payments] invoice ${invoice.id}: work order ${id} not found for org ${orgId}`,
    );
    return "unchanged";
  }
  const row = toRow(rec);
  const mirror = await invoiceMirrorOf(pb, orgId, invoice.id);
  if (mirror) {
    const linked = await pb
      .collection("billing_invoices")
      .getOne(mirror.id, { fields: "id,work_order" });
    if (str(linked.work_order) === "") {
      await pb
        .collection("billing_invoices")
        .update(mirror.id, { work_order: row.id });
    }
  }
  if (invoice.status !== "paid") return "unchanged";
  const part = invoice.metadata.work_order_part ?? "";
  let next: WorkOrderStatus | null = null;
  // WR-E06: the acceptance invoice is only ever created by acceptWorkOrder, so its payment
  // moves the order even when the write that followed it failed (still `sent`, or lazily
  // `expired` since); the money is taken either way.
  const acceptedNow =
    row.status === "accepted" ||
    ((row.status === "sent" || row.status === "expired") &&
      (row.depositInvoiceId === "" || row.depositInvoiceId === invoice.id));
  if ((part === "full" || part === "deposit") && acceptedNow) {
    next = part === "full" ? "paid" : "deposit_paid";
  } else if (part === "balance" && row.status === "delivered") {
    next = "paid";
  }
  if (next === null) return "unchanged";
  const patch: Record<string, unknown> = { status: next };
  if (next === "paid") patch.paid_at = now.toISOString();
  if (row.status !== "accepted") {
    patch.accepted_at = now.toISOString();
    patch.deposit_invoice_id = invoice.id;
  }
  const batch = pb.createBatch();
  batch.collection(COLLECTION).update(row.id, patch);
  batch.collection("audit_log").create(
    auditBody(sysCtx, {
      action: "work_order.paid",
      targetCollection: COLLECTION,
      targetId: row.id,
      meta: { part, status: next },
    }),
  );
  await batch.send();
  return "moved";
}
