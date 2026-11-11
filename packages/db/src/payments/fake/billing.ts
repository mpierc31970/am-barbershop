// P10 payments: CdsBilling stand-in (CDS as the seller, D66; PAY-09, CONTEXT A1).
//
// Mirrors the Stripe adapter at the port level, with state in `payment_fake_objects`:
// - createCheckout stores a session and returns the platform's "Test payment" page
//   (`/test-pay/<sessionId>`); the page completes it with fakeCompleteSession.
// - Yearly cadence is Pattern 4(a), as on Stripe: `deferredMonthly` is kept on the session
//   but never put on the subscription; the completion handler adds those items.
// - changeItems with chargeNow on a failing card changes nothing ("card_declined"), the
//   pending_if_incomplete contract. Proration is the fake's approximation (choice 2).
// - Tax is always 0 ("Tax calculated at payment: $0.00 in test mode").
// - normaliseWebhook always throws (choice 3): the fake never accepts HTTP webhooks.
// - In CDS_ENV=production every money call throws PaymentsUnavailable (Pitfall 4).
import {
  WebhookSignatureInvalid,
  type BillingLine,
  type CdsBilling,
  type ChangeItemsInput,
  type NormalisedEvent,
  type ProviderInvoiceLine,
} from "@cds/core/payments";
import { platformUrl } from "../../email/env";
import {
  fakeSuffix,
  getFakeObject,
  listFakeObjects,
  putFakeObject,
  updateFakeObject,
  type FakeObject,
} from "./store";
import {
  addInterval,
  earliestEnd,
  emitLater,
  fakeEvent,
  invoiceLine,
  invoiceNumber,
  latestEnd,
  lineCents,
  monthlyCents,
  mustGet,
  pricedIdentity,
  prorate,
  refuseInProduction,
  registerEmit,
  toInvoice,
  toSession,
  toSubscription,
  type EmitEvent,
  type FakeCustomer,
  type FakeInvoice,
  type FakeItem,
  type FakePortal,
  type FakePrice,
  type FakeRefund,
  type FakeSession,
  type FakeSubscription,
} from "./shared";

const APPLIED_KEYS_MAX = 50;

export type FakeBillingDeps = { emit: EmitEvent; now?: () => Date };

export function hostedInvoiceUrl(id: string): string {
  return platformUrl(`/test-pay/${id}`);
}

export async function customerFailing(customerId: string): Promise<boolean> {
  const c = await getFakeObject<FakeCustomer>(customerId);
  return c?.data.cardFailing === true;
}

/** Store an invoice; paid when the card is good, open (one failed attempt) when not. */
export async function storeInvoice(input: {
  orgId: string | null;
  customerId: string;
  subscriptionId: string | null;
  lines: ProviderInvoiceLine[];
  description: string;
  metadata: Record<string, string>;
  failing: boolean;
  idempotencyKey?: string;
  billingReason?: string;
}): Promise<FakeObject<FakeInvoice>> {
  const totalCents = input.lines.reduce((s, l) => s + l.amountCents, 0);
  const suffix = fakeSuffix(
    input.idempotencyKey ? `invoice:${input.idempotencyKey}` : undefined,
  );
  const id = `in_fake_${suffix}`;
  return putFakeObject<FakeInvoice>(
    "invoice",
    {
      orgId: input.orgId,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      status: input.failing ? "open" : "paid",
      number: invoiceNumber(id),
      lines: input.lines,
      totalCents,
      taxCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      description: input.description,
      metadata: input.metadata,
      attempts: input.failing ? 1 : 0,
      billingReason: input.billingReason ?? "manual",
    },
    input.orgId,
    { id },
  );
}

/** Cents refunded against one invoice (the fake's refund objects). */
async function refundsOf(inv: FakeObject<FakeInvoice>): Promise<number> {
  const refunds = await listFakeObjects<FakeRefund>({
    kind: "refund",
    orgRef: inv.orgRef,
  });
  return refunds
    .filter((r) => r.data.target === inv.id)
    .reduce((s, r) => s + r.data.cents, 0);
}

/**
 * The invoice as the Stripe adapter reports it (WR-E04): a refund on the payment leaves the
 * invoice itself unchanged, and the adapter counts it from the payment's refunds.
 */
async function invoiceView(inv: FakeObject<FakeInvoice>) {
  const base = toInvoice(inv, hostedInvoiceUrl(inv.id));
  if (base.status !== "paid") return base;
  const refunded = Math.min(await refundsOf(inv), base.totalCents);
  return refunded > base.refundedCents
    ? { ...base, refundedCents: refunded }
    : base;
}

export function itemFromLine(line: BillingLine, periodEnd: string): FakeItem {
  return {
    id: `si_fake_${fakeSuffix()}`,
    priceRef: line.priceRef ?? "",
    kind: line.kind,
    key: line.key,
    quantity: line.quantity,
    interval: line.interval,
    currentPeriodEnd: periodEnd,
    unitCents: line.unitCents,
    label: line.label,
  };
}

type Plan = {
  items: FakeItem[];
  lines: ProviderInvoiceLine[];
  /** Integer cents per month after the change. */
  thenMonthlyCents: number;
  periodEnd: string;
};

/** Apply a change to a copy of the items and price it (nothing is stored). */
function planChange(
  sub: FakeSubscription,
  input: Omit<ChangeItemsInput, "idempotencyKey">,
  now: Date,
): Plan {
  const periodEnd =
    earliestEnd(sub.items) ?? addInterval(now.toISOString(), "month");
  const removed = new Set(input.remove);
  const qty = new Map(input.setQuantity.map((q) => [q.itemId, q.quantity]));
  const lines: ProviderInvoiceLine[] = [];
  const items: FakeItem[] = [];
  for (const item of sub.items) {
    if (removed.has(item.id)) continue;
    const quantity = qty.get(item.id) ?? item.quantity;
    if (quantity > item.quantity) {
      lines.push({
        kind: item.kind,
        key: item.key,
        amountCents: prorate(
          monthlyCents(
            item.interval,
            item.unitCents * (quantity - item.quantity),
          ),
          periodEnd,
          now,
        ),
        description: `${item.label} (prorated)`,
      });
    }
    items.push({ ...item, quantity });
  }
  for (const line of input.add) {
    items.push(
      itemFromLine(
        line,
        line.interval === "year"
          ? (latestEnd(sub.items.filter((i) => i.interval === "year")) ??
              addInterval(now.toISOString(), "year"))
          : periodEnd,
      ),
    );
    lines.push({
      kind: line.kind,
      key: line.key,
      amountCents: prorate(
        monthlyCents(line.interval, lineCents(line)),
        periodEnd,
        now,
      ),
      description: `${line.label} (prorated)`,
    });
  }
  // Removals carry no credit in the fake (Stripe would credit the unused time).
  const proration = input.proration === "always_invoice" ? lines : [];
  return {
    items,
    lines: [...proration, ...input.oneTime.map(invoiceLine)],
    thenMonthlyCents: items.reduce(
      (s, i) => s + monthlyCents(i.interval, i.unitCents * i.quantity),
      0,
    ),
    periodEnd,
  };
}

/** CR-C01, as Stripe's `proration_date`: prorate at the given instant, else now. */
function prorationNow(
  input: { prorationDate?: string },
  now: () => Date,
): Date {
  if (input.prorationDate) {
    const d = new Date(input.prorationDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return now();
}

export function createFakeCdsBilling(deps: FakeBillingDeps): CdsBilling {
  const { emit } = deps;
  const now = deps.now ?? (() => new Date());
  registerEmit(emit);

  const later = (e: NormalisedEvent) => emitLater(emit, e);

  async function getSub(id: string) {
    return mustGet<FakeSubscription>(id, "subscription");
  }

  const billing: CdsBilling = {
    provider: "fake",

    async ensureCustomer(input) {
      if (input.customerId) return { customerId: input.customerId };
      const c = await putFakeObject<FakeCustomer>(
        "customer",
        {
          orgId: input.orgId,
          name: input.name,
          email: input.email,
          cardFailing: false,
        },
        input.orgId,
        { idempotencyKey: input.idempotencyKey },
      );
      return { customerId: c.id };
    },

    async createCheckout(input) {
      refuseInProduction();
      const s = await putFakeObject<FakeSession>(
        "session",
        {
          orgId: input.orgId,
          customerId: input.customerId,
          account: null,
          customerEmail: null,
          lines: [...input.lines],
          deferredMonthly: [...input.deferredMonthly],
          cadence: input.cadence,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          status: "open",
          paymentStatus: "unpaid",
          subscriptionId: null,
          invoiceId: null,
          refundedCents: 0,
        },
        input.orgId,
        { idempotencyKey: input.idempotencyKey },
      );
      return { sessionId: s.id, url: platformUrl(`/test-pay/${s.id}`) };
    },

    async expireCheckout(sessionId) {
      const s = await getFakeObject<FakeSession>(sessionId);
      if (!s || s.kind !== "session") return "expired";
      if (s.data.status === "complete") return "complete";
      if (s.data.status === "open") {
        await updateFakeObject<FakeSession>(s.id, { status: "expired" });
        later(
          fakeEvent(s.data.orgId, {
            type: "checkout.expired",
            sessionId: s.id,
          }),
        );
      }
      return "expired";
    },

    async changeItems(input) {
      refuseInProduction();
      const sub = await getSub(input.subscriptionId);
      const invoiceKey = `change:${input.idempotencyKey}`;
      // CR-C01, as on Stripe: the idempotent response is replayed, a decline included.
      if ((sub.data.declinedKeys ?? []).includes(input.idempotencyKey)) {
        return { applied: false, reason: "card_declined" };
      }
      if (sub.data.appliedKeys.includes(input.idempotencyKey)) {
        const prior = await getFakeObject<FakeInvoice>(
          `in_fake_${fakeSuffix(`invoice:${invoiceKey}`)}`,
        );
        return {
          applied: true,
          invoice: prior ? toInvoice(prior, hostedInvoiceUrl(prior.id)) : null,
        };
      }
      // WR-E09, as on Stripe: a saved-card charge sends no item metadata, so the new
      // items are what their synced prices say they are.
      const change = input.chargeNow
        ? {
            ...input,
            add: await Promise.all(
              input.add.map(async (l) => ({
                ...l,
                ...(await pricedIdentity(l)),
              })),
            ),
          }
        : input;
      const plan = planChange(sub.data, change, prorationNow(input, now));
      const invoiced =
        input.proration === "always_invoice" || input.oneTime.length > 0;
      const amount = plan.lines.reduce((s, l) => s + l.amountCents, 0);
      const failing = await customerFailing(sub.data.customerId);
      if (invoiced && amount > 0 && failing && input.chargeNow) {
        // pending_if_incomplete: the change waits on an unpaid invoice; nothing applies.
        await updateFakeObject<FakeSubscription>(sub.id, {
          declinedKeys: [
            ...(sub.data.declinedKeys ?? []),
            input.idempotencyKey,
          ].slice(-APPLIED_KEYS_MAX),
        });
        return { applied: false, reason: "card_declined" };
      }
      await updateFakeObject<FakeSubscription>(sub.id, {
        items: plan.items,
        appliedKeys: [...sub.data.appliedKeys, input.idempotencyKey].slice(
          -APPLIED_KEYS_MAX,
        ),
      });
      const orgId = sub.data.orgId;
      let invoice: FakeObject<FakeInvoice> | null = null;
      if (invoiced) {
        invoice = await storeInvoice({
          orgId,
          customerId: sub.data.customerId,
          subscriptionId: sub.id,
          lines: plan.lines,
          description: "Subscription update",
          metadata: {},
          failing: failing && amount > 0,
          idempotencyKey: invoiceKey,
          billingReason: "subscription_update",
        });
        await updateFakeObject<FakeSubscription>(sub.id, {
          latestInvoiceId: invoice.id,
        });
      }
      later(
        fakeEvent(orgId, {
          type: "subscription.updated",
          subscriptionId: sub.id,
        }),
      );
      if (invoice) {
        later(
          fakeEvent(orgId, {
            type:
              invoice.data.status === "paid"
                ? "invoice.paid"
                : "invoice.payment_failed",
            invoiceId: invoice.id,
          }),
        );
      }
      return {
        applied: true,
        invoice: invoice
          ? toInvoice(invoice, hostedInvoiceUrl(invoice.id))
          : null,
      };
    },

    async previewChange(input) {
      const sub = await getSub(input.subscriptionId);
      const plan = planChange(sub.data, input, prorationNow(input, now));
      return {
        todayCents:
          input.proration === "always_invoice"
            ? plan.lines.reduce((s, l) => s + l.amountCents, 0)
            : 0,
        taxCents: 0,
        thenMonthlyCents: plan.thenMonthlyCents,
        periodEnd: plan.periodEnd,
      };
    },

    async createInvoice(input) {
      refuseInProduction();
      const failing = await customerFailing(input.customerId);
      const inv = await storeInvoice({
        orgId: input.orgId,
        customerId: input.customerId,
        subscriptionId: null,
        lines: input.lines.map(invoiceLine),
        description: input.description,
        metadata: { ...input.metadata },
        failing,
        idempotencyKey: input.idempotencyKey,
      });
      later(
        fakeEvent(input.orgId, {
          type:
            inv.data.status === "paid"
              ? "invoice.paid"
              : "invoice.payment_failed",
          invoiceId: inv.id,
        }),
      );
      return toInvoice(inv, hostedInvoiceUrl(inv.id));
    },

    async refundAll(input) {
      refuseInProduction();
      const customer = await getFakeObject<FakeCustomer>(input.customerId);
      const invoices = await listFakeObjects<FakeInvoice>({
        kind: "invoice",
        orgRef: customer?.orgRef ?? null,
      });
      let refundedCents = 0;
      let count = 0;
      for (const inv of invoices) {
        if (inv.data.customerId !== input.customerId) continue;
        const remaining =
          inv.data.totalCents -
          Math.max(inv.data.refundedCents, await refundsOf(inv));
        if (inv.data.status !== "paid" || remaining <= 0) continue;
        await putFakeObject<FakeRefund>(
          "refund",
          {
            customerId: input.customerId,
            account: null,
            target: inv.id,
            cents: remaining,
          },
          inv.data.orgId,
          { idempotencyKey: `${input.idempotencyKey}:${inv.id}` },
        );
        // As on Stripe: a refund on the charge does not touch the invoice (WR-E04).
        refundedCents += remaining;
        count += 1;
      }
      if (count > 0) {
        later(
          fakeEvent(customer?.orgRef ?? null, {
            type: "charge.refunded",
            customerId: input.customerId,
          }),
        );
      }
      return { refundedCents, count };
    },

    async cancel(input) {
      const sub = await getSub(input.subscriptionId);
      const orgId = sub.data.orgId;
      if (input.mode === "now") {
        const saved = await updateFakeObject<FakeSubscription>(sub.id, {
          status: "canceled",
          cancelAt: now().toISOString(),
        });
        later(
          fakeEvent(orgId, {
            type: "subscription.deleted",
            subscriptionId: sub.id,
          }),
        );
        return toSubscription(saved);
      }
      // cancel_at = max_period_end (annual runs to term, BILL-16).
      const saved = await updateFakeObject<FakeSubscription>(sub.id, {
        cancelAt: latestEnd(sub.data.items) ?? now().toISOString(),
      });
      later(
        fakeEvent(orgId, {
          type: "subscription.updated",
          subscriptionId: sub.id,
        }),
      );
      return toSubscription(saved);
    },

    async listInvoices(input) {
      const customer = await getFakeObject<FakeCustomer>(input.customerId);
      if (!customer) return [];
      const since = input.since?.toISOString() ?? null;
      const rows = await listFakeObjects<FakeInvoice>({
        kind: "invoice",
        orgRef: customer.orgRef,
      });
      const views = rows
        .filter(
          (r) =>
            r.data.customerId === input.customerId &&
            (since === null || r.data.createdAt >= since),
        )
        .map((r) => invoiceView(r));
      return Promise.all(views);
    },

    async syncPrice(input) {
      if (input.previousPriceRef) {
        const prev = await getFakeObject<FakePrice>(input.previousPriceRef);
        if (
          prev &&
          prev.data.active &&
          prev.data.cents === input.cents &&
          prev.data.interval === input.interval &&
          input.productRef
        ) {
          return { priceRef: prev.id, productRef: input.productRef };
        }
      }
      const productRef =
        input.productRef ??
        `prod_fake_${fakeSuffix(`product:${input.kind}:${input.key}:${input.path}`)}`;
      const price = await putFakeObject<FakePrice>(
        "price",
        {
          kind: String(input.kind),
          key: input.key,
          path: input.path,
          interval: input.interval,
          cents: input.cents,
          productRef,
          active: true,
        },
        null,
        {
          idempotencyKey: `${productRef}:${input.previousPriceRef ?? "none"}:${input.interval}:${input.cents}`,
        },
      );
      if (input.previousPriceRef && input.previousPriceRef !== price.id) {
        const prev = await getFakeObject<FakePrice>(input.previousPriceRef);
        if (prev) {
          await updateFakeObject<FakePrice>(prev.id, { active: false });
        }
      }
      return { priceRef: price.id, productRef };
    },

    async reportUsage() {
      // Billing Meters have no fake counterpart: usage is metered in Stripe only.
    },

    async portalUrl(input) {
      const customer = await getFakeObject<FakeCustomer>(input.customerId);
      const portal = await putFakeObject<FakePortal>(
        "portal",
        { customerId: input.customerId, returnUrl: input.returnUrl },
        customer?.orgRef ?? null,
      );
      return platformUrl(`/test-pay/portal?session=${portal.id}`);
    },

    async fetchSubscription(id) {
      return toSubscription(await getSub(id));
    },

    async fetchInvoice(id) {
      return invoiceView(await mustGet<FakeInvoice>(id, "invoice"));
    },

    async fetchCheckoutSession(id) {
      return toSession(await mustGet<FakeSession>(id, "session"));
    },

    normaliseWebhook() {
      // Choice 3: the fake never accepts HTTP webhooks (T-10-45-03); it emits in-process.
      return Promise.reject(new WebhookSignatureInvalid());
    },

    async reconcile(input) {
      const at = now().toISOString();
      const events: NormalisedEvent[] = [];
      const base = (id: string, orgId: string | null) => ({
        id,
        provider: "fake" as const,
        account: null,
        orgId,
        createdAt: at,
      });
      const since = input.since;
      for (const s of await listFakeObjects<FakeSubscription>({
        kind: "subscription",
        updatedSince: since,
      })) {
        events.push({
          ...base(
            `reconcile:${s.id}:${s.data.status}:${s.updated}`,
            s.data.orgId,
          ),
          type:
            s.data.status === "canceled"
              ? "subscription.deleted"
              : "subscription.updated",
          subscriptionId: s.id,
        });
      }
      for (const inv of await listFakeObjects<FakeInvoice>({
        kind: "invoice",
        updatedSince: since,
      })) {
        const st = inv.data.status;
        const type =
          st === "paid"
            ? "invoice.paid"
            : st === "void"
              ? "invoice.voided"
              : st === "open"
                ? inv.data.attempts > 0
                  ? "invoice.payment_failed"
                  : "invoice.finalized"
                : null;
        if (!type) continue;
        events.push({
          ...base(`reconcile:${inv.id}:${st}:${inv.updated}`, inv.data.orgId),
          type,
          invoiceId: inv.id,
        });
      }
      for (const s of await listFakeObjects<FakeSession>({
        kind: "session",
        updatedSince: since,
      })) {
        if (s.data.status === "open" || s.data.account) continue;
        events.push({
          ...base(
            `reconcile:${s.id}:${s.data.status}:${s.updated}`,
            s.data.orgId,
          ),
          type:
            s.data.status === "complete"
              ? "checkout.completed"
              : "checkout.expired",
          sessionId: s.id,
        });
      }
      return events;
    },
  };
  return billing;
}
