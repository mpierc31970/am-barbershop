// DOM-05: record classes (14-CONTEXT "Record classes", P14-P39: cds is checked first).
import { describe, expect, it } from "vitest";
import { classifyRecord } from "./classify";
import { recordKey, type DnsRecord } from "./record";

const D = "example.com";
const r = (
  type: DnsRecord["type"],
  name: string,
  value: string,
  priority?: number,
): DnsRecord => ({
  type,
  name,
  value,
  ...(priority === undefined ? {} : { priority }),
});

describe("classifyRecord", () => {
  it.each<[DnsRecord, string]>([
    [r("MX", D, "aspmx.l.google.com", 1), "email"],
    [r("MX", "shop.example.com", "mx.zoho.com", 10), "email"],
    [r("TXT", D, "v=spf1 include:_spf.google.com ~all"), "email"],
    [
      r("TXT", "news.example.com", "v=spf1 include:mailgun.org ~all"),
      "verification",
    ],
    [r("TXT", D, "google-site-verification=abc123"), "verification"],
    [r("TXT", D, "MS=ms1234"), "verification"],
    [
      r(
        "CNAME",
        "s1._domainkey.example.com",
        "s1.domainkey.u123.wl.sendgrid.net",
      ),
      "email",
    ],
    [
      r("TXT", "google._domainkey.example.com", "v=DKIM1; k=rsa; p=AB"),
      "email",
    ],
    [r("TXT", "_dmarc.example.com", "v=DMARC1; p=none"), "email"],
    [r("TXT", "_mta-sts.example.com", "v=STSv1; id=1"), "email"],
    [r("CNAME", "mta-sts.example.com", "mta-sts.example.net"), "email"],
    [
      r(
        "TXT",
        "_smtp._tls.example.com",
        "v=TLSRPTv1; rua=mailto:x@example.com",
      ),
      "email",
    ],
    [
      r("TXT", "default._bimi.example.com", "v=BIMI1; l=https://x/logo.svg"),
      "email",
    ],
    [
      r(
        "SRV",
        "_autodiscover._tcp.example.com",
        "0 443 autodiscover.outlook.com",
        10,
      ),
      "email",
    ],
    [r("SRV", "_imaps._tcp.example.com", "0 993 imap.example.net", 0), "email"],
    [
      r(
        "SRV",
        "_sipfederationtls._tcp.example.com",
        "1 5061 sipfed.online.lync.com",
        100,
      ),
      "email",
    ],
    [
      r("SRV", "_minecraft._tcp.example.com", "0 25565 mc.example.net", 0),
      "other",
    ],
    [
      r("CNAME", "autodiscover.example.com", "autodiscover.outlook.com"),
      "email",
    ],
    [r("CNAME", "lyncdiscover.example.com", "webdir.online.lync.com"), "email"],
    [r("CNAME", "mail.example.com", "ghs.google.com"), "email"],
    [r("CNAME", "webmail.example.com", "webmail.titan.email"), "email"],
    [r("CNAME", "mail.example.com", "mail.zoho.eu"), "email"],
    [r("CNAME", "email.example.com", "mailgun.org"), "other"],
    [r("A", D, "203.0.113.10"), "site"],
    [r("AAAA", D, "2001:db8::1"), "site"],
    [r("A", "www.example.com", "203.0.113.10"), "site"],
    [r("CNAME", "www.example.com", "example.com"), "site"],
    [r("CNAME", "shop.example.com", "shops.myshopify.com"), "other"],
    [r("A", "blog.example.com", "198.51.100.4"), "other"],
    [r("CAA", D, '0 issue "letsencrypt.org"'), "other"],
    [r("NS", D, "ns1.example.net"), "other"],
  ])("%j -> %s", (rec, cls) => {
    expect(classifyRecord(rec, D)).toBe(cls);
  });

  it("accepts a trailing-dot, mixed-case domain", () => {
    expect(
      classifyRecord(
        r("MX", "EXAMPLE.com.", "mx.example.net", 10),
        "Example.COM.",
      ),
    ).toBe("email");
    expect(
      classifyRecord(
        r("A", "WWW.example.com.", "203.0.113.10"),
        "example.com.",
      ),
    ).toBe("site");
  });

  it("a cdsKeys hit is cds before every other class (P14-P39)", () => {
    const ses = r(
      "CNAME",
      "abc123._domainkey.example.com",
      "abc123.dkim.amazonses.com",
    );
    const dmarc = r("TXT", "_dmarc.example.com", "v=DMARC1; p=none");
    const site = r("A", D, "203.0.113.10");
    const sendMx = r(
      "MX",
      "send.example.com",
      "feedback-smtp.us-east-1.amazonses.com",
      10,
    );
    const caa = r("CAA", D, '0 issue "letsencrypt.org"');
    const cdsKeys = new Set([ses, dmarc, site, sendMx, caa].map(recordKey));
    for (const rec of [ses, dmarc, site, sendMx, caa]) {
      expect(classifyRecord(rec, D, { cdsKeys })).toBe("cds");
    }
    // Same names with other values are not CDS's.
    expect(
      classifyRecord(r("TXT", "_dmarc.example.com", "v=DMARC1; p=reject"), D, {
        cdsKeys,
      }),
    ).toBe("email");
  });

  it("cdsKeys matches the canonical form (trailing dot, case)", () => {
    const cdsKeys = new Set([
      recordKey(r("CNAME", "x._domainkey.example.com", "x.dkim.amazonses.com")),
    ]);
    expect(
      classifyRecord(
        r("CNAME", "X._domainkey.Example.com.", "X.DKIM.amazonses.com."),
        D,
        { cdsKeys },
      ),
    ).toBe("cds");
  });
});
