// Fixture zones for the gate and data-list tests (14-05 choice 7). All fictitious.
// Each case is a typed DnsRecord[] in canonical shape (FQDN names, no trailing dots).
import type { DnsRecord } from "../record";

export type FixtureZone = {
  domain: string;
  records: DnsRecord[];
  /** DNSSEC flag for the gate (G3); only the dnssecOn case sets true. */
  dnssec: boolean;
};

const rec = (
  type: DnsRecord["type"],
  name: string,
  value: string,
  priority?: number,
): DnsRecord => ({
  type,
  name,
  value,
  ttl: 3600,
  ...(priority === undefined ? {} : { priority }),
});

const base = (d: string): DnsRecord[] => [
  rec(
    "SOA",
    d,
    "ns1.registrar.example hostmaster." + d + " 1 7200 3600 1209600 3600",
  ),
  rec("NS", d, "ns1.registrar.example"),
  rec("NS", d, "ns2.registrar.example"),
  rec("A", d, "203.0.113.10"),
  rec("CNAME", `www.${d}`, d),
];

export const googleWorkspace: FixtureZone = {
  domain: "riverabakery.example",
  dnssec: false,
  records: [
    ...base("riverabakery.example"),
    rec("MX", "riverabakery.example", "aspmx.l.google.com", 1),
    rec("MX", "riverabakery.example", "alt1.aspmx.l.google.com", 5),
    rec("TXT", "riverabakery.example", "v=spf1 include:_spf.google.com ~all"),
    rec("TXT", "riverabakery.example", "google-site-verification=abc123"),
    rec(
      "TXT",
      "google._domainkey.riverabakery.example",
      "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
    ),
    rec("TXT", "_dmarc.riverabakery.example", "v=DMARC1; p=none"),
  ],
};

export const microsoft365: FixtureZone = {
  domain: "lakesidecoach.example",
  dnssec: false,
  records: [
    ...base("lakesidecoach.example"),
    rec(
      "MX",
      "lakesidecoach.example",
      "lakesidecoach-example.mail.protection.outlook.com",
      0,
    ),
    rec(
      "TXT",
      "lakesidecoach.example",
      "v=spf1 include:spf.protection.outlook.com -all",
    ),
    rec("TXT", "lakesidecoach.example", "MS=ms12345678"),
    rec(
      "CNAME",
      "autodiscover.lakesidecoach.example",
      "autodiscover.outlook.com",
    ),
    rec(
      "CNAME",
      "selector1._domainkey.lakesidecoach.example",
      "selector1-lakesidecoach-example._domainkey.contoso.onmicrosoft.com",
    ),
    rec(
      "CNAME",
      "selector2._domainkey.lakesidecoach.example",
      "selector2-lakesidecoach-example._domainkey.contoso.onmicrosoft.com",
    ),
  ],
};

export const titan: FixtureZone = {
  domain: "glowstudio.example",
  dnssec: false,
  records: [
    ...base("glowstudio.example"),
    rec("MX", "glowstudio.example", "mx1.hostinger.com", 5),
    rec("MX", "glowstudio.example", "mx2.hostinger.com", 10),
    rec(
      "TXT",
      "glowstudio.example",
      "v=spf1 include:_spf.mail.hostinger.com ~all",
    ),
    rec(
      "TXT",
      "titan1._domainkey.glowstudio.example",
      "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3",
    ),
  ],
};

export const zoho: FixtureZone = {
  domain: "oakshop.example",
  dnssec: false,
  records: [
    ...base("oakshop.example"),
    rec("MX", "oakshop.example", "mx.zoho.com", 10),
    rec("MX", "oakshop.example", "mx2.zoho.com", 20),
    rec("TXT", "oakshop.example", "v=spf1 include:zoho.com ~all"),
    rec(
      "TXT",
      "zmail._domainkey.oakshop.example",
      "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEB",
    ),
  ],
};

export const namecheapForwarding: FixtureZone = {
  domain: "palmyoga.example",
  dnssec: false,
  records: [
    ...base("palmyoga.example"),
    rec("MX", "palmyoga.example", "eforward1.registrar-servers.com", 10),
    rec("MX", "palmyoga.example", "eforward2.registrar-servers.com", 10),
    rec(
      "TXT",
      "palmyoga.example",
      "v=spf1 include:spf.efwd.registrar-servers.com ~all",
    ),
  ],
};

export const godaddyParking: FixtureZone = {
  domain: "sunnyspa.example",
  dnssec: false,
  records: [
    rec("NS", "sunnyspa.example", "ns07.domaincontrol.com"),
    rec("NS", "sunnyspa.example", "ns08.domaincontrol.com"),
    rec("A", "sunnyspa.example", "34.102.136.180"),
    rec("CNAME", "www.sunnyspa.example", "sunnyspa.example"),
  ],
};

export const dnssecOn: FixtureZone = {
  domain: "secureclinic.example",
  dnssec: true,
  records: [...base("secureclinic.example")],
};

export const twoSpf: FixtureZone = {
  domain: "doublespf.example",
  dnssec: false,
  records: [
    ...base("doublespf.example"),
    rec("MX", "doublespf.example", "aspmx.l.google.com", 1),
    rec("TXT", "doublespf.example", "v=spf1 include:_spf.google.com ~all"),
    rec("TXT", "doublespf.example", "v=spf1 include:servers.mcsv.net ~all"),
    rec("TXT", "google._domainkey.doublespf.example", "v=DKIM1; k=rsa; p=MIIB"),
  ],
};

export const wildcard: FixtureZone = {
  domain: "starcards.example",
  dnssec: false,
  records: [
    ...base("starcards.example"),
    rec("A", "*.starcards.example", "203.0.113.10"),
  ],
};

export const noEmail: FixtureZone = {
  domain: "quietsite.example",
  dnssec: false,
  records: [...base("quietsite.example")],
};

export const big195: FixtureZone = {
  domain: "bigzone.example",
  dnssec: false,
  records: Array.from({ length: 195 }, (_, i) =>
    rec("A", `h${i}.bigzone.example`, `198.51.100.${i % 250}`),
  ),
};
