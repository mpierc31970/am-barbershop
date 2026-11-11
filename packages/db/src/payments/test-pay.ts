// P10 test-pay (10-23; CONTEXT A1 stand-in, PAY-09): the org-scoped readers the fake
// adapter's test pages use to find "this org's" provider objects. The portal and Connect test
// pages never act on a customer or account id taken from the query string alone: they compare
// it with the id stored on the caller org's own row (T-10-23-02, invariant 1).
//
// Ids only, never the rows: the full provider ids stay server-side (the test pages run on
// the server and only compare them). Both refuse in CDS_ENV=production, as every fake helper
// does (Pitfall 4).
import type { OrgContext } from "../context";
import { withSuperuser } from "../client";
import { requirePermission } from "../repository";
import { billingAccountByOrg } from "./accounts";
import { gatewayAccountByOrg } from "./connect";
import { refuseInProduction } from "./fake/shared";

/** The caller org's CDS customer id (billing_accounts.customer_id), or null before checkout. */
export async function testPayCustomerId(
  ctx: OrgContext,
): Promise<string | null> {
  refuseInProduction();
  requirePermission(ctx, "billing", "write");
  const account = await withSuperuser((pb) =>
    billingAccountByOrg(pb, ctx.orgId),
  );
  return account && account.customerId !== "" ? account.customerId : null;
}

/** The caller org's Connect account id (gateway_accounts.account_id), or null. */
export async function testPayAccountId(
  ctx: OrgContext,
): Promise<string | null> {
  refuseInProduction();
  requirePermission(ctx, "connect", "write");
  const row = await withSuperuser((pb) => gatewayAccountByOrg(pb, ctx.orgId));
  return row && row.accountId !== "" ? row.accountId : null;
}
