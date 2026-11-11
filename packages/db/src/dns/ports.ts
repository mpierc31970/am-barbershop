// packages/db/src/dns/ports.ts (P14, DOM-03, DOM-04).
// Owner: 14-10 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The external-world seam for DNS (D55, D289): four ports, each with a fake adapter over
// `dns_fake_state` (./fake, 14-10) and a real one (Cloudflare 14-11, resolver/RDAP/prober
// 14-12). factory.ts picks one from env; nothing else imports an adapter.
//
// DOM-04, D56: CDS never buys, renews or moves a domain between registrars. The provider port
// manages DNS zones only, and ports.test.ts fails if any method name for those registrar
// actions appears anywhere in the dns sources.
import type { DnsRecord, RType } from "@cds/core/dns";

/** A zone as the DNS host sees it: waiting for delegation, serving, or delegated away again. */
export type ZoneStatus = "pending" | "active" | "moved";

/** A record stored at the DNS host, with the host's id for it. */
export type ProviderRecord = DnsRecord & { id: string };

export type DnsProviderName = "fake" | "cloudflare";

/** The DNS host CDS runs tenant zones on (Cloudflare free plan, D55). Zone operations only. */
export interface DnsProvider {
  readonly name: DnsProviderName;
  /** Create (or return the existing) zone for a domain: id, assigned nameservers, status. */
  createZone(
    domain: string,
  ): Promise<{ zoneId: string; nameservers: string[]; status: ZoneStatus }>;
  zoneStatus(zoneId: string): Promise<ZoneStatus>;
  listRecords(zoneId: string): Promise<ProviderRecord[]>;
  /** Matched by type + name (+ value for multi-value types); updates TTL or adds. */
  upsertRecord(zoneId: string, r: DnsRecord): Promise<ProviderRecord>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
  importBind(
    zoneId: string,
    zoneFile: string,
  ): Promise<{ added: number; skipped: number }>;
  exportBind(zoneId: string): Promise<string>;
  /** Records the host found by its own scan (fake: none; Cloudflare: the scan review list). */
  scanRecords(zoneId: string): Promise<DnsRecord[]>;
  deleteZone(zoneId: string): Promise<void>;
}

/** The method names of DnsProvider, exactly (ports.test.ts; a type check keeps it exhaustive). */
export const DNS_PROVIDER_METHODS = Object.freeze([
  "createZone",
  "zoneStatus",
  "listRecords",
  "upsertRecord",
  "deleteRecord",
  "importBind",
  "exportBind",
  "scanRecords",
  "deleteZone",
] as const satisfies readonly Exclude<keyof DnsProvider, "name">[]);

// Compile-time proof the list above names every method (no method can be added silently).
type MissingMethod = Exclude<
  Exclude<keyof DnsProvider, "name">,
  (typeof DNS_PROVIDER_METHODS)[number]
>;
const _allMethodsListed: [MissingMethod] extends [never] ? true : never = true;
void _allMethodsListed;

export type DnsAnswer = {
  status: "ok" | "nxdomain" | "nodata" | "error";
  records: DnsRecord[];
};

/** The public resolvers step 7 requires to agree (P14-P8). */
export const PUBLIC_RESOLVERS: readonly string[] = Object.freeze([
  "1.1.1.1",
  "8.8.8.8",
]);

export interface DnsResolver {
  /** Ask the given servers (public resolvers, or a zone's authoritative NS IPs). */
  resolve(
    name: string,
    type: RType,
    opts: { servers: string[] },
  ): Promise<DnsAnswer>;
  /** The domain's delegated nameservers and their IPs, as the public DNS sees them. */
  resolveNsIps(domain: string): Promise<{ names: string[]; ips: string[] }>;
  ipsFor(hostname: string): Promise<string[]>;
}

export type RegistryInfo = {
  found: boolean;
  registrar: string | null;
  expiresAt: string | null;
  /** RDAP `secureDNS.delegationSigned`; null when unknown (P14-P10, P14-P37). */
  dnssec: boolean | null;
};

/** RDAP (falling back to DoH for DNSSEC). Read-only. */
export interface RegistryLookup {
  lookup(domain: string): Promise<RegistryInfo>;
}

export type ProbeResult = {
  ok: boolean;
  status: number | null;
  /** The body of the host proof path (`cds-host` MAC), when served. */
  proof: string | null;
  certDaysLeft: number | null;
  /** An error class name or short code; never a host or a value. */
  error: string | null;
};

/** HTTPS probe through the CDS edge (P14-P9). */
export interface HttpsProber {
  probe(host: string): Promise<ProbeResult>;
}
