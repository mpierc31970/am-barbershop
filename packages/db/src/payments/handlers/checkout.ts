// P10 payments: checkout handlers (PAY-01, BILL-01, BILL-16; CONTEXT A2; D161, D186, D263,
// D314; RESEARCH Pattern 4).
//
// A completed CDS checkout (re-fetched; must be `complete` and `paid`, T-10-12-04) makes the
// org's billing account active: subscription id, cadence, build plan, Care Plan, `paid_at`
// (first payment only), `price_locked_until` (founding lock, choice 1) and
// `organizations.billing_status = active`. Yearly cadence then adds the monthly-by-nature
// items (Care Plan, build installment) with no proration, because their first month was
// charged as one-time lines at checkout. The order's add-ons are installed with
// `source = billing` and no setup fee; the order comes from `billing_accounts.checkout_draft`,
// never from the provider payload (choice 3). The checkout invoice is mirrored too, so the
// state is right whichever of `checkout.completed` / `invoice.paid` arrives first.
//
// Idempotent by state: once the account carries this session id and a `paid_at`, a replay
// (or a reconcile-synthesised event) rewrites nothing; it only installs add-ons that were
// never installed (an add-on the owner removed since stays removed).
import type {
  BillingLine,
  NormalisedEvent,
  ProviderCheckoutSession,
} from "@cds/core/payments";
import type PocketBase from "pocketbase";
import {
  installAddonForBilling,
  uninstallUnorderedAddons,
} from "../../addons/installer";
import { readPriceCatalog } from "../../catalog";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import type { OrgContext } from "../../context";
import { readPlatformMeta } from "../../platform-meta";
import {
  patchBillingAccount,
  type BillingAccount,
  type BillingAccountPatch,
  type CheckoutDraft,
} from "../accounts";
import { billingStaffAlert, guardProviderIdWrite } from "../staff-alert";
import { applyInvoice, billingContextFor, guardedAccount } from "./invoice";
import type { HandlerContext, HandlerMap } from "./types";

/** platform_meta key: founding-member cut-off (D161); unset = every payment is founding. */
export const FOUNDING_UNTIL_KEY = "billing:founding_until";
/** Founding customers keep their prices for two years (D161). */
const FOUNDING_LOCK_YEARS = 2;

const DEFAULT_DRAFT: CheckoutDraft = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "full",
};

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}

/** `paid_at + 2 years` when the founding cut-off is unset or not yet passed (choice 1). */
export async function foundingLockUntil(
  paidAt: string,
): Promise<string | null> {
  const raw = (await readPlatformMeta(FOUNDING_UNTIL_KEY))?.trim() ?? "";
  if (raw !== "") {
    const cutoff = new Date(raw).getTime();
    if (Number.isNaN(cutoff)) {
      console.warn(
        `[payments] ${FOUNDING_UNTIL_KEY} is not a date; treating it as unset`,
      );
    } else if (new Date(paidAt).getTime() > cutoff) {
      return null;
    }
  }
  return addYears(paidAt, FOUNDING_LOCK_YEARS);
}

/** Yearly cadence: add the deferred monthly items not yet on the subscription (Pattern 4). */
async function addDeferredMonthly(
  subscriptionId: string,
  sessionId: string,
  lines: readonly BillingLine[],
  h: HandlerContext,
): Promise<void> {
  if (lines.length === 0) return;
  const sub = await h.billing.fetchSubscription(subscriptionId);
  const missing = lines.filter(
    (l) => !sub.items.some((i) => i.kind === l.kind && i.key === l.key),
  );
  if (missing.length === 0) return;
  await h.billing.changeItems({
    subscriptionId,
    add: missing.map((l) => ({ ...l, interval: "month" as const })),
    remove: [],
    setQuantity: [],
    oneTime: [],
    // Their first month was a one-time line at checkout: never bill it twice (D314).
    proration: "none",
    chargeNow: false,
    idempotencyKey: `deferred-monthly:${sessionId}`,
  });
}

/** Install the order's add-ons as the billing job. A failure is logged, never fatal. */
async function installOrder(
  pb: PocketBase,
  ctx: OrgContext,
  slugs: readonly string[],
  firstApply: boolean,
  h: HandlerContext,
): Promise<void> {
  if (slugs.length === 0) return;
  const orgId = ctx.orgId;
  if (!h.addons) {
    console.error(
      `[payments] org ${orgId}: no add-on deps; ${slugs.length} paid add-on(s) wait for reconcile`,
    );
    return;
  }
  for (const slug of slugs) {
    if (!firstApply) {
      // A replay installs only what was never installed; an add-on the owner removed
      // since keeps its disabled row and stays removed.
      const res = await pb.collection("org_addons").getList(1, 1, {
        filter: pb.filter("organization = {:org} && addon = {:slug}", {
          org: orgId,
          slug,
        }),
        fields: "id",
      });
      if (res.items.length > 0) continue;
    }
    try {
      await installAddonForBilling(ctx, h.addons, slug);
    } catch (err) {
      console.error(
        `[payments] install ${slug} for org ${orgId} failed: ${errName(err)}`,
      );
    }
  }
}

/**
 * CR-E03 (D186): add-ons switched on before checkout (hub or assembly; free until paid) join
 * the order. One the owner took off the order is turned off here, on first apply, so it is
 * never kept unbilled. Free ($0 on the path) and unpriced add-ons stay; staff and billing
 * installs are not touched.
 */
async function dropUnorderedAddons(
  pb: PocketBase,
  ctx: OrgContext,
  ordered: readonly string[],
  h: HandlerContext,
): Promise<void> {
  const orgId = ctx.orgId;
  const [org, rows, catalog] = await Promise.all([
    pb.collection("organizations").getOne(orgId, { fields: "id,path" }),
    pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:org} && status = 'active'", {
        org: orgId,
      }),
      fields: "addon,source",
    }),
    readPriceCatalog(),
  ]);
  const priced = new Set(
    catalog
      .filter(
        (r) =>
          r.itemKind === "addon" &&
          r.path === org.path &&
          (r.monthlyCents ?? 0) > 0,
      )
      .map((r) => r.itemKey),
  );
  const drop = rows
    .filter(
      (r) =>
        (r.source === "hub" || r.source === "assembly") &&
        priced.has(String(r.addon)) &&
        !ordered.includes(String(r.addon)),
    )
    .map((r) => String(r.addon));
  if (drop.length === 0) return;
  if (!h.addons) {
    console.error(
      `[payments] org ${orgId}: no add-on deps; ${drop.length} unpaid add-on(s) wait for reconcile`,
    );
    return;
  }
  // A failure throws: the event fails before `paid_at` is written and is run again.
  await uninstallUnorderedAddons(ctx, h.addons, drop);
}

function completionPatch(
  account: BillingAccount,
  draft: CheckoutDraft,
  sessionId: string,
  subscriptionId: string | null,
  paidAt: string,
  lockedUntil: string | null,
): BillingAccountPatch {
  return {
    subscription_id: subscriptionId ?? account.subscriptionId,
    checkout_session_id: sessionId,
    status: "active",
    cadence: draft.cadence,
    build_plan: draft.buildPlan,
    care_plan: draft.carePlan,
    // 11-27: pages packs bought before checkout are on the subscription now (yearly: added
    // with the deferred items); the item sync keeps this mirror after that.
    pages_5_qty: draft.pagePacks ?? 0,
    paid_at: paidAt,
    price_locked_until: lockedUntil ?? "",
  };
}

/**
 * A paid session that is not the account's current one (CR-E02). Already paid: a second
 * subscription would bill forever, so it is cancelled now and staff refund the payment.
 * Not paid yet: an older order was paid after a newer one started (its session should have
 * been expired); nothing is applied and staff sort it out. Staff are alerted either way.
 */
async function strayCheckout(
  pb: PocketBase,
  orgId: string,
  account: BillingAccount,
  session: ProviderCheckoutSession,
  h: HandlerContext,
): Promise<void> {
  console.warn(`[payments] org ${orgId}: stray checkout ${session.id} ignored`);
  if (account.paidAt) {
    let cancelled = false;
    if (
      session.subscriptionId &&
      session.subscriptionId !== account.subscriptionId
    ) {
      try {
        await h.billing.cancel({
          subscriptionId: session.subscriptionId,
          mode: "now",
          idempotencyKey: `stray-cancel:${session.id}`,
        });
        cancelled = true;
      } catch (err) {
        console.error(
          `[payments] org ${orgId}: stray subscription not cancelled: ${errName(err)}`,
        );
      }
    }
    await billingStaffAlert(
      pb,
      "duplicate_checkout",
      orgId,
      `A second checkout (session ${session.id}) was paid after this site had already paid. ${
        cancelled
          ? "Its subscription was cancelled."
          : "Its subscription is NOT cancelled: cancel it in Stripe."
      } Refund that payment in Stripe.`,
      h.transport,
    );
    return;
  }
  await billingStaffAlert(
    pb,
    "stray_checkout",
    orgId,
    `An older checkout (session ${session.id}) was paid after a newer one was started. Nothing was applied: check which order the owner meant, then apply or refund it by hand.`,
    h.transport,
  );
}

async function onCheckoutCompleted(
  e: NormalisedEvent,
  h: HandlerContext,
): Promise<"applied" | "ignored"> {
  if (!("sessionId" in e)) return "ignored";
  // A tenant-side checkout on the tenant's own account is not CDS billing (D296).
  if (e.account) return "ignored";
  let session = await h.billing.fetchCheckoutSession(e.sessionId);
  const orgId = session.orgId ?? e.orgId;
  if (!orgId) {
    console.warn(`[payments] ${e.id} ignored: session names no org`);
    return "ignored";
  }
  return withOrgLock(`billing:${orgId}`, () =>
    withSuperuser(async (pb) => {
      session = await h.billing.fetchCheckoutSession(e.sessionId);
      if (session.orgId && session.orgId !== orgId) return "ignored";
      if (session.status !== "complete" || session.paymentStatus !== "paid") {
        console.warn(`[payments] ${e.id} ignored: session not paid`);
        return "ignored";
      }
      const account = await guardedAccount(pb, orgId, session.customerId, e.id);
      if (!account) return "ignored";
      // CR-E02: only the account's current session applies. Any other paid session is
      // stray: its lines are not the stored order, and it must never replace the live
      // subscription.
      const current =
        account.checkoutDraft?.sessionId ?? account.checkoutSessionId;
      if (current !== "" && current !== session.id) {
        await strayCheckout(pb, orgId, account, session, h);
        return "ignored";
      }
      const ctx = await billingContextFor(pb, orgId);
      const draft = account.checkoutDraft ?? DEFAULT_DRAFT;
      if (!account.checkoutDraft) {
        console.error(
          `[payments] org ${orgId}: completed checkout has no draft; defaults applied`,
        );
      }
      const firstApply = account.paidAt === null;

      if (firstApply) {
        // Before paid_at: once paid, a hub install is billed on its own and never touched.
        await dropUnorderedAddons(pb, ctx, draft.addons, h);
        const paidAt = account.paidAt ?? h.now.toISOString();
        const lockedUntil =
          account.priceLockedUntil ?? (await foundingLockUntil(paidAt));
        const org = await pb
          .collection("organizations")
          .getOne(orgId, { fields: "id,billing_status" });
        const orgPatch: Record<string, unknown> = {};
        if (org.billing_status !== "active") orgPatch.billing_status = "active";
        // build_started_at is NOT stamped here: it means build work started (staff set it via
        // markBuildStarted, 10-28 choice 2) and ends the decline window (D214).
        // WR-A01: a subscription id another org holds fails the event (staff alerted).
        await guardProviderIdWrite(
          pb,
          orgId,
          "subscription id",
          () =>
            patchBillingAccount(
              pb,
              ctx,
              account.id,
              completionPatch(
                account,
                draft,
                session.id,
                session.subscriptionId,
                paidAt,
                lockedUntil,
              ),
              "billing.checkout_completed",
              orgPatch,
            ),
          h.transport,
        );
      }

      if (draft.cadence === "yearly" && session.subscriptionId) {
        await addDeferredMonthly(
          session.subscriptionId,
          session.id,
          draft.deferredMonthly ?? [],
          h,
        );
      }

      await installOrder(pb, ctx, draft.addons, firstApply, h);

      // WR-E03: a subscription-mode session has no invoice of its own; its first invoice
      // is the subscription's latest one.
      let invoiceId = session.invoiceId;
      if (!invoiceId && session.subscriptionId) {
        const sub = await h.billing.fetchSubscription(session.subscriptionId);
        invoiceId = sub.latestInvoiceId ?? null;
      }
      if (invoiceId) {
        const inv = await h.billing.fetchInvoice(invoiceId);
        const fresh = await guardedAccount(pb, orgId, inv.customerId, e.id);
        if (fresh) await applyInvoice(pb, fresh, inv, h, "checkout");
      }
      return "applied";
    }),
  );
}

export const checkoutHandlers: HandlerMap = {
  "checkout.completed": onCheckoutCompleted,
};
