// packages/db/src/offboarding/handback.ts (P14, LIFE-01, DOM-05).
// Owner: 14-40 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Leaving CDS, step one: give the DNS back exactly (D282, D58; DOM-05 in reverse).
//   - exportZoneFile: the live CDS zone as a BIND file, its notes marking CDS's records
//     ("points to CDS", "remove"), stored at tenants/<org>/dns/handback/ (private store).
//   - handbackView: every record of the CDS zone grouped copy_exactly / points_to_cds / remove
//     (classified with dns_zones.cds_keys), the destination and the last check.
//   - chooseHandbackDestination: back to the registrar's DNS (the snapshot's original
//     nameservers) or another host's two nameservers (validated hostnames; the real resolver
//     only ever asks public IPs, T-14-40-01).
//   - checkHandbackDestination: the reverse gate. zoneGate with the CDS zone's non-CDS records
//     as the "snapshot" and the destination's own answers (asked by IP) as the "copy". Only G1
//     means anything in reverse. An email record missing -> mismatch (the switch is not
//     offered); a destination that can't answer before delegation -> ready_to_switch with
//     HANDBACK-AFTER (the check runs through public DNS after the switch).
//   - confirmHandbackSwitched: "I've changed them" -> waiting.
//   - advanceHandbacks (domains:run step `handbacks`): once public DNS shows the delegation
//     away from CDS, the same check runs through PUBLIC_RESOLVERS: no email record missing ->
//     done (zone handed_back, offboarding dns_handback done, owner mailed); otherwise mismatch
//     (owner bell + staff alert, CDS's nameservers shown to switch back to). The CDS zone is
//     deleted only here, only while the delegation is away from CDS, and only once every
//     record was found (checkPassed) or 30 days after the move away (staff alert first).
// Org scoping (P14-P34): every ctx function resolves its org with scopedOrgId first and loads
// the zone by (org_id, domain); another org's id or domain is NotFound. Errors are logged by
// class name only; never a host, record value or address.
import { createHash } from "node:crypto";
import { authorizeStaff, InvalidInput, NotFound, RateLimited } from "@cds/core";
import {
  classifyRecord,
  fqdn,
  normalizeRecord,
  P14_COPY,
  recordKey,
  zoneGate,
  type DnsRecord,
  type GateRule,
  type RType,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  isOrgContext,
  isPlatformContext,
  scopedOrgId,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { getDnsProvider, getDnsResolver } from "../dns/factory";
import { mapLimited } from "../dns/limit";
import {
  PUBLIC_RESOLVERS,
  type DnsProvider,
  type DnsResolver,
} from "../dns/ports";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { SlidingWindowLimiter } from "../rate-limit";
import { getObjectStore, type ObjectStore } from "../storage";
import { tenantDnsHandbackKey } from "../storage/keys";
import { errName, LEAVING_HREF, orgFacts, sysCtx } from "./effects";
import { DAY_MS, OFFBOARDINGS, parseSteps, readOffboardingRow } from "./model";
import { authorizeOffboarding, recordHandbackDone } from "./steps";

const DNS_ZONES = "dns_zones";

/** Delete the CDS zone this long after the delegation moved away, whatever the check says. */
export const HANDBACK_DELETE_AFTER_DAYS = 30;
/** Owner checks (choose + check) per org per minute; staff are not limited. */
export const HANDBACK_CHECKS_PER_MINUTE = 4;
const MISSING_CAP = 400;
const QUERY_CONCURRENCY = 8;

export type HandbackDestinationKind = "registrar" | "other";
export type HandbackStatus =
  "open" | "checking" | "ready_to_switch" | "waiting" | "done" | "mismatch";

export type HandbackGroups = {
  /** Everything that isn't CDS's: copy it exactly (email first). */
  copy_exactly: DnsRecord[];
  /** Site A / www CDS manages: change when the new site is ready. */
  points_to_cds: DnsRecord[];
  /** CDS sending records (SES DKIM / MAIL FROM / DMARC) and CDS's CAA: remove. */
  remove: DnsRecord[];
};

export type HandbackZoneView = {
  domain: string;
  /** The dns_zones status (active | moved | handed_back | deleted). */
  zoneStatus: string;
  registrar: string | null;
  groups: HandbackGroups;
  destination: HandbackDestinationKind | null;
  destinationNameservers: string[];
  /** CDS's nameservers (what to switch back to on a mismatch). */
  cdsNameservers: string[];
  /** One row per copy_exactly record once a check ran (empty before). */
  results: { record: DnsRecord; found: boolean }[];
  /** The destination answers for the domain before the switch (false: HANDBACK-AFTER). */
  canCheckBefore: boolean;
  status: HandbackStatus;
  /** Email-class records not found at the last check. */
  emailMissing: number;
  /** Owner copy for the status (HANDBACK-AFTER / -DONE / -MISMATCH), or null. */
  message: string | null;
  checkedAt: string | null;
  switchedAt: string | null;
  movedAwayAt: string | null;
  /** Every record was found at the destination (deletion may go ahead). */
  checkPassed: boolean;
  deletedAt: string | null;
};

export type HandbackView = { zones: HandbackZoneView[] };

/** Injectable adapters and clock (every network adapter is injectable). */
export type HandbackDeps = {
  now?: Date;
  provider?: DnsProvider;
  resolver?: DnsResolver;
  store?: ObjectStore;
  transport?: EmailTransport;
};

// ---------------------------------------------------------------------------------------
// The stored state (dns_zones.handback, maxSize 20000: record hashes only, never values)
// ---------------------------------------------------------------------------------------

type HandbackState = {
  v: 1;
  status: HandbackStatus;
  destination: HandbackDestinationKind | null;
  nameservers: string[];
  canCheckBefore: boolean;
  /** sha256(recordKey)[0..16] of the copy_exactly records not found at the last check. */
  missing: string[];
  emailMissing: number;
  checked: boolean;
  checkPassed: boolean;
  checkedAt: string | null;
  switchedAt: string | null;
  movedAwayAt: string | null;
  doneAt: string | null;
  mismatchAlertedAt: string | null;
  deletedAt: string | null;
  zoneFileKey: string | null;
};

function emptyState(): HandbackState {
  return {
    v: 1,
    status: "open",
    destination: null,
    nameservers: [],
    canCheckBefore: false,
    missing: [],
    emailMissing: 0,
    checked: false,
    checkPassed: false,
    checkedAt: null,
    switchedAt: null,
    movedAwayAt: null,
    doneAt: null,
    mismatchAlertedAt: null,
    deletedAt: null,
    zoneFileKey: null,
  };
}

const STATUSES: readonly HandbackStatus[] = [
  "open",
  "checking",
  "ready_to_switch",
  "waiting",
  "done",
  "mismatch",
];

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function parseState(v: unknown): HandbackState {
  const o =
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const base = emptyState();
  const dest = o.destination;
  return {
    ...base,
    status: STATUSES.includes(o.status as HandbackStatus)
      ? (o.status as HandbackStatus)
      : "open",
    destination: dest === "registrar" || dest === "other" ? dest : null,
    nameservers: strings(o.nameservers),
    canCheckBefore: o.canCheckBefore === true,
    missing: strings(o.missing),
    emailMissing:
      typeof o.emailMissing === "number" && o.emailMissing >= 0
        ? Math.floor(o.emailMissing)
        : 0,
    checked: o.checked === true,
    checkPassed: o.checkPassed === true,
    checkedAt: strOrNull(o.checkedAt),
    switchedAt: strOrNull(o.switchedAt),
    movedAwayAt: strOrNull(o.movedAwayAt),
    doneAt: strOrNull(o.doneAt),
    mismatchAlertedAt: strOrNull(o.mismatchAlertedAt),
    deletedAt: strOrNull(o.deletedAt),
    zoneFileKey: strOrNull(o.zoneFileKey),
  };
}

type ZoneRec = {
  id: string;
  orgId: string;
  domain: string;
  status: string;
  providerZoneId: string;
  nameservers: string[];
  originalNameservers: string[];
  registrar: string | null;
  cdsKeys: string[];
  state: HandbackState;
};

function toZoneRec(r: RecordModel): ZoneRec {
  const keys = (r.cds_keys ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    orgId: String(r.org_id ?? ""),
    domain: String(r.domain ?? ""),
    status: String(r.status ?? ""),
    providerZoneId: String(r.provider_zone_id ?? ""),
    nameservers: strings(r.nameservers).map((n) => fqdn(n)),
    originalNameservers: strings(r.original_nameservers).map((n) => fqdn(n)),
    registrar: strOrNull(r.registrar),
    cdsKeys: strings(keys.cds),
    state: parseState(r.handback),
  };
}

/** Zone statuses the handback is about: still at CDS, or already given back. */
const AT_CDS = new Set(["active", "moved"]);

function keyHash(r: DnsRecord): string {
  return createHash("sha256").update(recordKey(r)).digest("hex").slice(0, 16);
}

function nowOf(v: Date | undefined): Date {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v : new Date();
}

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

function domainOrNotFound(domain: unknown): string {
  const d = typeof domain === "string" ? fqdn(domain) : "";
  if (!DOMAIN_RE.test(d)) throw new NotFound();
  return d;
}

/** The org's zone row for one domain (P14-P34: another org's domain is NotFound). */
async function loadZone(orgId: string, domain: string): Promise<ZoneRec> {
  const d = domainOrNotFound(domain);
  const rec = await withSuperuser(async (pb) => {
    const res = await pb.collection(DNS_ZONES).getList(1, 1, {
      filter: pb.filter("org_id = {:org} && domain = {:d}", {
        org: orgId,
        d,
      }),
      skipTotal: true,
    });
    return res.items[0] ?? null;
  });
  if (!rec) throw new NotFound();
  return toZoneRec(rec);
}

async function writeState(
  ctx: OrgContext | PlatformContext | SystemContext,
  zone: ZoneRec,
  state: HandbackState,
  action: string | null,
  meta: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<void> {
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(DNS_ZONES).update(zone.id, { handback: state, ...extra });
    if (action) {
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action,
          organization: zone.orgId,
          targetCollection: DNS_ZONES,
          targetId: zone.id,
          meta: { domain: zone.domain, ...meta },
        }),
      );
    }
    await batch.send();
  });
}

// ---------------------------------------------------------------------------------------
// Grouping (choice 1)
// ---------------------------------------------------------------------------------------

const CLASS_ORDER: Readonly<Record<string, number>> = {
  email: 0,
  verification: 1,
  site: 2,
  other: 3,
  cds: 4,
};

function isSiteRecord(r: DnsRecord, domain: string): boolean {
  const name = fqdn(r.name);
  return (
    (name === domain || name === `www.${domain}`) &&
    (r.type === "A" || r.type === "AAAA" || r.type === "CNAME")
  );
}

/** Group the CDS zone's records with its cds_keys (SOA and the apex NS left out). */
export function groupHandbackRecords(
  domain: string,
  records: readonly DnsRecord[],
  cdsKeys: readonly string[],
): HandbackGroups {
  const d = fqdn(domain);
  const keys = new Set(cdsKeys);
  const groups: HandbackGroups = {
    copy_exactly: [],
    points_to_cds: [],
    remove: [],
  };
  for (const raw of records) {
    const r = normalizeRecord(plain(raw));
    if (r.type === "SOA" || (r.type === "NS" && fqdn(r.name) === d)) continue;
    if (classifyRecord(r, d, { cdsKeys: keys }) === "cds") {
      if (isSiteRecord(r, d)) groups.points_to_cds.push(r);
      else groups.remove.push(r);
    } else {
      groups.copy_exactly.push(r);
    }
  }
  const rank = (r: DnsRecord) => CLASS_ORDER[classifyRecord(r, d)] ?? 9;
  groups.copy_exactly.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.type.localeCompare(b.type) ||
      fqdn(a.name).localeCompare(fqdn(b.name)),
  );
  return groups;
}

/** A provider record without the host's id (never serialised). */
function plain(r: DnsRecord & { id?: string }): DnsRecord {
  const out: DnsRecord = { type: r.type, name: r.name, value: r.value };
  if (r.priority !== undefined) out.priority = r.priority;
  if (r.ttl !== undefined) out.ttl = r.ttl;
  return out;
}

async function zoneRecords(
  zone: ZoneRec,
  provider: DnsProvider,
): Promise<DnsRecord[]> {
  if (zone.providerZoneId === "" || zone.status === "deleted") return [];
  const listed = await provider.listRecords(zone.providerZoneId);
  return listed.map((r) => plain(r));
}

// ---------------------------------------------------------------------------------------
// Zone file (choice 5 uses it too)
// ---------------------------------------------------------------------------------------

function noteLine(r: DnsRecord): string {
  const v = r.value.replace(/[\r\n]+/g, " ");
  const p = r.priority !== undefined ? ` ${r.priority}` : "";
  return `;   ${fqdn(r.name)} ${r.type}${p} ${v}`;
}

/**
 * The live CDS zone as a BIND file (provider exportBind) with notes marking CDS's records,
 * stored at tenants/<org>/dns/handback/<domain>-<ISO>.txt (T-14-40-04: private store,
 * served only through the owner's download). `zoneRowId` must be one of `orgId`'s rows.
 */
export async function exportZoneFile(
  orgId: string,
  zoneRowId: string,
  deps: HandbackDeps = {},
): Promise<{ text: string; key: string }> {
  if (!/^[a-z0-9]{15}$/.test(orgId) || !/^[a-z0-9]{15}$/.test(zoneRowId)) {
    throw new NotFound();
  }
  const rec = await withSuperuser((pb) =>
    pb
      .collection(DNS_ZONES)
      .getOne(zoneRowId)
      .catch(() => null),
  );
  if (!rec || String(rec.org_id) !== orgId) throw new NotFound();
  const zone = toZoneRec(rec);
  if (zone.providerZoneId === "" || zone.status === "deleted") {
    throw new NotFound();
  }
  const provider = deps.provider ?? getDnsProvider();
  const bind = await provider.exportBind(zone.providerZoneId);
  const groups = groupHandbackRecords(
    zone.domain,
    await zoneRecords(zone, provider),
    zone.cdsKeys,
  );
  const notes = [
    `; DNS records for ${zone.domain}, from Support.`,
    "; Copy exactly: every record below that is not listed in the two notes here.",
  ];
  if (groups.points_to_cds.length > 0) {
    notes.push("; Points to us: change when your new site is ready:");
    for (const r of groups.points_to_cds) notes.push(noteLine(r));
  }
  if (groups.remove.length > 0) {
    notes.push("; Support sending records: remove (do not copy):");
    for (const r of groups.remove) notes.push(noteLine(r));
  }
  const text = `${notes.join("\n")}\n;\n${bind}`;
  const now = nowOf(deps.now);
  const key = tenantDnsHandbackKey(orgId, zone.domain, now);
  await (deps.store ?? getObjectStore()).put(key, text, "text/plain");
  return { text, key };
}

/** The zone file for the owner's Download button (Owner/Admin; staff with `domains`). */
export async function handbackZoneFile(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  domain: string,
  deps: HandbackDeps = {},
): Promise<{ filename: string; text: string }> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "read");
  const zone = await loadZone(org, domain);
  const { text } = await exportZoneFile(org, zone.id, deps);
  return { filename: `${zone.domain}-zone.txt`, text };
}

// ---------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------

function messageFor(zone: ZoneRec): string | null {
  const s = zone.state;
  if (s.status === "done") return P14_COPY.HANDBACK_DONE;
  if (s.status === "mismatch") {
    return P14_COPY.HANDBACK_MISMATCH({ count: Math.max(1, s.emailMissing) });
  }
  if (s.destination && s.status === "ready_to_switch" && !s.canCheckBefore) {
    return P14_COPY.HANDBACK_AFTER({
      registrar:
        s.destination === "registrar"
          ? (zone.registrar ?? "Your registrar")
          : "Your new DNS host",
    });
  }
  return null;
}

async function zoneView(
  zone: ZoneRec,
  provider: DnsProvider,
): Promise<HandbackZoneView> {
  const groups = groupHandbackRecords(
    zone.domain,
    await zoneRecords(zone, provider),
    zone.cdsKeys,
  );
  const s = zone.state;
  const missing = new Set(s.missing);
  return {
    domain: zone.domain,
    zoneStatus: zone.status,
    registrar: zone.registrar,
    groups,
    destination: s.destination,
    destinationNameservers: [...s.nameservers],
    cdsNameservers: [...zone.nameservers],
    results: s.checked
      ? groups.copy_exactly.map((record) => ({
          record,
          found: !missing.has(keyHash(record)),
        }))
      : [],
    canCheckBefore: s.canCheckBefore,
    status: s.status,
    emailMissing: s.emailMissing,
    message: messageFor(zone),
    checkedAt: s.checkedAt,
    switchedAt: s.switchedAt,
    movedAwayAt: s.movedAwayAt,
    checkPassed: s.checkPassed,
    deletedAt: s.deletedAt,
  };
}

/**
 * The DNS handback for the org's zones still at CDS (or handed back and still on record).
 * Owner/Admin (`offboarding:read`); staff with `domains`.
 */
export async function handbackView(
  ctx: OrgContext | PlatformContext,
  orgId?: string,
  deps: HandbackDeps = {},
): Promise<HandbackView> {
  const org = scopedOrgId(ctx, orgId);
  authorizeOffboarding(ctx, "read");
  const rows = await withSuperuser((pb) =>
    pb.collection(DNS_ZONES).getFullList({
      filter: pb.filter(
        "org_id = {:org} && (status = 'active' || status = 'moved' || status = 'handed_back' || status = 'deleted')",
        { org },
      ),
      sort: "domain",
    }),
  );
  const provider = deps.provider ?? getDnsProvider();
  const zones: HandbackZoneView[] = [];
  for (const r of rows) {
    const zone = toZoneRec(r);
    if (zone.status === "deleted" && zone.state.status !== "done") continue;
    zones.push(await zoneView(zone, provider));
  }
  return { zones };
}

// ---------------------------------------------------------------------------------------
// Owner actions (choices 2 and 3)
// ---------------------------------------------------------------------------------------

let checkLimiter = new SlidingWindowLimiter(HANDBACK_CHECKS_PER_MINUTE, 60_000);

/** Tests only: forget the per-org check limiter. */
export function resetHandbackLimitsForTests(): void {
  checkLimiter = new SlidingWindowLimiter(HANDBACK_CHECKS_PER_MINUTE, 60_000);
}

function limitOwner(ctx: OrgContext | PlatformContext, org: string): void {
  if (isOrgContext(ctx) && !checkLimiter.hit(`handback:${org}`)) {
    throw new RateLimited("Wait a minute, then check again.");
  }
}

/** Writes: the Owner (`offboarding:run`, never impersonated) or staff (`offboard`/`domains`). */
function authorizeWrite(
  ctx: OrgContext | PlatformContext,
  staffFeature: "offboard" | "domains",
): void {
  if (isPlatformContext(ctx)) {
    assertPlatformContext(ctx);
    authorizeStaff(ctx.staffRole, staffFeature);
    return;
  }
  authorizeOffboarding(ctx, "run");
}

async function assertLeaving(org: string): Promise<void> {
  const row = await readOffboardingRow(org);
  if (!row || row.status !== "notice") {
    throw new InvalidInput("Moving away hasn't started for this site.");
  }
}

function atCdsOrNotFound(zone: ZoneRec): void {
  if (!AT_CDS.has(zone.status)) throw new NotFound();
}

const NS_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

function nameserverInput(v: unknown): string {
  const s = typeof v === "string" ? fqdn(v.trim()) : "";
  if (!NS_RE.test(s)) {
    throw new InvalidInput(
      "Enter a nameserver name, like ns1.example-host.com.",
    );
  }
  return s;
}

type CheckOutcome = {
  canCheckBefore: boolean;
  /** Null when the destination could not be asked. */
  missing: DnsRecord[] | null;
  emailMissing: number;
};

/** IPs of the destination nameservers (the real resolver returns public IPs only). */
async function destinationIps(
  resolver: DnsResolver,
  names: readonly string[],
): Promise<string[]> {
  const lists = await Promise.all(
    names.map((n) => resolver.ipsFor(n).catch(() => [] as string[])),
  );
  return [...new Set(lists.flat())];
}

/** Ask `servers` for every (name, type) of `records` (plus nothing else). */
async function answersFrom(
  resolver: DnsResolver,
  records: readonly DnsRecord[],
  servers: string[],
): Promise<DnsRecord[]> {
  const pairs = new Map<string, { name: string; type: RType }>();
  for (const r of records) {
    const name = fqdn(r.name);
    pairs.set(`${r.type}\u0000${name}`, { name, type: r.type });
  }
  const answers = await mapLimited(
    [...pairs.values()],
    QUERY_CONCURRENCY,
    async (p) => {
      const a = await resolver
        .resolve(p.name, p.type, { servers })
        .catch(() => ({ status: "error" as const, records: [] }));
      return a.status === "ok" ? a.records : [];
    },
  );
  return answers.flat().map((r) => normalizeRecord(r));
}

/** The reverse gate: G1 only (G2-G7 are not meaningful in reverse; choice 3). */
function reverseGate(
  domain: string,
  wanted: DnsRecord[],
  copy: DnsRecord[],
  now: Date,
): { missing: DnsRecord[]; emailMissing: number } {
  const res = zoneGate({
    domain,
    snapshot: wanted,
    copy,
    takenAt: now,
    now,
    dnssec: false,
    zoneFileUploaded: true,
    acks: new Set<string>(),
    overrides: new Set<GateRule>(),
  });
  const g1 = res.findings.find((f) => f.rule === "G1");
  if (!g1 || g1.detail.rule !== "G1") return { missing: [], emailMissing: 0 };
  return {
    missing: [
      ...g1.detail.missing,
      ...g1.detail.mismatched.map((m) => m.original),
    ],
    emailMissing: g1.detail.emailMissing,
  };
}

async function checkAtDestination(
  zone: ZoneRec,
  wanted: DnsRecord[],
  nameservers: readonly string[],
  resolver: DnsResolver,
  now: Date,
): Promise<CheckOutcome> {
  const ips = await destinationIps(resolver, nameservers);
  if (ips.length === 0) {
    return { canCheckBefore: false, missing: null, emailMissing: 0 };
  }
  const soa = await resolver
    .resolve(zone.domain, "SOA", { servers: ips })
    .catch(() => ({ status: "error" as const, records: [] }));
  if (soa.status !== "ok") {
    return { canCheckBefore: false, missing: null, emailMissing: 0 };
  }
  const copy = await answersFrom(resolver, wanted, ips);
  const g = reverseGate(zone.domain, wanted, copy, now);
  return {
    canCheckBefore: true,
    missing: g.missing,
    emailMissing: g.emailMissing,
  };
}

function withOutcome(
  state: HandbackState,
  outcome: CheckOutcome,
  at: string,
): HandbackState {
  if (outcome.missing === null) {
    return {
      ...state,
      status: "ready_to_switch",
      canCheckBefore: false,
      checked: false,
      missing: [],
      emailMissing: 0,
      checkPassed: false,
      checkedAt: at,
    };
  }
  const missing = outcome.missing.slice(0, MISSING_CAP).map(keyHash);
  return {
    ...state,
    status: outcome.emailMissing > 0 ? "mismatch" : "ready_to_switch",
    canCheckBefore: true,
    checked: true,
    missing,
    emailMissing: outcome.emailMissing,
    checkPassed: outcome.missing.length === 0,
    checkedAt: at,
  };
}

async function runDestinationCheck(
  ctx: OrgContext | PlatformContext,
  zone: ZoneRec,
  state: HandbackState,
  deps: HandbackDeps,
  action: string,
  meta: Record<string, unknown>,
): Promise<HandbackState> {
  const now = nowOf(deps.now);
  const provider = deps.provider ?? getDnsProvider();
  const resolver = deps.resolver ?? getDnsResolver();
  const wanted = groupHandbackRecords(
    zone.domain,
    await zoneRecords(zone, provider),
    zone.cdsKeys,
  ).copy_exactly;
  const outcome = await checkAtDestination(
    zone,
    wanted,
    state.nameservers,
    resolver,
    now,
  );
  const next = withOutcome(state, outcome, now.toISOString());
  await writeState(ctx, zone, next, action, {
    ...meta,
    status: next.status,
    canCheckBefore: next.canCheckBefore,
    missing: outcome.missing?.length ?? null,
  });
  return next;
}

/**
 * Where the DNS goes (choice 2): `registrar` = the nameservers the domain had before CDS
 * (the snapshot's original_nameservers); `other` = two typed nameserver names. Runs the
 * reverse gate straight away. Owner (`offboarding:run`) or a super_admin (`offboard`).
 */
export async function chooseHandbackDestination(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  domain: string,
  input: { kind: HandbackDestinationKind; nameservers?: [string, string] },
  deps: HandbackDeps = {},
): Promise<HandbackZoneView> {
  const org = scopedOrgId(ctx, orgId);
  authorizeWrite(ctx, "offboard");
  const zone = await loadZone(org, domain);
  atCdsOrNotFound(zone);
  await assertLeaving(org);
  let nameservers: string[];
  if (input?.kind === "registrar") {
    nameservers = zone.originalNameservers;
    // CR-A02: a snapshot taken after the switch may have recorded CDS's own nameservers.
    const cdsNs = new Set(zone.nameservers);
    if (nameservers.length === 0 || nameservers.some((n) => cdsNs.has(n))) {
      throw new InvalidInput(
        "We don't know your registrar's nameservers. Choose Another DNS host and enter them.",
      );
    }
  } else if (input?.kind === "other") {
    const raw = Array.isArray(input.nameservers) ? input.nameservers : [];
    if (raw.length !== 2) {
      throw new InvalidInput("Enter both new nameservers.");
    }
    nameservers = raw.map(nameserverInput);
    if (nameservers[0] === nameservers[1]) {
      throw new InvalidInput("Enter two different nameservers.");
    }
    if (nameservers.some((n) => zone.nameservers.includes(n))) {
      throw new InvalidInput(
        "Those are our nameservers. Enter your new host's.",
      );
    }
  } else {
    throw new InvalidInput("Choose where your DNS goes.");
  }
  limitOwner(ctx, org);
  const state: HandbackState = {
    ...zone.state,
    status: "open",
    destination: input.kind,
    nameservers,
    switchedAt: null,
    mismatchAlertedAt: null,
  };
  const next = await runDestinationCheck(
    ctx,
    zone,
    state,
    deps,
    "offboarding.handback_destination",
    { kind: input.kind },
  );
  return zoneView({ ...zone, state: next }, deps.provider ?? getDnsProvider());
}

/** "Check my new DNS": the reverse gate at the destination's own nameservers (choice 3). */
export async function checkHandbackDestination(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  domain: string,
  deps: HandbackDeps = {},
): Promise<HandbackZoneView> {
  const org = scopedOrgId(ctx, orgId);
  authorizeWrite(ctx, "domains");
  const zone = await loadZone(org, domain);
  atCdsOrNotFound(zone);
  await assertLeaving(org);
  if (!zone.state.destination) {
    throw new InvalidInput("Choose where your DNS goes first.");
  }
  limitOwner(ctx, org);
  // After the switch the job owns the state; a manual check re-runs the public check there.
  if (zone.state.status === "waiting" || zone.state.switchedAt) {
    await advanceOneZone(zone, nowOf(deps.now), false, deps, ctx);
    const again = await loadZone(org, domain);
    return zoneView(again, deps.provider ?? getDnsProvider());
  }
  const next = await runDestinationCheck(
    ctx,
    zone,
    { ...zone.state },
    deps,
    "offboarding.handback_checked",
    {},
  );
  return zoneView({ ...zone, state: next }, deps.provider ?? getDnsProvider());
}

/** "I've changed them": the owner switched the nameservers; the job checks from here. */
export async function confirmHandbackSwitched(
  ctx: OrgContext | PlatformContext,
  orgId: string | undefined,
  domain: string,
  deps: HandbackDeps = {},
): Promise<HandbackZoneView> {
  const org = scopedOrgId(ctx, orgId);
  authorizeWrite(ctx, "offboard");
  const zone = await loadZone(org, domain);
  atCdsOrNotFound(zone);
  await assertLeaving(org);
  if (zone.state.status !== "ready_to_switch") {
    throw new InvalidInput(
      zone.state.status === "mismatch"
        ? P14_COPY.HANDBACK_MISMATCH({
            count: Math.max(1, zone.state.emailMissing),
          })
        : "Check your new DNS first.",
    );
  }
  const now = nowOf(deps.now);
  const next: HandbackState = {
    ...zone.state,
    status: "waiting",
    switchedAt: now.toISOString(),
  };
  await writeState(ctx, zone, next, "offboarding.handback_switched", {});
  return zoneView({ ...zone, state: next }, deps.provider ?? getDnsProvider());
}

// ---------------------------------------------------------------------------------------
// The job step (choices 3 and 4)
// ---------------------------------------------------------------------------------------

export type AdvanceHandbacksResult = {
  /** Zones whose delegation was away from CDS and got the public check. */
  checked: number;
  done: number;
  deleted: number;
  mismatches: number;
  errors: number;
};

async function ownerAddresses(
  pb: PocketBase,
  orgId: string,
): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org} && role = 'owner'", {
      org: orgId,
    }),
    expand: "user",
    fields: "expand.user.email",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const e = (r.expand?.user as { email?: unknown } | undefined)?.email;
    if (typeof e === "string" && e !== "") out.add(e);
  }
  return [...out];
}

/** Owner mail + bell: the DNS is back with them. Never throws. */
async function notifyHandedBack(
  zone: ZoneRec,
  deps: HandbackDeps,
  now: Date,
): Promise<void> {
  const ctx = sysCtx();
  try {
    const to = await withSuperuser((pb) => ownerAddresses(pb, zone.orgId));
    for (const addr of to) {
      await sendEmail(
        { kind: "cds", ctx },
        "offboarding.handed_back",
        addr,
        {},
        {
          ...(deps.transport ? { transport: deps.transport } : {}),
          concernsOrg: zone.orgId,
        },
      ).catch((err: unknown) =>
        console.error(`[handback] owner mail not sent: ${errName(err)}`),
      );
    }
  } catch (err) {
    console.error(`[handback] owner mail not sent: ${errName(err)}`);
  }
  await raiseAlert(
    { orgId: zone.orgId, as: ctx },
    {
      type: "offboarding.handed_back",
      sourceKey: `handback:done:${zone.id}`,
      title: P14_COPY.MAIL_HANDED_BACK_S,
      safeTitle: P14_COPY.MAIL_HANDED_BACK_S,
      href: LEAVING_HREF,
      actionLabel: "Open checklist",
    },
    {
      now,
      dedicatedEmail: true,
      ...(deps.transport ? { transport: deps.transport } : {}),
    },
  );
}

/** Owner bell + one staff `handback_mismatch` alert. Never throws. */
async function notifyMismatch(
  zone: ZoneRec,
  count: number,
  deps: HandbackDeps,
  now: Date,
  sourceKey: string,
): Promise<void> {
  const ctx = sysCtx();
  const title = P14_COPY.HANDBACK_MISMATCH({ count: Math.max(1, count) });
  await raiseAlert(
    { orgId: zone.orgId, as: ctx },
    {
      type: "offboarding.started",
      sourceKey,
      title,
      safeTitle: "Some email records are missing at your new DNS",
      href: LEAVING_HREF,
      actionLabel: "Open checklist",
    },
    { now, ...(deps.transport ? { transport: deps.transport } : {}) },
  );
  await alertStaff(zone, "handback_mismatch", count, deps);
}

async function alertStaff(
  zone: ZoneRec,
  kind: "handback_mismatch" | "handback_overdue",
  count: number,
  deps: HandbackDeps,
): Promise<void> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[handback] staff alert not sent: no staff alert address");
    return;
  }
  let business = zone.orgId;
  try {
    const facts = await orgFacts(zone.orgId);
    if (facts) business = facts.name;
  } catch {
    // The id is enough for staff to act on.
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: sysCtx() },
      "staff.domain_alert",
      to,
      {
        kind,
        business,
        orgId: zone.orgId,
        domain: zone.domain,
        count,
        href: platformUrl(`/staff/sites/${zone.orgId}?tab=offboarding`),
      },
      deps.transport ? { transport: deps.transport } : {},
    );
  } catch (err) {
    console.error(`[handback] staff alert not sent: ${errName(err)}`);
  }
}

/** Mark the offboarding's `zone_deleted` system step done (when an offboarding exists). */
async function markZoneDeletedStep(orgId: string, at: string): Promise<void> {
  const row = await readOffboardingRow(orgId);
  if (!row) return;
  await withSuperuser(async (pb) => {
    const rec = await pb.collection(OFFBOARDINGS).getOne(row.id);
    const steps = parseSteps(rec.steps);
    steps.zone_deleted = { status: "done", at };
    await pb.collection(OFFBOARDINGS).update(row.id, { steps });
  });
}

/** True when another of the org's zones is still at CDS (handback not finished). */
async function otherZonesAtCds(zone: ZoneRec): Promise<boolean> {
  const rows = await withSuperuser((pb) =>
    pb.collection(DNS_ZONES).getFullList({
      filter: pb.filter(
        "org_id = {:org} && id != {:id} && (status = 'active' || status = 'moved')",
        { org: zone.orgId, id: zone.id },
      ),
      fields: "id",
    }),
  );
  return rows.length > 0;
}

type StepTally = {
  checked: boolean;
  done: boolean;
  deleted: boolean;
  mismatch: boolean;
};

/**
 * One zone through choices 3-4. The delegation is read from public DNS; the zone is never
 * deleted while it still points at CDS (T-14-40-03).
 */
async function advanceOneZone(
  zone: ZoneRec,
  now: Date,
  dryRun: boolean,
  deps: HandbackDeps,
  actor: OrgContext | PlatformContext | SystemContext = sysCtx(),
): Promise<StepTally> {
  const tally: StepTally = {
    checked: false,
    done: false,
    deleted: false,
    mismatch: false,
  };
  const s = zone.state;
  const handedBack = zone.status === "handed_back";
  const inFlow =
    AT_CDS.has(zone.status) &&
    s.destination !== null &&
    (s.status === "ready_to_switch" ||
      s.status === "waiting" ||
      s.status === "mismatch");
  if (!handedBack && !inFlow) return tally;
  if (zone.providerZoneId === "" && handedBack) return tally;

  const resolver = deps.resolver ?? getDnsResolver();
  const provider = deps.provider ?? getDnsProvider();
  const ns = await resolver.resolveNsIps(zone.domain);
  const names = ns.names.map((n) => fqdn(n));
  const cds = new Set(zone.nameservers);
  const away = names.length > 0 && !names.some((n) => cds.has(n));
  const at = now.toISOString();
  let state: HandbackState = { ...s };

  if (!away) {
    // Still (or again) at CDS: nothing moves, nothing is deleted. A switch back resets the
    // 30-day clock.
    if (state.movedAwayAt && !dryRun) {
      state = { ...state, movedAwayAt: null, mismatchAlertedAt: null };
      await writeState(actor, zone, state, null);
    }
    return tally;
  }

  // Public check of every copy_exactly record through each public resolver (choice 3).
  if (inFlow || !state.checkPassed) {
    tally.checked = true;
    const wanted = groupHandbackRecords(
      zone.domain,
      await zoneRecords(zone, provider),
      zone.cdsKeys,
    ).copy_exactly;
    const missingByKey = new Map<string, DnsRecord>();
    let emailMissing = 0;
    for (const server of PUBLIC_RESOLVERS) {
      const copy = await answersFrom(resolver, wanted, [server]);
      const g = reverseGate(zone.domain, wanted, copy, now);
      for (const r of g.missing) missingByKey.set(keyHash(r), r);
      emailMissing = Math.max(emailMissing, g.emailMissing);
    }
    const missing = [...missingByKey.keys()].slice(0, MISSING_CAP);
    state = {
      ...state,
      movedAwayAt: state.movedAwayAt ?? at,
      checked: true,
      missing,
      emailMissing,
      checkPassed: missingByKey.size === 0,
      checkedAt: at,
    };
    if (inFlow && emailMissing === 0) {
      tally.done = true;
      state = { ...state, status: "done", doneAt: at, mismatchAlertedAt: null };
      if (!dryRun) {
        await writeState(
          actor,
          zone,
          state,
          "offboarding.handback_moved_away",
          { passed: state.checkPassed, missing: missingByKey.size },
          { status: "handed_back" },
        );
        if (!(await otherZonesAtCds(zone))) {
          try {
            await recordHandbackDone(sysCtx(), zone.orgId, { now });
          } catch (err) {
            // No running notice (the owner moved the DNS without leaving): nothing to open.
            if (!(err instanceof InvalidInput)) throw err;
          }
        }
        await notifyHandedBack(zone, deps, now);
      }
      zone = { ...zone, status: "handed_back", state };
    } else if (inFlow) {
      tally.mismatch = true;
      const first = state.status !== "mismatch" || !state.mismatchAlertedAt;
      state = {
        ...state,
        status: "mismatch",
        mismatchAlertedAt: state.mismatchAlertedAt ?? at,
      };
      if (!dryRun) {
        await writeState(
          actor,
          zone,
          state,
          first ? "offboarding.handback_mismatch" : null,
          { emailMissing },
        );
        if (first) {
          await notifyMismatch(
            zone,
            emailMissing,
            deps,
            now,
            `handback:mismatch:${zone.id}:${at}`,
          );
        }
      }
      zone = { ...zone, state };
    } else if (!dryRun) {
      await writeState(actor, zone, state, null);
      zone = { ...zone, state };
    }
  } else if (!state.movedAwayAt && !dryRun) {
    state = { ...state, movedAwayAt: at };
    await writeState(actor, zone, state, null);
    zone = { ...zone, state };
  }

  // Deletion (choice 4): delegation away (checked above), and every record found, or 30 days
  // after the move away.
  if (zone.providerZoneId === "") return tally;
  const movedAt = state.movedAwayAt ? Date.parse(state.movedAwayAt) : NaN;
  const overdue =
    Number.isFinite(movedAt) &&
    now.getTime() - movedAt >= HANDBACK_DELETE_AFTER_DAYS * DAY_MS;
  const passed = zone.status === "handed_back" && state.checkPassed;
  if (!passed && !overdue) return tally;
  tally.deleted = true;
  if (dryRun) return tally;
  if (!passed) {
    await alertStaff(zone, "handback_mismatch", state.missing.length, deps);
  }
  await provider.deleteZone(zone.providerZoneId);
  const deleted: HandbackState = { ...state, deletedAt: at };
  await writeState(
    actor,
    zone,
    deleted,
    "offboarding.zone_deleted",
    { reason: passed ? "check_passed" : "30_days" },
    { status: "deleted", provider_zone_id: "" },
  );
  await markZoneDeletedStep(zone.orgId, at);
  return tally;
}

/**
 * domains:run step `handbacks` (P14-P18): every zone in a handback (or handed back and not
 * yet deleted) through the public check and the deletion rule. A failing zone is counted
 * and the next run retries it.
 */
export async function advanceHandbacks(
  opts: { now?: Date; dryRun?: boolean; deps?: HandbackDeps } = {},
): Promise<AdvanceHandbacksResult> {
  const now = nowOf(opts.now);
  const dryRun = opts.dryRun === true;
  const deps = { ...(opts.deps ?? {}), now };
  const result: AdvanceHandbacksResult = {
    checked: 0,
    done: 0,
    deleted: 0,
    mismatches: 0,
    errors: 0,
  };
  const rows = await withSuperuser((pb) =>
    pb.collection(DNS_ZONES).getFullList({
      filter: pb.filter(
        "status = 'active' || status = 'moved' || status = 'handed_back'",
      ),
      sort: "updated",
    }),
  );
  for (const r of rows) {
    const zone = toZoneRec(r);
    if (zone.state.destination === null && zone.status !== "handed_back") {
      continue;
    }
    try {
      const t = await advanceOneZone(zone, now, dryRun, deps);
      if (t.checked) result.checked += 1;
      if (t.done) result.done += 1;
      if (t.deleted) result.deleted += 1;
      if (t.mismatch) result.mismatches += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`[handback] zone not advanced: ${errName(err)}`);
    }
  }
  return result;
}
