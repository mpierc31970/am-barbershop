// packages/db/src/dns/real-resolver.ts (P14, DOM-05, DOM-06).
// Owner: 14-12 (14-EXECUTOR-BRIEF "Module seams"). Not in the dns barrel: only factory.ts imports it.
//
// The real DnsResolver over node:dns/promises (RESEARCH Pattern 2, Pitfall 5; 14-12 choices 1-2):
// - Every query builds a fresh Resolver({ timeout, tries: 1 }): no caching resolver ever
//   answers for a snapshot or a gate (T-14-12-04).
// - setServers accepts IPs only, and every server is checked by isPublicIp first, so an
//   owner-pointed NS at 127.0.0.1, 10/8 or 169.254.169.254 (cloud metadata) is never asked
//   (T-14-12-01). An unsafe server throws UnsafeResolverTarget before any query.
// - NS names are resolved to IPs through the public resolvers (1.1.1.1, 8.8.8.8); non-public
//   IPs are dropped; zero left -> { ips: [] } and the caller fails safe.
// - CNAME is asked first: a CNAME answer excludes every other type at that name.
// - DS is never queried here (Node throws for it); G3 comes from RDAP/DoH (rdap.ts, P14-P10).
// Errors map ENOTFOUND -> nxdomain, ENODATA -> nodata, anything else -> error. Nothing logs.
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import {
  fqdn,
  normalizeRecord,
  unquoteTxt,
  type DnsRecord,
  type RType,
} from "@cds/core/dns";
import { PUBLIC_RESOLVERS, type DnsAnswer, type DnsResolver } from "./ports";

/** A server (or NS IP) that is not a public address; nothing was queried. */
export class UnsafeResolverTarget extends Error {
  constructor() {
    super("Refused a non-public DNS server address");
    this.name = "UnsafeResolverTarget";
  }
}

/** The subset of node:dns/promises Resolver this adapter uses (tests inject a fake). */
export interface ResolverLike {
  setServers(servers: string[]): void;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  resolveCname(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<{ priority: number; exchange: string }[]>;
  resolveTxt(name: string): Promise<string[][]>;
  resolveNs(name: string): Promise<string[]>;
  resolveSoa(name: string): Promise<{
    nsname: string;
    hostmaster: string;
    serial: number;
    refresh: number;
    retry: number;
    expire: number;
    minttl: number;
  }>;
  resolveCaa(name: string): Promise<
    {
      critical: number;
      issue?: string;
      issuewild?: string;
      iodef?: string;
      contactemail?: string;
      contactphone?: string;
    }[]
  >;
  resolveSrv(
    name: string,
  ): Promise<
    { priority: number; weight: number; port: number; name: string }[]
  >;
}

export type MakeResolver = (opts: {
  timeout: number;
  tries: number;
}) => ResolverLike;

// ---------------------------------------------------------------------------------------------
// isPublicIp (choice 2)
// ---------------------------------------------------------------------------------------------

/** [network, prefix length] blocks that are never queried or connected to. */
const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return false;
  for (const [net, len] of V4_BLOCKED) {
    const base = v4ToInt(net) as number;
    const size = 2 ** (32 - len);
    if (n >= base && n < base + size) return false;
  }
  return true;
}

/** Eight 16-bit words, or null when not a valid IPv6 literal (zone ids refused). */
function v6Words(ip: string): number[] | null {
  if (ip.includes("%")) return null;
  let s = ip.toLowerCase();
  const tail: number[] = [];
  const v4m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4m) {
    const n = v4ToInt(v4m[1] as string);
    if (n === null) return null;
    tail.push(Math.floor(n / 65536), n % 65536);
    s = s.slice(0, s.length - (v4m[1] as string).length);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string): number[] | null => {
    if (h === "") return [];
    const out: number[] = [];
    for (const w of h.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(w)) return null;
      out.push(parseInt(w, 16));
    }
    return out;
  };
  const head = parse(halves[0] as string);
  if (head === null) return null;
  if (halves.length === 1) {
    const all = [...head, ...tail];
    return all.length === 8 ? all : null;
  }
  const rest = parse(halves[1] as string);
  if (rest === null) return null;
  const known = head.length + rest.length + tail.length;
  if (known > 7) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
}

function isPublicV6(ip: string): boolean {
  const w = v6Words(ip);
  if (!w) return false;
  const [w0, w1, w2, w3, w4, w5] = w as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (w.every((x) => x === 0)) return false; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return false; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d: judge the IPv4 address.
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0) {
    if (w5 === 0xffff || w5 === 0) {
      const v4 = `${w[6]! >> 8}.${w[6]! & 255}.${w[7]! >> 8}.${w[7]! & 255}`;
      return isPublicV4(v4);
    }
  }
  if ((w0 & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((w0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((w0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (w0 === 0x2001 && w1 === 0x0db8) return false; // 2001:db8::/32 documentation
  return true;
}

/**
 * True only for a globally routable unicast address. Refuses loopback, RFC1918, CGNAT,
 * link-local (incl. 169.254.169.254), ULA, multicast, documentation and reserved ranges,
 * and IPv4-mapped forms of any of them (choice 2, T-14-12-01). Hostnames are refused.
 */
export function isPublicIp(ip: string): boolean {
  if (typeof ip !== "string") return false;
  const s = ip.trim();
  const fam = isIP(s);
  if (fam === 4) return isPublicV4(s);
  if (fam === 6) return isPublicV6(s);
  return false;
}

// ---------------------------------------------------------------------------------------------
// realDnsResolver (choice 1)
// ---------------------------------------------------------------------------------------------

const defaultMakeResolver: MakeResolver = (opts) =>
  new Resolver(opts) as unknown as ResolverLike;

function errCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return "";
}

function statusOf(err: unknown): DnsAnswer["status"] {
  const c = errCode(err);
  if (c === "ENOTFOUND") return "nxdomain";
  if (c === "ENODATA") return "nodata";
  return "error";
}

async function query(
  r: ResolverLike,
  name: string,
  type: RType,
): Promise<DnsRecord[]> {
  const rec = (value: string, priority?: number): DnsRecord =>
    normalizeRecord(
      priority === undefined
        ? { type, name, value }
        : { type, name, value, priority },
    );
  switch (type) {
    case "A":
      return (await r.resolve4(name)).map((v) => rec(v));
    case "AAAA":
      return (await r.resolve6(name)).map((v) => rec(v));
    case "CNAME":
      return (await r.resolveCname(name)).map((v) => rec(v));
    case "NS":
      return (await r.resolveNs(name)).map((v) => rec(v));
    case "MX":
      return (await r.resolveMx(name)).map((m) => rec(m.exchange, m.priority));
    case "TXT":
      return (await r.resolveTxt(name)).map((chunks) =>
        rec(unquoteTxt(chunks)),
      );
    case "SRV":
      return (await r.resolveSrv(name)).map((s) =>
        rec(`${s.weight} ${s.port} ${s.name}`, s.priority),
      );
    case "CAA":
      return (await r.resolveCaa(name)).flatMap((c) => {
        const tag = (
          [
            "issue",
            "issuewild",
            "iodef",
            "contactemail",
            "contactphone",
          ] as const
        ).find((t) => typeof c[t] === "string");
        if (!tag) return [];
        const v = (c[tag] as string)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        return [rec(`${c.critical ?? 0} ${tag} "${v}"`)];
      });
    case "SOA": {
      const s = await r.resolveSoa(name);
      return [
        rec(
          `${s.nsname} ${s.hostmaster} ${s.serial} ${s.refresh} ${s.retry} ${s.expire} ${s.minttl}`,
        ),
      ];
    }
  }
}

export type RealResolverOptions = {
  makeResolver?: MakeResolver;
  /** Per-query timeout in ms (T-14-12-03). */
  timeoutMs?: number;
  /** Public resolvers used for NS-name and host lookups (default 1.1.1.1, 8.8.8.8). */
  publicServers?: readonly string[];
};

export function realDnsResolver(opts: RealResolverOptions = {}): DnsResolver {
  const make = opts.makeResolver ?? defaultMakeResolver;
  const timeout = opts.timeoutMs ?? 3000;
  const publicServers = [...(opts.publicServers ?? PUBLIC_RESOLVERS)];

  /** A fresh resolver bound to vetted servers; throws before any query on a bad server. */
  function fresh(servers: readonly string[]): ResolverLike {
    if (servers.length === 0) throw new UnsafeResolverTarget();
    for (const s of servers) {
      if (!isPublicIp(s)) throw new UnsafeResolverTarget();
    }
    const r = make({ timeout, tries: 1 });
    r.setServers(servers.map((s) => s.trim()));
    return r;
  }

  async function publicA(r: ResolverLike, host: string): Promise<string[]> {
    try {
      return (await r.resolve4(host)).filter(isPublicIp);
    } catch {
      return [];
    }
  }

  return {
    async resolve(name, type, { servers }): Promise<DnsAnswer> {
      const r = fresh(servers);
      const n = fqdn(name);
      if (type !== "CNAME") {
        try {
          const cn = await query(r, n, "CNAME");
          if (cn.length > 0) return { status: "ok", records: cn };
        } catch (err) {
          const st = statusOf(err);
          if (st === "nxdomain") return { status: "nxdomain", records: [] };
          // nodata (no CNAME here) or a transient error: ask for the type itself.
        }
      }
      try {
        const records = await query(r, n, type);
        return { status: records.length > 0 ? "ok" : "nodata", records };
      } catch (err) {
        return { status: statusOf(err), records: [] };
      }
    },

    async resolveNsIps(domain): Promise<{ names: string[]; ips: string[] }> {
      const r = fresh(publicServers);
      let names: string[];
      try {
        names = (await r.resolveNs(fqdn(domain))).map((n) => fqdn(n));
      } catch {
        return { names: [], ips: [] };
      }
      const ipLists = await Promise.all(names.map((n) => publicA(r, n)));
      const ips = [...new Set(ipLists.flat())];
      return { names, ips };
    },

    async ipsFor(hostname): Promise<string[]> {
      const r = fresh(publicServers);
      return publicA(r, fqdn(hostname));
    },
  };
}
