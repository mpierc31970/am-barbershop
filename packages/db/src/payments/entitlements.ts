// P10 entitlements (10-17; BILL-03, BILL-04, BILL-13, BILL-14; CONTEXT A3; D27, D225, D233,
// D234, D310; invariant 9). One server read answers "may this org use X right now":
//   active org_addons slugs
//   ∪ plan-included add-ons: active, priced $0 `addon` catalog rows for the org's path
//     (unpriced rows are never included; Studio gets Builder Pro free), paused with the
//     plan when the account is lapsed / canceled (WR-A02)
//   ∪ `care-plan` when the billing account has it and is not lapsed / canceled
//   + media pack and pages pack quantities (0 when lapsed / canceled; pages packs 11-27).
// Lapse never deletes (invariant 9): the stored care_plan flag and pack quantities stay on the
// account, so paying again restores both. `past_due` keeps everything (D310 grace).
// Every read is scoped by the org id from the context, with bound filters (T-10-17-02).
import type { EntitlementSet } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { activeSet } from "../addons/entitlements";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import {
  billingAccountByOrg,
  type BillingAccount,
  type BillingAccountStatus,
} from "./accounts";

/** Billing states that pause Care Plan and media packs, exactly like a lapsed add-on (internal; media/cdn/allowance.ts reuses it). */
export const PAUSED: ReadonlySet<BillingAccountStatus> =
  new Set<BillingAccountStatus>(["lapsed", "canceled"]);

/**
 * Active "5 more pages" packs (11-27, D185): the mirrored `pages_5_qty`, read as 0 while the
 * account is lapsed or canceled (the stored quantity is untouched, invariant 9). Internal:
 * content/allowance.ts reads the same rule.
 */
export function pagePacksOf(account: BillingAccount | null): number {
  return account && !PAUSED.has(account.status) ? account.pages5Qty : 0;
}

/** The org's path ("standard" | "studio"), or "" when unset. */
async function orgPath(pb: PocketBase, orgId: string): Promise<string> {
  const res = await pb.collection("organizations").getList(1, 1, {
    filter: pb.filter("id = {:org}", { org: orgId }),
    fields: "path",
  });
  const path = res.items[0]?.path;
  return typeof path === "string" ? path : "";
}

/** Add-on keys the org's path includes at $0 (choice 1: priced rows only). */
async function planIncluded(pb: PocketBase, path: string): Promise<string[]> {
  if (path === "") return [];
  const rows = await pb.collection("price_catalog").getFullList({
    filter: pb.filter(
      "active = true && priced = true && item_kind = 'addon' && path = {:path} && monthly_cents = 0",
      { path },
    ),
    fields: "item_key",
  });
  return rows
    .map((r) => (typeof r.item_key === "string" ? r.item_key : ""))
    .filter((k) => k !== "");
}

/** Internal (system callers with a superuser client): the org's entitlement set. */
export async function entitlementsFor(
  pb: PocketBase,
  orgId: string,
): Promise<EntitlementSet> {
  const [active, path, account] = await Promise.all([
    activeSet(pb, orgId),
    orgPath(pb, orgId),
    billingAccountByOrg(pb, orgId),
  ]);
  const keys = new Set<string>(active);
  // WR-A02: plan-included add-ons are part of the paid plan, so a lapse or cancel pauses
  // them exactly like a paid add-on (CONTEXT A3). Before checkout (no account, or status
  // `none`) they are on, like every pre-checkout install (D186).
  const planPaused = account ? PAUSED.has(account.status) : false;
  if (!planPaused) {
    for (const k of await planIncluded(pb, path)) keys.add(k);
  }
  const paused = account ? PAUSED.has(account.status) : true;
  if (account && !paused && account.carePlan) keys.add("care-plan");
  // media_5gb_qty / media_25gb_qty: read as 0 while lapsed; the stored values are untouched.
  const mediaPacks5 = account && !paused ? account.media5gbQty : 0;
  const mediaPacks25 = account && !paused ? account.media25gbQty : 0;
  return { keys, mediaPacks5, mediaPacks25, pagePacks: pagePacksOf(account) };
}

/** What this org may use right now. Any member may ask (gates, nav, the Forms lock). */
export async function entitlements(ctx: OrgContext): Promise<EntitlementSet> {
  assertOrgContext(ctx);
  return withSuperuser((pb) => entitlementsFor(pb, ctx.orgId));
}

/**
 * The org's path ("standard" | "studio", "" when unset) for reading its catalog prices
 * (10-31, BILL-18: the add-on hub shows the path's price). Any member may ask.
 */
export async function orgPlanPath(ctx: OrgContext): Promise<string> {
  assertOrgContext(ctx);
  return withSuperuser((pb) => orgPath(pb, ctx.orgId));
}

/** The server truth for every gate: is `key` in the org's entitlement set. */
export async function hasEntitlement(
  ctx: OrgContext,
  key: string,
): Promise<boolean> {
  if (typeof key !== "string" || key === "") return false;
  return (await entitlements(ctx)).keys.has(key);
}
