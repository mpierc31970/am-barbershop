// 14-10 (DOM-03; T-14-10-01): the fake DNS world on the real PocketBase binary. One world per
// domain in dns_fake_state plays the old host, the CDS zone, delegation, public resolvers,
// RDAP, HTTPS and SES; every fake function refuses under CDS_ENV=production.
import { recordKey } from "@cds/core/dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests } from "../src/client";
import { fakeHttpsProber } from "../src/dns/fake/prober";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeRegistryLookup } from "../src/dns/fake/registry";
import { fakeDnsResolver, fakeNameserverIp } from "../src/dns/fake/resolver";
import {
  FakeDnsRefused,
  fakeBreakEmailRecord,
  fakeChangeNameservers,
  fakeExpireIn,
  fakeSetDnssec,
  fakeSetHttps,
  fakeSetSesStatus,
  fakeWorldEmpty,
  fakeWorldGet,
  fakeWorldList,
  fakeWorldPatch,
  fakeWorldPut,
} from "../src/dns/fake-world";
import { PUBLIC_RESOLVERS } from "../src/dns/ports";
import { formatBind } from "@cds/core/dns";
import {
  seedFakeDomain,
  switchBack,
  switchToCds,
  switchToOther,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
const provider = fakeDnsProvider();
const resolver = fakeDnsResolver();
const registry = fakeRegistryLookup();
const OLD_NS = [fakeNameserverIp("old", 0)];
const CDS_NS = [fakeNameserverIp("cds", 0)];
const OTHER_NS = [fakeNameserverIp("other", 0)];
const PUBLIC = [...PUBLIC_RESOLVERS];

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
});

afterAll(async () => {
  await inst?.stop();
});

const keys = (rs: { type: string }[]) =>
  rs.map((r) => recordKey(r as never)).sort();

describe("fake DNS world (14-10)", () => {
  it("seeds a Google world answered by the old NS and the public resolvers", async () => {
    if (!inst) return;
    await seedFakeDomain("rivera.example", "google");
    const old = await resolver.resolve("rivera.example", "MX", {
      servers: OLD_NS,
    });
    expect(old.status).toBe("ok");
    expect(old.records.map((r) => r.value)).toEqual(["smtp.google.com"]);
    const pub = await resolver.resolve("rivera.example", "MX", {
      servers: PUBLIC,
    });
    expect(keys(pub.records)).toEqual(keys(old.records));
    const ns = await resolver.resolveNsIps("rivera.example");
    expect(ns.names).toEqual(["ns1.oldhost.test", "ns2.oldhost.test"]);
    expect(ns.ips).toEqual(["192.0.2.1", "192.0.2.2"]);
    expect(await resolver.ipsFor("ns2.oldhost.test")).toEqual(["192.0.2.2"]);
    expect(
      (await resolver.resolve("nope.rivera.example", "A", { servers: PUBLIC }))
        .status,
    ).toBe("nxdomain");
    expect(
      (await resolver.resolve("rivera.example", "AAAA", { servers: PUBLIC }))
        .status,
    ).toBe("nodata");
    expect(
      (await resolver.resolve("unknown.example", "A", { servers: PUBLIC }))
        .status,
    ).toBe("nxdomain");
    // www is a CNAME: an A query returns the CNAME.
    const www = await resolver.resolve("www.rivera.example", "A", {
      servers: PUBLIC,
    });
    expect(www.records[0]?.type).toBe("CNAME");
  });

  it("createZone is pending with two nameservers; importBind copies the old zone", async () => {
    if (!inst) return;
    const w = await seedFakeDomain("bakery.example", "m365");
    const z = await provider.createZone("bakery.example");
    expect(z.status).toBe("pending");
    expect(z.nameservers).toEqual([
      "ada.ns.cloudflare.test",
      "bob.ns.cloudflare.test",
    ]);
    expect(z.zoneId).toMatch(/^fz_[0-9a-f]{16}$/);
    // Idempotent while the zone exists.
    expect((await provider.createZone("bakery.example")).zoneId).toBe(z.zoneId);
    expect(await provider.zoneStatus(z.zoneId)).toBe("pending");

    const res = await provider.importBind(
      z.zoneId,
      formatBind("bakery.example", w.oldZone),
    );
    expect(res.added).toBe(w.oldZone.length);
    const listed = await provider.listRecords(z.zoneId);
    expect(keys(listed)).toEqual(keys(w.oldZone));
    expect(listed.every((r) => /^fr_\d+$/.test(r.id))).toBe(true);
    // Re-import adds nothing.
    const again = await provider.importBind(
      z.zoneId,
      formatBind("bakery.example", w.oldZone),
    );
    expect(again).toEqual({ added: 0, skipped: w.oldZone.length });
    // Export round-trips the keys.
    const exported = await provider.exportBind(z.zoneId);
    expect(exported).toContain("mail.protection.outlook.com.");
    expect(await provider.scanRecords(z.zoneId)).toEqual([]);
  });

  it("upsert matches by type+name (single) or full key (multi); apex NS refused; delete", async () => {
    if (!inst) return;
    await seedFakeDomain("studio.example", "none");
    const { zoneId } = await provider.createZone("studio.example");
    const c1 = await provider.upsertRecord(zoneId, {
      type: "CNAME",
      name: "shop.studio.example",
      value: "a.example.net",
    });
    const c2 = await provider.upsertRecord(zoneId, {
      type: "CNAME",
      name: "shop.studio.example",
      value: "b.example.net",
    });
    expect(c2.id).toBe(c1.id);
    await provider.upsertRecord(zoneId, {
      type: "TXT",
      name: "studio.example",
      value: "one",
    });
    await provider.upsertRecord(zoneId, {
      type: "TXT",
      name: "studio.example",
      value: "two",
    });
    expect((await provider.listRecords(zoneId)).length).toBe(3);
    await expect(
      provider.upsertRecord(zoneId, {
        type: "NS",
        name: "studio.example",
        value: "ns.evil.test",
      }),
    ).rejects.toThrow(/apex/);
    await expect(
      provider.upsertRecord(zoneId, {
        type: "A",
        name: "other.example",
        value: "198.18.0.1",
      }),
    ).rejects.toThrow(/outside/);
    await provider.deleteRecord(zoneId, c1.id);
    expect((await provider.listRecords(zoneId)).length).toBe(2);
    await provider.deleteZone(zoneId);
    expect((await fakeWorldGet("studio.example"))?.cdsZoneId).toBeNull();
    await expect(provider.listRecords(zoneId)).rejects.toThrow();
  });

  it("switchToCds activates the zone; public answers come from CDS; a broken record shows publicly only", async () => {
    if (!inst) return;
    const w = await seedFakeDomain("coach.example", "titan");
    const { zoneId } = await provider.createZone("coach.example");
    await provider.importBind(zoneId, formatBind("coach.example", w.oldZone));
    await provider.upsertRecord(zoneId, {
      type: "A",
      name: "coach.example",
      value: "203.0.113.200",
    });
    await switchToCds("coach.example");
    expect(await provider.zoneStatus(zoneId)).toBe("active");

    const pubA = await resolver.resolve("coach.example", "A", {
      servers: PUBLIC,
    });
    expect(pubA.records.map((r) => r.value).sort()).toContain("203.0.113.200");
    const ns = await resolver.resolveNsIps("coach.example");
    expect(ns.names).toEqual([
      "ada.ns.cloudflare.test",
      "bob.ns.cloudflare.test",
    ]);
    expect(ns.ips).toEqual(["198.51.100.1", "198.51.100.2"]);

    const cdsMx = await resolver.resolve("coach.example", "MX", {
      servers: CDS_NS,
    });
    const before = await resolver.resolve("coach.example", "MX", {
      servers: PUBLIC,
    });
    expect(keys(before.records)).toEqual(keys(cdsMx.records));

    await fakeBreakEmailRecord("coach.example");
    const after = await resolver.resolve("coach.example", "MX", {
      servers: PUBLIC,
    });
    expect(keys(after.records)).not.toEqual(keys(cdsMx.records));
    const cdsAfter = await resolver.resolve("coach.example", "MX", {
      servers: CDS_NS,
    });
    expect(keys(cdsAfter.records)).toEqual(keys(cdsMx.records));

    // Moved away after being active -> moved; back to old is moved too.
    await switchToOther("coach.example");
    expect(await provider.zoneStatus(zoneId)).toBe("moved");
    expect(
      (
        await resolver.resolve("coach.example", "A", { servers: OTHER_NS })
      ).records.map((r) => r.value),
    ).toEqual(["198.18.0.10"]);
    await switchBack("coach.example");
    expect((await resolver.resolveNsIps("coach.example")).ips[0]).toBe(
      "192.0.2.1",
    );
    // A server outside every fake range is an error.
    expect(
      (await resolver.resolve("coach.example", "A", { servers: ["10.0.0.1"] }))
        .status,
    ).toBe("error");
  });

  it("wildcard records answer any name under the parent", async () => {
    if (!inst) return;
    await seedFakeDomain("wild.example", "wildcard");
    const r = await resolver.resolve("anything.wild.example", "A", {
      servers: PUBLIC,
    });
    expect(r.status).toBe("ok");
    expect(r.records[0]?.name).toBe("anything.wild.example");
  });

  it("registry, prober, SES, DNSSEC and expiry come from the world", async () => {
    if (!inst) return;
    const now = new Date("2026-10-16T12:00:00.000Z");
    await seedFakeDomain("salon.example", "dnssec", {}, now);
    expect(await registry.lookup("salon.example")).toMatchObject({
      found: true,
      registrar: "GoDaddy",
      dnssec: true,
    });
    expect((await registry.lookup("missing.example")).found).toBe(false);
    await fakeSetDnssec("salon.example", false);
    expect((await registry.lookup("salon.example")).dnssec).toBe(false);
    await fakeExpireIn("salon.example", 10, now);
    expect((await registry.lookup("salon.example")).expiresAt).toBe(
      "2026-10-26T12:00:00.000Z",
    );

    const prober = fakeHttpsProber({
      expectedProof: (h) => `proof-for-${h}`,
    });
    expect((await prober.probe("salon.example")).ok).toBe(false);
    await fakeSetHttps("salon.example", true);
    const ok = await prober.probe("www.salon.example");
    expect(ok).toMatchObject({
      ok: true,
      status: 200,
      proof: "proof-for-www.salon.example",
      error: null,
    });
    expect(ok.certDaysLeft).toBeGreaterThan(0);
    expect((await prober.probe("shop.salon.example")).ok).toBe(false);
    expect((await fakeHttpsProber().probe("salon.example")).proof).toBeNull();

    const pending = await fakeSetSesStatus("salon.example", "pending");
    expect(pending.ses.tokens).toHaveLength(3);
    const verified = await fakeSetSesStatus("salon.example", "verified");
    expect(verified.ses.tokens).toEqual(pending.ses.tokens);
    expect(
      (await fakeSetSesStatus("salon.example", "none")).ses.tokens,
    ).toEqual([]);
  });

  it("put/patch/list/changeNameservers keep one row per domain", async () => {
    if (!inst) return;
    await fakeWorldPut({ ...fakeWorldEmpty("Patch.Example."), registrar: "X" });
    const p = await fakeWorldPatch("patch.example", { https: "ok" });
    expect(p).toMatchObject({
      domain: "patch.example",
      registrar: "X",
      https: "ok",
    });
    const list = await fakeWorldList();
    expect(list.filter((w) => w.domain === "patch.example")).toHaveLength(1);
    await fakeChangeNameservers("patch.example", "other");
    expect((await fakeWorldGet("patch.example"))?.delegatedTo).toBe("other");
  });

  it("every fake function refuses under CDS_ENV=production", async () => {
    if (!inst) return;
    const saved = process.env.CDS_ENV;
    process.env.CDS_ENV = "production";
    try {
      const calls: (() => unknown)[] = [
        () => fakeWorldEmpty("x.example"),
        () => fakeWorldGet("rivera.example"),
        () => fakeWorldPut(fakeWorldEmpty("x.example")),
        () => fakeWorldPatch("x.example", {}),
        () => fakeWorldList(),
        () => fakeChangeNameservers("rivera.example", "cds"),
        () => fakeBreakEmailRecord("rivera.example"),
        () => fakeSetDnssec("rivera.example", true),
        () => fakeSetHttps("rivera.example", true),
        () => fakeSetSesStatus("rivera.example", "pending"),
        () => fakeExpireIn("rivera.example", 1),
        () => provider.createZone("rivera.example"),
        () => provider.zoneStatus("fz_x"),
        () => provider.listRecords("fz_x"),
        () => resolver.resolve("rivera.example", "A", { servers: PUBLIC }),
        () => resolver.resolveNsIps("rivera.example"),
        () => resolver.ipsFor("ns1.oldhost.test"),
        () => registry.lookup("rivera.example"),
        () => fakeHttpsProber().probe("rivera.example"),
      ];
      for (const call of calls) {
        await expect(
          (async () => {
            await call();
          })(),
        ).rejects.toBeInstanceOf(FakeDnsRefused);
      }
    } finally {
      if (saved === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved;
    }
  });
});
