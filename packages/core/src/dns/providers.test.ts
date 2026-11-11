// DOM-05: mail-provider detection (14-05 choice 2).
import { describe, expect, it } from "vitest";
import {
  googleWorkspace,
  microsoft365,
  namecheapForwarding,
  noEmail,
  titan,
  zoho,
} from "./__fixtures__/zones";
import { classifyRecord } from "./classify";
import {
  detectMailProvider,
  expectedMissing,
  MAIL_HOST_PATTERNS,
  MAIL_PROVIDERS,
} from "./providers";

describe("MAIL_PROVIDERS", () => {
  it("is frozen data with unique ids", () => {
    expect(Object.isFrozen(MAIL_PROVIDERS)).toBe(true);
    const ids = MAIL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "google",
      "microsoft",
      "zoho",
      "titan",
      "proton",
      "fastmail",
      "icloud",
    ]);
  });
});

describe("detectMailProvider", () => {
  it.each([
    [googleWorkspace, "google"],
    [microsoft365, "microsoft"],
    [titan, "titan"],
    [zoho, "zoho"],
  ] as const)("detects %#", (z, id) => {
    expect(detectMailProvider(z.records, z.domain)).toBe(id);
  });

  it("returns null for no email and for registrar forwarding", () => {
    expect(detectMailProvider(noEmail.records, noEmail.domain)).toBeNull();
    expect(
      detectMailProvider(
        namecheapForwarding.records,
        namecheapForwarding.domain,
      ),
    ).toBeNull();
  });

  it("falls back to the apex SPF include when there is no MX", () => {
    const rs = [
      {
        type: "TXT" as const,
        name: "x.example",
        value: "v=spf1 include:spf.messagingengine.com ~all",
      },
    ];
    expect(detectMailProvider(rs, "x.example")).toBe("fastmail");
  });

  it("detects Proton and iCloud by MX", () => {
    expect(
      detectMailProvider(
        [
          {
            type: "MX",
            name: "p.example",
            value: "mail.protonmail.ch",
            priority: 10,
          },
        ],
        "p.example",
      ),
    ).toBe("proton");
    expect(
      detectMailProvider(
        [
          {
            type: "MX",
            name: "i.example",
            value: "mx01.mail.icloud.com",
            priority: 10,
          },
        ],
        "i.example",
      ),
    ).toBe("icloud");
  });
});

describe("expectedMissing", () => {
  it("is empty when every expected record is present", () => {
    for (const z of [googleWorkspace, microsoft365, titan, zoho]) {
      const id = detectMailProvider(z.records, z.domain);
      expect(expectedMissing(id!, z.records, z.domain)).toEqual([]);
    }
  });

  it("names the missing DKIM and autodiscover records", () => {
    const rs = microsoft365.records.filter(
      (r) =>
        !r.name.startsWith("selector2.") && !r.name.startsWith("autodiscover."),
    );
    expect(expectedMissing("microsoft", rs, microsoft365.domain)).toEqual([
      "selector2._domainkey",
      "autodiscover",
    ]);
  });

  it("Zoho accepts any _domainkey selector", () => {
    const rs = zoho.records.map((r) =>
      r.name.startsWith("zmail.")
        ? { ...r, name: "custom._domainkey.oakshop.example" }
        : r,
    );
    expect(expectedMissing("zoho", rs, zoho.domain)).toEqual([]);
  });
});

describe("MAIL_HOST_PATTERNS", () => {
  it("lets the classifier mark a mail CNAME pointing at Titan as email", () => {
    expect(
      classifyRecord(
        {
          type: "CNAME",
          name: "mail.glowstudio.example",
          value: "mx1.hostinger.com",
        },
        "glowstudio.example",
        { mailHosts: MAIL_HOST_PATTERNS },
      ),
    ).toBe("email");
  });
});
