// P10 billing attacks (10-04, TEN-03, invariant 1). Every P10 tenant collection is
// `writes: "custom"`: the generic repo stays read-only and org B's get of org A's row is
// NotFound. The custom writers (10-12, 10-14, 10-26, 10-27, 10-28) carry their own
// cross-tenant write attacks in their plans' tests (10-04 choice 4); they may also add
// `<collection>:<area>` keys here.
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export function attacks(env: AttackEnv): AttackMap {
  return {
    billing_accounts: readOnlyAttack(env, "billing_accounts"),
    billing_invoices: readOnlyAttack(env, "billing_invoices"),
    gateway_accounts: readOnlyAttack(env, "gateway_accounts"),
    work_orders: readOnlyAttack(env, "work_orders"),
    care_plan_time: readOnlyAttack(env, "care_plan_time"),
  };
}
