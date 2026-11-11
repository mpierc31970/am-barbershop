// DOM-03: email setup presets and the one-SPF merge (14-06 choices 1-3, RESEARCH Pitfall 8).
import { describe, expect, it } from "vitest";
import {
  EMAIL_PRESETS,
  EMAIL_PRESET_IDS,
  SpfMergeError,
  checkPresetValue,
  mergeSpf,
  presetRecords,
  type EmailPresetId,
} from "./presets";
import { recordKey, type DnsRecord } from "./record";

const D = "riverabakery.com";

const zohoZone: DnsRecord[] = [
  { type: "MX", name: D, value: "mx.zoho.com", priority: 10 },
  { type: "MX", name: D, value: "mx2.zoho.com", priority: 20 },
  { type: "MX", name: D, value: "mx3.zoho.com", priority: 50 },
  { type: "TXT", name: D, value: "v=spf1 include:zoho.com ~all" },
  { type: "TXT", name: `_dmarc.${D}`, value: "v=DMARC1; p=none" },
  { type: "A", name: D, value: "203.0.113.10" },
];

const keys = (rs: DnsRecord[]) => rs.map(recordKey).sort();

describe("mergeSpf", () => {
  it("adds the include before the one all", () => {
    expect(mergeSpf("v=spf1 include:zoho.com ~all", "_spf.google.com")).toEqual(
      { value: "v=spf1 include:zoho.com include:_spf.google.com ~all" },
    );
  });

  it("an include already present leaves it unchanged", () => {
    const v = "v=spf1 include:_spf.google.com ~all";
    expect(mergeSpf(v, "_spf.google.com")).toEqual({ value: v });
    expect(mergeSpf(v, "include:_spf.GOOGLE.com")).toEqual({ value: v });
  });

  it("null or blank -> a fresh record", () => {
    const fresh = { value: "v=spf1 include:_spf.google.com ~all" };
    expect(mergeSpf(null, "_spf.google.com")).toEqual(fresh);
    expect(mergeSpf("  ", "_spf.google.com")).toEqual(fresh);
  });

  it("keeps the existing all qualifier and exactly one all", () => {
    expect(mergeSpf("v=spf1 mx -all", "zoho.com")).toEqual({
      value: "v=spf1 mx include:zoho.com -all",
    });
    expect(mergeSpf("v=spf1 a ?all ~all", "zoho.com")).toEqual({
      value: "v=spf1 a include:zoho.com ?all",
    });
    expect(mergeSpf("v=spf1 a", "zoho.com")).toEqual({
      value: "v=spf1 a include:zoho.com ~all",
    });
  });

  it("dedupes includes and unquotes", () => {
    expect(
      mergeSpf('"v=spf1 include:a.com include:A.com" " -all"', "b.com"),
    ).toEqual({ value: "v=spf1 include:a.com include:b.com -all" });
  });

  it("does not add an all after a redirect", () => {
    expect(mergeSpf("v=spf1 redirect=_spf.x.com", "b.com")).toEqual({
      value: "v=spf1 include:b.com redirect=_spf.x.com",
    });
  });

  it("more than 10 estimated lookups -> too_many_lookups", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `include:s${i}.com`);
    const v = `v=spf1 ${ten.join(" ")} ~all`;
    expect(mergeSpf(v, "_spf.google.com")).toEqual({
      error: "too_many_lookups",
    });
    // a, mx, ptr, exists: 1 each; two unknown includes: 2 each; redirect: 2 -> 10.
    const atTen = `v=spf1 a mx ptr exists:x.com include:s0.com include:s1.com ~all`;
    expect(mergeSpf(atTen, "s1.com")).toEqual({ value: atTen });
    expect(
      mergeSpf(`${atTen.replace(" ~all", "")} redirect=r.com`, "s0.com"),
    ).toEqual({
      value:
        "v=spf1 a mx ptr exists:x.com include:s0.com include:s1.com redirect=r.com",
    });
    expect(
      mergeSpf(`${atTen.replace(" ~all", "")} redirect=r.com`, "z.com"),
    ).toEqual({ error: "too_many_lookups" });
  });

  it("counts nested include costs, not just top-level terms (WR-B03)", () => {
    // 6 terms, but Google (4) + three unknown includes (2 each) + a + mx = 12.
    expect(
      mergeSpf(
        "v=spf1 a mx include:servers.mcsv.net include:crm.example include:sendgrid.net ~all",
        "_spf.google.com",
      ),
    ).toEqual({ error: "too_many_lookups" });
    // Known cheap includes: Outlook (2) + Proton (1) + Google (4) = 7.
    expect(
      mergeSpf(
        "v=spf1 include:spf.protection.outlook.com include:_spf.protonmail.ch ~all",
        "_spf.google.com",
      ),
    ).toEqual({
      value:
        "v=spf1 include:spf.protection.outlook.com include:_spf.protonmail.ch include:_spf.google.com ~all",
    });
    // Google + Mailchimp + a CRM + mx + a = 4 + 2 + 2 + 1 + 1 = 10: allowed.
    expect(
      mergeSpf(
        "v=spf1 a mx include:servers.mcsv.net include:crm.example ~all",
        "_spf.google.com",
      ),
    ).toEqual({
      value:
        "v=spf1 a mx include:servers.mcsv.net include:crm.example include:_spf.google.com ~all",
    });
  });

  it("two v=spf1 in one value -> two_spf", () => {
    expect(
      mergeSpf("v=spf1 include:a.com ~all v=spf1 include:b.com ~all", "c.com"),
    ).toEqual({ error: "two_spf" });
  });
});

describe("EMAIL_PRESETS", () => {
  it("covers the six providers in UI order", () => {
    expect(EMAIL_PRESET_IDS).toEqual([
      "google",
      "microsoft",
      "zoho",
      "hostinger",
      "proton",
      "fastmail",
    ]);
    expect(EMAIL_PRESET_IDS.map((id) => EMAIL_PRESETS[id].name)).toEqual([
      "Google Workspace",
      "Microsoft 365",
      "Zoho Mail",
      "Hostinger Email",
      "Proton Mail",
      "Fastmail",
    ]);
  });

  it.each(EMAIL_PRESET_IDS.map((id) => [id]))(
    "%s: every field pattern accepts its example and rejects hello",
    (id) => {
      for (const f of EMAIL_PRESETS[id as EmailPresetId].fields) {
        expect(f.pattern.test(f.example)).toBe(true);
        expect(f.pattern.test("hello")).toBe(false);
        expect(checkPresetValue(id as EmailPresetId, f.key, f.example)).toBe(
          true,
        );
        expect(checkPresetValue(id as EmailPresetId, f.key, "hello")).toBe(
          false,
        );
      }
    },
  );

  it("checkPresetValue tolerates quotes and spaces around a pasted value", () => {
    expect(
      checkPresetValue(
        "google",
        "verification",
        ' "google-site-verification=abcdefghij0123456789" ',
      ),
    ).toBe(true);
  });
});

describe("presetRecords", () => {
  const gv = "google-site-verification=abcdefghij0123456789";
  const dkim = `v=DKIM1; k=rsa; p=${"A".repeat(120)}`;

  it("google over Zoho: replaces the 3 MX, merges SPF, adds DKIM and verification", () => {
    const out = presetRecords(
      "google",
      D,
      { verification: gv, dkim },
      zohoZone,
    );
    expect(out.replacesProvider).toBe("Zoho Mail");
    expect(out.replace.filter((r) => r.type === "MX")).toHaveLength(3);
    expect(keys(out.replace)).toEqual(
      keys([...zohoZone.filter((r) => r.type === "MX"), zohoZone[3]!]),
    );
    expect(out.spf).toEqual({
      before: "v=spf1 include:zoho.com ~all",
      after: "v=spf1 include:zoho.com include:_spf.google.com ~all",
    });
    expect(keys(out.add)).toEqual(
      keys([
        { type: "MX", name: D, value: "smtp.google.com", priority: 1 },
        {
          type: "TXT",
          name: D,
          value: "v=spf1 include:zoho.com include:_spf.google.com ~all",
        },
        { type: "TXT", name: D, value: gv },
        { type: "TXT", name: `google._domainkey.${D}`, value: dkim },
      ]),
    );
    expect(out.remove).toEqual([]);
  });

  it("never touches _dmarc", () => {
    for (const id of EMAIL_PRESET_IDS) {
      const out = presetRecords(id, D, {}, zohoZone);
      for (const r of [...out.add, ...out.replace, ...out.remove]) {
        expect(r.name.startsWith("_dmarc.")).toBe(false);
      }
    }
  });

  it("an empty zone: no replacement, fresh SPF", () => {
    const out = presetRecords("zoho", D, {}, []);
    expect(out.replacesProvider).toBeNull();
    expect(out.replace).toEqual([]);
    expect(out.spf).toEqual({
      before: null,
      after: "v=spf1 include:zoho.com ~all",
    });
    expect(out.add.filter((r) => r.type === "MX")).toEqual([
      { type: "MX", name: D, value: "mx.zoho.com", priority: 10, ttl: 3600 },
      { type: "MX", name: D, value: "mx2.zoho.com", priority: 20, ttl: 3600 },
      { type: "MX", name: D, value: "mx3.zoho.com", priority: 50, ttl: 3600 },
    ]);
  });

  it("the same provider already set up: nothing to add", () => {
    const out = presetRecords("zoho", D, {}, zohoZone);
    expect(out).toEqual({
      add: [],
      replace: [],
      remove: [],
      spf: {
        before: "v=spf1 include:zoho.com ~all",
        after: "v=spf1 include:zoho.com ~all",
      },
      replacesProvider: null,
    });
  });

  it("an old MX set of the same provider is replaced without the warning", () => {
    const old: DnsRecord[] = [
      { type: "MX", name: D, value: "aspmx.l.google.com", priority: 1 },
      { type: "MX", name: D, value: "alt1.aspmx.l.google.com", priority: 5 },
    ];
    const out = presetRecords("google", D, {}, old);
    expect(out.replacesProvider).toBeNull();
    expect(keys(out.replace)).toEqual(keys(old));
  });

  it("an unknown MX host is named as the provider being replaced", () => {
    const out = presetRecords("google", D, {}, [
      { type: "MX", name: D, value: "mail.oldhost.net", priority: 10 },
    ]);
    expect(out.replacesProvider).toBe("mail.oldhost.net");
  });

  it("microsoft: domain MX, autodiscover, two DKIM CNAMEs", () => {
    const out = presetRecords(
      "microsoft",
      D,
      {
        verification: "MS=ms12345678",
        dkim: "selector1-riverabakery-com._domainkey.rivera.onmicrosoft.com\nselector2-riverabakery-com._domainkey.rivera.onmicrosoft.com",
      },
      [],
    );
    expect(keys(out.add)).toEqual(
      keys([
        {
          type: "MX",
          name: D,
          value: "riverabakery-com.mail.protection.outlook.com",
          priority: 0,
        },
        {
          type: "TXT",
          name: D,
          value: "v=spf1 include:spf.protection.outlook.com ~all",
        },
        { type: "TXT", name: D, value: "MS=ms12345678" },
        {
          type: "CNAME",
          name: `autodiscover.${D}`,
          value: "autodiscover.outlook.com",
        },
        {
          type: "CNAME",
          name: `selector1._domainkey.${D}`,
          value: "selector1-riverabakery-com._domainkey.rivera.onmicrosoft.com",
        },
        {
          type: "CNAME",
          name: `selector2._domainkey.${D}`,
          value: "selector2-riverabakery-com._domainkey.rivera.onmicrosoft.com",
        },
      ]),
    );
  });

  it("proton: three DKIM CNAMEs from the first target", () => {
    const out = presetRecords(
      "proton",
      D,
      { dkim: "protonmail.domainkey.dabc123.domains.proton.ch" },
      [],
    );
    const cn = out.add.filter((r) => r.type === "CNAME");
    expect(cn.map((r) => [r.name, r.value])).toEqual([
      [
        `protonmail._domainkey.${D}`,
        "protonmail.domainkey.dabc123.domains.proton.ch",
      ],
      [
        `protonmail2._domainkey.${D}`,
        "protonmail2.domainkey.dabc123.domains.proton.ch",
      ],
      [
        `protonmail3._domainkey.${D}`,
        "protonmail3.domainkey.dabc123.domains.proton.ch",
      ],
    ]);
  });

  it("fastmail: DKIM CNAMEs need no input", () => {
    const out = presetRecords("fastmail", D, {}, []);
    expect(
      out.add.filter((r) => r.type === "CNAME").map((r) => [r.name, r.value]),
    ).toEqual([
      [`fm1._domainkey.${D}`, `fm1.${D}.dkim.fmhosted.com`],
      [`fm2._domainkey.${D}`, `fm2.${D}.dkim.fmhosted.com`],
      [`fm3._domainkey.${D}`, `fm3.${D}.dkim.fmhosted.com`],
    ]);
  });

  it("hostinger: DKIM TXT at titan1._domainkey; an old CNAME there is removed", () => {
    const out = presetRecords("hostinger", D, { dkim: `"${dkim}"` }, [
      { type: "CNAME", name: `titan1._domainkey.${D}`, value: "x.example.net" },
    ]);
    expect(out.add).toContainEqual({
      type: "TXT",
      name: `titan1._domainkey.${D}`,
      value: dkim,
      ttl: 3600,
    });
    expect(out.remove).toEqual([
      { type: "CNAME", name: `titan1._domainkey.${D}`, value: "x.example.net" },
    ]);
  });

  it("a changed DKIM of the same type is replaced", () => {
    const out = presetRecords("google", D, { dkim }, [
      { type: "TXT", name: `google._domainkey.${D}`, value: "v=DKIM1; p=OLD" },
    ]);
    expect(out.replace).toEqual([
      { type: "TXT", name: `google._domainkey.${D}`, value: "v=DKIM1; p=OLD" },
    ]);
  });

  it("an invalid value throws InvalidInput", () => {
    expect(() =>
      presetRecords("google", D, { verification: "hello" }, []),
    ).toThrowError(/verification/);
  });

  it("an SPF the merge refuses throws SpfMergeError with the code", () => {
    const two: DnsRecord[] = [
      { type: "TXT", name: D, value: "v=spf1 include:a.com ~all" },
      { type: "TXT", name: D, value: "v=spf1 include:b.com ~all" },
    ];
    try {
      presetRecords("google", D, {}, two);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SpfMergeError);
      expect((e as SpfMergeError).code).toBe("two_spf");
    }
  });
});
