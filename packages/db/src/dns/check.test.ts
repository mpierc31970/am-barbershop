// 14-13 Task 3 (DOM-05, DOM-04; T-14-13-04): the read-only domain check. Injected public
// tools, no PocketBase env, and a client mock that fails the test if anything signs in.
import { fqdn, type DnsRecord, type RType } from "@cds/core/dns";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DnsResolver, RegistryLookup } from "./ports";

const superuserCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../client", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    withSuperuser: () => {
      superuserCalls.n++;
      throw new Error("domains:check must never touch PocketBase");
    },
  };
});

import { checkDomainPublic, formatCheckReport } from "./check";

const D = "riverabakery.example";

function rec(
  type: RType,
  rel: string,
  value: string,
  priority?: number,
): DnsRecord {
  return {
    type,
    name: rel === "@" ? D : `${rel}.${D}`,
    value,
    ...(priority === undefined ? {} : { priority }),
  };
}

const GOOGLE: DnsRecord[] = [
  rec("A", "@", "198.18.0.10"),
  rec("CNAME", "www", D),
  rec("MX", "@", "smtp.google.com", 1),
  rec("TXT", "@", "v=spf1 include:_spf.google.com ~all"),
  rec("TXT", "@", "google-site-verification=aaaaaaaaaaaa"),
  rec("TXT", "@", "google-site-verification=bbbbbbbbbbbb"),
  rec("TXT", "@", "facebook-domain-verification=xyz"),
  rec("TXT", "@", "apple-domain-verification=abc"),
  rec("TXT", "@", "pinterest-site-verification=def"),
  rec("TXT", "google._domainkey", "v=DKIM1; k=rsa; p=MIIBgoogle"),
  rec("TXT", "s1._domainkey", "v=DKIM1; k=rsa; p=MIIBs1"),
  rec("TXT", "_dmarc", "v=DMARC1; p=none"),
  rec("CNAME", "shop", "shops.myshopify.com"),
  rec("CNAME", "blog", "blog.example.net"),
  rec("CNAME", "links", "links.example.net"),
  rec("A", "ftp", "198.18.0.11"),
  rec("NS", "@", "ns1.registrar.test"),
  rec("NS", "@", "ns2.registrar.test"),
];

function tableResolver(records: DnsRecord[]): DnsResolver & { asked: number } {
  const r = {
    asked: 0,
    async resolve(name: string, type: RType, opts: { servers: string[] }) {
      r.asked++;
      expect(opts.servers).toEqual(["192.0.2.1", "192.0.2.2"]);
      const q = fqdn(name);
      const at = records.filter((x) => fqdn(x.name) === q);
      if (at.length === 0) return { status: "nxdomain" as const, records: [] };
      const typed = at.filter((x) => x.type === type);
      if (typed.length > 0) return { status: "ok" as const, records: typed };
      const cname = at.filter((x) => x.type === "CNAME");
      if (cname.length > 0) return { status: "ok" as const, records: cname };
      return { status: "nodata" as const, records: [] };
    },
    async resolveNsIps() {
      return {
        names: ["ns1.registrar.test", "ns2.registrar.test"],
        ips: ["192.0.2.1", "192.0.2.2"],
      };
    },
    async ipsFor() {
      return [];
    },
  };
  return r;
}

const registry: RegistryLookup = {
  async lookup() {
    return {
      found: true,
      registrar: "GoDaddy.com, LLC",
      expiresAt: "2027-03-03T04:00:00Z",
      dnssec: false,
    };
  },
};

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("checkDomainPublic + formatCheckReport (14-13)", () => {
  it("prints the five UI-SPEC lines for a Google Workspace domain", async () => {
    const resolver = tableResolver(GOOGLE);
    const report = await checkDomainPublic(D, {
      resolver,
      registry,
      now: new Date("2026-10-17T00:00:00Z"),
    });
    const lines = formatCheckReport(report);
    expect(lines).toEqual([
      "riverabakery.example · registrar GoDaddy.com, LLC · expires 2027-03-03 · DNSSEC off",
      "Email        7 records · provider Google Workspace (MX, SPF, 2 DKIM, DMARC, 2 verification)",
      "Verification 3 · Site 2 · Other 4 · wildcard no",
      "Gate         G2 pass · G3 pass · G4 none · G5 none · G6 pass (1 SPF)",
      "Read-only: nothing was written.",
    ]);
    expect(report.nameservers).toEqual([
      "ns1.registrar.test",
      "ns2.registrar.test",
    ]);
    expect(resolver.asked).toBeGreaterThan(0);
    expect(superuserCalls.n).toBe(0);
  });

  it("reports hard blocks and CAA without writing anything", async () => {
    const records = [
      ...GOOGLE,
      rec("TXT", "@", "v=spf1 include:spf.titan.email ~all"),
      rec("CAA", "@", '0 issue "digicert.com"'),
    ];
    const report = await checkDomainPublic(D, {
      resolver: tableResolver(records),
      registry: {
        async lookup() {
          return {
            found: true,
            registrar: null,
            expiresAt: null,
            dnssec: null,
          };
        },
      },
    });
    const lines = formatCheckReport(report);
    expect(lines[0]).toBe(
      "riverabakery.example · registrar unknown · expires unknown · DNSSEC unknown",
    );
    expect(lines[3]).toBe(
      "Gate         G2 pass · G3 DNSSEC unknown (hard block) · G4 adds letsencrypt.org · G5 none · G6 fail (2 SPF)",
    );
    expect(lines[4]).toBe("Read-only: nothing was written.");
    expect(superuserCalls.n).toBe(0);
  });

  it("throws DnsSweepFailed when the domain has no nameservers", async () => {
    const resolver: DnsResolver = {
      ...tableResolver([]),
      async resolveNsIps() {
        return { names: [], ips: [] };
      },
    };
    await expect(
      checkDomainPublic(D, { resolver, registry }),
    ).rejects.toMatchObject({ name: "DnsSweepFailed" });
  });
});
