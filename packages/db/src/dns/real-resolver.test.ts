// 14-12 (DOM-05, DOM-06; T-14-12-01, T-14-12-04): the real resolver against an injected fake
// node:dns Resolver. No network: every query goes to the fake below.
import { describe, expect, it } from "vitest";
import {
  isPublicIp,
  realDnsResolver,
  UnsafeResolverTarget,
  type MakeResolver,
  type ResolverLike,
} from "./real-resolver";

function dnsErr(code: string): Error {
  return Object.assign(new Error(code), { code });
}

type Table = Record<string, unknown>; // `${method} ${name}` -> answer or Error

function fakeWorld(table: Table) {
  const made: {
    opts: { timeout: number; tries: number };
    servers: string[];
  }[] = [];
  const calls: string[] = [];
  const make: MakeResolver = (opts) => {
    const entry = { opts, servers: [] as string[] };
    made.push(entry);
    const answer = (method: string) => async (name: string) => {
      calls.push(`${method} ${name}`);
      const v = table[`${method} ${name}`];
      if (v === undefined) throw dnsErr("ENODATA");
      if (v instanceof Error) throw v;
      return v;
    };
    const r = {
      setServers(s: string[]) {
        entry.servers = s;
      },
      resolve4: answer("resolve4"),
      resolve6: answer("resolve6"),
      resolveCname: answer("resolveCname"),
      resolveMx: answer("resolveMx"),
      resolveTxt: answer("resolveTxt"),
      resolveNs: answer("resolveNs"),
      resolveSoa: answer("resolveSoa"),
      resolveCaa: answer("resolveCaa"),
      resolveSrv: answer("resolveSrv"),
    };
    return r as unknown as ResolverLike;
  };
  return { make, made, calls };
}

describe("isPublicIp (choice 2)", () => {
  it("accepts public unicast", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "82.180.132.176",
      "2606:4700::1111",
    ]) {
      expect(isPublicIp(ip)).toBe(true);
    }
  });

  it("refuses private, loopback, CGNAT, link-local, metadata, multicast, reserved", () => {
    for (const ip of [
      "10.0.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "127.0.0.1",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "192.0.2.10",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.7",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "example.com",
      "",
      "1.2.3",
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("an IPv4-mapped public address is public", () => {
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIp("172.32.0.1")).toBe(true);
    expect(isPublicIp("100.128.0.1")).toBe(true);
  });
});

describe("realDnsResolver.resolve (choice 1)", () => {
  it("throws UnsafeResolverTarget before any query for a private server", async () => {
    const w = fakeWorld({});
    const r = realDnsResolver({ makeResolver: w.make });
    await expect(
      r.resolve("example.com", "A", { servers: ["10.0.0.5"] }),
    ).rejects.toBeInstanceOf(UnsafeResolverTarget);
    await expect(
      r.resolve("example.com", "A", {
        servers: ["8.8.8.8", "169.254.169.254"],
      }),
    ).rejects.toBeInstanceOf(UnsafeResolverTarget);
    await expect(
      r.resolve("example.com", "A", { servers: ["ns1.example.com"] }),
    ).rejects.toBeInstanceOf(UnsafeResolverTarget);
    expect(w.made).toHaveLength(0);
    expect(w.calls).toHaveLength(0);
  });

  it("builds a fresh resolver per query with tries 1, the timeout and the given servers", async () => {
    const w = fakeWorld({ "resolve4 example.com": ["93.184.216.34"] });
    const r = realDnsResolver({ makeResolver: w.make, timeoutMs: 1234 });
    await r.resolve("example.com", "A", { servers: ["198.41.0.4"] });
    await r.resolve("example.com", "A", { servers: ["198.41.0.4"] });
    expect(w.made).toHaveLength(2);
    expect(w.made[0]?.opts).toEqual({ timeout: 1234, tries: 1 });
    expect(w.made[0]?.servers).toEqual(["198.41.0.4"]);
  });

  it("joins TXT chunks into one record", async () => {
    const w = fakeWorld({
      "resolveTxt example.com": [["v=spf1 ", "include:x ~all"]],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    const a = await r.resolve("Example.com.", "TXT", { servers: ["8.8.8.8"] });
    expect(a.status).toBe("ok");
    expect(a.records).toEqual([
      { type: "TXT", name: "example.com", value: "v=spf1 include:x ~all" },
    ]);
  });

  it("maps ENODATA -> nodata and ENOTFOUND -> nxdomain, other -> error", async () => {
    const w = fakeWorld({
      "resolveCname gone.example.com": dnsErr("ENOTFOUND"),
      "resolveCname slow.example.com": dnsErr("ETIMEOUT"),
      "resolve4 slow.example.com": dnsErr("ETIMEOUT"),
    });
    const r = realDnsResolver({ makeResolver: w.make });
    const s = { servers: ["8.8.8.8"] };
    expect(await r.resolve("example.com", "MX", s)).toEqual({
      status: "nodata",
      records: [],
    });
    expect(await r.resolve("gone.example.com", "A", s)).toEqual({
      status: "nxdomain",
      records: [],
    });
    expect(await r.resolve("slow.example.com", "A", s)).toEqual({
      status: "error",
      records: [],
    });
  });

  it("asks CNAME first and returns only the CNAME when one exists", async () => {
    const w = fakeWorld({
      "resolveCname www.example.com": ["Example.com."],
      "resolve4 www.example.com": ["1.2.3.4"],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    const a = await r.resolve("www.example.com", "A", { servers: ["8.8.8.8"] });
    expect(a.records).toEqual([
      { type: "CNAME", name: "www.example.com", value: "example.com" },
    ]);
    expect(w.calls).toEqual(["resolveCname www.example.com"]);
  });

  it("maps MX, SRV and CAA to DnsRecord", async () => {
    const w = fakeWorld({
      "resolveMx example.com": [
        { priority: 10, exchange: "Mx1.Mail.example." },
      ],
      "resolveSrv _sip._tcp.example.com": [
        { priority: 100, weight: 1, port: 443, name: "sip.example.net" },
      ],
      "resolveCaa example.com": [
        { critical: 0, issue: "letsencrypt.org" },
        { critical: 128, iodef: "mailto:sec@example.com" },
      ],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    const s = { servers: ["8.8.8.8"] };
    expect((await r.resolve("example.com", "MX", s)).records).toEqual([
      {
        type: "MX",
        name: "example.com",
        value: "mx1.mail.example",
        priority: 10,
      },
    ]);
    expect(
      (await r.resolve("_sip._tcp.example.com", "SRV", s)).records,
    ).toEqual([
      {
        type: "SRV",
        name: "_sip._tcp.example.com",
        value: "1 443 sip.example.net",
        priority: 100,
      },
    ]);
    expect((await r.resolve("example.com", "CAA", s)).records).toEqual([
      { type: "CAA", name: "example.com", value: '0 issue "letsencrypt.org"' },
      {
        type: "CAA",
        name: "example.com",
        value: '128 iodef "mailto:sec@example.com"',
      },
    ]);
  });
});

describe("realDnsResolver.resolveNsIps / ipsFor", () => {
  it("resolves NS names through the public resolvers and drops non-public IPs", async () => {
    const w = fakeWorld({
      "resolveNs example.com": ["ns1.host.example.", "ns2.evil.example"],
      "resolve4 ns1.host.example": ["198.41.0.4", "10.0.0.9"],
      "resolve4 ns2.evil.example": ["127.0.0.1"],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    const out = await r.resolveNsIps("example.com");
    expect(out).toEqual({
      names: ["ns1.host.example", "ns2.evil.example"],
      ips: ["198.41.0.4"],
    });
    expect(w.made[0]?.servers).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("zero public IPs -> empty list (caller fails safe)", async () => {
    const w = fakeWorld({
      "resolveNs example.com": ["ns.local.example"],
      "resolve4 ns.local.example": ["169.254.169.254"],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    expect((await r.resolveNsIps("example.com")).ips).toEqual([]);
    const w2 = fakeWorld({ "resolveNs example.com": dnsErr("ENOTFOUND") });
    expect(
      await realDnsResolver({ makeResolver: w2.make }).resolveNsIps(
        "example.com",
      ),
    ).toEqual({ names: [], ips: [] });
  });

  it("ipsFor is a public A lookup", async () => {
    const w = fakeWorld({
      "resolve4 example.com": ["82.180.132.176", "192.168.0.2"],
    });
    const r = realDnsResolver({ makeResolver: w.make });
    expect(await r.ipsFor("example.com")).toEqual(["82.180.132.176"]);
    expect(await r.ipsFor("missing.example.com")).toEqual([]);
  });
});
