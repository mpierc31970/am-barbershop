// P10 payments: the real BillingGate (10-20; BILL-12, BILL-16; CONTEXT A3; D186, D263, D285;
// RESEARCH Pattern 5). Replaces the P5 free stand-in (`getBillingGate()` returns this).
//
// A hub install ("Add to site") asks `approve` inside the installer's `addons:<org>` lock:
//   source staff / assembly / billing   -> approved, no billing call (staff: --no-charge or a
//                                          quote reference, BILL-20; billing: paid at checkout)
//   no paid checkout yet                -> approved free, priced or not; the add-on joins the
//                                          checkout order (10-16 reads active add-ons into the
//                                          draft and blocks checkout on unpriced ones; choice 1)
//   account lapsed / canceled           -> refused, PAUSED-NO-ADD
//   paid, unpriced add-on               -> refused, UNPRICED-ADDON (D264)
//   $0 for the path / already an item   -> approved, no billing call
//   paid, before launch                 -> item at its price (account cadence, choice 2),
//                                          prorated, no setup fee
//   paid, after launch (launched_at)    -> the same plus the $25 setup line (D186)
// The change is sent with `always_invoice` + `chargeNow` (pending_if_incomplete): it applies
// only when the invoice is paid, so the installer writes the row only after payment
// (T-10-20-01). A declined card refuses with the locked ERR-CARD copy and nothing changes.
// `release` (choice 3) removes the item with proration credit on an owner uninstall.
// The provider round trip runs inside the addons lock; the Stripe client timeout is 20 s.
// CR-C01 / WR-D03: a charge needs the confirm token from `previewAddonCharge` (passed as the
// install's `chargeToken`). It is refused "price changed" when the token is missing, stale or
// the fresh figures differ; it prorates at the previewed instant and keys on the token nonce.
import type { AddonRegistry } from "@cds/core/addons";
import { InvalidInput } from "@cds/core";
import type {
  BillingLine,
  CdsBilling,
  ProviderSubscription,
} from "@cds/core/payments";
import type { BillingApproval, BillingGate } from "../addons/billing";
import { withSuperuser } from "../client";
import { type OrgContext } from "../context";
import { requirePermission } from "../repository";
import type { BillingAccount } from "./accounts";
import {
  CARD_DECLINED_COPY,
  freePreview,
  isBeforeCheckout,
  loadChargeState,
  PAUSED_NO_ADD_COPY,
  previewData,
  pricedItem,
  UNPRICED_ADDON_COPY,
  YEARLY_MONTHS,
  type ChargePreviewData,
} from "./charge-shared";
import {
  CHARGE_PRICE_CHANGED_COPY,
  mintChargeToken,
  readChargeToken,
} from "./charge-token";
import { PAUSED } from "./entitlements";
import { getCdsBilling } from "./factory";

export {
  CARD_DECLINED_COPY,
  PAUSED_NO_ADD_COPY,
  UNPRICED_ADDON_COPY,
  NOT_PAID_COPY,
  type ChargePreviewData,
  type ChargeFailReason,
} from "./charge-shared";
export { CHARGE_PRICE_CHANGED_COPY } from "./charge-token";

const addonItem = (slug: string) => `addon:${slug}`;

export type BillingGateDeps = {
  billing?: CdsBilling;
  now?: () => Date;
  /** Add-on names for the invoice line label; the slug is the fallback. */
  registry?: Pick<AddonRegistry, "get">;
};

/** What adding one add-on would put on the subscription right now. */
type AddonPlan =
  | {
      kind: "free";
      reason: string;
      thenCents: number;
      interval: "month" | "year";
      account: BillingAccount | null;
      launchedAt: string | null;
    }
  | { kind: "refuse"; reason: string }
  | {
      kind: "charge";
      account: BillingAccount;
      launchedAt: string | null;
      add: BillingLine;
      oneTime: BillingLine[];
      setupCents: number;
    };

function addonLine(
  slug: string,
  label: string,
  cents: number,
  refs: { monthlyRef: string | null; yearlyRef: string | null },
  yearly: boolean,
): BillingLine {
  return {
    kind: "addon",
    key: slug,
    label,
    interval: yearly ? "year" : "month",
    unitCents: yearly ? YEARLY_MONTHS * cents : cents,
    quantity: 1,
    priceRef: (yearly ? refs.yearlyRef : refs.monthlyRef) ?? null,
  };
}

function hasAddonItem(sub: ProviderSubscription, slug: string): boolean {
  return sub.items.some((i) => i.kind === "addon" && i.key === slug);
}

async function planAddon(
  orgId: string,
  slug: string,
  label: string,
  billing: () => CdsBilling,
): Promise<AddonPlan> {
  const s = await withSuperuser((pb) => loadChargeState(pb, orgId));
  const { account, path, launchedAt } = s;
  if (account && PAUSED.has(account.status)) {
    return { kind: "refuse", reason: PAUSED_NO_ADD_COPY };
  }
  const price = path === "" ? null : await pricedItem("addon", slug, path);
  const yearly = account?.cadence === "yearly";
  const interval = yearly ? "year" : "month";
  if (isBeforeCheckout(account)) {
    // Choice 1: free now, it joins the checkout order. An unpriced add-on is allowed too:
    // checkout shows the UNPRICED alert for it (10-16 CheckoutBlocked), never a guessed price.
    return {
      kind: "free",
      reason: "before_checkout",
      thenCents: price
        ? yearly
          ? YEARLY_MONTHS * price.cents
          : price.cents
        : 0,
      interval,
      account,
      launchedAt,
    };
  }
  if (price === null) return { kind: "refuse", reason: UNPRICED_ADDON_COPY };
  if (price.cents === 0) {
    return {
      kind: "free",
      reason: "included",
      thenCents: 0,
      interval,
      account,
      launchedAt,
    };
  }
  const paid = account!;
  const sub = await billing().fetchSubscription(paid.subscriptionId);
  const add = addonLine(slug, label, price.cents, price, yearly);
  if (hasAddonItem(sub, slug)) {
    // Already billed (a staff uninstall left the item, or a retry after the item applied).
    return {
      kind: "free",
      reason: "already_billed",
      thenCents: add.unitCents,
      interval,
      account,
      launchedAt,
    };
  }
  const oneTime: BillingLine[] = [];
  let setupCents = 0;
  if (launchedAt !== null) {
    const setup = await pricedItem("setup_fee", "addon", path);
    if (setup === null) return { kind: "refuse", reason: UNPRICED_ADDON_COPY };
    setupCents = setup.cents;
    if (setupCents > 0) {
      oneTime.push({
        kind: "setup_fee",
        key: "addon",
        label: `${label} setup`,
        interval: "once",
        unitCents: setupCents,
        quantity: 1,
        priceRef: setup.onceRef,
      });
    }
  }
  return {
    kind: "charge",
    account: paid,
    launchedAt,
    add,
    oneTime,
    setupCents,
  };
}

/**
 * The billing-backed gate (BILL-12). `approve` charges the saved card when D186 says so and
 * approves only once the change applied (the invoice is paid); `release` removes the item.
 */
export function billingGate(deps: BillingGateDeps = {}): BillingGate {
  const billing = () => deps.billing ?? getCdsBilling();
  const labelOf = (slug: string) => deps.registry?.get(slug)?.name ?? slug;
  const now = () => (deps.now ? deps.now() : new Date());
  return {
    async approve({ orgId, slug, source, token }): Promise<BillingApproval> {
      if (source !== "hub") return { approved: true, chargeCents: 0 };
      const plan = await planAddon(orgId, slug, labelOf(slug), billing);
      if (plan.kind === "refuse")
        return { approved: false, reason: plan.reason };
      if (plan.kind === "free") return { approved: true, chargeCents: 0 };
      // CR-C01: only the figure the owner confirmed is charged.
      const claims = readChargeToken(
        token,
        { orgId, item: addonItem(slug) },
        now(),
      );
      if (!claims || claims.thenCents !== plan.add.unitCents) {
        return { approved: false, reason: CHARGE_PRICE_CHANGED_COPY };
      }
      const change = {
        subscriptionId: plan.account.subscriptionId,
        add: [plan.add],
        remove: [],
        setQuantity: [],
        oneTime: plan.oneTime,
        proration: "always_invoice" as const,
        chargeNow: true,
        prorationDate: new Date(claims.at).toISOString(),
      };
      const fresh = await billing().previewChange(change);
      if (fresh.todayCents !== claims.todayCents) {
        return { approved: false, reason: CHARGE_PRICE_CHANGED_COPY };
      }
      const period = plan.account.currentPeriodEnd ?? "none";
      const res = await billing().changeItems({
        ...change,
        // The confirm's nonce: a retry of the same confirm replays the provider's answer and
        // never charges twice; a reinstall later (after `release`) or a retry after a decline
        // comes with a new preview, so it is a new attempt, never a cached no-op.
        idempotencyKey: `addon:${orgId}:${slug}:${period}:${claims.nonce}`,
      });
      if (!res.applied) return { approved: false, reason: CARD_DECLINED_COPY };
      return { approved: true, chargeCents: res.invoice?.totalCents ?? 0 };
    },

    async release({ orgId, slug }): Promise<void> {
      const account = await withSuperuser((pb) =>
        loadChargeState(pb, orgId).then((s) => s.account),
      );
      if (isBeforeCheckout(account) || PAUSED.has(account!.status)) return;
      const sub = await billing().fetchSubscription(account!.subscriptionId);
      const items = sub.items.filter(
        (i) => i.kind === "addon" && i.key === slug,
      );
      if (items.length === 0) return;
      await billing().changeItems({
        subscriptionId: sub.id,
        add: [],
        remove: items.map((i) => i.id),
        setQuantity: [],
        oneTime: [],
        // Credit for the unused time, settled at once (the bill drops, D186).
        proration: "always_invoice",
        chargeNow: false,
        idempotencyKey: `addon-release:${orgId}:${slug}:${items.map((i) => i.id).join(",")}`,
      });
    },
  };
}

/**
 * The confirm dialog's figures for adding one add-on (D-UI-P10-14): server-side proration
 * preview, never computed in the browser. Owner only (billing:read). Throws InvalidInput with
 * PAUSED-NO-ADD / UNPRICED-ADDON when the add-on cannot be added.
 */
export async function previewAddonCharge(
  ctx: OrgContext,
  slug: string,
  deps: BillingGateDeps = {},
): Promise<ChargePreviewData> {
  requirePermission(ctx, "billing", "read");
  if (typeof slug !== "string" || slug === "") {
    throw new InvalidInput("Choose an add-on.");
  }
  const billing = () => deps.billing ?? getCdsBilling();
  const label = deps.registry?.get(slug)?.name ?? slug;
  const plan = await planAddon(ctx.orgId, slug, label, billing);
  if (plan.kind === "refuse") throw new InvalidInput(plan.reason);
  const at = deps.now ? deps.now() : new Date();
  const withToken = (figures: ReturnType<typeof previewData>) => ({
    ...figures,
    token: mintChargeToken({
      orgId: ctx.orgId,
      item: addonItem(slug),
      basis: 0,
      todayCents: figures.todayCents,
      thenCents: figures.thenCents,
      at: at.getTime(),
    }),
  });
  if (plan.kind === "free") {
    return withToken(
      freePreview(plan.account, plan.launchedAt, plan.thenCents, plan.interval),
    );
  }
  const p = await billing().previewChange({
    subscriptionId: plan.account.subscriptionId,
    add: [plan.add],
    remove: [],
    setQuantity: [],
    oneTime: plan.oneTime,
    proration: "always_invoice",
    chargeNow: true,
    prorationDate: at.toISOString(),
  });
  return withToken(
    previewData(
      p,
      plan.account,
      plan.launchedAt,
      plan.setupCents,
      plan.add.unitCents,
      plan.add.interval === "year" ? "year" : "month",
    ),
  );
}
