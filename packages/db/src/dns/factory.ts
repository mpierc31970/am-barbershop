// packages/db/src/dns/factory.ts (P14, DOM-03, DOM-04).
// Owner: 14-10 → 14-11 → 14-12 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Builds the DNS adapters from env (mirrors payments/factory.ts; 14-10 choice 1):
//   CDS_DNS_PROVIDER  ""         -> closed in production ("Domain connection opens soon"),
//                                   fake everywhere else
//                     fake       -> the fake world (every fake call refuses in production)
//                     cloudflare -> needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
//                     other      -> throws naming the variable (T-14-10-02)
// Resolver, prober and registry follow the provider (P14-P32): fake -> fake world,
// cloudflare/closed -> real. Overrides CDS_DNS_RESOLVER (resolver + registry) and
// CDS_HTTPS_PROBER accept fake|real; unknown values throw.
// Real adapters (14-12): realDnsResolver (node:dns, SSRF-guarded), rdapRegistryLookup (RDAP +
// DoH DS) and pinnedHttpsProber (connects to CDS_EDGE_IPV4 only; missing -> throws naming it).
// getPublicDnsTools() returns the real resolver + RDAP whatever the mode (domains:check, read-only).
// The Cloudflare adapter (./cloudflare, 14-11) and the real adapters are imported only here.
import { InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { cloudflareDnsProvider } from "./cloudflare";
import { fakeHttpsProber } from "./fake/prober";
import { fakeDnsProvider } from "./fake/provider";
import { fakeRegistryLookup } from "./fake/registry";
import { fakeDnsResolver } from "./fake/resolver";
import { pinnedHttpsProber } from "./prober";
import { rdapRegistryLookup } from "./rdap";
import { realDnsResolver } from "./real-resolver";
import type {
  DnsProvider,
  DnsResolver,
  HttpsProber,
  RegistryLookup,
} from "./ports";

export type DnsProviderMode = "fake" | "cloudflare" | "closed";
export type DnsAdapterMode = "fake" | "real";

function isProduction(): boolean {
  return process.env.CDS_ENV === "production";
}

export function dnsProviderMode(): DnsProviderMode {
  const raw = process.env.CDS_DNS_PROVIDER?.trim().toLowerCase() ?? "";
  if (raw === "") return isProduction() ? "closed" : "fake";
  if (raw === "fake") return "fake";
  if (raw === "cloudflare") return "cloudflare";
  throw new Error('CDS_DNS_PROVIDER must be "fake" or "cloudflare"');
}

/** Domain connection is open unless production has no provider configured. */
export function dnsOpen(): boolean {
  return dnsProviderMode() !== "closed";
}

function adapterMode(envName: string): DnsAdapterMode {
  const raw = process.env[envName]?.trim().toLowerCase() ?? "";
  if (raw === "fake" || raw === "real") return raw;
  if (raw !== "") throw new Error(`${envName} must be "fake" or "real"`);
  return dnsProviderMode() === "fake" ? "fake" : "real";
}

/** Which resolver (and RDAP lookup) answers: CDS_DNS_RESOLVER, else follow the provider. */
export function dnsResolverMode(): DnsAdapterMode {
  return adapterMode("CDS_DNS_RESOLVER");
}

/** Which HTTPS prober runs: CDS_HTTPS_PROBER, else follow the provider. */
export function httpsProberMode(): DnsAdapterMode {
  return adapterMode("CDS_HTTPS_PROBER");
}

function requireCloudflareEnv(): void {
  const missing = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `CDS_DNS_PROVIDER=cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (missing: ${missing.join(", ")})`,
    );
  }
}

type Overrides = {
  provider?: DnsProvider;
  resolver?: DnsResolver;
  registry?: RegistryLookup;
  prober?: HttpsProber;
};

let overrides: Overrides = {};
let provider: DnsProvider | null = null;
let resolver: DnsResolver | null = null;
let registry: RegistryLookup | null = null;
let prober: HttpsProber | null = null;
let publicTools: { resolver: DnsResolver; registry: RegistryLookup } | null =
  null;

export function getDnsProvider(): DnsProvider {
  if (overrides.provider) return overrides.provider;
  if (provider) return provider;
  const mode = dnsProviderMode();
  if (mode === "closed") throw new InvalidInput(P14_COPY.DOM_CLOSED);
  if (mode === "cloudflare") {
    requireCloudflareEnv();
    provider = cloudflareDnsProvider({
      token: process.env.CLOUDFLARE_API_TOKEN as string,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID as string,
    });
    return provider;
  }
  provider = fakeDnsProvider();
  return provider;
}

export function getDnsResolver(): DnsResolver {
  if (overrides.resolver) return overrides.resolver;
  if (resolver) return resolver;
  resolver =
    dnsResolverMode() === "real" ? realDnsResolver() : fakeDnsResolver();
  return resolver;
}

export function getRegistryLookup(): RegistryLookup {
  if (overrides.registry) return overrides.registry;
  if (registry) return registry;
  registry =
    dnsResolverMode() === "real" ? rdapRegistryLookup() : fakeRegistryLookup();
  return registry;
}

export function getHttpsProber(): HttpsProber {
  if (overrides.prober) return overrides.prober;
  if (prober) return prober;
  if (httpsProberMode() === "real") {
    const edgeIp = process.env.CDS_EDGE_IPV4?.trim() ?? "";
    if (edgeIp === "") {
      throw new Error(
        "The real HTTPS prober needs CDS_EDGE_IPV4 (the edge's public IPv4)",
      );
    }
    prober = pinnedHttpsProber({ edgeIp });
    return prober;
  }
  prober = fakeHttpsProber();
  return prober;
}

/**
 * The real public-DNS resolver and RDAP lookup, whatever CDS_DNS_PROVIDER says (P14-P32):
 * `domains:check` always reads the outside world. Read-only; test overrides still win.
 */
export function getPublicDnsTools(): {
  resolver: DnsResolver;
  registry: RegistryLookup;
} {
  publicTools ??= {
    resolver: realDnsResolver(),
    registry: rdapRegistryLookup(),
  };
  return {
    resolver: overrides.resolver ?? publicTools.resolver,
    registry: overrides.registry ?? publicTools.registry,
  };
}

/** Tests: inject adapters (a spy provider, a recorded resolver). */
export function setDnsForTests(p: Overrides): void {
  overrides = { ...overrides, ...p };
}

/** Tests: drop overrides and memoised adapters (env is re-read on next use). */
export function resetDnsForTests(): void {
  overrides = {};
  provider = null;
  resolver = null;
  registry = null;
  prober = null;
  publicTools = null;
}
