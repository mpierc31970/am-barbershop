// DOM-05, D58: record identity (RESEARCH Pattern 1, Pitfall 9). Every P14 comparison
// (gate G1, post-switch check, health drift, reverse gate) goes through recordKey.
import { describe, expect, it } from "vitest";
import {
  canonicalValue,
  dedupeRecords,
  fqdn,
  recordKey,
  sameRecord,
  unquoteTxt,
  type DnsRecord,
} from "./record";

const txt = (value: string, name = "example.com"): DnsRecord => ({
  type: "TXT",
  name,
  value,
});

describe("fqdn", () => {
  it("lowercases, trims and drops one trailing dot", () => {
    expect(fqdn(" WWW.Example.COM. ")).toBe("www.example.com");
  });
  it("resolves @ and relative names against the origin", () => {
    expect(fqdn("@", "Example.com.")).toBe("example.com");
    expect(fqdn("", "example.com")).toBe("example.com");
    expect(fqdn("www", "example.com")).toBe("www.example.com");
    expect(fqdn("www.example.com", "example.com")).toBe("www.example.com");
    expect(fqdn("mail.other.net.", "example.com")).toBe("mail.other.net");
  });
});

describe("unquoteTxt", () => {
  it("joins quoted chunks, string[] and string[][] identically", () => {
    const a = unquoteTxt('"v=DKIM1; k=rsa; p=AB" "CD"');
    const b = unquoteTxt(["v=DKIM1; k=rsa; p=AB", "CD"]);
    const c = unquoteTxt([["v=DKIM1; k=rsa; p=AB", "CD"]]);
    expect(a).toBe("v=DKIM1; k=rsa; p=ABCD");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it('decodes \\" \\\\ and \\DDD inside quotes', () => {
    expect(unquoteTxt('"say \\"hi\\" \\\\ \\065"')).toBe('say "hi" \\ A');
    expect(unquoteTxt('"caf\\195\\169"')).toBe("café");
  });
  it("leaves an unquoted value as is (case kept)", () => {
    expect(unquoteTxt("v=spf1 include:_spf.google.com ~all")).toBe(
      "v=spf1 include:_spf.google.com ~all",
    );
  });
});

describe("recordKey / sameRecord", () => {
  it("TXT chunked, string[] and string[][] forms are the same record", () => {
    const k = recordKey(txt('"v=DKIM1; k=rsa; p=AB" "CD"'));
    expect(recordKey(txt("v=DKIM1; k=rsa; p=ABCD"))).toBe(k);
    expect(
      recordKey({
        type: "TXT",
        name: "EXAMPLE.com.",
        value: unquoteTxt([["v=DKIM1; k=rsa; p=AB", "CD"]]),
      }),
    ).toBe(k);
  });

  it("MX with embedded priority and trailing dot equals split form; other priority differs", () => {
    const a: DnsRecord = {
      type: "MX",
      name: "example.com",
      value: "10 ASPMX.L.GOOGLE.COM.",
    };
    const b: DnsRecord = {
      type: "MX",
      name: "example.com.",
      value: "aspmx.l.google.com",
      priority: 10,
    };
    const c: DnsRecord = {
      type: "MX",
      name: "example.com",
      value: "aspmx.l.google.com",
      priority: 20,
    };
    expect(sameRecord(a, b)).toBe(true);
    expect(sameRecord(b, c)).toBe(false);
  });

  it("TXT case is preserved (D58 exact recreation)", () => {
    expect(sameRecord(txt("Hello"), txt("hello"))).toBe(false);
  });

  it("TTL never matters", () => {
    expect(
      sameRecord({ ...txt("x"), ttl: 300 }, { ...txt("x"), ttl: 3600 }),
    ).toBe(true);
  });

  it("name case and trailing dot never matter; type does", () => {
    const a: DnsRecord = {
      type: "CNAME",
      name: "WWW.example.com.",
      value: "Example.com.",
    };
    const b: DnsRecord = {
      type: "CNAME",
      name: "www.example.com",
      value: "example.com",
    };
    expect(sameRecord(a, b)).toBe(true);
    expect(sameRecord(a, { ...b, type: "TXT" })).toBe(false);
  });

  it("SRV: 4-part value equals priority + 3-part value", () => {
    const a: DnsRecord = {
      type: "SRV",
      name: "_sip._tls.example.com",
      value: "100 1 443 SIPDIR.online.lync.com.",
    };
    const b: DnsRecord = {
      type: "SRV",
      name: "_sip._tls.example.com",
      value: "1 443 sipdir.online.lync.com",
      priority: 100,
    };
    expect(sameRecord(a, b)).toBe(true);
    expect(canonicalValue(b)).toBe("1 443 sipdir.online.lync.com");
  });

  it('CAA canonical is flags tag "value" with the tag lowercased', () => {
    const a: DnsRecord = {
      type: "CAA",
      name: "example.com",
      value: '0 ISSUE "letsencrypt.org"',
    };
    const b: DnsRecord = {
      type: "CAA",
      name: "example.com",
      value: "0 issue letsencrypt.org",
    };
    expect(canonicalValue(a)).toBe('0 issue "letsencrypt.org"');
    expect(sameRecord(a, b)).toBe(true);
  });

  it("AAAA is compressed and lowercased; A is trimmed", () => {
    const a: DnsRecord = {
      type: "AAAA",
      name: "example.com",
      value: "2001:0DB8:0000:0000:0000:0000:0000:0001",
    };
    expect(canonicalValue(a)).toBe("2001:db8::1");
    expect(sameRecord(a, { ...a, value: "2001:db8::1" })).toBe(true);
    expect(
      canonicalValue({
        type: "A",
        name: "example.com",
        value: " 203.0.113.10 ",
      }),
    ).toBe("203.0.113.10");
  });

  it("priority is ignored for types without one", () => {
    expect(sameRecord({ ...txt("x"), priority: 5 }, txt("x"))).toBe(true);
  });
});

describe("dedupeRecords", () => {
  it("keeps the first of each key and merges sources", () => {
    const out = dedupeRecords([
      { ...txt('"a" "b"'), ttl: 300, sources: ["zone_file"] },
      { ...txt("ab"), ttl: 3600, sources: ["sweep"] },
      { ...txt("other"), sources: ["scan"] },
      { ...txt("ab"), sources: ["zone_file", "scan"] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.ttl).toBe(300);
    expect(out[0]?.sources).toEqual(["zone_file", "scan", "sweep"]);
    expect(out[1]?.sources).toEqual(["scan"]);
  });
});
