// P12 two-org fixture (12-01; 12-VALIDATION Wave 0). Every P12 integration test starts here:
// org A and org B, each with an owner, admin, editor and viewer member context, one live
// (published) page and one active add-on; org A on the Care Plan with minutes left, org B
// without it; plus staff PlatformContexts for support_agent and super_admin.
// Seeds through the superuser client (test-only). It creates NO P12 collection rows: the
// support schema arrives in 12-02 and each test seeds the rows it needs.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";

const IP = "127.0.0.1";

export type SupportRole = "owner" | "admin" | "editor" | "viewer";

export type SupportOrg = {
  org: string;
  /** User id per role. */
  users: Record<SupportRole, string>;
  /** Member context per role (never impersonated). */
  ctx: Record<SupportRole, OrgContext>;
  /** The owner's context as seen by an impersonating super_admin (support:write denied). */
  impersonatedOwner: OrgContext;
  /** A published page (slug `about`). */
  livePage: string;
  /** The active add-on slug in org_addons. */
  addon: string;
  /** billing_accounts row id. */
  billingAccount: string;
  /** True for org A only. */
  carePlan: boolean;
};

export type SupportSeed = {
  base: TwoOrgs;
  A: SupportOrg;
  B: SupportOrg;
  staff: {
    agent: PlatformContext;
    superAdmin: PlatformContext;
    agentUser: string;
    superAdminUser: string;
  };
  /** Care Plan minutes already logged for org A this month (60 a month, D299). */
  careMinutesUsedA: number;
};

/** Minutes logged against org A's Care Plan, leaving 45 of 60 this month. */
export const SUPPORT_SEED_CARE_USED = 15;
/** The add-on slug every seeded org has active (from seedTwoOrgs). */
export const SUPPORT_SEED_ADDON = "fixture-seed";

function secret(): string {
  return randomBytes(18).toString("hex");
}

async function user(
  pb: PocketBase,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const password = secret();
  return (
    await pb
      .collection("users")
      .create({ email, password, passwordConfirm: password, ...extra })
  ).id;
}

function ctxFor(orgId: string, actor: string, role: SupportRole): OrgContext {
  return mintOrgContext({ orgId, actor, role, grants: [], ip: IP });
}

async function supportOrg(
  pb: PocketBase,
  orgId: string,
  owner: string,
  key: "a" | "b",
  carePlan: boolean,
  impersonator: string,
  now: Date,
): Promise<SupportOrg> {
  const users = { owner } as Record<SupportRole, string>;
  for (const role of ["admin", "editor", "viewer"] as const) {
    users[role] = await user(pb, `support-${role}-${key}@cds.test`);
    await pb
      .collection("memberships")
      .create({ user: users[role], organization: orgId, role });
  }
  const ctx = {} as Record<SupportRole, OrgContext>;
  for (const role of ["owner", "admin", "editor", "viewer"] as const) {
    ctx[role] = ctxFor(orgId, users[role], role);
  }
  const livePage = (
    await pb.collection("pages").create({
      organization: orgId,
      slug: "about",
      title: "About",
      status: "published",
      kind: "builder",
    })
  ).id;
  const billingAccount = (
    await pb.collection("billing_accounts").create({
      organization: orgId,
      provider: "fake",
      customer_id: `cus_support_${key}`,
      status: "active",
      care_plan: carePlan,
    })
  ).id;
  if (carePlan) {
    await pb.collection("care_plan_time").create({
      organization: orgId,
      minutes: SUPPORT_SEED_CARE_USED,
      note: "Seeded Care Plan time",
      staff: "staff@cds.test",
      logged_at: now.toISOString(),
    });
  }
  return {
    org: orgId,
    users,
    ctx,
    impersonatedOwner: mintOrgContext({
      orgId,
      actor: owner,
      role: "owner",
      grants: [],
      impersonator,
      ip: IP,
    }),
    livePage,
    addon: SUPPORT_SEED_ADDON,
    billingAccount,
    carePlan,
  };
}

/**
 * Seed the P12 two-org fixture. Pass `base` when the test already ran seedTwoOrgs (e.g. the
 * isolation suite); otherwise it is seeded here. `now` dates the Care Plan time row, so pass
 * the same instant the test's clock uses.
 */
export async function seedSupport(
  pb: PocketBase,
  opts: { base?: TwoOrgs; now?: Date } = {},
): Promise<SupportSeed> {
  const base = opts.base ?? (await seedTwoOrgs(pb));
  const now = opts.now ?? new Date();
  const agentUser = await user(pb, "support-agent@cds.test", {
    staff_role: "support_agent",
  });
  const superAdminUser = await user(pb, "support-super@cds.test", {
    staff_role: "super_admin",
  });
  const A = await supportOrg(
    pb,
    base.A.org,
    base.A.owner,
    "a",
    true,
    superAdminUser,
    now,
  );
  const B = await supportOrg(
    pb,
    base.B.org,
    base.B.owner,
    "b",
    false,
    superAdminUser,
    now,
  );
  return {
    base,
    A,
    B,
    staff: {
      agent: mintPlatformContext({
        actor: agentUser,
        staffRole: "support_agent",
        ip: IP,
      }),
      superAdmin: mintPlatformContext({
        actor: superAdminUser,
        staffRole: "super_admin",
        ip: IP,
      }),
      agentUser,
      superAdminUser,
    },
    careMinutesUsedA: SUPPORT_SEED_CARE_USED,
  };
}
