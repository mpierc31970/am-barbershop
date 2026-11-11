// 13-36: test-only seed for the apps/web STAFF-11 console-path test. Keeps the superuser client
// inside packages/db (Invariant 1): the P12 support fixture's org A with a published page, its
// Owner context and the same Owner under staff impersonation (the staff path for content).
import type { OrgContext } from "../src/context";
import { superuser } from "../src/client";
import type { TwoOrgs } from "./fixtures";
import { seedSupport } from "./support-seed";

export async function seedWindowLockSite(base: TwoOrgs): Promise<{
  orgId: string;
  pageId: string;
  owner: OrgContext;
  impersonatedOwner: OrgContext;
}> {
  const pb = await superuser();
  const seed = await seedSupport(pb, { base, now: new Date() });
  return {
    orgId: seed.A.org,
    pageId: seed.A.livePage,
    owner: seed.A.ctx.owner,
    impersonatedOwner: seed.A.impersonatedOwner,
  };
}
