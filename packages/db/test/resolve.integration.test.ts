// TEN-04: hostname -> organization resolution on the real PocketBase 0.39.11 binary.
// Rejects, never defaults (T-02-20); cache bounded (T-02-21).
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  clearResolverCache,
  resolveOrganization,
  resolverCacheSize,
  RESOLVER_CACHE_MAX,
} from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

async function orgWithHost(
  slug: string,
  status: "active" | "held" | "disabled",
  hostname: string,
): Promise<string> {
  const org = await pb
    .collection("organizations")
    .create({ name: slug, slug, status });
  await pb.collection("org_hosts").create({
    hostname,
    organization: org.id,
    kind: "custom",
    primary: true,
  });
  return org.id;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await orgWithHost("held-org", "held", "held.example.com");
  await orgWithHost("disabled-org", "disabled", "disabled.example.com");
  await orgWithHost("shop-org", "active", "shop.example.com");
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  clearResolverCache();
});

describe("TEN-04 resolveOrganization", () => {
  it("resolves an active org's host to {orgId, slug, host}", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization("a.example.com")).toEqual({
      orgId: seed.A.org,
      slug: "org-a",
      host: "a.example.com",
      hostKind: "custom",
      primaryHost: "a.example.com",
      suspended: false,
      // 14-14: redirect target (custom rows have none) and the org's live stage.
      redirectTo: null,
      live: false,
    });
  });

  it("normalizes case, port and trailing dot", async (ctx) => {
    if (!inst) return ctx.skip();
    const r = await resolveOrganization("Shop.Example.COM.");
    expect(r?.host).toBe("shop.example.com");
    expect(r?.slug).toBe("shop-org");
    expect((await resolveOrganization("SHOP.example.com:443"))?.slug).toBe(
      "shop-org",
    );
  });

  it("unknown host -> null (never a default org)", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization("nobody.example.com")).toBeNull();
  });

  it("held and disabled orgs -> null", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization("held.example.com")).toBeNull();
    expect(await resolveOrganization("disabled.example.com")).toBeNull();
  });

  it("platform host, IP forms and empty input -> null", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization("localhost")).toBeNull();
    expect(await resolveOrganization("cds.needtobeedgy.com")).toBeNull();
    expect(await resolveOrganization("127.1")).toBeNull();
    expect(await resolveOrganization("127.0.0.1")).toBeNull();
    expect(await resolveOrganization(null)).toBeNull();
    expect(await resolveOrganization(undefined)).toBeNull();
    expect(await resolveOrganization("")).toBeNull();
  });

  it("filter injection in the host never matches another org", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization('x" || hostname != "')).toBeNull();
  });
});

describe("TEN-04 resolver cache (T-02-21)", () => {
  it("serves a hit from cache until clearResolverCache()", async (ctx) => {
    if (!inst) return ctx.skip();
    const orgId = await orgWithHost(
      "cached-org",
      "active",
      "cached.example.com",
    );
    expect((await resolveOrganization("cached.example.com"))?.orgId).toBe(
      orgId,
    );
    const row = await pb
      .collection("org_hosts")
      .getFirstListItem(
        pb.filter("hostname = {:h}", { h: "cached.example.com" }),
      );
    await pb.collection("org_hosts").delete(row.id);
    expect((await resolveOrganization("cached.example.com"))?.orgId).toBe(
      orgId,
    );
    clearResolverCache();
    expect(await resolveOrganization("cached.example.com")).toBeNull();
  });

  it("caches a miss (a new row appears only after clearResolverCache)", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await resolveOrganization("late.example.com")).toBeNull();
    const orgId = await orgWithHost("late-org", "active", "late.example.com");
    expect(await resolveOrganization("late.example.com")).toBeNull();
    clearResolverCache();
    expect((await resolveOrganization("late.example.com"))?.orgId).toBe(orgId);
  });

  it(`never holds more than ${RESOLVER_CACHE_MAX} entries`, async (ctx) => {
    if (!inst) return ctx.skip();
    for (let i = 0; i <= RESOLVER_CACHE_MAX; i++) {
      await resolveOrganization(`flood-${i}.example.com`);
    }
    expect(resolverCacheSize()).toBe(RESOLVER_CACHE_MAX);
  });
});
