// P10 billing fixtures (10-04, TEN-03, invariant 1): one superuser-inserted row per org per
// P10 tenant collection, for the isolation suite's read attacks. billing_invoices and
// work_orders hold a plain-text organization (BILL-09, D214); the rest relate.
import type PocketBase from "pocketbase";

export const BILLING_COLLECTIONS = [
  "billing_accounts",
  "billing_invoices",
  "gateway_accounts",
  "work_orders",
  "care_plan_time",
] as const;

export type BillingCollection = (typeof BILLING_COLLECTIONS)[number];

export type BillingSeed = Record<BillingCollection, { A: string; B: string }>;

async function rowsFor(
  pb: PocketBase,
  org: string,
  tag: string,
): Promise<Record<BillingCollection, string>> {
  const now = new Date().toISOString();
  const create = async (name: string, data: Record<string, unknown>) =>
    (await pb.collection(name).create({ organization: org, ...data })).id;
  const workOrder = await create("work_orders", {
    kind: "polish",
    title: `Polish ${tag}`,
    total_cents: 20000,
    status: "sent",
    deposit_invoice_id: `in_dep_${tag}`,
    created_by: "staff@cds.test",
  });
  return {
    billing_accounts: await create("billing_accounts", {
      provider: "fake",
      customer_id: `cus_${tag}`,
      subscription_id: `sub_${tag}`,
      status: "active",
      cadence: "monthly",
      build_plan: "full",
      card_brand: "visa",
      card_last4: "4242",
      card_exp: "12/2030",
    }),
    billing_invoices: await create("billing_invoices", {
      provider: "fake",
      provider_invoice_id: `in_${tag}`,
      number: `CDS-${tag}`,
      issued_at: now,
      kind: "checkout",
      amount_cents: 3900,
      status: "paid",
      hosted_url: `https://example.test/inv/${tag}`,
    }),
    gateway_accounts: await create("gateway_accounts", {
      provider: "fake",
      account_id: `acct_${tag}`,
      charges_enabled: true,
      details_submitted: true,
      status: "connected",
      checked_at: now,
    }),
    work_orders: workOrder,
    care_plan_time: await create("care_plan_time", {
      minutes: 30,
      note: `Care ${tag}`,
      staff: "staff@cds.test",
      logged_at: now,
    }),
  };
}

/** Org A's and org B's row in each P10 tenant collection, keyed `A` / `B`. */
export async function seedBilling(
  pb: PocketBase,
  orgA: string,
  orgB: string,
): Promise<BillingSeed> {
  const a = await rowsFor(pb, orgA, "a");
  const b = await rowsFor(pb, orgB, "b");
  const out = {} as BillingSeed;
  for (const name of BILLING_COLLECTIONS) {
    out[name] = { A: a[name], B: b[name] };
  }
  return out;
}
