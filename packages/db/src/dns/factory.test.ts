// 14-10 (D55, D289, P14-P32; T-14-10-01, T-14-10-02): CDS_DNS_PROVIDER picks the DNS host;
// unset in production is closed (never the fake), unknown values throw naming the variable.
import { InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dnsOpen,
  dnsProviderMode,
  dnsResolverMode,
  getDnsProvider,
  getDnsResolver,
  getHttpsProber,
  getPublicDnsTools,
  getRegistryLookup,
  httpsProberMode,
  resetDnsForTests,
  setDnsForTests,
} from "./factory";
import type { DnsProvider } from "./ports";

const KEYS = [
  "CDS_ENV",
  "CDS_DNS_PROVIDER",
  "CDS_DNS_RESOLVER",
  "CDS_HTTPS_PROBER",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CDS_EDGE_IPV4",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetDnsForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetDnsForTests();
});

describe("dnsProviderMode", () => {
  it("unset outside production is fake", () => {
    expect(dnsProviderMode()).toBe("fake");
    expect(dnsOpen()).toBe(true);
    expect(getDnsProvider().name).toBe("fake");
  });

  it("unset in production is closed, and the provider refuses with DOM_CLOSED", () => {
    process.env.CDS_ENV = "production";
    expect(dnsProviderMode()).toBe("closed");
    expect(dnsOpen()).toBe(false);
    expect(() => getDnsProvider()).toThrow(InvalidInput);
    expect(() => getDnsProvider()).toThrow(P14_COPY.DOM_CLOSED);
  });

  it("explicit fake stays fake (the fake itself refuses in production)", () => {
    process.env.CDS_DNS_PROVIDER = " FAKE ";
    expect(dnsProviderMode()).toBe("fake");
  });

  it("cloudflare is trimmed and lowercased, and needs the token and account id", () => {
    process.env.CDS_DNS_PROVIDER = "Cloudflare ";
    expect(dnsProviderMode()).toBe("cloudflare");
    expect(dnsOpen()).toBe(true);
    expect(() => getDnsProvider()).toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(() => getDnsProvider()).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it("cloudflare with credentials builds the Cloudflare adapter (no network at build)", () => {
    process.env.CDS_DNS_PROVIDER = "cloudflare";
    process.env.CLOUDFLARE_API_TOKEN = "t";
    process.env.CLOUDFLARE_ACCOUNT_ID = "a";
    const p = getDnsProvider();
    expect(p.name).toBe("cloudflare");
    expect(getDnsProvider()).toBe(p);
  });

  it("cloudflare without the token throws naming CLOUDFLARE_API_TOKEN only", () => {
    process.env.CDS_DNS_PROVIDER = "cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "a";
    expect(() => getDnsProvider()).toThrow(/missing: CLOUDFLARE_API_TOKEN\)/);
  });

  it("an unknown value throws naming the variable", () => {
    process.env.CDS_DNS_PROVIDER = "x";
    expect(() => dnsProviderMode()).toThrow(
      'CDS_DNS_PROVIDER must be "fake" or "cloudflare"',
    );
  });
});

describe("resolver / prober / registry selection (P14-P32)", () => {
  it("follow the provider: fake -> fake adapters", () => {
    expect(dnsResolverMode()).toBe("fake");
    expect(httpsProberMode()).toBe("fake");
    expect(getDnsResolver()).toBeDefined();
    expect(getRegistryLookup()).toBeDefined();
    expect(getHttpsProber()).toBeDefined();
  });

  it("follow the provider: cloudflare and closed -> real adapters (14-12)", async () => {
    process.env.CDS_DNS_PROVIDER = "cloudflare";
    process.env.CDS_EDGE_IPV4 = "82.180.132.176";
    expect(dnsResolverMode()).toBe("real");
    expect(httpsProberMode()).toBe("real");
    const r = getDnsResolver();
    expect(getDnsResolver()).toBe(r);
    await expect(
      r.resolve("example.com", "A", { servers: ["169.254.169.254"] }),
    ).rejects.toThrow(/non-public/);
    expect(getRegistryLookup()).toBeDefined();
    expect(getHttpsProber()).toBeDefined();
    delete process.env.CDS_DNS_PROVIDER;
    process.env.CDS_ENV = "production";
    expect(dnsResolverMode()).toBe("real");
  });

  it("CDS_DNS_RESOLVER=real builds the real resolver (no network at build)", () => {
    process.env.CDS_DNS_RESOLVER = "real";
    const r = getDnsResolver();
    expect(Object.keys(r).sort()).toEqual([
      "ipsFor",
      "resolve",
      "resolveNsIps",
    ]);
    // The real resolver refuses a private server before any query (SSRF guard).
    return expect(
      r.resolve("example.com", "A", { servers: ["10.0.0.1"] }),
    ).rejects.toThrow(/non-public/);
  });

  it("CDS_HTTPS_PROBER=real without CDS_EDGE_IPV4 throws naming it", () => {
    process.env.CDS_HTTPS_PROBER = "real";
    expect(() => getHttpsProber()).toThrow(/CDS_EDGE_IPV4/);
    process.env.CDS_EDGE_IPV4 = "10.0.0.1";
    expect(() => getHttpsProber()).toThrow(/non-public CDS_EDGE_IPV4/);
    process.env.CDS_EDGE_IPV4 = "82.180.132.176";
    expect(getHttpsProber()).toBeDefined();
  });

  it("getPublicDnsTools is real whatever the provider mode", async () => {
    expect(dnsResolverMode()).toBe("fake");
    const t = getPublicDnsTools();
    expect(getPublicDnsTools().resolver).toBe(t.resolver);
    await expect(
      t.resolver.resolve("example.com", "A", { servers: ["127.0.0.1"] }),
    ).rejects.toThrow(/non-public/);
    const spy = {
      lookup: async () => ({
        found: false,
        registrar: null,
        expiresAt: null,
        dnssec: null,
      }),
    };
    setDnsForTests({ registry: spy });
    expect(getPublicDnsTools().registry).toBe(spy);
  });

  it("overrides accept fake|real and throw otherwise", () => {
    process.env.CDS_DNS_RESOLVER = "real";
    process.env.CDS_HTTPS_PROBER = " Fake";
    expect(dnsResolverMode()).toBe("real");
    expect(httpsProberMode()).toBe("fake");
    process.env.CDS_DNS_RESOLVER = "dig";
    expect(() => dnsResolverMode()).toThrow(
      'CDS_DNS_RESOLVER must be "fake" or "real"',
    );
    process.env.CDS_HTTPS_PROBER = "curl";
    expect(() => httpsProberMode()).toThrow(
      'CDS_HTTPS_PROBER must be "fake" or "real"',
    );
  });

  it("setDnsForTests injects, resetDnsForTests drops", () => {
    const spy = { name: "fake" } as unknown as DnsProvider;
    setDnsForTests({ provider: spy });
    process.env.CDS_ENV = "production";
    expect(getDnsProvider()).toBe(spy);
    resetDnsForTests();
    expect(() => getDnsProvider()).toThrow(InvalidInput);
  });
});
