// P10 payments: entitlements follow the subscription (BILL-03, BILL-11, BILL-16; CONTEXT A2,
// A3; D27, D181, D310; RESEARCH Pattern 6, Pitfalls 5 and 6; invariant 9).
//
// | provider status                         | account   | add-ons                                  | owner      |
// | active / trialing                       | active    | lapse rows re-enabled                    | restored   |
// | past_due                                | past_due  | unchanged (lapse rows re-enabled)        | card_failed|
// | unpaid / canceled / incomplete_expired  | lapsed    | paid add-ons -> disabled / billing_lapse | lapsed     |
//
// Choices (10-15, unattended):
// 1. A "paid add-on" is an add-on slug present as an item on the (re-fetched) subscription,
//    and not $0 in the catalog for the org's path. Pre-billing rows (hub/staff/assembly with
//    no subscription item) and plan-included $0 rows are never touched.
// 2. Emails go out once per transition: only when `billing_accounts.status` changes.
// 3. `syncItemsToAccount` keeps care_plan, the media and pages pack quantities and current_period_end
//    in step with the fetched items.
// 4. A cancel on a declined site (`declined_at` set, 10-28) creates no remaining-installments
//    invoice.
//
// Nothing here deletes anything: a lapse is a disable through the P5 installer. Every step
// is state-idempotent, so a replayed or reconciled event changes nothing. Internal: these
// take the superuser client or the handler context and are not exported from @cds/db.
import {
  BUILD_INSTALLMENTS,
  installmentSplit,
  lapseStateFor,
  type BillingLine,
  type ProviderSubscription,
} from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { lapseAddons, restoreLapsedAddons } from "../addons/installer";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { readPriceCatalog } from "../catalog";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { mintSystemContext, type OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import {
  billingAccountByOrg,
  billingOwnerOf,
  INSTALLMENT_KEY,
  patchBillingAccount,
  type BillingAccount,
  type BillingItemPrice,
  type BillingAccountPatch,
} from "./accounts";
import {
  billingContextFor,
  buildCentsFor,
  guardedAccount,
  receiptDay,
} from "./handlers/invoice";
import type { HandlerContext } from "./handlers/types";

const BILLING_TAB_PATH = "/hub/settings?tab=billing";
const HUB_PATH = "/hub";
/** Metadata key on the one-off invoice for the installments left at cancel (D181). */
export const REMAINING_INSTALLMENTS_META = "installments_remaining_for";
const MEDIA_5GB_KEY = "media-5gb";
const MEDIA_25GB_KEY = "media-25gb";
const PAGES_5_KEY = "pages-5";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------------------
// Items -> account (choice 3)

/** The account fields the subscription items decide. Pure. */
export function itemsPatch(
  account: BillingAccount,
  sub: ProviderSubscription,
): BillingAccountPatch {
  const qty = (key: string) =>
    sub.items
      .filter((i) => i.kind === "pack" && i.key === key)
      .reduce((s, i) => s + i.quantity, 0);
  const carePlan = sub.items.some((i) => i.kind === "care_plan");
  const ends = sub.items
    .map((i) => i.currentPeriodEnd)
    .filter((e) => e !== "")
    .sort();
  const periodEnd = ends[0] ?? null;
  const patch: BillingAccountPatch = {};
  if (account.carePlan !== carePlan) patch.care_plan = carePlan;
  if (account.media5gbQty !== qty(MEDIA_5GB_KEY)) {
    patch.media_5gb_qty = qty(MEDIA_5GB_KEY);
  }
  if (account.media25gbQty !== qty(MEDIA_25GB_KEY)) {
    patch.media_25gb_qty = qty(MEDIA_25GB_KEY);
  }
  if (account.pages5Qty !== qty(PAGES_5_KEY)) {
    patch.pages_5_qty = qty(PAGES_5_KEY);
  }
  if (periodEnd !== null && !sameInstant(account.currentPeriodEnd, periodEnd)) {
    patch.current_period_end = periodEnd;
  }
  // WR-D04: what each item is billed at, so the Billing tab shows locked prices (D161).
  const prices = itemPricesOf(sub);
  if (
    prices !== null &&
    JSON.stringify(prices) !== JSON.stringify(account.itemPrices)
  ) {
    patch.item_prices = prices;
  }
  return patch;
}

/** The items as billed, merged per (kind, key, interval); null when no item says its price. */
function itemPricesOf(sub: ProviderSubscription): BillingItemPrice[] | null {
  if (
    sub.items.length > 0 &&
    sub.items.every((i) => i.unitCents === undefined)
  ) {
    return null;
  }
  const out: BillingItemPrice[] = [];
  for (const i of sub.items) {
    if (i.unitCents === undefined) continue;
    const interval: BillingItemPrice["interval"] =
      i.interval === "year" ? "year" : i.interval === "once" ? "once" : "month";
    const same = out.find(
      (o) =>
        o.kind === i.kind &&
        o.key === i.key &&
        o.interval === interval &&
        o.unitCents === i.unitCents,
    );
    if (same) same.quantity += i.quantity;
    else
      out.push({
        kind: i.kind,
        key: i.key,
        interval,
        unitCents: i.unitCents,
        quantity: i.quantity,
      });
  }
  return out.sort((a, b) =>
    `${a.kind}:${a.key}:${a.interval}`.localeCompare(
      `${b.kind}:${b.key}:${b.interval}`,
    ),
  );
}

function sameInstant(a: string | null, b: string): boolean {
  if (a === null) return false;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  return !Number.isNaN(x) && x === y;
}

/** Write the item-derived fields when they differ (no write, no audit row otherwise). */
export async function syncItemsToAccount(
  pb: PocketBase,
  orgId: string,
  sub: ProviderSubscription,
): Promise<void> {
  const account = await billingAccountByOrg(pb, orgId);
  if (!account) return;
  const patch = itemsPatch(account, sub);
  if (Object.keys(patch).length === 0) return;
  const ctx = await billingContextFor(pb, orgId);
  await patchBillingAccount(pb, ctx, account.id, patch, "billing.items_synced");
}

// ---------------------------------------------------------------------------------------
// Pieces

/** Add-on slugs paid for on this subscription (choice 1): items, minus $0 catalog rows. */
async function paidAddonSlugs(
  pb: PocketBase,
  orgId: string,
  sub: ProviderSubscription,
): Promise<string[]> {
  const onSub = [
    ...new Set(sub.items.filter((i) => i.kind === "addon").map((i) => i.key)),
  ];
  if (onSub.length === 0) return [];
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,path" });
  const path = str(org.path);
  const included = new Set(
    (await readPriceCatalog())
      .filter(
        (r) =>
          r.itemKind === "addon" && r.path === path && r.monthlyCents === 0,
      )
      .map((r) => r.itemKey),
  );
  return onSub.filter((s) => !included.has(s));
}

/** Integer cents still owed on open invoices of this customer (for the emails). */
async function openCents(
  account: BillingAccount,
  h: HandlerContext,
): Promise<number> {
  try {
    const invoices = await h.billing.listInvoices({
      customerId: account.customerId,
      since: null,
    });
    return invoices
      .filter((i) => i.customerId === account.customerId && i.status === "open")
      .reduce((s, i) => s + i.totalCents, 0);
  } catch (err) {
    console.error(
      `[payments] org ${account.organization}: open amount unknown: ${errName(err)}`,
    );
    return account.amountDueCents;
  }
}

async function ownerEmail(
  pb: PocketBase,
  orgId: string,
): Promise<{ to: string; orgName: string } | null> {
  const owner = await billingOwnerOf(pb, orgId);
  if (!owner || owner.email === "") {
    console.error(
      `[payments] org ${orgId}: no owner email for a billing notice`,
    );
    return null;
  }
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  return { to: owner.email, orgName: str(org.name) };
}

type Notice =
  | { type: "billing.card_failed"; amountCents: number }
  | { type: "billing.lapsed"; amountCents: number; addons: string[] }
  | { type: "billing.restored"; addons: string[] };

/** One owner notice; a lost email is logged, never a failed event. */
async function notify(
  pb: PocketBase,
  orgId: string,
  n: Notice,
  h: HandlerContext,
): Promise<void> {
  try {
    const who = await ownerEmail(pb, orgId);
    if (!who) return;
    const sender = {
      kind: "cds" as const,
      ctx: mintSystemContext({ job: "billing" }),
    };
    const opts = h.transport ? { transport: h.transport } : {};
    const billingTab = platformUrl(BILLING_TAB_PATH);
    if (n.type === "billing.card_failed") {
      await sendEmail(
        sender,
        n.type,
        who.to,
        {
          orgName: who.orgName,
          amountCents: n.amountCents,
          date: receiptDay(h.now.toISOString()),
          updateUrl: billingTab,
        },
        opts,
      );
    } else if (n.type === "billing.lapsed") {
      await sendEmail(
        sender,
        n.type,
        who.to,
        {
          orgName: who.orgName,
          amountCents: n.amountCents,
          addons: n.addons,
          payUrl: billingTab,
        },
        opts,
      );
    } else {
      await sendEmail(
        sender,
        n.type,
        who.to,
        { addons: n.addons, hubUrl: platformUrl(HUB_PATH) },
        opts,
      );
    }
  } catch (err) {
    console.error(
      `[payments] org ${orgId}: ${n.type} not sent: ${errName(err)}`,
    );
  }
}

function addonName(h: HandlerContext, slug: string): string {
  return h.addons?.addons.get(slug)?.name ?? slug;
}

/** Names of the org's add-ons currently paused for a lapse. */
async function lapsedNames(
  pb: PocketBase,
  orgId: string,
  h: HandlerContext,
): Promise<string[]> {
  const rows = await pb.collection("org_addons").getFullList({
    filter: pb.filter(
      "organization = {:org} && status = 'disabled' && disabled_reason = 'billing_lapse'",
      { org: orgId },
    ),
    sort: "addon",
    fields: "addon",
  });
  return rows.map((r) => addonName(h, str(r.addon)));
}

/**
 * The installments left when a subscription on the 6-payment plan is cancelled, as invoice
 * lines (Pitfall 6): `(left - 1) x each` plus the last payment with its remainder cents.
 * Pure. Empty when nothing is left.
 */
export function remainingInstallmentLines(
  buildCents: number,
  paid: number,
): BillingLine[] {
  const left =
    BUILD_INSTALLMENTS - Math.max(0, Math.min(paid, BUILD_INSTALLMENTS));
  if (left <= 0) return [];
  const { eachCents, lastCents } = installmentSplit(buildCents);
  const lines: BillingLine[] = [];
  if (left > 1) {
    lines.push({
      kind: "installment",
      key: INSTALLMENT_KEY,
      label: `Website build, remaining payments ${paid + 1} to ${BUILD_INSTALLMENTS - 1}`,
      interval: "once",
      unitCents: eachCents,
      quantity: left - 1,
      priceRef: null,
    });
  }
  lines.push({
    kind: "installment",
    key: INSTALLMENT_KEY,
    label: `Website build, final payment ${BUILD_INSTALLMENTS} of ${BUILD_INSTALLMENTS}`,
    interval: "once",
    unitCents: lastCents,
    quantity: 1,
    priceRef: null,
  });
  return lines;
}

/** D181 / BILL-11: one one-off invoice for the installments left at cancel (choice 4). */
async function invoiceRemainingInstallments(
  pb: PocketBase,
  ctx: OrgContext,
  account: BillingAccount,
  sub: ProviderSubscription,
  h: HandlerContext,
): Promise<void> {
  if (sub.status !== "canceled") return;
  if (account.buildPlan !== "installments") return;
  if (account.declinedAt !== null) return;
  if (account.installmentsPaid >= BUILD_INSTALLMENTS) return;
  const existing = await h.billing.listInvoices({
    customerId: account.customerId,
    since: null,
  });
  if (
    existing.some((i) => i.metadata[REMAINING_INSTALLMENTS_META] === sub.id)
  ) {
    return;
  }
  const build = await buildCentsFor(pb, ctx.orgId, account);
  if (!build) {
    console.error(
      `[payments] org ${ctx.orgId}: build fee unknown; remaining installments not invoiced`,
    );
    return;
  }
  const lines = remainingInstallmentLines(
    build.cents,
    account.installmentsPaid,
  );
  if (lines.length === 0) return;
  await h.billing.createInvoice({
    orgId: ctx.orgId,
    customerId: account.customerId,
    lines,
    description: "Website build, remaining payments",
    metadata: { kind: "one_off", [REMAINING_INSTALLMENTS_META]: sub.id },
    idempotencyKey: `installments-remaining:${sub.id}`,
  });
  await pb.collection("audit_log").create(
    auditBody(ctx, {
      action: "billing.installments_remaining",
      targetCollection: "billing_accounts",
      targetId: account.id,
      meta: { paid: account.installmentsPaid, lines: lines.length },
    }),
  );
}

// ---------------------------------------------------------------------------------------
// The state sync

/**
 * Apply a subscription's current state to the org (Pattern 6). Re-fetches the subscription
 * under `billing:<org>` (T-10-15-05), so a stale event applies the newest state. Ignored when
 * the subscription is not the org's (customer guard, or another subscription id).
 */
export async function syncSubscriptionState(
  orgId: string,
  sub: ProviderSubscription,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const fresh = await h.billing.fetchSubscription(sub.id);
      if (fresh.orgId && fresh.orgId !== orgId) return "ignored";
      const account = await guardedAccount(
        pb,
        orgId,
        fresh.customerId,
        `subscription ${fresh.id}`,
      );
      if (!account) return "ignored";
      // The checkout handler links the subscription; until then (or for an old one) the
      // event is not this account's.
      if (
        account.subscriptionId === "" ||
        account.subscriptionId !== fresh.id
      ) {
        console.warn(
          `[payments] subscription ${fresh.id} ignored: not org ${orgId}'s current subscription`,
        );
        return "ignored";
      }
      await syncItemsToAccount(pb, orgId, fresh);

      const next = lapseStateFor(fresh.status);
      if (next === "none") return "applied";
      const ctx = await billingContextFor(pb, orgId);
      const prev = account.status;
      const now = h.now.toISOString();
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,billing_status" });
      const orgPatch: Record<string, unknown> =
        org.billing_status === next ? {} : { billing_status: next };

      if (next === "lapsed") {
        if (h.addons) {
          await lapseAddons(
            ctx,
            h.addons,
            await paidAddonSlugs(pb, orgId, fresh),
          );
        } else {
          console.error(
            `[payments] org ${orgId}: no add-on deps; paid add-ons wait for reconcile to pause`,
          );
        }
        const due =
          prev === "lapsed"
            ? account.amountDueCents
            : await openCents(account, h);
        const patch: BillingAccountPatch = {};
        if (prev !== "lapsed") {
          patch.status = "lapsed";
          patch.lapsed_at = account.lapsedAt ?? now;
          patch.amount_due_cents = due;
        }
        await patchBillingAccount(
          pb,
          ctx,
          account.id,
          patch,
          "billing.lapsed",
          orgPatch,
        );
        // A declined site (10-28) already got org.declined: no "add-ons paused" email.
        if (prev !== "lapsed" && account.declinedAt === null) {
          await notify(
            pb,
            orgId,
            {
              type: "billing.lapsed",
              amountCents: due,
              addons: await lapsedNames(pb, orgId, h),
            },
            h,
          );
        }
        await invoiceRemainingInstallments(pb, ctx, account, fresh, h);
        return "applied";
      }

      // active or past_due: everything is on (D310). A lapse is undone here; restore
      // re-enables only rows paused for billing_lapse (Pitfall 5).
      const restored = h.addons ? await restoreLapsedAddons(ctx, h.addons) : [];
      if (!h.addons && prev === "lapsed") {
        console.error(
          `[payments] org ${orgId}: no add-on deps; paused add-ons wait for reconcile to return`,
        );
      }
      // Before the first checkout completes the checkout handler owns the account.
      if (prev === "none") return "applied";
      const patch: BillingAccountPatch = {};
      if (prev !== next) patch.status = next;
      if (prev === "lapsed") {
        patch.lapsed_at = "";
        patch.restored_at = now;
      }
      let due = account.amountDueCents;
      if (next === "past_due" && prev !== "past_due") {
        due = await openCents(account, h);
        patch.amount_due_cents = due;
      } else if (next === "active" && account.amountDueCents !== 0) {
        patch.amount_due_cents = 0;
      }
      await patchBillingAccount(
        pb,
        ctx,
        account.id,
        patch,
        next === "past_due" ? "billing.past_due" : "billing.active",
        orgPatch,
      );
      if (prev === "lapsed") {
        await notify(
          pb,
          orgId,
          {
            type: "billing.restored",
            addons: restored.map((s) => addonName(h, s)),
          },
          h,
        );
      } else if (next === "past_due" && prev !== "past_due") {
        await notify(
          pb,
          orgId,
          { type: "billing.card_failed", amountCents: due },
          h,
        );
        // 11-21 (DASH-35): the Owner's urgent bell / push alert. Key = the Needs-you item
        // (`billing:fix_card`, past_due or lapsed), so it clears itself once the card is fixed.
        // The card-failed email above is the dedicated email. raiseAlert never throws.
        await raiseAlert(
          { orgId, as: mintSystemContext({ job: "billing" }) },
          {
            type: "billing.card_failed",
            sourceKey: "billing:fix_card",
            title: "Your payment to us failed. Update your card.",
            safeTitle: "Your payment to us failed",
            href: "/hub/settings?tab=billing",
            actionLabel: "Update card",
          },
          { dedicatedEmail: true, now: h.now },
        );
      }
      return "applied";
    }),
  );
}

/** pending_update_applied / _expired: only the item-derived fields move (choice 3). */
export async function syncSubscriptionItems(
  orgId: string,
  sub: ProviderSubscription,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      const fresh = await h.billing.fetchSubscription(sub.id);
      if (fresh.orgId && fresh.orgId !== orgId) return "ignored";
      const account = await guardedAccount(
        pb,
        orgId,
        fresh.customerId,
        `subscription ${fresh.id}`,
      );
      if (!account || account.subscriptionId !== fresh.id) return "ignored";
      await syncItemsToAccount(pb, orgId, fresh);
      return "applied";
    }),
  );
}
