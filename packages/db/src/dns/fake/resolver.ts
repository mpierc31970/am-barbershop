// packages/db/src/dns/fake/resolver.ts (P14, DOM-03; 14-10 choice 4).
// The fake DNS: which zone answers depends on the server asked.
//   192.0.2.<n>     the old host's nameservers      -> world.oldZone
//   198.51.100.<n>  the CDS (Cloudflare) nameservers -> world.cdsZone
//   203.0.113.<n>   some other host's nameservers   -> world.otherZone
//   PUBLIC_RESOLVERS (1.1.1.1, 8.8.8.8)             -> the zone `delegatedTo` names, with
//                                                     `publicOverrides` applied on top
// So "break an email record" is visible to the public resolvers only, while an
// authoritative read of the CDS zone still matches. Unknown domains are NXDOMAIN; a wildcard
// record answers any name under its parent that has no records of its own.
import { fqdn, type DnsRecord, type RType } from "@cds/core/dns";
import { PUBLIC_RESOLVERS, type DnsAnswer, type DnsResolver } from "../ports";
import {
  normalizeDomain,
  refuseInProduction,
  storeList,
  withoutId,
  type FakeDelegation,
  type FakeWorld,
} from "./store";

const NS_NET: Readonly<Record<FakeDelegation, string>> = {
  old: "192.0.2.",
  cds: "198.51.100.",
  other: "203.0.113.",
};

/** The fake IP of the i-th nameserver of a zone (1-based last octet). */
export function fakeNameserverIp(zone: FakeDelegation, i: number): string {
  return `${NS_NET[zone]}${i + 1}`;
}

function nameservers(w: FakeWorld, zone: FakeDelegation): string[] {
  if (zone === "old") return w.oldNameservers;
  if (zone === "cds") return w.cdsZoneId ? w.cdsNameservers : [];
  return w.otherNameservers;
}

function zoneRecords(w: FakeWorld, zone: FakeDelegation): DnsRecord[] | null {
  if (zone === "old") return w.oldZone;
  if (zone === "cds") {
    return w.cdsZoneId ? w.cdsZone.map(withoutId) : null;
  }
  return w.otherZone;
}

/** The delegated zone with public overrides replacing every record of the same type+name. */
function publicRecords(w: FakeWorld): DnsRecord[] | null {
  const base = zoneRecords(w, w.delegatedTo);
  if (!base) return null;
  const slot = (r: DnsRecord): string => `${r.type} ${fqdn(r.name)}`;
  const overridden = new Set(w.publicOverrides.map(slot));
  return [
    ...base.filter((r) => !overridden.has(slot(r))),
    ...w.publicOverrides,
  ];
}

function worldOf(worlds: FakeWorld[], name: string): FakeWorld | null {
  let best: FakeWorld | null = null;
  for (const w of worlds) {
    if (name === w.domain || name.endsWith(`.${w.domain}`)) {
      if (!best || w.domain.length > best.domain.length) best = w;
    }
  }
  return best;
}

function serverZone(server: string): FakeDelegation | "public" | null {
  if (PUBLIC_RESOLVERS.includes(server)) return "public";
  for (const z of ["old", "cds", "other"] as const) {
    if (server.startsWith(NS_NET[z])) return z;
  }
  return null;
}

function answer(
  w: FakeWorld,
  records: DnsRecord[],
  nsNames: string[],
  qname: string,
  type: RType,
): DnsAnswer {
  const all = [...records];
  if (!all.some((r) => r.type === "NS" && fqdn(r.name) === w.domain)) {
    for (const ns of nsNames)
      all.push({ type: "NS", name: w.domain, value: ns });
  }
  let at = all.filter((r) => fqdn(r.name) === qname);
  if (at.length === 0 && qname !== w.domain) {
    const wild = `*.${qname.slice(qname.indexOf(".") + 1)}`;
    at = all
      .filter((r) => fqdn(r.name) === wild)
      .map((r) => ({ ...r, name: qname }));
  }
  if (at.length === 0) return { status: "nxdomain", records: [] };
  const typed = at.filter((r) => r.type === type);
  if (typed.length > 0) return { status: "ok", records: typed };
  const cname = at.filter((r) => r.type === "CNAME");
  if (cname.length > 0) return { status: "ok", records: cname };
  return { status: "nodata", records: [] };
}

export function fakeDnsResolver(): DnsResolver {
  return {
    async resolve(name, type, opts) {
      refuseInProduction();
      const qname = normalizeDomain(name);
      const server = opts.servers[0];
      const zone = server === undefined ? null : serverZone(server);
      if (zone === null) return { status: "error", records: [] };
      const w = worldOf(await storeList(), qname);
      if (!w) return { status: "nxdomain", records: [] };
      if (zone === "public") {
        const recs = publicRecords(w);
        if (!recs) return { status: "error", records: [] };
        return answer(w, recs, nameservers(w, w.delegatedTo), qname, type);
      }
      const recs = zoneRecords(w, zone);
      if (!recs) return { status: "error", records: [] };
      return answer(w, recs, nameservers(w, zone), qname, type);
    },

    async resolveNsIps(domain) {
      refuseInProduction();
      const d = normalizeDomain(domain);
      const w = (await storeList()).find((x) => x.domain === d);
      if (!w) return { names: [], ips: [] };
      const names = nameservers(w, w.delegatedTo);
      return {
        names: [...names],
        ips: names.map((_, i) => fakeNameserverIp(w.delegatedTo, i)),
      };
    },

    async ipsFor(hostname) {
      refuseInProduction();
      const h = normalizeDomain(hostname);
      const worlds = await storeList();
      for (const w of worlds) {
        for (const z of ["old", "cds", "other"] as const) {
          const i = nameservers(w, z).indexOf(h);
          if (i >= 0) return [fakeNameserverIp(z, i)];
        }
      }
      const w = worldOf(worlds, h);
      const recs = w ? publicRecords(w) : null;
      if (!w || !recs) return [];
      const a = answer(w, recs, [], h, "A");
      return a.records.filter((r) => r.type === "A").map((r) => r.value);
    },
  };
}
