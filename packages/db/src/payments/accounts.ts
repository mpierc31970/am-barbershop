// P10 payments: the billing account chokepoint (BILL-01, BILL-16; CONTEXT A2; D161, D181,
// D263, D299; invariant 1).
//
// One `billing_accounts` row per org mirrors the CDS-side customer and its one subscription.
// Tenant reads go through `readBillingAccount(ctx)` (owner only, `billing:read`) and never
// carry provider ids (customer, subscription, session) or the raw checkout draft (D187).
// The internal writers below take the superuser client and are used by the payment handlers
// and the checkout start (10-16); they are NOT re-exported from @cds/db (payments/index.ts
// lists the public names explicitly). Every filter is bound (`pb.filter`).
import { toBrowser } from "@cds/core";
import type { BillingLine, PaymentProvider } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintOrgContext, type OrgContext } from "../context";
import { requirePermission } from "../repository";

const COLLECTION = "billing_accounts";
/** Audit rows and installs from the payment handlers name this job (10-12 choice 2). */
export const BILLING_JOB = "billing";
const SYSTEM_IP = "system:billing";

/** Subscription item / invoice line keys for the build fee installments (D181, Pitfall 6). */
export const INSTALLMENT_KEY = "build-installment";
/** The 6th payment's extra cents ride on a separate monthly item, removed after the 6th. */
export const INSTALLMENT_REMAINDER_KEY = "build-remainder";

export type BillingAccountStatus =
  "none" | "active" | "past_due" | "lapsed" | "canceled";
export type BillingCadence = "monthly" | "yearly";
export type BuildPlan = "full" | "installments";

/**
 * The order the owner confirmed at checkout, stored on the account by `startCheckout`
 * (10-16) before the provider session is created. The completion handler installs from
 * this, never from the provider payload (10-12 choice 3).
 */
export type CheckoutDraft = {
  addons: string[];
  extras: string[];
  carePlan: boolean;
  cadence: BillingCadence;
  buildPlan: BuildPlan;
  /** Integer cents of the build fee sold; falls back to the catalog when absent. */
  buildCents?: number;
  /** Yearly cadence: monthly-by-nature items added after completion (Pattern 4(a)). */
  deferredMonthly?: BillingLine[];
  /** CR-E02: the hosted session this order was sent to; any other paid session is stray. */
  sessionId?: string;
  /**
   * 11-27 (D185): "5 more pages" packs added before checkout ("It joins your order"). Absent
   * reads as 0. Checkout lines carry `pack:pages-5 x pagePacks`.
   */
  pagePacks?: number;
};

/**
 * One subscription item as billed (WR-D04): integer cents per unit per interval, from the
 * provider's subscription. No provider ids.
 */
export type BillingItemPrice = {
  kind: string;
  key: string;
  interval: "month" | "year" | "once";
  unitCents: number;
  quantity: number;
};

/** Every field of the record. Server-only: provider ids included. */
export type BillingAccount = {
  id: string;
  organization: string;
  provider: PaymentProvider;
  customerId: string;
  subscriptionId: string;
  status: BillingAccountStatus;
  cadence: BillingCadence | null;
  buildPlan: BuildPlan | null;
  installmentsPaid: number;
  paidAt: string | null;
  carePlan: boolean;
  media5gbQty: number;
  media25gbQty: number;
  /** "5 more pages" packs on the subscription (11-27, D185). */
  pages5Qty: number;
  currentPeriodEnd: string | null;
  lapsedAt: string | null;
  priceLockedUntil: string | null;
  checkoutSessionId: string;
  checkoutDraft: CheckoutDraft | null;
  amountDueCents: number;
  cardBrand: string;
  cardLast4: string;
  cardExp: string;
  declinedAt: string | null;
  restoredAt: string | null;
  /** The subscription items as billed (WR-D04); empty until the first sync. */
  itemPrices: BillingItemPrice[];
  updated: string;
};

/** What an owner screen may show: no provider ids, no draft. */
export type BillingAccountView = Omit<
  BillingAccount,
  "customerId" | "subscriptionId" | "checkoutSessionId" | "checkoutDraft"
>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The mirrored item prices; anything malformed is dropped (WR-D04). */
export function parseItemPrices(v: unknown): BillingItemPrice[] {
  if (!Array.isArray(v)) return [];
  const out: BillingItemPrice[] = [];
  for (const e of v) {
    if (!isObj(e)) continue;
    const interval = e.interval;
    if (
      typeof e.kind !== "string" ||
      typeof e.key !== "string" ||
      (interval !== "month" && interval !== "year" && interval !== "once") ||
      typeof e.unitCents !== "number" ||
      !Number.isSafeInteger(e.unitCents) ||
      e.unitCents < 0 ||
      typeof e.quantity !== "number" ||
      !Number.isSafeInteger(e.quantity) ||
      e.quantity < 0
    ) {
      continue;
    }
    out.push({
      kind: e.kind,
      key: e.key,
      interval,
      unitCents: e.unitCents,
      quantity: e.quantity,
    });
  }
  return out;
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s !== "")
    : [];
}

const INTERVALS = new Set(["month", "year", "once"]);

function billingLine(v: unknown): BillingLine | null {
  if (!isObj(v)) return null;
  const unitCents = v.unitCents;
  const quantity = v.quantity;
  if (
    typeof v.kind !== "string" ||
    typeof v.key !== "string" ||
    typeof v.label !== "string" ||
    typeof v.interval !== "string" ||
    !INTERVALS.has(v.interval) ||
    typeof unitCents !== "number" ||
    !Number.isSafeInteger(unitCents) ||
    unitCents < 0 ||
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    return null;
  }
  return {
    kind: v.kind as BillingLine["kind"],
    key: v.key,
    label: v.label,
    interval: v.interval as BillingLine["interval"],
    unitCents,
    quantity,
    priceRef:
      typeof v.priceRef === "string" && v.priceRef !== "" ? v.priceRef : null,
  };
}

/** Most "5 more pages" packs one pre-checkout order may hold (11-27 choice 2). */
export const MAX_DRAFT_PAGE_PACKS = 20;

/** The stored draft, normalised; anything malformed reads as absent. */
export function parseCheckoutDraft(raw: unknown): CheckoutDraft | null {
  if (!isObj(raw)) return null;
  const cadence =
    raw.cadence === "yearly"
      ? "yearly"
      : raw.cadence === "monthly"
        ? "monthly"
        : null;
  const buildPlan =
    raw.buildPlan === "installments"
      ? "installments"
      : raw.buildPlan === "full"
        ? "full"
        : null;
  if (!cadence || !buildPlan) return null;
  const draft: CheckoutDraft = {
    addons: strings(raw.addons),
    extras: strings(raw.extras),
    carePlan: raw.carePlan === true,
    cadence,
    buildPlan,
  };
  if (
    typeof raw.buildCents === "number" &&
    Number.isSafeInteger(raw.buildCents) &&
    raw.buildCents >= 0
  ) {
    draft.buildCents = raw.buildCents;
  }
  const packs = raw.pagePacks;
  if (
    typeof packs === "number" &&
    Number.isSafeInteger(packs) &&
    packs >= 1 &&
    packs <= MAX_DRAFT_PAGE_PACKS
  ) {
    draft.pagePacks = packs;
  }
  if (typeof raw.sessionId === "string" && raw.sessionId !== "") {
    draft.sessionId = raw.sessionId;
  }
  if (Array.isArray(raw.deferredMonthly)) {
    draft.deferredMonthly = raw.deferredMonthly
      .map(billingLine)
      .filter((l): l is BillingLine => l !== null);
  }
  return draft;
}

const STATUSES = new Set(["none", "active", "past_due", "lapsed", "canceled"]);

export function toBillingAccount(r: RecordModel): BillingAccount {
  const status = str(r.status);
  const cadence = str(r.cadence);
  const plan = str(r.build_plan);
  return {
    id: r.id,
    organization: str(r.organization),
    provider: r.provider === "stripe" ? "stripe" : "fake",
    customerId: str(r.customer_id),
    subscriptionId: str(r.subscription_id),
    status: (STATUSES.has(status) ? status : "none") as BillingAccountStatus,
    cadence: cadence === "monthly" || cadence === "yearly" ? cadence : null,
    buildPlan: plan === "full" || plan === "installments" ? plan : null,
    installmentsPaid: int(r.installments_paid),
    paidAt: dateOrNull(r.paid_at),
    carePlan: r.care_plan === true,
    media5gbQty: int(r.media_5gb_qty),
    media25gbQty: int(r.media_25gb_qty),
    pages5Qty: int(r.pages_5_qty),
    currentPeriodEnd: dateOrNull(r.current_period_end),
    lapsedAt: dateOrNull(r.lapsed_at),
    priceLockedUntil: dateOrNull(r.price_locked_until),
    checkoutSessionId: str(r.checkout_session_id),
    checkoutDraft: parseCheckoutDraft(r.checkout_draft),
    amountDueCents: int(r.amount_due_cents),
    cardBrand: str(r.card_brand),
    cardLast4: str(r.card_last4),
    cardExp: str(r.card_exp),
    declinedAt: dateOrNull(r.declined_at),
    restoredAt: dateOrNull(r.restored_at),
    itemPrices: parseItemPrices(r.item_prices),
    updated: str(r.updated),
  };
}

const SERVER_ONLY = new Set<string>([
  "customerId",
  "subscriptionId",
  "checkoutSessionId",
  "checkoutDraft",
]);

function toView(a: BillingAccount): BillingAccountView {
  // Allow-list copy: the server-only fields are never copied into the view.
  return Object.fromEntries(
    Object.entries(a).filter(([k]) => !SERVER_ONLY.has(k)),
  ) as BillingAccountView;
}

// ---------------------------------------------------------------------------------------
// Internal (superuser client; payment handlers and checkout start only)

/** The org's billing account, or null. */
async function billingRecordByOrg(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
  });
  return res.items[0] ?? null;
}

export async function billingAccountByOrg(
  pb: PocketBase,
  orgId: string,
): Promise<BillingAccount | null> {
  const r = await billingRecordByOrg(pb, orgId);
  return r ? toBillingAccount(r) : null;
}

/** The account holding a provider customer id, or null (charge.refunded carries no org). */
export async function billingAccountByCustomer(
  pb: PocketBase,
  customerId: string,
): Promise<BillingAccount | null> {
  if (typeof customerId !== "string" || customerId === "") return null;
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("customer_id = {:c}", { c: customerId }),
  });
  const r = res.items[0];
  return r ? toBillingAccount(r) : null;
}

/** The org's account, created empty (`status = none`) when missing. Unique per org. */
export async function ensureBillingAccount(
  pb: PocketBase,
  orgId: string,
  provider: PaymentProvider,
): Promise<BillingAccount> {
  const found = await billingAccountByOrg(pb, orgId);
  if (found) return found;
  try {
    const r = await pb.collection(COLLECTION).create({
      organization: orgId,
      provider,
      status: "none",
      installments_paid: 0,
    });
    return toBillingAccount(r);
  } catch (err) {
    // A concurrent create hit the unique index: read the winner.
    const again = await billingAccountByOrg(pb, orgId);
    if (again) return again;
    throw err;
  }
}

/** Raw field patch for `billing_accounts` (PocketBase field names). */
export type BillingAccountPatch = Record<string, unknown>;

/**
 * Write a patch to one account and its audit row in one batch, optionally with an
 * `organizations` patch (the mirrored `billing_status`). The audit meta lists the changed
 * field names only, never values (ids stay out of the audit log).
 */
export async function patchBillingAccount(
  pb: PocketBase,
  sysCtx: OrgContext,
  id: string,
  patch: BillingAccountPatch,
  auditAction: string,
  orgPatch: Record<string, unknown> = {},
): Promise<void> {
  const fields = Object.keys(patch);
  const orgFields = Object.keys(orgPatch);
  if (fields.length === 0 && orgFields.length === 0) return;
  const batch = pb.createBatch();
  if (fields.length > 0) batch.collection(COLLECTION).update(id, patch);
  if (orgFields.length > 0) {
    batch.collection("organizations").update(sysCtx.orgId, orgPatch);
  }
  batch.collection("audit_log").create(
    auditBody(sysCtx, {
      action: auditAction,
      targetCollection: COLLECTION,
      targetId: id,
      meta: { fields, ...(orgFields.length > 0 ? { orgFields } : {}) },
    }),
  );
  await batch.send();
}

/** The org's first owner user id, or null. */
export async function billingOwnerOf(
  pb: PocketBase,
  orgId: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const res = await pb.collection("memberships").getList(1, 1, {
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
    sort: "created,id",
    expand: "user",
    fields: "user,expand.user.email,expand.user.name",
  });
  const m = res.items[0];
  const user = str(m?.user);
  if (!m || user === "") return null;
  const expanded = (m.expand?.user ?? {}) as {
    email?: unknown;
    name?: unknown;
  };
  return { id: user, email: str(expanded.email), name: str(expanded.name) };
}

/**
 * The org context the payment handlers act with (10-12 choice 2): owner role, the org's
 * owner as actor, ip `system:billing` and `systemJob: "billing"`, so installs and audit rows
 * attribute to the billing job (auditBody blanks the actor for system runs). Internal.
 */
export function billingOrgContext(orgId: string, ownerId: string): OrgContext {
  return mintOrgContext({
    orgId,
    actor: ownerId,
    role: "owner",
    grants: [],
    systemJob: BILLING_JOB,
    ip: SYSTEM_IP,
  });
}

// ---------------------------------------------------------------------------------------
// Public (OrgContext first, invariant 1)

/** The org's billing state for the owner's Billing tab; null before any checkout. */
export async function readBillingAccount(
  ctx: OrgContext,
): Promise<BillingAccountView | null> {
  requirePermission(ctx, "billing", "read");
  const record = await withSuperuser((pb) => billingRecordByOrg(pb, ctx.orgId));
  // BILL-05: project through the browser allowlist; provider ids and the draft never leave.
  return record
    ? toView(toBillingAccount(toBrowser(COLLECTION, record) as RecordModel))
    : null;
}
