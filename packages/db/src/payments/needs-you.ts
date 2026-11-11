// P10 payments: the owner's billing "Needs you" items and the Settings tab counts (BILL-03,
// PAY-03; 10-15; UI-SPEC "Needs-you items" and "Tab counts"; D310).
//
// - "Fix your card": the CDS bill is past due or the add-ons are paused (lapsed).
// - "Finish Stripe setup": the tenant's Stripe account was connected once and is now
//   restricted or disconnected (an onboarding never finished is not a stop).
// - "Quote from CDS: {title}": each work order CDS sent and the owner has not answered.
// Items are for the Owner only; Admin, Editor, Viewer and impersonating staff get [] (T-10-15-04).
// Titles pass through as plain text (React escapes them at render). Filters are bound and
// scoped to ctx.orgId (invariant 1).
import { can } from "@cds/core";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { billingAccountByOrg } from "./accounts";
import { gatewayAccountByOrg } from "./connect";

export type BillingNeedsYouItem = {
  kind: "fix_card" | "finish_stripe" | "quote";
  title: string;
  actionLabel: string;
  href: string;
};

export type BillingTabCounts = { payments: number; billing: number };

const BILLING_TAB = "/hub/settings?tab=billing";
const PAYMENTS_TAB = "/hub/settings?tab=payments";
const QUOTES_PATH = "/hub/settings/quotes";
const QUOTES_MAX = 50;

type Signals = {
  cardTrouble: boolean;
  stripeStopped: boolean;
  quotes: { id: string; title: string }[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function sentQuotes(
  pb: PocketBase,
  orgId: string,
): Promise<{ id: string; title: string }[]> {
  const res = await pb.collection("work_orders").getList(1, QUOTES_MAX, {
    filter: pb.filter("organization = {:org} && status = 'sent'", {
      org: orgId,
    }),
    sort: "sent_at,id",
    fields: "id,title",
  });
  return res.items.map((r) => ({ id: r.id, title: str(r.title) }));
}

async function signals(
  orgId: string,
  want: { billing: boolean; payments: boolean },
): Promise<Signals> {
  return withSuperuser(async (pb) => {
    const out: Signals = {
      cardTrouble: false,
      stripeStopped: false,
      quotes: [],
    };
    if (want.billing) {
      const account = await billingAccountByOrg(pb, orgId);
      out.cardTrouble =
        account?.status === "past_due" || account?.status === "lapsed";
      out.quotes = await sentQuotes(pb, orgId);
    }
    if (want.payments) {
      const row = await gatewayAccountByOrg(pb, orgId);
      // A non-empty alerted_status means the account was connected once (10-14).
      out.stripeStopped =
        row !== null &&
        row.alertedStatus !== "" &&
        (row.status === "restricted" || row.status === "disconnected");
    }
    return out;
  });
}

/** The Owner's billing Needs-you items for P11; [] for every other role and impersonation. */
export async function billingNeedsYou(
  ctx: OrgContext,
): Promise<BillingNeedsYouItem[]> {
  assertOrgContext(ctx);
  if (ctx.role !== "owner" || ctx.impersonator) return [];
  const s = await signals(ctx.orgId, { billing: true, payments: true });
  const items: BillingNeedsYouItem[] = [];
  if (s.cardTrouble) {
    items.push({
      kind: "fix_card",
      title: "Fix your card",
      actionLabel: "Update card",
      href: BILLING_TAB,
    });
  }
  if (s.stripeStopped) {
    items.push({
      kind: "finish_stripe",
      title: "Finish Stripe setup",
      actionLabel: "Finish Stripe setup",
      href: PAYMENTS_TAB,
    });
  }
  for (const q of s.quotes) {
    items.push({
      kind: "quote",
      title: `Quote from Support: ${q.title}`,
      actionLabel: "Review quote",
      href: `${QUOTES_PATH}/${encodeURIComponent(q.id)}`,
    });
  }
  return items;
}

/**
 * Settings tab counts ("Payments · 1", "Billing · 2"). Payments counts for roles that can
 * read Connect (Owner, Admin); Billing (past due or paused, plus waiting quotes) for those
 * that can read billing (Owner). Everyone else gets zeros.
 */
export async function billingTabCounts(
  ctx: OrgContext,
): Promise<BillingTabCounts> {
  assertOrgContext(ctx);
  const want = {
    billing: can(ctx, "billing", "read"),
    payments: can(ctx, "connect", "read"),
  };
  if (!want.billing && !want.payments) return { payments: 0, billing: 0 };
  const s = await signals(ctx.orgId, want);
  return {
    payments: s.stripeStopped ? 1 : 0,
    billing: (s.cardTrouble ? 1 : 0) + s.quotes.length,
  };
}
