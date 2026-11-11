// DOM-05, D58: BIND zone file parse/format (RESEARCH Pitfall 9; Cloudflare import rules).
// Fixtures are shaped like each registrar's export for fictitious `*.example` domains.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatBind,
  MAX_ZONE_FILE_BYTES,
  parseBind,
  ZoneFileError,
} from "./bind";
import { classifyRecord } from "./classify";
import { recordKey, type DnsRecord } from "./record";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "__fixtures__", "bind", name), "utf8");

type Row = [string, string, string, number | null, number | null];
const rows = (rs: DnsRecord[]): Row[] =>
  rs.map((r) => [r.type, r.name, r.value, r.priority ?? null, r.ttl ?? null]);

const CASES: Record<string, { domain: string; expected: Row[] }> = {
  "godaddy.txt": {
    domain: "bakery.example",
    expected: [
      [
        "SOA",
        "bakery.example",
        "ns01.domaincontrol.com dns.jomax.net 2026100100 28800 7200 604800 3600",
        null,
        3600,
      ],
      ["A", "bakery.example", "203.0.113.10", null, 600],
      ["CNAME", "www.bakery.example", "bakery.example", null, 3600],
      [
        "CNAME",
        "_domainconnect.bakery.example",
        "_domainconnect.gd.domaincontrol.com",
        null,
        3600,
      ],
      [
        "CNAME",
        "autodiscover.bakery.example",
        "autodiscover.outlook.com",
        null,
        3600,
      ],
      [
        "MX",
        "bakery.example",
        "bakery-example.mail.protection.outlook.com",
        0,
        3600,
      ],
      [
        "TXT",
        "bakery.example",
        "v=spf1 include:spf.protection.outlook.com -all",
        null,
        3600,
      ],
      ["TXT", "bakery.example", "MS=ms12345678", null, 3600],
      [
        "TXT",
        "_dmarc.bakery.example",
        "v=DMARC1; p=quarantine; rua=mailto:dmarc@bakery.example",
        null,
        3600,
      ],
      [
        "SRV",
        "_sip._tls.bakery.example",
        "1 443 sipdir.online.lync.com",
        100,
        3600,
      ],
      [
        "SRV",
        "_sipfederationtls._tcp.bakery.example",
        "1 5061 sipfed.online.lync.com",
        100,
        3600,
      ],
      ["CAA", "bakery.example", '0 issue "letsencrypt.org"', null, 3600],
      ["NS", "bakery.example", "ns01.domaincontrol.com", null, 3600],
      ["NS", "bakery.example", "ns02.domaincontrol.com", null, 3600],
    ],
  },
  "namecheap.txt": {
    domain: "salon.example",
    expected: [
      [
        "SOA",
        "salon.example",
        "dns1.registrar-servers.com hostmaster.registrar-servers.com 1696154400 43200 3600 604800 3601",
        null,
        1800,
      ],
      ["NS", "salon.example", "dns1.registrar-servers.com", null, 1800],
      ["NS", "salon.example", "dns2.registrar-servers.com", null, 1800],
      ["A", "salon.example", "198.51.100.20", null, 1799],
      ["CNAME", "www.salon.example", "salon.example", null, 1799],
      ["MX", "salon.example", "mx1.privateemail.com", 10, 1799],
      ["MX", "salon.example", "mx2.privateemail.com", 10, 1799],
      ["CNAME", "mail.salon.example", "privateemail.com", null, 1799],
      [
        "TXT",
        "salon.example",
        "v=spf1 include:spf.privateemail.com ~all",
        null,
        1799,
      ],
      [
        "TXT",
        "default._domainkey.salon.example",
        "v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsalonKEY",
        null,
        1799,
      ],
      [
        "TXT",
        "salon.example",
        "google-site-verification=Abc_DEF-123",
        null,
        1799,
      ],
      [
        "TXT",
        "salon.example",
        "facebook-domain-verification=xyz789",
        null,
        1799,
      ],
      [
        "SRV",
        "_autodiscover._tcp.salon.example",
        "0 443 privateemail.com",
        0,
        1799,
      ],
      ["CNAME", "blog.salon.example", "salon-blog.example.net", null, 1800],
    ],
  },
  "hostinger.txt": {
    domain: "studio.example",
    expected: [
      [
        "SOA",
        "studio.example",
        "ns1.dns-parking.com dns.hostinger.com 2026100101 10800 3600 1209600 300",
        null,
        14400,
      ],
      ["NS", "studio.example", "ns1.dns-parking.com", null, 14400],
      ["NS", "studio.example", "ns2.dns-parking.com", null, 14400],
      ["A", "studio.example", "192.0.2.44", null, 300],
      ["CNAME", "www.studio.example", "studio.example", null, 300],
      ["A", "ftp.studio.example", "192.0.2.44", null, 14400],
      ["MX", "studio.example", "mx1.hostinger.com", 5, 14400],
      ["MX", "studio.example", "mx2.hostinger.com", 10, 14400],
      [
        "TXT",
        "studio.example",
        "v=spf1 include:_spf.mail.hostinger.com ~all",
        null,
        3600,
      ],
      [
        "CNAME",
        "hostingermail-a._domainkey.studio.example",
        "hostingermail-a.dkim.mail.hostinger.com",
        null,
        3600,
      ],
      [
        "CNAME",
        "autoconfig.studio.example",
        "autoconfig.mail.hostinger.com",
        null,
        300,
      ],
      [
        "CNAME",
        "autodiscover.studio.example",
        "autodiscover.mail.hostinger.com",
        null,
        300,
      ],
      [
        "TXT",
        "google._domainkey.studio.example",
        "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx1y2z3STUDIOpartTWOabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZpartTHREE+/=",
        null,
        3600,
      ],
      ["TXT", "_dmarc.studio.example", "v=DMARC1; p=none", null, 3600],
      ["TXT", "studio.example", 'say "hello" café', null, 3600],
      ["CAA", "studio.example", '0 issuewild ";"', null, 14400],
    ],
  },
  "cloudflare-export.txt": {
    domain: "coach.example",
    expected: [
      [
        "SOA",
        "coach.example",
        "ada.ns.cloudflare.com dns.cloudflare.com 2051234567 10000 2400 604800 3600",
        null,
        3600,
      ],
      ["NS", "coach.example", "ada.ns.cloudflare.com", null, 86400],
      ["NS", "coach.example", "bob.ns.cloudflare.com", null, 86400],
      ["A", "coach.example", "203.0.113.77", null, 1],
      ["A", "shop.coach.example", "198.51.100.9", null, 1],
      ["AAAA", "coach.example", "2001:db8::42", null, 1],
      ["CNAME", "www.coach.example", "coach.example", null, 1],
      [
        "CNAME",
        "s1._domainkey.coach.example",
        "s1.domainkey.u123.wl.sendgrid.net",
        null,
        1,
      ],
      ["MX", "coach.example", "aspmx.l.google.com", 1, 1],
      ["MX", "coach.example", "alt1.aspmx.l.google.com", 5, 1],
      ["SRV", "_imaps._tcp.coach.example", "1 993 imap.gmail.com", 0, 1],
      [
        "TXT",
        "coach.example",
        "v=spf1 include:_spf.google.com include:sendgrid.net ~all",
        null,
        1,
      ],
      [
        "TXT",
        "_dmarc.coach.example",
        "v=DMARC1; p=reject; rua=mailto:reports@coach.example",
        null,
        1,
      ],
      ["TXT", "coach.example", "apple-domain-verification=QwErTy", null, 1],
      [
        "CAA",
        "coach.example",
        '0 issue "pki.goog; cansignhttpexchanges=yes"',
        null,
        1,
      ],
    ],
  },
  "ionos.txt": {
    domain: "shop.example",
    expected: [
      [
        "SOA",
        "shop.example",
        "ns1045.ui-dns.de hostmaster.1und1.com 2026100100 28800 7200 604800 300",
        null,
        3600,
      ],
      ["NS", "shop.example", "ns1045.ui-dns.de", null, 86400],
      ["NS", "shop.example", "ns1102.ui-dns.com", null, 86400],
      ["A", "shop.example", "192.0.2.88", null, 3600],
      ["A", "www.shop.example", "192.0.2.88", null, 3600],
      ["MX", "shop.example", "mx00.ionos.com", 10, 3600],
      ["MX", "shop.example", "mx01.ionos.com", 10, 3600],
      [
        "TXT",
        "shop.example",
        "v=spf1 include:_spf-us.ionos.com ~all",
        null,
        3600,
      ],
      [
        "CNAME",
        "s1-ionos._domainkey.shop.example",
        "s1.dkim.ionos.com",
        null,
        3600,
      ],
      ["TXT", "_mta-sts.shop.example", "v=STSv1; id=20261001", null, 3600],
      ["CNAME", "mta-sts.shop.example", "mta-sts.ionos.com", null, 3600],
      [
        "TXT",
        "_smtp._tls.shop.example",
        "v=TLSRPTv1; rua=mailto:tls@shop.example",
        null,
        3600,
      ],
      [
        "TXT",
        "default._bimi.shop.example",
        "v=BIMI1; l=https://shop.example/logo.svg",
        null,
        3600,
      ],
      ["CNAME", "store.shop.example", "shops.myshopify.com", null, 3600],
    ],
  },
};

describe("parseBind: registrar fixture corpus", () => {
  for (const [file, { domain, expected }] of Object.entries(CASES)) {
    it(`${file} parses to the expected records`, () => {
      const rs = parseBind(fixture(file), domain);
      expect(rows(rs)).toEqual(expected);
      for (const r of rs) expect(r.sources).toEqual(["zone_file"]);
    });

    it(`${file} round-trips through formatBind with the same keys (no NS/SOA)`, () => {
      const rs = parseBind(fixture(file), domain);
      const text = formatBind(domain, rs);
      expect(text).not.toMatch(/\sIN\s+(NS|SOA)\s/);
      const again = parseBind(text, domain);
      const want = rs
        .filter((r) => r.type !== "NS" && r.type !== "SOA")
        .map(recordKey);
      expect(again.map(recordKey)).toEqual(want);
      expect(again.map((r) => r.ttl)).toEqual(
        rs.filter((r) => r.type !== "NS" && r.type !== "SOA").map((r) => r.ttl),
      );
    });
  }

  it("the GoDaddy zone classifies as expected", () => {
    const rs = parseBind(fixture("godaddy.txt"), "bakery.example");
    const cls = rs.map(
      (r) => `${r.type} ${r.name} ${classifyRecord(r, "bakery.example")}`,
    );
    expect(cls).toContain("MX bakery.example email");
    expect(cls).toContain("TXT _dmarc.bakery.example email");
    expect(cls).toContain("CNAME autodiscover.bakery.example email");
    expect(cls).toContain("SRV _sip._tls.bakery.example email");
    expect(cls).toContain("TXT bakery.example verification");
    expect(cls).toContain("A bakery.example site");
    expect(cls).toContain("CNAME www.bakery.example site");
    expect(cls).toContain("CNAME _domainconnect.bakery.example other");
  });
});

describe("formatBind", () => {
  it("writes FQDN targets with a trailing dot and splits long TXT into 255-byte chunks", () => {
    const long = "p=" + "A".repeat(600);
    const text = formatBind("example.com", [
      { type: "CNAME", name: "www.example.com", value: "example.com" },
      {
        type: "MX",
        name: "example.com",
        value: "mx.example.net",
        priority: 10,
        ttl: 300,
      },
      {
        type: "SRV",
        name: "_imaps._tcp.example.com",
        value: "1 993 imap.example.net",
        priority: 0,
      },
      { type: "TXT", name: "k._domainkey.example.com", value: long },
      { type: "TXT", name: "example.com", value: 'a "q" \\ é' },
      { type: "NS", name: "example.com", value: "ns1.example.net" },
    ]);
    expect(text).toMatch(
      /^www\.example\.com\.\s+3600\s+IN\s+CNAME\s+example\.com\.$/m,
    );
    expect(text).toMatch(
      /^example\.com\.\s+300\s+IN\s+MX\s+10 mx\.example\.net\.$/m,
    );
    expect(text).toMatch(/IN\s+SRV\s+0 1 993 imap\.example\.net\.$/m);
    expect(text).not.toMatch(/\sNS\s/);
    const txtLine =
      text.split("\n").find((l) => l.startsWith("k._domainkey")) ?? "";
    const chunks = txtLine.match(/"[^"]*"/g) ?? [];
    expect(chunks.map((c) => c.length - 2)).toEqual([255, 255, 92]);
    const back = parseBind(text, "example.com");
    expect(back.find((r) => r.name === "k._domainkey.example.com")?.value).toBe(
      long,
    );
    expect(
      back.find((r) => r.type === "TXT" && r.name === "example.com")?.value,
    ).toBe('a "q" \\ é');
  });

  it("refuses a record outside the domain", () => {
    expect(() =>
      formatBind("example.com", [
        { type: "A", name: "other.example", value: "192.0.2.1" },
      ]),
    ).toThrow(ZoneFileError);
  });
});

describe("parseBind: refusals", () => {
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      if (e instanceof ZoneFileError) return e.code;
      throw e;
    }
    return undefined;
  };

  it("$INCLUDE -> include", () => {
    expect(
      code(() => parseBind(fixture("bad-include.txt"), "bakery.example")),
    ).toBe("include");
  });

  it("over 256 KiB -> too_big (checked before parsing)", () => {
    const big = "; " + "x".repeat(300 * 1024) + "\n";
    expect(MAX_ZONE_FILE_BYTES).toBe(256 * 1024);
    expect(code(() => parseBind(big, "example.com"))).toBe("too_big");
  });

  it("an owner outside the domain -> wrong_domain", () => {
    expect(
      code(() =>
        parseBind("other.example. 300 IN A 192.0.2.1\n", "example.com"),
      ),
    ).toBe("wrong_domain");
    expect(
      code(() =>
        parseBind(
          "$ORIGIN other.example.\n@ 300 IN A 192.0.2.1\n",
          "example.com",
        ),
      ),
    ).toBe("wrong_domain");
    // A look-alike suffix is not a subdomain.
    expect(
      code(() =>
        parseBind("badexample.com. 300 IN A 192.0.2.1\n", "example.com"),
      ),
    ).toBe("wrong_domain");
  });

  it("an unknown type -> unreadable naming the type", () => {
    try {
      parseBind("@ 300 IN HTTPS 1 . alpn=h2\n", "example.com");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ZoneFileError);
      expect((e as ZoneFileError).code).toBe("unreadable");
      expect((e as ZoneFileError).message).toMatch(/HTTPS/);
    }
  });

  it.each([
    ['@ 300 IN TXT "unterminated\n'],
    ["@ 300 IN SOA a. b. ( 1 2 3 4 5\n"],
    ["@ 300 IN A 999.1.1.1\n"],
    ["@ 300 IN MX mail.example.com.\n"],
    ["@ 300 CH A 192.0.2.1\n"],
    ["$GENERATE 1-10 host$ A 192.0.2.$\n"],
  ])("malformed input -> unreadable: %j", (text) => {
    expect(code(() => parseBind(text, "example.com"))).toBe("unreadable");
  });

  it("an SOA serial above 2^31-1 still parses (WR-B02)", () => {
    const rs = parseBind(
      "@ 3600 IN SOA ns1.example.com. hostmaster.example.com. 2351048337 10000 2400 604800 3600\n@ 300 IN A 192.0.2.1\n",
      "example.com",
    );
    expect(rs.find((r) => r.type === "SOA")?.value).toContain("2351048337");
    expect(rs.some((r) => r.type === "A")).toBe(true);
  });

  it.each([["4294967296"], ["1h"], ["12345678901"]])(
    "an SOA serial outside uint32 -> unreadable: %s",
    (serial) => {
      expect(
        code(() =>
          parseBind(
            `@ 3600 IN SOA a. b. ${serial} 10000 2400 604800 3600\n`,
            "example.com",
          ),
        ),
      ).toBe("unreadable");
    },
  );

  it("an empty or comment-only file parses to no records", () => {
    expect(parseBind("", "example.com")).toEqual([]);
    expect(parseBind("﻿; nothing here\n\n", "example.com")).toEqual([]);
  });
});
