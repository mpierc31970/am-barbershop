// packages/db/src/dns/snapshot.ts (P14, DOM-05, DOM-04).
// Owner: 14-13 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The snapshot of a domain's current zone (D58, D171, D187, P14-P24): the union of three
// tagged sources, deduped by recordKey:
//   zone_file  a BIND export the owner uploaded
//   scan       the DNS host's own scan (Cloudflare only; the fake has none)
//   sweep      an authoritative sweep: the domain's current nameservers asked BY IP (never a
//              caching resolver) for every sweepNames() entry, plus a random-label wildcard
//              probe `cds-probe-<8 hex>.<domain>` (Pitfall 10)
// The JSON goes to the private object store at tenants/<org>/dns/snapshots/<ISO>.json and the
// org's dns_zones row (keyed by org_id + domain, P14-P23) gets a summary. Deny-by-default:
// only the Snapshot fields are serialised, records only as type/name/value/priority/ttl/
// sources (T-14-13-02). Errors are logged by class name only; no host or value is logged.
import { randomBytes } from "node:crypto";
import { InvalidInput, NotFound } from "@cds/core";
import {
  dedupeRecords,
  fqdn,
  isRType,
  normalizeRecord,
  parseBind,
  RECORD_SOURCES,
  recordKey,
  sweepNames,
  type DnsRecord,
  type RecordSource,
  type RType,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertId } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import { tenantDnsSnapshotKey, tenantDnsSnapshotPrefix } from "../storage/keys";
import { getDnsProvider, getDnsResolver, getRegistryLookup } from "./factory";
import { mapLimited } from "./limit";
import type {
  DnsAnswer,
  DnsProvider,
  DnsResolver,
  RegistryLookup,
} from "./ports";

export const DNS_ZONES_COLLECTION = "dns_zones";

/** At most this many DNS queries in flight during a sweep or read-back (T-14-13-03). */
export const DNS_QUERY_CONCURRENCY = 8;

/** The stored snapshot (P14-P24). Nothing else is ever serialised. */
export type Snapshot = {
  v: 1;
  domain: string;
  takenAt: string;
  /** Which sources contributed, in RECORD_SOURCES order. */
  sources: RecordSource[];
  wildcard: boolean;
  records: DnsRecord[];
  registrar: string | null;
  /** RDAP/DoH at snapshot time: true on, false off, null unknown. */
  dnssec: boolean | null;
  /** The apex NS set the domain was delegated to when the snapshot was taken. */
  originalNameservers: string[];
};

export type SweepResult = {
  records: DnsRecord[];
  wildcard: boolean;
  /** The apex NS names (the delegation as public DNS sees it). */
  nameservers: string[];
  /** `_domainkey` exists (nodata) but no known selector answered: G2 asks for the zone file. */
  dkimHidden: boolean;
  /** Queries answered with `error`. */
  errors: number;
};

export type SnapshotDeps = {
  resolver?: DnsResolver;
  registry?: RegistryLookup;
  provider?: DnsProvider;
  store?: ObjectStore;
  /** 8 hex chars for the wildcard probe label (tests). */
  probeLabel?: () => string;
};

/**
 * CR-A02: the domain is already delegated (wholly or partly) to CDS's own zone, so a sweep
 * would read CDS's copy, not the old host. Never snapshot it.
 */
export class DnsSweepAtCds extends Error {
  constructor() {
    super("The domain already points to CDS");
    this.name = "DnsSweepAtCds";
  }
}

/** The domain's DNS could not be read (no nameserver IPs, or every query failed). */
export class DnsSweepFailed extends Error {
  constructor() {
    super("The domain's DNS could not be read");
    this.name = "DnsSweepFailed";
  }
}

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

/** fqdn() plus a hostname shape check; InvalidInput otherwise. */
export function snapshotDomain(domain: string): string {
  const d = typeof domain === "string" ? fqdn(domain) : "";
  if (!DOMAIN_RE.test(d)) throw new InvalidInput("invalid domain");
  return d;
}

function inZone(name: string, d: string): boolean {
  return name === d || name.endsWith(`.${d}`);
}

function tag(rs: readonly DnsRecord[], source: RecordSource): DnsRecord[] {
  return rs.map((r) => ({ ...normalizeRecord(r), sources: [source] }));
}

/** type + value + priority: what a wildcard answer looks like at any name. */
function answerSig(r: DnsRecord): string {
  const k = recordKey(r).split("\u0000");
  return `${k[0]}\u0000${k[2]}\u0000${k[3]}`;
}

function defaultProbeLabel(): string {
  return randomBytes(4).toString("hex");
}

/**
 * The authoritative sweep (14-13 choice 1). Pure network read: never touches PocketBase or
 * the object store, so `domains:check` can call it. Throws DnsSweepFailed when the domain
 * has no nameserver IPs or no query got an answer.
 */
export async function sweepZone(
  domain: string,
  deps: {
    resolver?: DnsResolver;
    probeLabel?: () => string;
    /** CDS's assigned nameservers for this domain: a delegation to any of them throws. */
    cdsNameservers?: readonly string[];
  } = {},
): Promise<SweepResult> {
  const d = snapshotDomain(domain);
  const resolver = deps.resolver ?? getDnsResolver();
  const ns = await resolver.resolveNsIps(d);
  const cds = new Set((deps.cdsNameservers ?? []).map((n) => fqdn(n)));
  if (cds.size > 0 && ns.names.some((n) => cds.has(fqdn(n)))) {
    throw new DnsSweepAtCds();
  }
  if (ns.ips.length === 0) throw new DnsSweepFailed();
  const servers = [...ns.ips];
  let errors = 0;
  let answered = 0;
  const ask = async (name: string, type: RType): Promise<DnsAnswer> => {
    const a = await resolver.resolve(name, type, { servers });
    if (a.status === "error") errors++;
    else answered++;
    return a;
  };

  // Wildcard probe: a random label no one would create.
  const label = `cds-probe-${(deps.probeLabel ?? defaultProbeLabel)()}.${d}`;
  const wildRecords: DnsRecord[] = [];
  for (const type of ["CNAME", "A", "AAAA", "TXT", "MX"] as const) {
    const a = await ask(label, type);
    if (a.status === "nxdomain") break;
    if (a.status !== "ok") continue;
    for (const r of a.records) {
      wildRecords.push({ ...r, name: `*.${d}` });
    }
    if (a.records.some((r) => r.type === "CNAME")) break;
  }
  const wild = dedupeRecords(tag(wildRecords, "sweep"));
  const wildSigs = new Set(wild.map(answerSig));

  const names = sweepNames(d);
  const perName = await mapLimited(
    names,
    DNS_QUERY_CONCURRENCY,
    async (sn): Promise<DnsRecord[]> => {
      const found: DnsRecord[] = [];
      const types = sn.types.includes("CNAME")
        ? ["CNAME" as RType, ...sn.types.filter((t) => t !== "CNAME")]
        : sn.types;
      for (const type of types) {
        const a = await ask(sn.name, type);
        if (a.status === "nxdomain") break;
        if (a.status !== "ok") continue;
        found.push(...a.records.filter((r) => inZone(fqdn(r.name), d)));
        // A CNAME owns its name: nothing else can live there.
        if (a.records.some((r) => r.type === "CNAME")) break;
      }
      return found;
    },
  );
  if (answered === 0) throw new DnsSweepFailed();

  const swept = tag(perName.flat(), "sweep").filter(
    (r) => r.name === d || !wildSigs.has(answerSig(r)),
  );
  const nameservers = [
    ...new Set(
      swept.filter((r) => r.type === "NS" && r.name === d).map((r) => r.value),
    ),
  ];
  const records = dedupeRecords([
    ...swept.filter((r) => !(r.type === "NS" && r.name === d)),
    ...wild,
  ]);

  const dkimSeen = records.some((r) => r.name.endsWith(`._domainkey.${d}`));
  let dkimHidden = false;
  if (!dkimSeen) {
    const a = await ask(`_domainkey.${d}`, "TXT");
    dkimHidden = a.status === "nodata";
  }
  return {
    records,
    wildcard: wild.length > 0,
    nameservers: nameservers.length > 0 ? nameservers : [...ns.names],
    dkimHidden,
    errors,
  };
}

/** Exactly the Snapshot fields (deny by default, D187). */
function serialiseRecord(r: DnsRecord): DnsRecord {
  const out: DnsRecord = { type: r.type, name: r.name, value: r.value };
  if (typeof r.priority === "number") out.priority = r.priority;
  if (typeof r.ttl === "number") out.ttl = r.ttl;
  const sources = (r.sources ?? []).filter((s) =>
    (RECORD_SOURCES as readonly string[]).includes(s),
  );
  if (sources.length > 0) out.sources = sources;
  return out;
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Pick the Snapshot fields from untrusted JSON; null when it is not a v1 snapshot. */
export function pickSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.domain !== "string") return null;
  if (typeof o.takenAt !== "string") return null;
  const records: DnsRecord[] = [];
  for (const r of Array.isArray(o.records) ? o.records : []) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.type !== "string" || !isRType(x.type)) continue;
    if (typeof x.name !== "string" || typeof x.value !== "string") continue;
    records.push(
      serialiseRecord({
        type: x.type,
        name: x.name,
        value: x.value,
        ...(typeof x.priority === "number" ? { priority: x.priority } : {}),
        ...(typeof x.ttl === "number" ? { ttl: x.ttl } : {}),
        sources: strings(x.sources) as RecordSource[],
      }),
    );
  }
  return {
    v: 1,
    domain: o.domain,
    takenAt: o.takenAt,
    sources: strings(o.sources).filter((s): s is RecordSource =>
      (RECORD_SOURCES as readonly string[]).includes(s),
    ),
    wildcard: o.wildcard === true,
    records,
    registrar: typeof o.registrar === "string" ? o.registrar : null,
    dnssec: typeof o.dnssec === "boolean" ? o.dnssec : null,
    originalNameservers: strings(o.originalNameservers),
  };
}

// ---------------------------------------------------------------------------------------
// dns_zones row (platform collection; org_id text, P13-P5)
// ---------------------------------------------------------------------------------------

export type DnsZoneStatus =
  "pending" | "active" | "moved" | "handed_back" | "deleted";

export type DnsZoneRow = {
  id: string;
  orgId: string;
  domain: string;
  status: DnsZoneStatus;
  provider: "fake" | "cloudflare" | null;
  providerZoneId: string | null;
  /** The CDS nameservers the host assigned. */
  nameservers: string[];
  originalNameservers: string[];
  registrar: string | null;
  expiresAt: string | null;
  dnssec: "on" | "off" | "unknown" | null;
  snapshotKey: string | null;
  snapshotAt: string | null;
  cdsKeys: { cds: string[]; owner: string[] };
};

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export function toDnsZoneRow(rec: RecordModel): DnsZoneRow {
  const keys = (rec.cds_keys ?? {}) as Record<string, unknown>;
  const provider = str(rec.provider);
  const dnssec = str(rec.dnssec);
  return {
    id: rec.id,
    orgId: String(rec.org_id),
    domain: String(rec.domain),
    status: String(rec.status) as DnsZoneStatus,
    provider:
      provider === "fake" || provider === "cloudflare" ? provider : null,
    providerZoneId: str(rec.provider_zone_id),
    nameservers: strings(rec.nameservers),
    originalNameservers: strings(rec.original_nameservers),
    registrar: str(rec.registrar),
    expiresAt: str(rec.expires_at),
    dnssec:
      dnssec === "on" || dnssec === "off" || dnssec === "unknown"
        ? dnssec
        : null,
    snapshotKey: str(rec.snapshot_key),
    snapshotAt: str(rec.snapshot_at),
    cdsKeys: { cds: strings(keys.cds), owner: strings(keys.owner) },
  };
}

async function zoneRecordFor(
  pb: PocketBase,
  orgId: string,
  domain: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(DNS_ZONES_COLLECTION).getList(1, 1, {
    filter: pb.filter("org_id = {:org} && domain = {:domain}", {
      org: orgId,
      domain,
    }),
    skipTotal: true,
  });
  return res.items[0] ?? null;
}

/** The org's dns_zones row for one domain, or null. */
export async function readDnsZoneRow(
  orgId: string,
  domain: string,
): Promise<DnsZoneRow | null> {
  assertId(orgId);
  const d = snapshotDomain(domain);
  return withSuperuser(async (pb) => {
    const rec = await zoneRecordFor(pb, orgId, d);
    return rec ? toDnsZoneRow(rec) : null;
  });
}

/**
 * Upsert the (org_id, domain) row with `patch` (race-safe like indexing-record.ts: the
 * unique (org_id, domain) index settles a create race). New rows start `pending`.
 */
export async function upsertDnsZoneRow(
  orgId: string,
  domain: string,
  patch: Record<string, unknown>,
): Promise<DnsZoneRow> {
  assertId(orgId);
  const d = snapshotDomain(domain);
  return withSuperuser(async (pb) => {
    const coll = pb.collection(DNS_ZONES_COLLECTION);
    const existing = await zoneRecordFor(pb, orgId, d);
    if (existing) return toDnsZoneRow(await coll.update(existing.id, patch));
    try {
      return toDnsZoneRow(
        await coll.create({
          org_id: orgId,
          domain: d,
          status: "pending",
          ...patch,
        }),
      );
    } catch (err) {
      const again = await zoneRecordFor(pb, orgId, d);
      if (!again) throw err;
      return toDnsZoneRow(await coll.update(again.id, patch));
    }
  });
}

// ---------------------------------------------------------------------------------------
// Take / read
// ---------------------------------------------------------------------------------------

function dnssecSelect(v: boolean | null): "on" | "off" | "unknown" {
  return v === true ? "on" : v === false ? "off" : "unknown";
}

/**
 * Take a snapshot of `domain`'s current zone for `orgId` (14-13 choice 2): zone file +
 * provider scan (Cloudflare only, when `zoneId` is given) + authoritative sweep, written as
 * JSON and summarised on the dns_zones row.
 */
export async function takeSnapshot(
  orgId: string,
  domain: string,
  opts: {
    zoneFile?: string;
    zoneId?: string;
    deps?: SnapshotDeps;
    now?: Date;
  } = {},
): Promise<{ key: string; snapshot: Snapshot; zoneRowId: string }> {
  assertId(orgId);
  const d = snapshotDomain(domain);
  const deps = opts.deps ?? {};
  const now = opts.now ?? new Date();

  // Zone file first: a bad upload fails before any network work (ZoneFileError).
  const fileRecords =
    opts.zoneFile !== undefined && opts.zoneFile.trim() !== ""
      ? tag(parseBind(opts.zoneFile, d), "zone_file").filter((r) =>
          inZone(r.name, d),
        )
      : [];

  let scanRecords: DnsRecord[] = [];
  if (opts.zoneId) {
    const provider = deps.provider ?? getDnsProvider();
    if (provider.name === "cloudflare") {
      scanRecords = tag(await provider.scanRecords(opts.zoneId), "scan").filter(
        (r) => inZone(r.name, d),
      );
    }
  }

  // CR-A02: while the CDS zone is not yet the domain's live DNS, a delegation to its
  // nameservers means the sweep would read CDS's own copy.
  const current = await readDnsZoneRow(orgId, d);
  const cdsNameservers =
    current && current.status !== "active" ? current.nameservers : [];
  const sweep = await sweepZone(d, {
    resolver: deps.resolver,
    probeLabel: deps.probeLabel,
    cdsNameservers,
  });
  const info = await (deps.registry ?? getRegistryLookup()).lookup(d);

  const isApexNs = (r: DnsRecord): boolean => r.type === "NS" && r.name === d;
  const fileNs = fileRecords.filter(isApexNs).map((r) => r.value);
  const records = dedupeRecords([
    ...fileRecords,
    ...scanRecords,
    ...sweep.records,
  ]).filter((r) => r.type !== "SOA" && !isApexNs(r));

  const used = new Set<RecordSource>();
  for (const r of records) for (const s of r.sources ?? []) used.add(s);
  const snapshot: Snapshot = {
    v: 1,
    domain: d,
    takenAt: now.toISOString(),
    sources: RECORD_SOURCES.filter((s) => used.has(s)),
    wildcard: sweep.wildcard || records.some((r) => r.name === `*.${d}`),
    records: records.map(serialiseRecord),
    registrar: info.registrar,
    dnssec: info.dnssec,
    originalNameservers:
      sweep.nameservers.length > 0 ? sweep.nameservers : [...new Set(fileNs)],
  };

  const key = tenantDnsSnapshotKey(orgId, now);
  const store = deps.store ?? getObjectStore();
  await store.put(key, JSON.stringify(snapshot), "application/json");

  // CR-A02: never replace a known original NS set with one that holds CDS's nameservers.
  const assigned = new Set((current?.nameservers ?? []).map((n) => fqdn(n)));
  const keepOriginal =
    (current?.originalNameservers.length ?? 0) > 0 &&
    snapshot.originalNameservers.some((n) => assigned.has(fqdn(n)));
  const row = await upsertDnsZoneRow(orgId, d, {
    snapshot_key: key,
    snapshot_at: snapshot.takenAt,
    registrar: (info.registrar ?? "").slice(0, 120),
    expires_at: info.expiresAt ?? "",
    dnssec: dnssecSelect(info.dnssec),
    ...(keepOriginal
      ? {}
      : { original_nameservers: snapshot.originalNameservers }),
  });
  return { key, snapshot, zoneRowId: row.id };
}

/** Read one of `orgId`'s snapshots; a key outside the org's snapshot prefix is NotFound. */
export async function readSnapshot(
  orgId: string,
  key: string,
  deps: { store?: ObjectStore } = {},
): Promise<Snapshot | null> {
  assertId(orgId);
  if (
    typeof key !== "string" ||
    !key.startsWith(tenantDnsSnapshotPrefix(orgId)) ||
    key.includes("..")
  ) {
    throw new NotFound();
  }
  const bytes = await (deps.store ?? getObjectStore()).get(key);
  if (!bytes) return null;
  try {
    return pickSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** The latest snapshot of `domain` for `orgId` (from its dns_zones row), or null. */
export async function latestSnapshot(
  orgId: string,
  domain: string,
  deps: { store?: ObjectStore } = {},
): Promise<{ key: string; snapshot: Snapshot; row: DnsZoneRow } | null> {
  const row = await readDnsZoneRow(orgId, domain);
  if (!row?.snapshotKey) return null;
  const snapshot = await readSnapshot(orgId, row.snapshotKey, deps);
  return snapshot ? { key: row.snapshotKey, snapshot, row } : null;
}
