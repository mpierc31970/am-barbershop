// P10 payments: media packs, the Care Plan and the card-update link on the saved card
// (10-20; BILL-13, BILL-16, BILL-19; CONTEXT A3, A4; D225, D263, D285, D299, D-UI-P10-14).
//
// Every purchase follows the one confirm-first path: a server preview (`previewPack`,
// `previewCarePlan`) gives the dialog its "Today" / "Then" figures, then the buy runs under
// `billing:<org>` as one item change on the one subscription:
//   - packs (+5 GB $5, +25 GB $15, +5 pages $10 from 11-27) are quantity on one monthly item
//     each, stackable. Before checkout a pages pack joins the order instead (draft
//     `pagePacks`, paid at checkout); media packs are refused there (NOT_PAID);
//   - the Care Plan ($99) is one monthly item, on or off any time;
//   - adding uses `always_invoice` + `chargeNow` (pending_if_incomplete), so nothing changes
//     unless the prorated invoice is paid; removing credits the unused time.
// After an applied change the account mirrors the items (`syncItemsToAccount`), an audit row
// is written and the org's `org:<id>:addons` entitlement tag is invalidated (10-17 note).
// Owner only and never under impersonation (`purchases:run`; the portal link `billing:write`).
// Nothing is added while the account is lapsed (PAUSED-NO-ADD); the card link still works.
// A pack is not removed while the media in use would overfill what is left (choice 5), nor a
// pages pack while the counted pages exceed the page allowance left (PAGES-PACK-REFUSED).
// CR-C01 / WR-D03: every add is confirmed with the preview's token (charge-token.ts). Under the
// lock the charge refuses "price changed" when the fresh figure differs from the one the owner
// saw, treats a retry after the add already applied as done (no second pack), prorates at the
// previewed instant and uses the token's nonce in the idempotency key.
import { InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { pageAllowance } from "@cds/core/content";
import {
  mediaAllowanceBytes,
  type BillingLine,
  type CdsBilling,
  type ChangeItemsInput,
  type ProviderSubscription,
  type ProviderSubscriptionItem,
} from "@cds/core/payments";
import { randomUUID } from "node:crypto";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { countCountedPages, packsFor } from "../content/allowance";
import { withOrgLock } from "../content/lock";
import { addonsTag, type Invalidator } from "../content/ports";
import type { OrgContext } from "../context";
import { platformUrl } from "../email/env";
import { formatGb, mediaUsage } from "../media/cdn/usage";
import { requirePermission } from "../repository";
import { MAX_DRAFT_PAGE_PACKS, type BillingAccount } from "./accounts";
import {
  CARD_DECLINED_COPY,
  freePreview,
  isBeforeCheckout,
  loadChargeState,
  monthlyLine,
  NOT_PAID_COPY,
  PAUSED_NO_ADD_COPY,
  previewData,
  pricedItem,
  UNPRICED_ADDON_COPY,
  type ChargeFailReason,
  type ChargePreviewData,
  type ChargeState,
  type PricedItem,
} from "./charge-shared";
import {
  CHARGE_PRICE_CHANGED_COPY,
  mintChargeToken,
  readChargeToken,
  type ChargeTokenClaims,
} from "./charge-token";
import { PAUSED } from "./entitlements";
import { setDraftPagePacks } from "./checkout";
import { getCdsBilling } from "./factory";
import { syncItemsToAccount } from "./lapse";

/** P10 media pack sizes (kept for P10 callers; each maps onto a PackKind). */
export type PackSize = "5gb" | "25gb";
/** Every pack sold on the subscription (11-27 choice 1): media packs and "5 more pages". */
export type PackKind = "media-5gb" | "media-25gb" | "pages-5";

export type ChargeResult =
  | {
      ok: true;
      invoiceTotalCents: number;
      /** The confirmed change was already on the subscription; nothing was charged. */
      alreadyApplied?: true;
    }
  | { ok: false; reason: ChargeFailReason; message: string };

export type ChargeDeps = {
  billing?: CdsBilling;
  /** Invalidates `org:<id>:addons` after a change (web: the revalidateTag invalidator). */
  invalidator?: Invalidator;
  /** Clock for the confirm token (tests). */
  now?: () => Date;
  /**
   * The add-on registry: a pages pack bought before checkout joins the order, and the draft
   * is re-validated against the offer (11-27 choice 2). Not needed after checkout.
   */
  registry?: AddonRegistry;
};

/** Where the provider's card page returns the owner (the Billing tab shows a toast). */
export const CARD_UPDATED_RETURN_PATH =
  "/hub/settings?tab=billing&card=updated";

type Pack = { key: PackKind; label: string };

const PACKS: Record<PackKind, Pack> = {
  "media-5gb": { key: "media-5gb", label: "5 GB media storage" },
  "media-25gb": { key: "media-25gb", label: "25 GB media storage" },
  "pages-5": { key: "pages-5", label: "5 more pages" },
};
const SIZE_KIND: Record<PackSize, PackKind> = {
  "5gb": "media-5gb",
  "25gb": "media-25gb",
};
const CARE_KEY = "care";
const CARE_LABEL = "Care Plan";

const ALREADY: ChargeResult = {
  ok: true,
  invoiceTotalCents: 0,
  alreadyApplied: true,
};

function nowOf(deps: ChargeDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/** UI-SPEC PACK-REMOVE-REFUSED with the real figures. */
export function packRemoveRefusedCopy(
  usedBytes: number,
  leftBytes: number,
): string {
  return `You're using ${formatGb(usedBytes)}, more than the ${formatGb(leftBytes)} you'd have left. Delete ${formatGb(usedBytes - leftBytes)} of media first, then remove the pack.`;
}

/** UI-SPEC PAGES-PACK-REFUSED with the real figures. */
export function pagesPackRemoveRefusedCopy(used: number, left: number): string {
  const over = used - left;
  return `You have ${used} pages, more than the ${left} you'd have left. Delete ${over} ${over === 1 ? "page" : "pages"} first, then remove the pack.`;
}

/** A pack by kind, or by P10 size ("5gb" | "25gb"); anything else is refused. */
function packOf(kind: unknown): Pack {
  if (kind === "5gb" || kind === "25gb") return PACKS[SIZE_KIND[kind]];
  if (kind === "media-5gb" || kind === "media-25gb" || kind === "pages-5") {
    return PACKS[kind];
  }
  throw new InvalidInput("Choose a 5 GB or 25 GB pack, or 5 more pages.");
}

const packItem = (pack: { key: string }) => `pack:${pack.key}`;

const NO_PACK_COPY = "There's no pack of that size to remove.";
const DRAFT_PACKS_FULL_COPY =
  "That's the most pages you can add before checkout. Add more after your site is paid for.";

/** Pages packs waiting on the pre-checkout order (draft `pagePacks`), 0 when none. */
function draftPagePacksOf(account: BillingAccount | null): number {
  return account?.checkoutDraft?.pagePacks ?? 0;
}

function fail(reason: ChargeFailReason, message: string): ChargeResult {
  return { ok: false, reason, message };
}

const priceChanged = (): ChargeResult =>
  fail("price_changed", CHARGE_PRICE_CHANGED_COPY);

type Paid = ChargeState & { account: BillingAccount };

/** The paid, unpaused state, or the refusal to return. */
async function paidState(orgId: string): Promise<Paid | ChargeResult> {
  const s = await withSuperuser((pb) => loadChargeState(pb, orgId));
  if (s.account && PAUSED.has(s.account.status)) {
    return fail("paused", PAUSED_NO_ADD_COPY);
  }
  if (isBeforeCheckout(s.account)) return fail("refused", NOT_PAID_COPY);
  return s as Paid;
}

function isResult(v: Paid | ChargeResult): v is ChargeResult {
  return "ok" in v;
}

function itemOf(
  sub: ProviderSubscription,
  kind: BillingLine["kind"],
  key: string,
): ProviderSubscriptionItem | undefined {
  return sub.items.find((i) => i.kind === kind && i.key === key);
}

type Change = Omit<ChangeItemsInput, "subscriptionId" | "idempotencyKey">;

/** The change prorated at the previewed instant (Stripe `proration_date`). */
function at(change: Change, claims: ChargeTokenClaims): Change {
  return { ...change, prorationDate: new Date(claims.at).toISOString() };
}

/**
 * True when the provider's figures for the change still match the token: Today (prorated at
 * the previewed instant) and Then (the catalog price). Otherwise the owner re-previews.
 */
async function sameFigures(
  s: Paid,
  change: Change,
  thenCents: number,
  claims: ChargeTokenClaims,
  deps: ChargeDeps,
): Promise<boolean> {
  if (thenCents !== claims.thenCents) return false;
  const billing = deps.billing ?? getCdsBilling();
  const p = await billing.previewChange({
    ...change,
    subscriptionId: s.account.subscriptionId,
  });
  return p.todayCents === claims.todayCents;
}

/** One more of the pack: quantity on the existing item, or the item added. */
function packAdd(
  sub: ProviderSubscription,
  pack: { key: string; label: string },
  price: PricedItem,
): Change {
  const item = itemOf(sub, "pack", pack.key);
  return {
    add: item ? [] : [monthlyLine("pack", pack.key, pack.label, price)],
    remove: [],
    setQuantity: item ? [{ itemId: item.id, quantity: item.quantity + 1 }] : [],
    oneTime: [],
    proration: "always_invoice",
    chargeNow: true,
  };
}

function removal(item: ProviderSubscriptionItem): Change {
  return {
    add: [],
    remove: item.quantity > 1 ? [] : [item.id],
    setQuantity:
      item.quantity > 1
        ? [{ itemId: item.id, quantity: item.quantity - 1 }]
        : [],
    oneTime: [],
    // Credit for the unused time (UI-SPEC: "credited for the rest of this month").
    proration: "always_invoice",
    chargeNow: false,
  };
}

/** A removal's key: one per attempt (no charge, so no confirm token). */
function attemptKey(s: Paid, keyBase: string): string {
  return `${keyBase}:${s.account.currentPeriodEnd ?? "none"}:${randomUUID()}`;
}

/**
 * Send the change; on success mirror the items, audit and invalidate. An add's key carries
 * the confirm token's nonce (CR-C01): the same confirm replays the provider's answer and can
 * never charge twice; a new preview (after a decline) is a new attempt.
 */
async function apply(
  ctx: OrgContext,
  s: Paid,
  change: Change,
  idempotencyKey: string,
  audit: { action: string; meta: Record<string, unknown> },
  deps: ChargeDeps,
): Promise<ChargeResult> {
  const billing = deps.billing ?? getCdsBilling();
  const res = await billing.changeItems({
    ...change,
    subscriptionId: s.account.subscriptionId,
    idempotencyKey,
  });
  if (!res.applied) return fail("card_declined", CARD_DECLINED_COPY);
  const sub = await billing.fetchSubscription(s.account.subscriptionId);
  const invoiceTotalCents = res.invoice?.totalCents ?? 0;
  await withSuperuser(async (pb) => {
    await syncItemsToAccount(pb, ctx.orgId, sub);
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: audit.action,
        targetCollection: "billing_accounts",
        targetId: s.account.id,
        meta: { ...audit.meta, invoiceTotalCents },
      }),
    );
  });
  deps.invalidator?.invalidate([addonsTag(ctx.orgId)]);
  return { ok: true, invoiceTotalCents };
}

/** The provider's figures for the change, prorated now, with a fresh confirm token. */
async function previewOf(
  ctx: OrgContext,
  s: Paid,
  change: Change,
  thenCents: number,
  token: { item: string; basis: number; now: Date },
  deps: ChargeDeps,
): Promise<ChargePreviewData> {
  const billing = deps.billing ?? getCdsBilling();
  const p = await billing.previewChange({
    ...change,
    prorationDate: token.now.toISOString(),
    subscriptionId: s.account.subscriptionId,
  });
  const figures = previewData(
    p,
    s.account,
    s.launchedAt,
    0,
    thenCents,
    "month",
  );
  return {
    ...figures,
    token: mintChargeToken({
      orgId: ctx.orgId,
      item: token.item,
      basis: token.basis,
      todayCents: figures.todayCents,
      thenCents: figures.thenCents,
      at: token.now.getTime(),
    }),
  };
}

async function previewState(ctx: OrgContext): Promise<Paid> {
  requirePermission(ctx, "billing", "read");
  const s = await paidState(ctx.orgId);
  if (isResult(s)) throw new InvalidInput(s.ok ? "" : s.message);
  return s;
}

// ---------------------------------------------------------------------------------------
// Packs (BILL-13, D225; 11-27 DASH-08, D185): media packs and "5 more pages"

/**
 * Before checkout a pages pack joins the order (11-27 choice 2): the preview has nothing due
 * today, and its token is bound to the draft's current pack count so a double click or a
 * retried confirm adds one pack, never two.
 */
async function preCheckoutPagesPreview(
  ctx: OrgContext,
  s: ChargeState,
  pack: Pack,
  deps: ChargeDeps,
): Promise<ChargePreviewData> {
  const price = await pricedItem("pack", pack.key, s.path);
  if (price === null) throw new InvalidInput(UNPRICED_ADDON_COPY);
  const figures = freePreview(s.account, s.launchedAt, price.cents, "month");
  return {
    ...figures,
    token: mintChargeToken({
      orgId: ctx.orgId,
      item: packItem(pack),
      basis: draftPagePacksOf(s.account),
      todayCents: 0,
      thenCents: price.cents,
      at: nowOf(deps).getTime(),
    }),
  };
}

/** The confirm dialog's figures (and confirm token) for one more pack. Owner only. */
export async function previewPack(
  ctx: OrgContext,
  kind: PackKind | PackSize,
  deps: ChargeDeps = {},
): Promise<ChargePreviewData> {
  const pack = packOf(kind);
  if (pack.key === "pages-5") {
    requirePermission(ctx, "billing", "read");
    const pre = await withSuperuser((pb) => loadChargeState(pb, ctx.orgId));
    if (pre.account && PAUSED.has(pre.account.status)) {
      throw new InvalidInput(PAUSED_NO_ADD_COPY);
    }
    if (isBeforeCheckout(pre.account)) {
      return preCheckoutPagesPreview(ctx, pre, pack, deps);
    }
  }
  const s = await previewState(ctx);
  const price = await pricedItem("pack", pack.key, s.path);
  if (price === null) throw new InvalidInput(UNPRICED_ADDON_COPY);
  const billing = deps.billing ?? getCdsBilling();
  const sub = await billing.fetchSubscription(s.account.subscriptionId);
  return previewOf(
    ctx,
    s,
    packAdd(sub, pack, price),
    price.cents,
    {
      item: packItem(pack),
      basis: itemOf(sub, "pack", pack.key)?.quantity ?? 0,
      now: nowOf(deps),
    },
    deps,
  );
}

function registryOf(deps: ChargeDeps): AddonRegistry {
  if (!deps.registry) {
    throw new Error("buyPack: a pages pack before checkout needs the registry");
  }
  return deps.registry;
}

/** Add one pages pack to the pre-checkout order (caller holds `billing:<org>`). */
async function preCheckoutPagesAdd(
  ctx: OrgContext,
  s: ChargeState,
  pack: Pack,
  claims: ChargeTokenClaims,
  deps: ChargeDeps,
): Promise<ChargeResult> {
  const before = draftPagePacksOf(s.account);
  if (before > claims.basis) return ALREADY;
  if (before < claims.basis) return priceChanged();
  const price = await pricedItem("pack", pack.key, s.path);
  if (price === null) return fail("refused", UNPRICED_ADDON_COPY);
  if (price.cents !== claims.thenCents || claims.todayCents !== 0) {
    return priceChanged();
  }
  if (before >= MAX_DRAFT_PAGE_PACKS) {
    return fail("refused", DRAFT_PACKS_FULL_COPY);
  }
  await setDraftPagePacks(ctx, before + 1, registryOf(deps), deps.billing, {
    action: "billing.pack_added",
    meta: { kind: pack.key, quantity: before + 1, beforeCheckout: true },
  });
  deps.invalidator?.invalidate([addonsTag(ctx.orgId)]);
  return { ok: true, invoiceTotalCents: 0 };
}

/**
 * Buy one more pack, confirmed with the token from `previewPack`. After checkout: quantity +1
 * on the saved card (prorated). Refused "price changed" without a valid token or when the
 * figure moved; a retry after the pack was added returns `alreadyApplied` and charges nothing.
 * Before checkout a pages pack joins the order (draft `pagePacks` +1, paid at checkout);
 * media packs keep the P10 refusal.
 */
export async function buyPack(
  ctx: OrgContext,
  kind: PackKind | PackSize,
  deps: ChargeDeps = {},
  token?: unknown,
): Promise<ChargeResult> {
  requirePermission(ctx, "purchases", "run");
  const pack = packOf(kind);
  return withOrgLock(`billing:${ctx.orgId}`, async () => {
    if (pack.key === "pages-5") {
      const pre = await withSuperuser((pb) => loadChargeState(pb, ctx.orgId));
      if (
        !(pre.account && PAUSED.has(pre.account.status)) &&
        isBeforeCheckout(pre.account)
      ) {
        const claims = readChargeToken(
          token,
          { orgId: ctx.orgId, item: packItem(pack) },
          nowOf(deps),
        );
        if (!claims) return priceChanged();
        return preCheckoutPagesAdd(ctx, pre, pack, claims, deps);
      }
    }
    const s = await paidState(ctx.orgId);
    if (isResult(s)) return s;
    const claims = readChargeToken(
      token,
      { orgId: ctx.orgId, item: packItem(pack) },
      nowOf(deps),
    );
    if (!claims) return priceChanged();
    const price = await pricedItem("pack", pack.key, s.path);
    if (price === null) return fail("refused", UNPRICED_ADDON_COPY);
    const billing = deps.billing ?? getCdsBilling();
    const sub = await billing.fetchSubscription(s.account.subscriptionId);
    const before = itemOf(sub, "pack", pack.key)?.quantity ?? 0;
    // The confirmed add already went on (lost response, double click, second tab).
    if (before > claims.basis) return ALREADY;
    if (before < claims.basis) return priceChanged();
    const change = at(packAdd(sub, pack, price), claims);
    if (!(await sameFigures(s, change, price.cents, claims, deps))) {
      return priceChanged();
    }
    const quantity = before + 1;
    return apply(
      ctx,
      s,
      change,
      `pack:${ctx.orgId}:${pack.key}:${quantity}:${claims.nonce}`,
      {
        action: "billing.pack_added",
        meta: { pack: pack.key, kind: pack.key, quantity },
      },
      deps,
    );
  });
}

/**
 * PAGES-PACK-REFUSED when the counted pages would not fit the allowance left after one pack
 * less (11-27 choice 5); null when they fit.
 */
async function pagesRemovalRefusal(
  orgId: string,
  packsLeft: number,
): Promise<ChargeResult | null> {
  const used = await withSuperuser((pb) => countCountedPages(pb, orgId));
  const left = pageAllowance(Math.max(0, packsLeft));
  return used > left
    ? fail("refused", pagesPackRemoveRefusedCopy(used, left))
    : null;
}

/** Take one pages pack off the pre-checkout order (caller holds `billing:<org>`). */
async function preCheckoutPagesRemove(
  ctx: OrgContext,
  s: ChargeState,
  pack: Pack,
  deps: ChargeDeps,
): Promise<ChargeResult> {
  const current = draftPagePacksOf(s.account);
  if (current === 0) return fail("refused", NO_PACK_COPY);
  const packs = await withSuperuser((pb) => packsFor(pb, ctx.orgId));
  const refused = await pagesRemovalRefusal(ctx.orgId, packs - 1);
  if (refused) return refused;
  await setDraftPagePacks(ctx, current - 1, registryOf(deps), deps.billing, {
    action: "billing.pack_removed",
    meta: { kind: pack.key, quantity: current - 1, beforeCheckout: true },
  });
  deps.invalidator?.invalidate([addonsTag(ctx.orgId)]);
  return { ok: true, invoiceTotalCents: 0 };
}

/**
 * Remove one pack (quantity -1, credit for the unused time). Refused with PACK-REMOVE-REFUSED
 * when the media in use is more than the allowance that would be left (choice 5), and with
 * PAGES-PACK-REFUSED when the counted pages are more than the page allowance left (11-27).
 * Before checkout a pages pack comes off the order (draft `pagePacks` -1).
 */
export async function removePack(
  ctx: OrgContext,
  kind: PackKind | PackSize,
  deps: ChargeDeps = {},
): Promise<ChargeResult> {
  requirePermission(ctx, "purchases", "run");
  const pack = packOf(kind);
  return withOrgLock(`billing:${ctx.orgId}`, () =>
    // WR-B03: a pages pack's counted-page check and its removal also hold the content lock
    // that createPage, restore and clearing a page password take (always billing first, then
    // content), so a page cannot be added between the check and the write.
    pack.key === "pages-5"
      ? withOrgLock(ctx.orgId, () => removePackLocked(ctx, pack, deps))
      : removePackLocked(ctx, pack, deps),
  );
}

/** removePack's body; the caller holds `billing:<org>` (and the content lock for pages). */
async function removePackLocked(
  ctx: OrgContext,
  pack: Pack,
  deps: ChargeDeps,
): Promise<ChargeResult> {
  if (pack.key === "pages-5") {
    const pre = await withSuperuser((pb) => loadChargeState(pb, ctx.orgId));
    if (
      !(pre.account && PAUSED.has(pre.account.status)) &&
      isBeforeCheckout(pre.account)
    ) {
      return preCheckoutPagesRemove(ctx, pre, pack, deps);
    }
  }
  const s = await paidState(ctx.orgId);
  if (isResult(s)) return s;
  const billing = deps.billing ?? getCdsBilling();
  const sub = await billing.fetchSubscription(s.account.subscriptionId);
  const item = itemOf(sub, "pack", pack.key);
  if (!item) return fail("refused", NO_PACK_COPY);
  if (pack.key === "pages-5") {
    const refused = await pagesRemovalRefusal(ctx.orgId, item.quantity - 1);
    if (refused) return refused;
  } else {
    const qty = (key: string) => itemOf(sub, "pack", key)?.quantity ?? 0;
    const left = mediaAllowanceBytes(
      qty(PACKS["media-5gb"].key) - (pack.key === "media-5gb" ? 1 : 0),
      qty(PACKS["media-25gb"].key) - (pack.key === "media-25gb" ? 1 : 0),
    );
    const { usedBytes } = await mediaUsage(ctx);
    if (usedBytes > left) {
      return fail("refused", packRemoveRefusedCopy(usedBytes, left));
    }
  }
  return apply(
    ctx,
    s,
    removal(item),
    attemptKey(s, `pack-remove:${ctx.orgId}:${pack.key}:${item.quantity - 1}`),
    {
      action: "billing.pack_removed",
      meta: { pack: pack.key, kind: pack.key, quantity: item.quantity - 1 },
    },
    deps,
  );
}

// ---------------------------------------------------------------------------------------
// Care Plan (BILL-19, D299)

/** The confirm dialog's figures for turning the Care Plan on (or off when it is on). */
export async function previewCarePlan(
  ctx: OrgContext,
  deps: ChargeDeps = {},
): Promise<ChargePreviewData> {
  const s = await previewState(ctx);
  const price = await pricedItem("care_plan", CARE_KEY, s.path);
  if (price === null) throw new InvalidInput(UNPRICED_ADDON_COPY);
  const billing = deps.billing ?? getCdsBilling();
  const sub = await billing.fetchSubscription(s.account.subscriptionId);
  const item = itemOf(sub, "care_plan", CARE_KEY);
  const token = { item: CARE_KEY, basis: item ? 1 : 0, now: nowOf(deps) };
  if (item) return previewOf(ctx, s, removal(item), 0, token, deps);
  return previewOf(ctx, s, careAdd(price), price.cents, token, deps);
}

function careAdd(price: PricedItem): Change {
  return {
    add: [monthlyLine("care_plan", CARE_KEY, CARE_LABEL, price)],
    remove: [],
    setQuantity: [],
    oneTime: [],
    proration: "always_invoice",
    chargeNow: true,
  };
}

/**
 * Turn the Care Plan on (prorated charge, confirmed with the `previewCarePlan` token) or off
 * (credit, no token). Already in that state: no-op (`alreadyApplied` for a confirmed on).
 */
export async function setCarePlan(
  ctx: OrgContext,
  on: boolean,
  deps: ChargeDeps = {},
  token?: unknown,
): Promise<ChargeResult> {
  requirePermission(ctx, "purchases", "run");
  if (typeof on !== "boolean")
    throw new InvalidInput("on must be true or false");
  return withOrgLock(`billing:${ctx.orgId}`, async () => {
    const s = await paidState(ctx.orgId);
    if (isResult(s)) return s;
    const billing = deps.billing ?? getCdsBilling();
    const sub = await billing.fetchSubscription(s.account.subscriptionId);
    const item = itemOf(sub, "care_plan", CARE_KEY);
    if (!on) {
      if (item === undefined) return { ok: true, invoiceTotalCents: 0 };
      return apply(
        ctx,
        s,
        removal(item),
        attemptKey(s, `care-off:${ctx.orgId}`),
        { action: "billing.care_plan_off", meta: {} },
        deps,
      );
    }
    const claims = readChargeToken(
      token,
      { orgId: ctx.orgId, item: CARE_KEY },
      nowOf(deps),
    );
    if (item !== undefined) {
      // Already on: a confirmed retry is done; nothing is charged either way.
      return claims ? ALREADY : { ok: true, invoiceTotalCents: 0 };
    }
    if (!claims || claims.basis !== 0) return priceChanged();
    const price = await pricedItem("care_plan", CARE_KEY, s.path);
    if (price === null) return fail("refused", UNPRICED_ADDON_COPY);
    const change = at(careAdd(price), claims);
    if (!(await sameFigures(s, change, price.cents, claims, deps))) {
      return priceChanged();
    }
    return apply(
      ctx,
      s,
      change,
      `care-on:${ctx.orgId}:${claims.nonce}`,
      { action: "billing.care_plan_on", meta: {} },
      deps,
    );
  });
}

// ---------------------------------------------------------------------------------------
// Card update (provider-hosted portal; fake page in stand-in mode)

/**
 * The provider's card page for the caller's own customer (T-10-20-05: the id is read from
 * this org's account only). Allowed while lapsed, so the owner can pay. Owner only.
 */
export async function billingPortalLink(
  ctx: OrgContext,
  deps: ChargeDeps = {},
): Promise<{ url: string }> {
  requirePermission(ctx, "billing", "write");
  const s = await withSuperuser((pb) => loadChargeState(pb, ctx.orgId));
  const customerId = s.account?.customerId ?? "";
  if (customerId === "") throw new InvalidInput(NOT_PAID_COPY);
  const billing = deps.billing ?? getCdsBilling();
  const url = await billing.portalUrl({
    customerId,
    returnUrl: platformUrl(CARD_UPDATED_RETURN_PATH),
  });
  return { url };
}
