// 13-22 test helper: seed the support fixture with a named site B and return its hostname, so
// apps/web tests can suspend it without holding a PocketBase client (Invariant 1 lint).
import { resetClientForTests, superuser } from "../src/client";
import { seedSupport, type SupportSeed } from "./support-seed";

export async function seedSuspendableSite(opts: {
  now: Date;
  business: string;
}): Promise<{ s: SupportSeed; host: string }> {
  resetClientForTests();
  const pb = await superuser();
  const s = await seedSupport(pb, { now: opts.now });
  await pb.collection("organizations").update(s.B.org, { name: opts.business });
  const host = String(
    (await pb.collection("org_hosts").getOne(s.base.B.host)).hostname,
  );
  return { s, host };
}
