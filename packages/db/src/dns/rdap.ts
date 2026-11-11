// packages/db/src/dns/rdap.ts (P14, DOM-05).
// Owner: 14-12 (14-EXECUTOR-BRIEF "Module seams"). Not in the dns barrel: only factory.ts imports it.
//
// The real RegistryLookup (14-12 choice 3; RESEARCH "RDAP"; P14-P10, P14-P22, P14-P37):
// - IANA bootstrap https://data.iana.org/rdap/dns.json, cached in this lookup for 24 h
//   (T-14-12-03); TLD -> RDAP base URL.
// - GET <base>domain/<d> (accept: application/rdap+json): 404 -> found false
//   (DOM-NOT-REGISTERED); registrar = the `registrar` entity's vCard fn; expiry = the
//   `expiration` event; dnssec = secureDNS.delegationSigned.
// - No secureDNS (or no RDAP server for the TLD, or RDAP failing) -> DS via DoH JSON:
//   cloudflare-dns.com first, dns.google second. Answer type 43 -> true, Status 0 without
//   one -> false, anything else -> null (unknown; G3 treats it as a hard block, P14-P37).
// RDAP failing is never "not registered": found stays true with nulls. Nothing logs.
import { fqdn } from "@cds/core/dns";
import type { RegistryInfo, RegistryLookup } from "./ports";

export const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
export const DOH_ENDPOINTS: readonly string[] = Object.freeze([
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
]);
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const DS_TYPE = 43;

export type RdapOptions = {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

type Bootstrap = { at: number; byTld: Map<string, string> };

function parseBootstrap(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const services = (body as { services?: unknown })?.services;
  if (!Array.isArray(services)) return map;
  for (const svc of services) {
    if (!Array.isArray(svc) || svc.length < 2) continue;
    const [tlds, urls] = svc as [unknown, unknown];
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
    const base = (urls as unknown[]).find(
      (u): u is string => typeof u === "string" && u.startsWith("https://"),
    );
    if (!base) continue;
    const withSlash = base.endsWith("/") ? base : `${base}/`;
    for (const t of tlds) {
      if (typeof t === "string") map.set(t.toLowerCase(), withSlash);
    }
  }
  return map;
}

function registrarOf(body: Record<string, unknown>): string | null {
  const entities = body.entities;
  if (!Array.isArray(entities)) return null;
  for (const e of entities) {
    if (!e || typeof e !== "object") continue;
    const roles = (e as { roles?: unknown }).roles;
    if (!Array.isArray(roles) || !roles.includes("registrar")) continue;
    const vcard = (e as { vcardArray?: unknown }).vcardArray;
    if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) continue;
    for (const prop of vcard[1] as unknown[]) {
      if (
        Array.isArray(prop) &&
        prop[0] === "fn" &&
        typeof prop[3] === "string" &&
        prop[3].trim() !== ""
      ) {
        return prop[3].trim();
      }
    }
  }
  return null;
}

function expiryOf(body: Record<string, unknown>): string | null {
  const events = body.events;
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const { eventAction, eventDate } = ev as {
      eventAction?: unknown;
      eventDate?: unknown;
    };
    if (eventAction !== "expiration" || typeof eventDate !== "string") continue;
    const t = Date.parse(eventDate);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function delegationSignedOf(body: Record<string, unknown>): boolean | null {
  const sd = body.secureDNS;
  if (!sd || typeof sd !== "object") return null;
  const v = (sd as { delegationSigned?: unknown }).delegationSigned;
  return typeof v === "boolean" ? v : null;
}

export function rdapRegistryLookup(opts: RdapOptions = {}): RegistryLookup {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  let bootstrap: Bootstrap | null = null;

  async function getJson(
    url: string,
    accept: string,
  ): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await doFetch(url, {
        method: "GET",
        headers: { accept },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { status: res.status, body: null };
      return { status: res.status, body: await res.json() };
    } catch {
      return null;
    }
  }

  async function baseFor(tld: string): Promise<string | null> {
    const t = now().getTime();
    if (!bootstrap || t - bootstrap.at >= BOOTSTRAP_TTL_MS) {
      const r = await getJson(RDAP_BOOTSTRAP_URL, "application/json");
      if (r && r.status === 200 && r.body) {
        bootstrap = { at: t, byTld: parseBootstrap(r.body) };
      } else if (!bootstrap) {
        return null; // nothing cached and the bootstrap failed: unknown registrar
      }
    }
    return bootstrap.byTld.get(tld) ?? null;
  }

  async function dohDs(domain: string): Promise<boolean | null> {
    for (const ep of DOH_ENDPOINTS) {
      const url = `${ep}?name=${encodeURIComponent(domain)}&type=DS`;
      const r = await getJson(url, "application/dns-json");
      if (!r || r.status !== 200 || !r.body || typeof r.body !== "object") {
        continue;
      }
      const { Status, Answer } = r.body as {
        Status?: unknown;
        Answer?: unknown;
      };
      if (Status !== 0) continue;
      const hasDs =
        Array.isArray(Answer) &&
        Answer.some(
          (a) =>
            a &&
            typeof a === "object" &&
            (a as { type?: unknown }).type === DS_TYPE,
        );
      return hasDs;
    }
    return null;
  }

  return {
    async lookup(domain): Promise<RegistryInfo> {
      const d = fqdn(domain);
      const tld = d.split(".").pop() ?? "";
      const base = tld ? await baseFor(tld) : null;
      let registrar: string | null = null;
      let expiresAt: string | null = null;
      let dnssec: boolean | null = null;
      if (base) {
        const r = await getJson(
          `${base}domain/${encodeURIComponent(d)}`,
          "application/rdap+json",
        );
        if (r && r.status === 404) {
          return {
            found: false,
            registrar: null,
            expiresAt: null,
            dnssec: null,
          };
        }
        if (r && r.status === 200 && r.body && typeof r.body === "object") {
          const body = r.body as Record<string, unknown>;
          registrar = registrarOf(body);
          expiresAt = expiryOf(body);
          dnssec = delegationSignedOf(body);
        }
      }
      if (dnssec === null) dnssec = await dohDs(d);
      return { found: true, registrar, expiresAt, dnssec };
    },
  };
}
