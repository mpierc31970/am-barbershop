// packages/db/src/dns/cloudflare/provider.ts (P14, DOM-03; 14-11 choice 2).
// Owner: 14-11. Only factory.ts reaches this folder (through ./index.ts).
//
// The real DnsProvider: Cloudflare API v4 (D55, free plan; RESEARCH Pattern 3). Zone
// operations only (DOM-04, D56). Every record write is DNS-only, `proxied: false` (grey
// cloud, CONTEXT "DNS-only"; T-14-11-02): the CDS edge terminates TLS, never Cloudflare.
// BIND import is capped at 256 KiB and serialised through a platform lock whose claim is
// held 20 s, so at most 3 imports a minute leave this platform (Pitfall 14; T-14-11-03).
// Nothing here logs (T-14-11-01).
import { InvalidInput } from "@cds/core";
import {
  formatBind,
  fqdn,
  MAX_ZONE_FILE_BYTES,
  normalizeRecord,
  parseBind,
  recordKey,
  unquoteTxt,
  isRType,
  type DnsRecord,
} from "@cds/core/dns";
import { acquirePlatformLock } from "../../platform-meta";
import type { DnsProvider, ProviderRecord, ZoneStatus } from "../ports";
import {
  cfFetch,
  cfFetchText,
  CloudflareError,
  type CfClientOptions,
  type CfFetch,
} from "./client";

/** Runs one import while holding the platform-wide import claim. */
export type CfImportLock = <T>(fn: () => Promise<T>) => Promise<T>;

export type CloudflareDnsProviderOptions = {
  token: string;
  accountId: string;
  fetch?: CfFetch;
  /** Import serialisation; defaults to the platform lock `lock:cf-import` (20 s spacing). */
  lock?: CfImportLock;
  /** Clock for the default lock. */
  now?: () => Date;
};

export const CF_IMPORT_LOCK_KEY = "lock:cf-import";
/** 3 imports per minute per user (Cloudflare): one claim every 20 s. */
export const CF_IMPORT_SPACING_MS = 20_000;
const PER_PAGE = 100;
const MAX_PAGES = 50;

/**
 * The default import lock: claim `lock:cf-import` and never release it, so the claim itself
 * is the spacing: the next import may take it over only once it is 20 s old. A busy claim is
 * a retryable CloudflareError (`import_busy`); the move step waits for the next run.
 */
export function platformImportLock(
  now: () => Date = () => new Date(),
): CfImportLock {
  return async (fn) => {
    const token = await acquirePlatformLock(CF_IMPORT_LOCK_KEY, {
      now: now(),
      staleMs: CF_IMPORT_SPACING_MS,
    });
    if (!token) throw new CloudflareError("import_busy", null, true);
    return fn();
  };
}

type CfZone = {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
};

type CfRecord = {
  id: string;
  type: string;
  name: string;
  content?: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  data?: Record<string, unknown>;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkId(id: string): string {
  if (typeof id !== "string" || !ID_RE.test(id))
    throw new InvalidInput("invalid id");
  return id;
}

/** v4 zone status -> port status (`initializing` and anything unknown wait as `pending`). */
export function mapZoneStatus(s: string): ZoneStatus {
  if (s === "active") return "active";
  if (s === "moved" || s === "deactivated") return "moved";
  return "pending";
}

/** Quote a TXT value for the API: 255-byte chunks, `"` and `\` escaped. */
export function quoteTxt(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const dec = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length || chunks.length === 0) {
    let end = Math.min(start + 255, bytes.length);
    // Never split inside a UTF-8 sequence.
    while (
      end < bytes.length &&
      end > start &&
      ((bytes[end] as number) & 0xc0) === 0x80
    )
      end -= 1;
    chunks.push(dec.decode(bytes.slice(start, end)));
    if (end >= bytes.length) break;
    start = end;
  }
  return chunks
    .map((c) => `"${c.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(" ");
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A v4 record as a DnsRecord (unsupported types such as HTTPS or PTR -> null). */
export function fromCfRecord(cf: CfRecord): DnsRecord | null {
  if (!isRType(cf.type)) return null;
  const content = cf.content ?? "";
  let value = content;
  let priority: number | undefined;
  switch (cf.type) {
    case "TXT":
      value = unquoteTxt(content);
      break;
    case "MX":
      priority = num(cf.priority);
      break;
    case "SRV": {
      const d = cf.data ?? {};
      if (typeof d.target === "string") {
        value = `${num(d.weight) ?? 0} ${num(d.port) ?? 0} ${d.target}`;
        priority = num(d.priority) ?? num(cf.priority);
      } else {
        priority = num(cf.priority);
      }
      break;
    }
    case "CAA": {
      const d = cf.data ?? {};
      if (typeof d.tag === "string") {
        const v = String(d.value ?? "")
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        value = `${num(d.flags) ?? 0} ${d.tag} "${v}"`;
      }
      break;
    }
    default:
      break;
  }
  const raw: DnsRecord = { type: cf.type, name: cf.name, value };
  if (priority !== undefined) raw.priority = priority;
  const r = normalizeRecord(raw);
  if (typeof cf.ttl === "number") r.ttl = cf.ttl;
  return r;
}

/** Types where one name holds one record: an upsert replaces it. */
const SINGLE_VALUE = new Set(["CNAME"]);

function sameSlot(a: DnsRecord, b: DnsRecord): boolean {
  if (SINGLE_VALUE.has(a.type)) return a.type === b.type && a.name === b.name;
  return recordKey(a) === recordKey(b);
}

/** The v4 request body for a record. Always DNS-only. */
export function toCfBody(
  r: DnsRecord,
  zoneName: string,
): Record<string, unknown> {
  const n = normalizeRecord(r);
  const ttl =
    r.ttl ?? (n.name === zoneName || n.name === `www.${zoneName}` ? 300 : 3600);
  switch (n.type) {
    case "SRV": {
      const [w, p, target] = n.value.split(" ");
      return {
        type: "SRV",
        name: n.name,
        ttl,
        proxied: false,
        data: {
          priority: n.priority ?? 0,
          weight: Number(w),
          port: Number(p),
          target: target ?? "",
        },
      };
    }
    case "CAA": {
      const m = /^(\d+) (\S+) "([\s\S]*)"$/.exec(n.value);
      if (!m) throw new InvalidInput("invalid CAA record");
      return {
        type: "CAA",
        name: n.name,
        ttl,
        proxied: false,
        data: {
          flags: Number(m[1]),
          tag: m[2],
          value: unquoteTxt(`"${m[3]}"`),
        },
      };
    }
    case "TXT":
      return {
        type: "TXT",
        name: n.name,
        content: quoteTxt(n.value),
        ttl,
        proxied: false,
      };
    case "MX":
      return {
        type: "MX",
        name: n.name,
        content: n.value,
        priority: n.priority ?? 0,
        ttl,
        proxied: false,
      };
    default:
      return {
        type: n.type,
        name: n.name,
        content: n.value,
        ttl,
        proxied: false,
      };
  }
}

export function cloudflareDnsProvider(
  opts: CloudflareDnsProviderOptions,
): DnsProvider {
  if (!opts.token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  if (!opts.accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  const client: CfClientOptions = { token: opts.token, fetch: opts.fetch };
  const lock = opts.lock ?? platformImportLock(opts.now);
  const zoneNames = new Map<string, string>();

  async function getZone(zoneId: string): Promise<CfZone> {
    const env = await cfFetch<CfZone>(
      `/zones/${checkId(zoneId)}`,
      { method: "GET" },
      client,
    );
    zoneNames.set(zoneId, fqdn(env.result.name));
    return env.result;
  }

  async function zoneName(zoneId: string): Promise<string> {
    return zoneNames.get(zoneId) ?? fqdn((await getZone(zoneId)).name);
  }

  async function listCf(zoneId: string): Promise<CfRecord[]> {
    const out: CfRecord[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const env = await cfFetch<CfRecord[]>(
        `/zones/${checkId(zoneId)}/dns_records?per_page=${PER_PAGE}&page=${page}`,
        { method: "GET" },
        client,
      );
      out.push(...(env.result ?? []));
      const total = env.result_info?.total_pages ?? 1;
      if (page >= total || (env.result ?? []).length === 0) break;
    }
    return out;
  }

  function withId(cf: CfRecord): ProviderRecord | null {
    const r = fromCfRecord(cf);
    return r ? { ...r, id: cf.id } : null;
  }

  return {
    name: "cloudflare",

    async createZone(domain) {
      const name = fqdn(domain);
      let zone: CfZone;
      try {
        const env = await cfFetch<CfZone>(
          "/zones",
          {
            method: "POST",
            body: JSON.stringify({
              name,
              account: { id: opts.accountId },
              type: "full",
            }),
          },
          client,
        );
        zone = env.result;
      } catch (err) {
        // WR-A04: 1061 may be CDS's own zone (an earlier run created it, then failed before
        // the dns_zones row was written). Return it when it is in CDS's account; the caller
        // decides whether another org already holds it. Elsewhere: still zone_exists.
        if (!(err instanceof CloudflareError) || err.code !== "zone_exists") {
          throw err;
        }
        const found = await cfFetch<CfZone[]>(
          `/zones?name=${encodeURIComponent(name)}&account.id=${encodeURIComponent(opts.accountId)}`,
          { method: "GET" },
          client,
        );
        const own = (found.result ?? []).find((z) => fqdn(z.name) === name);
        if (!own) throw err;
        zone = own;
      }
      zoneNames.set(zone.id, name);
      return {
        zoneId: zone.id,
        nameservers: (zone.name_servers ?? []).map((ns) => fqdn(ns)),
        status: mapZoneStatus(zone.status),
      };
    },

    async zoneStatus(zoneId) {
      return mapZoneStatus((await getZone(zoneId)).status);
    },

    async listRecords(zoneId) {
      const out: ProviderRecord[] = [];
      for (const cf of await listCf(zoneId)) {
        const r = withId(cf);
        if (r) out.push(r);
      }
      return out;
    },

    async upsertRecord(zoneId, r) {
      const zone = await zoneName(zoneId);
      const n = normalizeRecord(r);
      if (n.type === "SOA")
        throw new InvalidInput("SOA records are managed by the DNS host");
      if (n.type === "NS" && n.name === zone) {
        throw new InvalidInput("apex NS records are managed by the DNS host");
      }
      if (n.name !== zone && !n.name.endsWith(`.${zone}`)) {
        throw new InvalidInput("record is outside the zone");
      }
      const body = JSON.stringify(toCfBody(r, zone));
      const existing = (await listCf(zoneId)).find((cf) => {
        const have = fromCfRecord(cf);
        return have !== null && sameSlot(have, n);
      });
      const env = existing
        ? await cfFetch<CfRecord>(
            `/zones/${checkId(zoneId)}/dns_records/${checkId(existing.id)}`,
            { method: "PUT", body },
            client,
          )
        : await cfFetch<CfRecord>(
            `/zones/${checkId(zoneId)}/dns_records`,
            { method: "POST", body },
            client,
          );
      const stored = withId(env.result);
      if (!stored) throw new CloudflareError("bad_response", null, false);
      return stored;
    },

    async deleteRecord(zoneId, recordId) {
      try {
        await cfFetch<unknown>(
          `/zones/${checkId(zoneId)}/dns_records/${checkId(recordId)}`,
          { method: "DELETE" },
          client,
        );
      } catch (err) {
        if (err instanceof CloudflareError && err.status === 404) return;
        throw err;
      }
    },

    async importBind(zoneId, zoneFile) {
      if (new TextEncoder().encode(zoneFile).length > MAX_ZONE_FILE_BYTES) {
        throw new CloudflareError("too_large", null, false);
      }
      checkId(zoneId);
      const zone = await zoneName(zoneId);
      // Re-format: absolute owners and CNAME/MX/NS/SRV targets with the trailing dot.
      const file = formatBind(zone, parseBind(zoneFile, zone));
      if (new TextEncoder().encode(file).length > MAX_ZONE_FILE_BYTES) {
        throw new CloudflareError("too_large", null, false);
      }
      return lock(async () => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([file], { type: "text/plain" }),
          "zone.txt",
        );
        form.append("proxied", "false");
        const env = await cfFetch<{
          recs_added?: number;
          total_records_parsed?: number;
        }>(
          `/zones/${zoneId}/dns_records/import`,
          { method: "POST", body: form },
          client,
        );
        const added = env.result?.recs_added ?? 0;
        const parsed = env.result?.total_records_parsed ?? added;
        return { added, skipped: Math.max(0, parsed - added) };
      });
    },

    async exportBind(zoneId) {
      return cfFetchText(
        `/zones/${checkId(zoneId)}/dns_records/export`,
        { method: "GET" },
        client,
      );
    },

    async scanRecords(zoneId) {
      await cfFetch<unknown>(
        `/zones/${checkId(zoneId)}/dns_records/scan/trigger`,
        { method: "POST" },
        client,
      );
      const env = await cfFetch<CfRecord[]>(
        `/zones/${checkId(zoneId)}/dns_records/scan/review`,
        { method: "GET" },
        client,
      );
      const out: DnsRecord[] = [];
      for (const cf of env.result ?? []) {
        const r = fromCfRecord(cf);
        if (r) out.push({ ...r, sources: ["scan"] });
      }
      return out;
    },

    async deleteZone(zoneId) {
      try {
        await cfFetch<unknown>(
          `/zones/${checkId(zoneId)}`,
          { method: "DELETE" },
          client,
        );
      } catch (err) {
        if (err instanceof CloudflareError && err.status === 404) return;
        throw err;
      }
      zoneNames.delete(zoneId);
    },
  };
}
