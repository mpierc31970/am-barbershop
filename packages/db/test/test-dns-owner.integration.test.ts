// 14-44 (DOM-03, DOM-08; T-14-44-02): fakeWorldsForOrg, the `/test-dns` ownership check. A
// member sees only the fake worlds its own org holds a fake, live CDS zone for.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, withSuperuser } from "../src/client";
import { mintOrgContext } from "../src/context";
import { fakeWorldsForOrg } from "../src/dns/fake-world";
import { seedFakeDomain } from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
});

afterAll(async () => {
  await inst?.stop();
});

function ctxFor(orgId: string) {
  return mintOrgContext({
    orgId,
    actor: "u1",
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

async function zone(
  orgId: string,
  domain: string,
  status: string,
  provider = "fake",
): Promise<void> {
  await withSuperuser((pb) =>
    pb
      .collection("dns_zones")
      .create({ org_id: orgId, domain, provider, status }),
  );
}

describe("fakeWorldsForOrg (14-44)", () => {
  it("lists only the caller org's fake, live zones that have a world", async () => {
    if (!inst) return;
    await seedFakeDomain("mine.example", "google");
    await seedFakeDomain("theirs.example", "google");
    await seedFakeDomain("gone.example", "google");
    await seedFakeDomain("real.example", "google");
    await zone("orga00000000001", "mine.example", "pending");
    await zone("orgb00000000001", "theirs.example", "active");
    await zone("orga00000000001", "gone.example", "handed_back");
    await zone("orga00000000001", "real.example", "active", "cloudflare");
    await zone("orga00000000001", "noworld.example", "pending");

    const a = await fakeWorldsForOrg(ctxFor("orga00000000001"));
    expect(a.map((w) => [w.world.domain, w.zoneStatus])).toEqual([
      ["mine.example", "pending"],
    ]);
    const b = await fakeWorldsForOrg(ctxFor("orgb00000000001"));
    expect(b.map((w) => w.world.domain)).toEqual(["theirs.example"]);
  });

  it("refuses a non-minted context", async () => {
    if (!inst) return;
    await expect(
      fakeWorldsForOrg({ orgId: "orga00000000001" } as never),
    ).rejects.toThrow();
  });
});
