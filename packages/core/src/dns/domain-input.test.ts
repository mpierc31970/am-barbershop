// DOM-03, DOM-04: the domain field and the owner record policy (14-06 choices 4 and 5).
import { describe, expect, it } from "vitest";
import {
  TWO_LEVEL_SUFFIXES,
  ownerRecordPolicy,
  parseDomainInput,
} from "./domain-input";
import type { DnsRecord } from "./record";

const PLATFORM = new Set(["localhost", "cds.needtobeedgy.com"]);
const D = "riverabakery.com";

describe("parseDomainInput", () => {
  it.each([
    ["https://www.RiveraBakery.com/menu", "riverabakery.com"],
    ["riverabakery.com", "riverabakery.com"],
    ["  RiveraBakery.COM.  ", "riverabakery.com"],
    ["http://riverabakery.com:8080/a?b=c#d", "riverabakery.com"],
    ["www.riverabakery.com", "riverabakery.com"],
    ["riverabakery.com/", "riverabakery.com"],
    ["rivera.co.uk", "rivera.co.uk"],
    ["https://www.rivera.com.au/", "rivera.com.au"],
    ["xn--bcher-kva.com", "xn--bcher-kva.com"],
  ])("%s -> %s", (raw, domain) => {
    expect(parseDomainInput(raw, PLATFORM)).toEqual({ ok: true, domain });
  });

  it.each([
    ["shop.riverabakery.com"],
    ["https://shop.riverabakery.com/x"],
    ["a.b.riverabakery.com"],
    ["shop.rivera.co.uk"],
    ["www.shop.riverabakery.com"],
  ])("%s -> subdomain", (raw) => {
    expect(parseDomainInput(raw, PLATFORM)).toEqual({
      ok: false,
      code: "subdomain",
    });
  });

  it.each([
    ["x.sites.connectionsdesignstudios.com"],
    ["connectionsdesignstudios.com"],
    ["https://www.connectionsdesignstudios.com/"],
    ["cds.needtobeedgy.com"],
    ["api.cds.needtobeedgy.com"],
  ])("%s -> reserved", (raw) => {
    expect(parseDomainInput(raw, PLATFORM)).toEqual({
      ok: false,
      code: "reserved",
    });
  });

  it("a platform host given by the caller is reserved", () => {
    expect(
      parseDomainInput("platform.example", new Set(["platform.example"])),
    ).toEqual({ ok: false, code: "reserved" });
  });

  it.each([
    ["not a domain"],
    [""],
    ["   "],
    ["localhost"],
    ["riverabakery"],
    ["co.uk"],
    ["127.0.0.1"],
    ["-rivera.com"],
    ["rivera..com"],
    ["rivera.c0m"],
    ["user@riverabakery.com"],
    [`${"a".repeat(64)}.com`],
  ])("%j -> invalid", (raw) => {
    expect(parseDomainInput(raw, PLATFORM)).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("TWO_LEVEL_SUFFIXES is the frozen P14-P22 list", () => {
    expect([...TWO_LEVEL_SUFFIXES].sort()).toEqual(
      [
        "co.uk",
        "org.uk",
        "me.uk",
        "com.au",
        "net.au",
        "org.au",
        "co.nz",
        "co.za",
        "com.br",
        "com.mx",
        "co.jp",
        "co.in",
      ].sort(),
    );
    expect(Object.isFrozen(TWO_LEVEL_SUFFIXES)).toBe(true);
  });
});

describe("ownerRecordPolicy", () => {
  const existing: DnsRecord[] = [
    { type: "TXT", name: D, value: "v=spf1 include:_spf.google.com ~all" },
    { type: "MX", name: D, value: "smtp.google.com", priority: 1 },
    { type: "CNAME", name: `em123.${D}`, value: "u1.wl.sendgrid.net" },
    { type: "TXT", name: `_github-challenge.${D}`, value: "abc" },
  ];
  const pol = (type: string, name: string, value: string) =>
    ownerRecordPolicy({ type, name, value }, D, existing);

  it("accepts a verification TXT at the apex, unquoted", () => {
    expect(pol("TXT", "@", '"google-site-verification=abc123"')).toEqual({
      ok: true,
      record: {
        type: "TXT",
        name: D,
        value: "google-site-verification=abc123",
      },
    });
  });

  it("accepts a second TXT at the same name with another value", () => {
    expect(pol("txt", "_github-challenge", "def").ok).toBe(true);
  });

  it("accepts a CNAME on a free name, full name or relative", () => {
    expect(pol("CNAME", "em456", "u2.wl.sendgrid.net.")).toEqual({
      ok: true,
      record: {
        type: "CNAME",
        name: `em456.${D}`,
        value: "u2.wl.sendgrid.net",
      },
    });
    expect(pol("CNAME", `em789.${D}`, "x.example.net").ok).toBe(true);
    expect(pol("CNAME", `em790.${D}.`, "x.example.net").ok).toBe(true);
  });

  it.each([
    ["CNAME", "@"],
    ["CNAME", D],
    ["TXT", "www"],
    ["CNAME", "www"],
    ["TXT", "_acme-challenge"],
    ["TXT", "_acme-challenge.shop"],
    ["TXT", "_acme-challenge2"],
    ["TXT", "*"],
    ["CNAME", "*.shop"],
    ["TXT", "google._domainkey"],
    ["CNAME", "selector1._domainkey"],
    ["TXT", "_dmarc"],
    ["TXT", "_dmarc.shop"],
    ["TXT", "_mta-sts"],
    ["CNAME", "mta-sts"],
    ["TXT", "_smtp._tls"],
    ["TXT", "send"],
    ["TXT", "x.send"],
    ["CNAME", "autodiscover"],
    ["CNAME", "autoconfig"],
  ])("%s %s -> protected", (type, name) => {
    expect(pol(type, name, "some-value")).toEqual({
      ok: false,
      code: "protected",
    });
  });

  it("an SPF TXT -> spf", () => {
    expect(pol("TXT", "@", "v=spf1 include:zoho.com ~all")).toEqual({
      ok: false,
      code: "spf",
    });
    expect(pol("TXT", "shop", '"V=SPF1 -all"')).toEqual({
      ok: false,
      code: "spf",
    });
  });

  it.each([["MX"], ["A"], ["AAAA"], ["NS"], ["SRV"], ["CAA"], ["SOA"], ["X"]])(
    "%s -> type",
    (type) => {
      expect(pol(type, "foo", "bar")).toEqual({ ok: false, code: "type" });
    },
  );

  it.each([["fo o"], ["foo/bar"], [""], ["foo..bar"], [".foo"], ["é"]])(
    "name %j -> name_invalid",
    (name) => {
      expect(pol("TXT", name, "x")).toEqual({
        ok: false,
        code: "name_invalid",
      });
    },
  );

  it("a name outside the domain (absolute) -> name_invalid", () => {
    expect(pol("TXT", "foo.other.com.", "x")).toEqual({
      ok: false,
      code: "name_invalid",
    });
  });

  it.each([[""], ["   "], ['""'], ['"" ""']])(
    "value %j -> value_empty",
    (v) => {
      expect(pol("TXT", "foo", v)).toEqual({ ok: false, code: "value_empty" });
    },
  );

  it("a CNAME target that is not a host name -> value_empty", () => {
    expect(pol("CNAME", "foo", "not a host")).toEqual({
      ok: false,
      code: "value_empty",
    });
  });

  it("same name + type + value, or a CNAME clash -> exists", () => {
    expect(pol("TXT", "_github-challenge", '"abc"')).toEqual({
      ok: false,
      code: "exists",
    });
    expect(pol("CNAME", "em123", "other.example.net")).toEqual({
      ok: false,
      code: "exists",
    });
    expect(pol("TXT", "em123", "x")).toEqual({ ok: false, code: "exists" });
    expect(pol("CNAME", "_github-challenge", "x.example.net")).toEqual({
      ok: false,
      code: "exists",
    });
  });
});
