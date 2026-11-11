// 14-10 choice 7 (DOM-03): the one test helper that drives the fake DNS world in
// `dns_fake_state`. Later plans import it and never edit it (extend with a local helper).
// Record sets are defined here (no dependency on 14-05's fixtures). All names fictitious.
import type { DnsRecord } from "@cds/core/dns";
import {
  fakeChangeNameservers,
  fakeWorldEmpty,
  fakeWorldPut,
  type FakeWorld,
} from "../../src/dns/fake-world";

export type FakeDomainPreset =
  | "google"
  | "m365"
  | "titan"
  | "zoho"
  | "none"
  | "forwarding"
  | "dnssec"
  | "two_spf"
  | "wildcard";

export const FAKE_OLD_NAMESERVERS = Object.freeze([
  "ns1.oldhost.test",
  "ns2.oldhost.test",
]);
export const FAKE_OTHER_NAMESERVERS = Object.freeze([
  "ns1.otherhost.test",
  "ns2.otherhost.test",
]);
/** The old site's address (RFC 2544 benchmarking range; not an NS range of the fake). */
export const FAKE_OLD_SITE_IP = "198.18.0.10";

const DAY_MS = 86_400_000;

function site(d: string): DnsRecord[] {
  return [
    { type: "A", name: d, value: FAKE_OLD_SITE_IP, ttl: 3600 },
    { type: "CNAME", name: `www.${d}`, value: d, ttl: 3600 },
  ];
}

function txt(name: string, value: string): DnsRecord {
  return { type: "TXT", name, value, ttl: 3600 };
}

function mx(name: string, value: string, priority: number): DnsRecord {
  return { type: "MX", name, value, priority, ttl: 3600 };
}

/** The old host's records for one preset. */
export function presetRecords(
  d: string,
  preset: FakeDomainPreset,
): DnsRecord[] {
  const google = [
    mx(d, "smtp.google.com", 1),
    txt(d, "v=spf1 include:_spf.google.com ~all"),
    txt(d, "google-site-verification=fakeverification123"),
    txt(`google._domainkey.${d}`, "v=DKIM1; k=rsa; p=MIIBfakekey"),
  ];
  switch (preset) {
    case "google":
    case "dnssec":
      return [...site(d), ...google];
    case "m365": {
      const label = d.replace(/\./g, "-");
      return [
        ...site(d),
        mx(d, `${label}.mail.protection.outlook.com`, 0),
        txt(d, "v=spf1 include:spf.protection.outlook.com -all"),
        txt(d, "MS=ms12345678"),
        {
          type: "CNAME",
          name: `autodiscover.${d}`,
          value: "autodiscover.outlook.com",
          ttl: 3600,
        },
      ];
    }
    case "titan":
      return [
        ...site(d),
        mx(d, "mx1.titan.email", 10),
        mx(d, "mx2.titan.email", 20),
        txt(d, "v=spf1 include:spf.titan.email ~all"),
      ];
    case "zoho":
      return [
        ...site(d),
        mx(d, "mx.zoho.com", 10),
        mx(d, "mx2.zoho.com", 20),
        mx(d, "mx3.zoho.com", 50),
        txt(d, "v=spf1 include:zoho.com ~all"),
      ];
    case "forwarding":
      return [
        ...site(d),
        mx(d, "mx1.improvmx.com", 10),
        mx(d, "mx2.improvmx.com", 20),
        txt(d, "v=spf1 include:spf.improvmx.com ~all"),
      ];
    case "two_spf":
      return [
        ...site(d),
        mx(d, "smtp.google.com", 1),
        txt(d, "v=spf1 include:_spf.google.com ~all"),
        txt(d, "v=spf1 include:spf.titan.email ~all"),
      ];
    case "wildcard":
      return [
        ...site(d),
        { type: "A", name: `*.${d}`, value: FAKE_OLD_SITE_IP, ttl: 3600 },
      ];
    case "none":
      return site(d);
  }
}

/**
 * Seed (or replace) a fake domain: delegated to the old host, registered at "GoDaddy",
 * expiring in a year, HTTPS failing until the CDS edge serves it, no SES identity.
 */
export async function seedFakeDomain(
  domain: string,
  preset: FakeDomainPreset,
  overrides: Partial<Omit<FakeWorld, "domain">> = {},
  now: Date = new Date(),
): Promise<FakeWorld> {
  const base = fakeWorldEmpty(domain);
  const d = base.domain;
  return fakeWorldPut({
    ...base,
    registrar: "GoDaddy",
    expiresAt: new Date(now.getTime() + 365 * DAY_MS).toISOString(),
    dnssec: preset === "dnssec",
    oldNameservers: [...FAKE_OLD_NAMESERVERS],
    oldZone: presetRecords(d, preset),
    otherNameservers: [...FAKE_OTHER_NAMESERVERS],
    otherZone: site(d),
    certDaysLeft: 0,
    ...overrides,
    domain: d,
  });
}

/** The owner points the nameservers at CDS. */
export function switchToCds(domain: string): Promise<FakeWorld> {
  return fakeChangeNameservers(domain, "cds");
}

/** The nameservers go back to the old host. */
export function switchBack(domain: string): Promise<FakeWorld> {
  return fakeChangeNameservers(domain, "old");
}

/** The nameservers go to some other host (handback, or moved away). */
export function switchToOther(domain: string): Promise<FakeWorld> {
  return fakeChangeNameservers(domain, "other");
}
