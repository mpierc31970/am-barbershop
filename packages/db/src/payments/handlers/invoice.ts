// P10 payments: invoice handlers (PAY-01, BILL-08, BILL-11; CONTEXT A2, A4; D82, D181).
//
// Every invoice event re-fetches the invoice and upserts one `billing_invoices` row (no
// card data). The transition of a row to `paid` sends one `billing.receipt` (10-12 choice 4).
// `installments_paid` is recomputed from the paid mirror rows that carry an installment
// line, never incremented; the installment rule then adds the remainder item before the
// 6th payment and removes the installment item after it (Pitfall 6).
//
// Guard (choice 5, T-10-12-01): the fetched invoice's customer must be the org's
// `customer_id`, otherwise the event is `ignored` and nothing is written.
// Each handler holds `billing:<org>`; never `addons:<org>` (the installer takes that one).
// Logs carry event, invoice and org ids only.
// 10-26: an invoice whose metadata names a `work_order` moves that order on payment
// (accepted -> paid / deposit_paid, delivered -> paid) and links the mirror row to it.
import { BUSINESS_TIME_ZONE, installmentSplit } from "@cds/core/payments";
import type { NormalisedEvent, ProviderInvoice } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { auditBody } from "../../audit";
import { readPriceCatalog } from "../../catalog";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { mintSystemContext, type OrgContext } from "../../context";
import { platformUrl } from "../../email/env";
import { sendEmail } from "../../email/send";
import {
  billingAccountByCustomer,
  billingAccountByOrg,
  billingOrgContext,
  billingOwnerOf,
  INSTALLMENT_REMAINDER_KEY,
  patchBillingAccount,
  type BillingAccount,
} from "../accounts";
import {
  invoiceMirrorOf,
  invoiceMirrorsOf,
  isInvoiceKind,
  upsertInvoiceMirror,
  type InvoiceKind,
} from "../invoices";
import { guardProviderIdWrite } from "../staff-alert";
import { applyWorkOrderPayment } from "../work-orders";
import { installmentActions } from "./installments";
import type { HandlerContext, HandlerMap } from "./types";

const BILLING_HUB_PATH = "/hub/settings?tab=billing";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** "8 Oct 2026" in the business time zone (the receipt's paid-on day). */
export function receiptDay(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(Number.isNaN(d.getTime()) ? new Date() : d);
}

/** A new mirror row's kind, from what the invoice says about itself. */
export function inferInvoiceKind(inv: ProviderInvoice): InvoiceKind {
  const declared = inv.metadata.kind;
  if (isInvoiceKind(declared)) return declared;
  if (inv.metadata.work_order) return "work_order";
  if (inv.metadata.session) return "checkout";
  // WR-E03: Stripe's Checkout leaves no session mark on its first invoice.
  if (inv.billingReason === "subscription_create") return "checkout";
  if (!inv.subscriptionId) return "one_off";
  return "renewal";
}

/** The org's billing context for audit rows and installs (choice 2). */
export async function billingContextFor(
  pb: PocketBase,
  orgId: string,
): Promise<OrgContext> {
  const owner = await billingOwnerOf(pb, orgId);
  return billingOrgContext(orgId, owner?.id ?? "");
}

/**
 * The org's account when the provider object's customer is the org's customer; null (and a
 * log line) otherwise (choice 5).
 */
export async function guardedAccount(
  pb: PocketBase,
  orgId: string,
  customerId: string,
  tag: string,
): Promise<BillingAccount | null> {
  const account = await billingAccountByOrg(pb, orgId);
  if (
    !account ||
    account.customerId === "" ||
    account.customerId !== customerId
  ) {
    console.warn(
      `[payments] ${tag} ignored: customer does not belong to org ${orgId}`,
    );
    return null;
  }
  return account;
}

async function sendReceipt(
  pb: PocketBase,
  orgId: string,
  inv: ProviderInvoice,
  h: HandlerContext,
): Promise<void> {
  try {
    const owner = await billingOwnerOf(pb, orgId);
    if (!owner || owner.email === "") {
      console.error(
        `[payments] receipt for ${inv.id}: org ${orgId} has no owner email`,
      );
      return;
    }
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name" });
    const firstName = owner.name.trim().split(/\s+/)[0] ?? "";
    await sendEmail(
      { kind: "cds", ctx: mintSystemContext({ job: "billing" }) },
      "billing.receipt",
      owner.email,
      {
        firstName: firstName === "" ? "there" : firstName,
        orgName: str(org.name),
        paidOn: receiptDay(h.now.toISOString()),
        paidCents: inv.totalCents,
        taxCents: inv.taxCents,
        lines: inv.lines.map((l) => ({
          label: l.description,
          cents: l.amountCents,
        })),
        nextBill: null,
        invoiceUrl: platformUrl(BILLING_HUB_PATH),
      },
      h.transport ? { transport: h.transport } : {},
    );
  } catch (err) {
    // The mirror is written; a lost receipt is logged, never a failed event.
    console.error(
      `[payments] receipt for ${inv.id} (org ${orgId}) not sent: ${errName(err)}`,
    );
  }
}

export async function buildCentsFor(
  pb: PocketBase,
  orgId: string,
  account: BillingAccount,
): Promise<{ cents: number; path: string } | null> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,path" });
  const path = str(org.path);
  const drafted = account.checkoutDraft?.buildCents;
  if (typeof drafted === "number") return { cents: drafted, path };
  const row = (await readPriceCatalog()).find(
    (r) =>
      r.itemKind === "build_fee" && r.itemKey === "base" && r.path === path,
  );
  const cents = row?.oneTimeCents ?? null;
  return cents === null ? null : { cents, path };
}

/**
 * Recompute `installments_paid` from the mirror and apply the installment rule (BILL-11).
 * Every step is idempotent by state: the count is a recount, the remainder is added only
 * while absent and the items are removed only while present.
 */
export async function syncInstallments(
  pb: PocketBase,
  sysCtx: OrgContext,
  account: BillingAccount,
  h: HandlerContext,
): Promise<void> {
  if (account.buildPlan !== "installments") return;
  const orgId = sysCtx.orgId;
  const mirrors = await invoiceMirrorsOf(pb, orgId);
  const paidCount = mirrors.filter(
    (m) => m.hasInstallment && m.status === "paid",
  ).length;
  if (paidCount !== account.installmentsPaid) {
    await patchBillingAccount(
      pb,
      sysCtx,
      account.id,
      { installments_paid: paidCount },
      "billing.installments",
    );
  }
  if (account.subscriptionId === "") return;
  const sub = await h.billing.fetchSubscription(account.subscriptionId);
  const items = sub.items.filter((i) => i.kind === "installment");
  const remainder = items.find((i) => i.key === INSTALLMENT_REMAINDER_KEY);
  const build = await buildCentsFor(pb, orgId, account);
  const split = build ? installmentSplit(build.cents) : null;
  const action = installmentActions({
    buildPlan: account.buildPlan,
    paidCount,
    remainderAdded: remainder !== undefined,
    itemPresent: items.length > 0,
    eachCents: split?.eachCents ?? 0,
    lastCents: split?.lastCents ?? 0,
  });
  if (action === "none") return;
  if (action === "add_remainder" && build && split) {
    const cents = split.lastCents - split.eachCents;
    const { priceRef } = await h.billing.syncPrice({
      // CR-E01: the price itself says "installment" (Stripe reads invoice lines by price).
      kind: "installment",
      key: INSTALLMENT_REMAINDER_KEY,
      path: build.path,
      interval: "month",
      cents,
      productRef: null,
      previousPriceRef: null,
    });
    await h.billing.changeItems({
      subscriptionId: sub.id,
      add: [
        {
          kind: "installment",
          key: INSTALLMENT_REMAINDER_KEY,
          label: "Website build, final payment adjustment",
          interval: "month",
          unitCents: cents,
          quantity: 1,
          priceRef,
        },
      ],
      remove: [],
      setQuantity: [],
      oneTime: [],
      proration: "none",
      chargeNow: false,
      idempotencyKey: `installment-remainder:${sub.id}`,
    });
  } else if (action === "remove_item") {
    await h.billing.changeItems({
      subscriptionId: sub.id,
      add: [],
      remove: items.map((i) => i.id),
      setQuantity: [],
      oneTime: [],
      proration: "none",
      chargeNow: false,
      idempotencyKey: `installment-remove:${sub.id}`,
    });
  } else {
    return;
  }
  await pb.collection("audit_log").create(
    auditBody(sysCtx, {
      action: "billing.installments",
      targetCollection: "billing_accounts",
      targetId: account.id,
      meta: { action, paidCount },
    }),
  );
}

/**
 * Mirror one re-fetched invoice for an org whose account passed the guard; a new `paid`
 * sends the receipt; then installments are recomputed. `kind` overrides the inferred kind
 * (the checkout handler knows its invoice is the checkout's).
 */
export async function applyInvoice(
  pb: PocketBase,
  account: BillingAccount,
  inv: ProviderInvoice,
  h: HandlerContext,
  kind: InvoiceKind | null = null,
): Promise<void> {
  const orgId = account.organization;
  const sysCtx = await billingContextFor(pb, orgId);
  const existing = await invoiceMirrorOf(pb, orgId, inv.id);
  const finalKind = kind ?? existing?.kind ?? inferInvoiceKind(inv);
  // CR-E01: the checkout invoice always carries build payment 1 when the order pays in
  // installments. On yearly cadence that payment is an inline one-time line whose kind
  // Stripe keeps on the product, out of sight of the invoice line.
  const buildPlan = account.buildPlan ?? account.checkoutDraft?.buildPlan;
  // WR-A01: an invoice another org already mirrors fails the event (staff alerted).
  const res = await guardProviderIdWrite(
    pb,
    orgId,
    "invoice id",
    () =>
      upsertInvoiceMirror(
        pb,
        orgId,
        inv,
        finalKind,
        account.provider,
        finalKind === "checkout" && buildPlan === "installments"
          ? { hasInstallment: true }
          : {},
      ),
    h.transport,
  );
  if (res.changed) {
    await pb.collection("audit_log").create(
      auditBody(sysCtx, {
        action: "billing.invoice_mirrored",
        targetCollection: "billing_invoices",
        targetId: res.row.id,
        meta: { status: res.row.status, kind: res.row.kind },
      }),
    );
  }
  if (res.becamePaid) await sendReceipt(pb, orgId, inv, h);
  // BILL-20 (10-26): a paid quote invoice moves its work order (state-idempotent).
  if (inv.metadata.work_order) {
    await applyWorkOrderPayment(pb, sysCtx, inv, h.now);
  }
  const fresh = (await billingAccountByOrg(pb, orgId)) ?? account;
  await syncInstallments(pb, sysCtx, fresh, h);
}

type InvoiceEvent = Extract<NormalisedEvent, { invoiceId: string }>;

async function onInvoice(
  e: NormalisedEvent,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  const ev = e as InvoiceEvent;
  // Tenant-side (Connect) invoices are not CDS's; nothing here mirrors them.
  if (ev.account) return "ignored";
  let inv = await h.billing.fetchInvoice(ev.invoiceId);
  const orgId = inv.orgId ?? ev.orgId;
  if (!orgId) {
    console.warn(`[payments] ${ev.id} ignored: invoice ${inv.id} names no org`);
    return "ignored";
  }
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      // Re-read under the lock: events arrive out of order.
      inv = await h.billing.fetchInvoice(ev.invoiceId);
      if (inv.orgId && inv.orgId !== orgId) return "ignored";
      const account = await guardedAccount(pb, orgId, inv.customerId, ev.id);
      if (!account) return "ignored";
      await applyInvoice(pb, account, inv, h);
      return "applied";
    }),
  );
}

async function onChargeRefunded(
  e: NormalisedEvent,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  if (e.type !== "charge.refunded" || e.account) return "ignored";
  const customerId = e.customerId;
  const account = await withSuperuser((pb) =>
    billingAccountByCustomer(pb, customerId),
  );
  if (!account || (e.orgId && e.orgId !== account.organization)) {
    console.warn(
      `[payments] ${e.id} ignored: refund customer has no matching org`,
    );
    return "ignored";
  }
  const orgId = account.organization;
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const current = await guardedAccount(pb, orgId, customerId, e.id);
      if (!current) return "ignored";
      const invoices = await h.billing.listInvoices({
        customerId,
        since: null,
      });
      for (const inv of invoices) {
        if (inv.customerId !== customerId) continue;
        if (inv.orgId && inv.orgId !== orgId) continue;
        await applyInvoice(pb, current, inv, h);
      }
      return "applied";
    }),
  );
}

export const invoiceHandlers: HandlerMap = {
  "invoice.paid": onInvoice,
  "invoice.payment_failed": onInvoice,
  "invoice.finalized": onInvoice,
  "invoice.voided": onInvoice,
  "charge.refunded": onChargeRefunded,
};
