// Per-org media allowance (10-33; BILL-13, D222, D225, CONTEXT A3). The P7 fixed 2 GB becomes
// 2 GB + 5 GB x media_5gb_qty + 25 GB x media_25gb_qty from the org's billing account. Packs
// read as 0 while the account is lapsed or canceled, exactly like the entitlement set
// (invariant 9: stored quantities are untouched, paying again restores them). No account =
// the 2 GB base. Computed server-side on every read (T-10-33-01). Every filter is bound.
import { mediaAllowanceBytes } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../../client";
import { assertOrgContext, type OrgContext } from "../../context";
import { PAUSED } from "../../payments/entitlements";
import type { BillingAccountStatus } from "../../payments/accounts";

const COLLECTION = "billing_accounts";
const FIELDS = "organization,status,media_5gb_qty,media_25gb_qty";
/** Org ids per bound OR filter (keeps the query string short at 10-50 tenants and beyond). */
const CHUNK = 40;

type Row = {
  organization?: unknown;
  status?: unknown;
  media_5gb_qty?: unknown;
  media_25gb_qty?: unknown;
};

function qty(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** Allowance in bytes for one billing account row (null = no account = 2 GB). */
export function allowanceFromAccount(row: Row | null | undefined): number {
  if (!row) return mediaAllowanceBytes(0, 0);
  const status = (
    typeof row.status === "string" ? row.status : "none"
  ) as BillingAccountStatus;
  if (PAUSED.has(status)) return mediaAllowanceBytes(0, 0);
  return mediaAllowanceBytes(qty(row.media_5gb_qty), qty(row.media_25gb_qty));
}

/** Internal (superuser client): allowance per org id, in one bound query per 40 orgs. */
export async function mediaAllowancesFor(
  pb: PocketBase,
  orgIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [
    ...new Set(orgIds.filter((id) => typeof id === "string" && id !== "")),
  ];
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, allowanceFromAccount(null));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const params: Record<string, string> = {};
    const clauses = part.map((id, j) => {
      params[`o${j}`] = id;
      return `organization = {:o${j}}`;
    });
    const rows = await pb.collection(COLLECTION).getFullList<Row>({
      filter: pb.filter(clauses.join(" || "), params),
      fields: FIELDS,
    });
    for (const r of rows) {
      const org = typeof r.organization === "string" ? r.organization : "";
      if (out.has(org)) out.set(org, allowanceFromAccount(r));
    }
  }
  return out;
}

/** The org's media allowance in bytes (2 GB + packs). Any member context may ask. */
export async function mediaAllowance(ctx: OrgContext): Promise<number> {
  assertOrgContext(ctx);
  return withSuperuser(async (pb) => {
    const res = await pb.collection(COLLECTION).getList<Row>(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: FIELDS,
    });
    return allowanceFromAccount(res.items[0] ?? null);
  });
}
