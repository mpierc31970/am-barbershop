// 12-01 Wave 0: the P12 two-org fixture and fakes run against the real schema.
import { can } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { fakeScanner, fixedClock } from "./support-fakes";
import { bootPb, type PbInstance } from "./pb-harness";
import { SUPPORT_SEED_CARE_USED, seedSupport } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

async function* bytes(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

describe("seedSupport (12-01 Wave 0)", () => {
  it("seeds two orgs with four roles, a live page, an add-on and org A's Care Plan", async (t) => {
    if (!inst) return t.skip();
    const clock = fixedClock("2026-10-15T17:00:00Z");
    const s = await seedSupport(pb, { now: clock.now() });

    for (const o of [s.A, s.B]) {
      const roles = await pb.collection("memberships").getFullList({
        filter: pb.filter("organization = {:org}", { org: o.org }),
      });
      for (const role of ["owner", "admin", "editor", "viewer"] as const) {
        expect(
          roles.some((m) => m.role === role && m.user === o.users[role]),
        ).toBe(true);
        expect(o.ctx[role].orgId).toBe(o.org);
        expect(o.ctx[role].role).toBe(role);
      }
      const page = await pb.collection("pages").getOne(o.livePage);
      expect(page.status).toBe("published");
      const addon = await pb.collection("org_addons").getFirstListItem(
        pb.filter("organization = {:org} && addon = {:a}", {
          org: o.org,
          a: o.addon,
        }),
      );
      expect(addon.status).toBe("active");
      expect(can(o.ctx.viewer, "support", "read")).toBe(true);
      expect(can(o.ctx.viewer, "support", "write")).toBe(false);
      expect(o.impersonatedOwner.impersonator).toBe(s.staff.superAdminUser);
    }

    expect(s.A.carePlan).toBe(true);
    expect(s.B.carePlan).toBe(false);
    const care = await pb.collection("care_plan_time").getFullList({
      filter: pb.filter("organization = {:org}", { org: s.A.org }),
    });
    expect(care.reduce((n, r) => n + (r.minutes as number), 0)).toBe(
      SUPPORT_SEED_CARE_USED,
    );
    expect(s.staff.agent.staffRole).toBe("support_agent");
    expect(s.staff.superAdmin.staffRole).toBe("super_admin");
  });

  it("fakes: scanner verdicts and a movable clock", async () => {
    const sc = fakeScanner("infected");
    expect(await sc.scan(bytes())).toBe("infected");
    sc.setVerdict("clean");
    expect(await sc.scan(bytes())).toBe("clean");
    expect(sc.calls).toBe(2);
    const c = fixedClock("2026-10-15T00:00:00Z");
    c.advance(30_000);
    expect(c.now().toISOString()).toBe("2026-10-15T00:00:30.000Z");
  });
});
