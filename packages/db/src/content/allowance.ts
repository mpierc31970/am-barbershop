// Page allowance on the server (11-26; DASH-08; D185, D273; invariant 9; T-11-26-01/02).
// The rules live in @cds/core/content (11-07): allowance = 10 + 5 x page packs, and only
// live, unprotected builder pages count. This module reads them against the database:
//   - packs = the entitlement set's `pagePacks` (11-27: billing_accounts.pages_5_qty, read
//     as 0 while the account is lapsed or canceled; the stored quantity is untouched, so
//     paying again restores it and nothing is ever deleted), plus packs still pending in the
//     pre-checkout draft (`checkout_draft.pagePacks`, only while the status is `none`, read
//     defensively as 0).
//   - the count is one bound count query mirroring countsTowardLimit (a test keeps the two
//     equal on the same rows).
//   - assertPageRoom runs inside createPage's run() (withOrgLock), so two tabs cannot both
//     take the last page.
// Every filter is bound and scoped to the context's org (invariant 1).
import { PageLimitReached, pageAllowance } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { billingAccountByOrg } from "../payments/accounts";
import { pagePacksOf } from "../payments/entitlements";
import { requirePermission } from "../repository";

const PAGES = "pages";
const ACCOUNTS = "billing_accounts";

/** Shared with countsTowardLimit: builder, not in the bin, no password (hash or flag). */
const COUNTED_FILTER =
  "organization = {:org} && kind = 'builder' && deleted_at = '' && password_protected != true && password_hash = ''";

function qty(v: unknown): number {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** Pending page packs on a pre-checkout draft (0 when absent or malformed). */
function draftPacks(draft: unknown): number {
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
    return 0;
  }
  return qty((draft as Record<string, unknown>).pagePacks);
}

/**
 * Internal (superuser client): active page packs for one org = the entitlement rule
 * (`pagePacksOf`, the same function entitlements() uses) + the draft's pending packs before
 * payment. The draft is read raw so a partial draft still counts its packs.
 */
export async function packsFor(pb: PocketBase, orgId: string): Promise<number> {
  const account = await billingAccountByOrg(pb, orgId);
  if (!account) return 0;
  const active = pagePacksOf(account);
  if (account.status !== "none") return active;
  const res = await pb.collection(ACCOUNTS).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "checkout_draft",
  });
  return active + draftPacks(res.items[0]?.checkout_draft);
}

/** Internal (superuser client): the org's page allowance. */
export async function allowanceFor(
  pb: PocketBase,
  orgId: string,
): Promise<number> {
  return pageAllowance(await packsFor(pb, orgId));
}

/** Internal (superuser client): pages using the allowance, in one bound count query. */
export async function countCountedPages(
  pb: PocketBase,
  orgId: string,
): Promise<number> {
  const res = await pb.collection(PAGES).getList(1, 1, {
    filter: pb.filter(COUNTED_FILTER, { org: orgId }),
    fields: "id",
  });
  return res.totalItems;
}

/**
 * Throws PageLimitReached when the org has no page left. The caller holds the per-org lock
 * (createPage's run()), so the count and the create are one step.
 */
export async function assertPageRoom(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<void> {
  const [used, allowance] = await Promise.all([
    countCountedPages(pb, ctx.orgId),
    allowanceFor(pb, ctx.orgId),
  ]);
  if (used >= allowance) throw new PageLimitReached(allowance);
}

/** The org's page allowance (10 + 5 x active packs). Any member may ask. */
export async function pageAllowanceFor(ctx: OrgContext): Promise<number> {
  requirePermission(ctx, "content", "read");
  return withSuperuser((pb) => allowanceFor(pb, ctx.orgId));
}

/** `{ used, allowance }` for the Pages tab counter (content:read). */
export async function pagesUsage(
  ctx: OrgContext,
): Promise<{ used: number; allowance: number }> {
  requirePermission(ctx, "content", "read");
  return withSuperuser(async (pb) => {
    const [used, allowance] = await Promise.all([
      countCountedPages(pb, ctx.orgId),
      allowanceFor(pb, ctx.orgId),
    ]);
    return { used, allowance };
  });
}
