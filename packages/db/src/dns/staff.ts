// packages/db/src/dns/staff.ts (P14, DOM-08).
// Owner: 14-37 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The staff domain surface (D169, D-UI-P14-17/-18, P14-P13, P14-P17): one read
// (`staffDomainView`: summary rail, hosts, move timeline, gate report with original vs
// read-back copy, post-switch check) and the actions the console (14-38 components, wired by
// 14-51) and `npm run domains:move` call. Every function starts with assertPlatformContext +
// authorizeStaff, checks the org exists and then calls the SAME 14-22/14-23 functions the job
// and the owner use (retryStep, retakeSnapshot, cancelMove, overrideGateRule, startMove).
// Those already write their audit row (with `organization`) in the move's batch, so only
// `staffStartMove` adds one more row (`domain.move_requested`, carrying the staff reason).
// Errors are logged by class name only; nothing here logs a host or a record value.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  classifyRecord,
  fqdn,
  GATE_RULE_NAMES,
  MAX_ZONE_FILE_BYTES,
  normalizeRecord,
  P14_COPY,
  recordKey,
  registrarFromRdapName,
  registrarRecordsNotCopied,
  ZoneFileError,
  type DnsRecord,
  type GateFinding,
  type GateRule,
  type RecordSource,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { readPlatformMeta } from "../platform-meta";
import { assertId } from "../repository";
import type { ObjectStore } from "../storage";
import { getDnsResolver } from "./factory";
import { readBackCopy } from "./gate-runner";
import {
  domainHealthSummary,
  domainIncidentKey,
  type DomainIncidentKind,
} from "./health";
import {
  cancelMove,
  getMove,
  MOVE_STEPS,
  openMoveFor,
  overrideGateRule,
  retakeSnapshot,
  retryStep,
  startMove,
  type MoveDeps,
  type MoveView,
} from "./moves";
import { PUBLIC_RESOLVERS, type DnsResolver } from "./ports";
import {
  DNS_ZONES_COLLECTION,
  latestSnapshot,
  toDnsZoneRow,
  type DnsZoneRow,
  type DnsZoneStatus,
} from "./snapshot";

// ---------------------------------------------------------------------------------------
// Contract (14-38 components, 14-51 wiring)
// ---------------------------------------------------------------------------------------

export type StaffRecordGroup = "email" | "verification" | "site" | "other";
export type StaffRecordResult =
  "match" | "ttl" | "mismatch" | "missing" | "added" | "ack";
export type StaffRuleResult = "pass" | "fail" | "overridden" | "acknowledged";

export type StaffGateRuleRow = {
  rule: GateRule;
  name: string;
  result: StaffRuleResult;
  /** "No override" (G1 on an email record, G3, G6). */
  hardBlock: boolean;
  /** A super_admin Override button applies (failing, overridable, not a hard block). */
  overridable: boolean;
  overriddenBy?: string;
  reason?: string;
};

export type StaffGateRecordRow = {
  group: StaffRecordGroup;
  type: string;
  name: string;
  /** The old zone's value; null for a record CDS added. */
  original: string | null;
  /** The value read back from the CDS nameservers; null when not read back or absent. */
  copy: string | null;
  sources: RecordSource[];
  result: StaffRecordResult;
};

export type StaffHostRow = {
  host: string;
  kind: string;
  redirectTo: string | null;
  primary: boolean;
  verified: boolean;
  /** From the daily health incidents: false when HTTPS is failing; null when unknown. */
  httpsOk: boolean | null;
  /** Not stored per host by the health pass (14-27); null until it is. */
  certDays: number | null;
};

export type StaffPostSwitchRow = {
  type: string;
  name: string;
  copy: string;
  /** What the public resolvers answer (deduped across 1.1.1.1 and 8.8.8.8). */
  publicAnswer: string[];
};

export type StaffDomainView = {
  orgId: string;
  business: string;
  live: boolean;
  summary: {
    domain: string | null;
    registrar: string | null;
    expiresAt: string | null;
    dnssec: "on" | "off" | "unknown" | null;
    zone: { id: string | null; status: DnsZoneStatus } | null;
    nameservers: string[];
    delegatedAt: string | null;
    primaryHost: string | null;
    lastHealth: { at: string | null; incidents: DomainIncidentKind[] };
  };
  hosts: StaffHostRow[];
  move: MoveView | null;
  gate: {
    rules: StaffGateRuleRow[];
    records: StaffGateRecordRow[];
    snapshotAt: string;
    recordCount: number;
    /** The CDS nameserver the copy was read back from; null when not read back. */
    readBackFrom: string | null;
  } | null;
  postSwitch: { open: boolean; records: StaffPostSwitchRow[] };
};

export type StaffDomainDeps = MoveDeps & {
  resolver?: DnsResolver;
  store?: ObjectStore;
};

export type StaffStartMoveResult = {
  move: MoveView;
  /** "Move started. <business>'s owner was asked to connect <domain>." */
  message: string;
};

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

const MOVES = "domain_moves";
const REASON_MIN = 10;
const REASON_MAX = 500;
const INCIDENT_KINDS: readonly DomainIncidentKind[] = [
  "delegation_lost",
  "email_drift",
  "https_failing",
  "cert_low",
  "expiry_30d",
  "expiry_7d",
];
const GROUP_ORDER: readonly StaffRecordGroup[] = [
  "email",
  "verification",
  "site",
  "other",
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function staffReason(reason: unknown): string {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < REASON_MIN || why.length > REASON_MAX) {
    throw new InvalidInput(
      `Give a reason (${REASON_MIN} to ${REASON_MAX} characters).`,
    );
  }
  return why;
}

type OrgFacts = { id: string; name: string; live: boolean };

async function orgFacts(pb: PocketBase, orgId: string): Promise<OrgFacts> {
  try {
    const o = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name,stage" });
    return { id: o.id, name: str(o.name), live: o.stage === "live" };
  } catch {
    throw new NotFound("site not found");
  }
}

/** The org exists (NotFound "site not found"); callers authorize first (choice 1). */
async function siteOf(orgId: string): Promise<OrgFacts> {
  assertId(orgId);
  return withSuperuser((pb) => orgFacts(pb, orgId));
}

async function openMoveOrRefuse(
  ctx: PlatformContext,
  orgId: string,
): Promise<MoveView> {
  const move = await openMoveFor(ctx, orgId);
  if (!move) throw new InvalidInput(P14_COPY.STAFF_NO_DOMAIN);
  return move;
}

function displayValue(r: DnsRecord): string {
  return r.priority !== undefined ? `${r.priority} ${r.value}` : r.value;
}

function pairKey(r: DnsRecord): string {
  return `${r.type}\u0000${fqdn(r.name)}`;
}

function groupOf(r: DnsRecord, domain: string): StaffRecordGroup {
  const c = classifyRecord(r, domain);
  return c === "email" || c === "verification" || c === "site" ? c : "other";
}

/** Records the gate compares: SOA and the apex NS are never copied. */
function comparable(
  records: readonly DnsRecord[],
  domain: string,
): DnsRecord[] {
  const d = fqdn(domain);
  return records.filter(
    (r) => r.type !== "SOA" && !(r.type === "NS" && fqdn(r.name) === d),
  );
}

function ackedKeys(findings: GateFinding[] | null): Set<string> {
  const out = new Set<string>();
  const g5 = findings?.find((f) => f.rule === "G5");
  if (g5?.detail.rule !== "G5") return out;
  for (const s of g5.detail.services) {
    if (s.acknowledged) for (const r of s.records) out.add(recordKey(r));
  }
  return out;
}

/** Per-record results (choice 2). `copy` null = not read back: fall back to the stored G1. */
export function staffCompareRecords(
  domain: string,
  original: readonly DnsRecord[],
  copy: readonly DnsRecord[] | null,
  findings: GateFinding[] | null,
): StaffGateRecordRow[] {
  const orig = comparable(original, domain);
  const acked = ackedKeys(findings);
  const rows: StaffGateRecordRow[] = [];
  if (copy) {
    const byKey = new Map(copy.map((r) => [recordKey(r), r]));
    const byPair = new Map<string, DnsRecord[]>();
    for (const r of copy) {
      byPair.set(pairKey(r), [...(byPair.get(pairKey(r)) ?? []), r]);
    }
    const origKeys = new Set(orig.map((r) => recordKey(r)));
    for (const r of orig) {
      const k = recordKey(r);
      const same = byKey.get(k);
      const others = byPair.get(pairKey(r)) ?? [];
      let result: StaffRecordResult;
      let copyValue: string | null = null;
      if (same) {
        copyValue = displayValue(same);
        result =
          same.ttl !== undefined && r.ttl !== undefined && same.ttl !== r.ttl
            ? "ttl"
            : "match";
      } else if (acked.has(k)) {
        result = "ack";
      } else if (others.some((o) => !origKeys.has(recordKey(o)))) {
        result = "mismatch";
        copyValue = others
          .filter((o) => !origKeys.has(recordKey(o)))
          .map(displayValue)
          .join(" | ");
      } else {
        result = "missing";
      }
      rows.push({
        group: groupOf(r, domain),
        type: r.type,
        name: fqdn(r.name),
        original: displayValue(r),
        copy: copyValue,
        sources: [...(r.sources ?? [])],
        result,
      });
    }
    for (const r of copy) {
      if (origKeys.has(recordKey(r))) continue;
      // A value that only replaces an original is already shown as that row's mismatch.
      if (orig.some((o) => pairKey(o) === pairKey(r))) continue;
      rows.push({
        group: groupOf(r, domain),
        type: r.type,
        name: fqdn(r.name),
        original: null,
        copy: displayValue(r),
        sources: ["cds"],
        result: "added",
      });
    }
  } else {
    const g1 = findings?.find((f) => f.rule === "G1");
    const missing = new Set<string>();
    const mismatched = new Map<string, DnsRecord | null>();
    if (g1?.detail.rule === "G1") {
      for (const r of g1.detail.missing) missing.add(recordKey(r));
      for (const m of g1.detail.mismatched) {
        mismatched.set(recordKey(m.original), m.copy);
      }
    }
    for (const r of orig) {
      const k = recordKey(r);
      const mm = mismatched.get(k);
      const result: StaffRecordResult = acked.has(k)
        ? "ack"
        : mismatched.has(k)
          ? "mismatch"
          : missing.has(k)
            ? "missing"
            : "match";
      rows.push({
        group: groupOf(r, domain),
        type: r.type,
        name: fqdn(r.name),
        original: displayValue(r),
        copy: mm ? displayValue(mm) : null,
        sources: [...(r.sources ?? [])],
        result,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      a.name.localeCompare(b.name) ||
      a.type.localeCompare(b.type),
  );
}

function ruleRows(move: MoveView): StaffGateRuleRow[] {
  return (move.findings ?? []).map((f) => {
    const o = move.overrides.find((x) => x.rule === f.rule);
    const acknowledged =
      f.pass &&
      f.rule === "G5" &&
      f.detail.rule === "G5" &&
      f.detail.services.length > 0 &&
      f.detail.services.every((s) => s.acknowledged);
    const result: StaffRuleResult =
      f.pass && f.overridden
        ? "overridden"
        : acknowledged
          ? "acknowledged"
          : f.pass
            ? "pass"
            : "fail";
    const hardBlock =
      f.hardBlock ||
      f.rule === "G3" ||
      f.rule === "G6" ||
      (f.rule === "G1" && f.detail.rule === "G1" && f.detail.emailMissing > 0);
    return {
      rule: f.rule,
      name: GATE_RULE_NAMES[f.rule],
      result,
      hardBlock,
      overridable: !f.pass && f.overridable && !f.hardBlock,
      ...(result === "overridden" && o
        ? { overriddenBy: o.by, reason: o.reason }
        : {}),
    };
  });
}

async function readIncidents(orgId: string): Promise<DomainIncidentKind[]> {
  const out: DomainIncidentKind[] = [];
  for (const kind of INCIDENT_KINDS) {
    const raw = await readPlatformMeta(domainIncidentKey(orgId, kind));
    if (raw !== null && raw !== "") out.push(kind);
  }
  return out;
}

async function lastMove(
  ctx: PlatformContext,
  orgId: string,
): Promise<MoveView | null> {
  const open = await openMoveFor(ctx, orgId);
  if (open) return open;
  const rec = await withSuperuser(async (pb) => {
    const res = await pb.collection(MOVES).getList(1, 1, {
      filter: pb.filter("org_id = {:org}", { org: orgId }),
      sort: "-created,-id",
      fields: "id",
      skipTotal: true,
    });
    return res.items[0] ?? null;
  });
  return rec ? getMove(ctx, rec.id) : null;
}

async function zoneFor(
  orgId: string,
  domain: string | null,
): Promise<{ row: DnsZoneRow; delegatedAt: string | null } | null> {
  return withSuperuser(async (pb) => {
    let rec: RecordModel | null = null;
    if (domain) {
      const res = await pb.collection(DNS_ZONES_COLLECTION).getList(1, 1, {
        filter: pb.filter("org_id = {:org} && domain = {:d}", {
          org: orgId,
          d: domain,
        }),
        skipTotal: true,
      });
      rec = res.items[0] ?? null;
    }
    if (!rec) {
      const res = await pb.collection(DNS_ZONES_COLLECTION).getList(1, 1, {
        filter: pb.filter("org_id = {:org} && status = {:s}", {
          org: orgId,
          s: "active",
        }),
        sort: "-updated,-id",
        skipTotal: true,
      });
      rec = res.items[0] ?? null;
    }
    if (!rec) return null;
    return {
      row: toDnsZoneRow(rec),
      delegatedAt: str(rec.delegated_at) || null,
    };
  });
}

/** The post-switch check, re-read through the public resolvers (only when it failed). */
async function postSwitchRecords(
  orgId: string,
  domain: string,
  deps: StaffDomainDeps,
): Promise<StaffPostSwitchRow[]> {
  const latest = await latestSnapshot(orgId, domain, { store: deps.store });
  if (!latest) return [];
  const { snapshot, row } = latest;
  const d = fqdn(snapshot.domain);
  const cdsKeys = new Set(row.cdsKeys.cds);
  const g5 = registrarRecordsNotCopied(
    snapshot.records,
    registrarFromRdapName(snapshot.registrar),
  );
  const email = snapshot.records.filter(
    (r) =>
      !g5.has(recordKey(r)) && classifyRecord(r, d, { cdsKeys }) === "email",
  );
  const resolver = deps.resolver ?? getDnsResolver();
  const answers = new Map<string, Set<string>>();
  const missing = new Map<string, DnsRecord>();
  for (const server of PUBLIC_RESOLVERS) {
    for (const r of email) {
      const a = await resolver.resolve(fqdn(r.name), r.type, {
        servers: [server],
      });
      if (a.status === "error") continue;
      const got =
        a.status === "ok" ? a.records.map((x) => normalizeRecord(x)) : [];
      const seen = answers.get(pairKey(r)) ?? new Set<string>();
      for (const g of got) seen.add(displayValue(g));
      answers.set(pairKey(r), seen);
      if (!got.some((g) => recordKey(g) === recordKey(r))) {
        missing.set(recordKey(r), r);
      }
    }
  }
  return [...missing.values()].map((r) => ({
    type: r.type,
    name: fqdn(r.name),
    copy: displayValue(r),
    publicAnswer: [...(answers.get(pairKey(r)) ?? [])],
  }));
}

// ---------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------

/** The staff Site › Domain picture (choice 2). Feature `domains` (both roles). */
export async function staffDomainView(
  ctx: PlatformContext,
  orgId: string,
  deps: StaffDomainDeps = {},
): Promise<StaffDomainView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domains");
  const org = await siteOf(orgId);

  const hostRecs = await withSuperuser((pb) =>
    pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "hostname,kind,redirect_to,primary,verified_at",
      sort: "-primary,hostname",
    }),
  );
  const incidents = await readIncidents(orgId);
  const health = await domainHealthSummary();
  const httpsFailing = incidents.includes("https_failing");
  const hosts: StaffHostRow[] = hostRecs.map((h) => {
    const kind = str(h.kind);
    return {
      host: str(h.hostname).toLowerCase(),
      kind,
      redirectTo: str(h.redirect_to) || null,
      primary: h.primary === true,
      verified: str(h.verified_at) !== "",
      httpsOk:
        kind === "preview" || !org.live
          ? null
          : httpsFailing
            ? false
            : health
              ? true
              : null,
      certDays: null,
    };
  });
  const primary = hosts.find((h) => h.primary) ?? null;
  const custom = hosts.find((h) => h.primary && h.kind === "custom") ?? null;

  const move = await lastMove(ctx, orgId);
  const domain = move?.toHost ?? custom?.host ?? null;
  const zone = await zoneFor(orgId, domain);

  let gate: StaffDomainView["gate"] = null;
  const gateDomain = move?.toHost ?? zone?.row.domain ?? null;
  if (gateDomain) {
    const latest = await latestSnapshot(orgId, gateDomain, {
      store: deps.store,
    }).catch(() => null);
    if (latest) {
      const { snapshot, row } = latest;
      const atOrBeforeDelegation =
        move !== null &&
        move.status !== "done" &&
        move.status !== "cancelled" &&
        MOVE_STEPS.indexOf(move.currentStep) <=
          MOVE_STEPS.indexOf("delegation");
      let copy: DnsRecord[] | null = null;
      let readBackFrom: string | null = null;
      if (
        atOrBeforeDelegation &&
        row.providerZoneId &&
        row.nameservers.length
      ) {
        try {
          copy = await readBackCopy(row, {
            records: snapshot.records,
            resolver: deps.resolver,
          });
          readBackFrom = row.nameservers[0] ?? null;
        } catch (err) {
          console.warn(
            `[dns/staff] read-back skipped: ${err instanceof Error ? err.name : "Error"}`,
          );
        }
      }
      const findings = move?.findings ?? null;
      gate = {
        rules: move ? ruleRows(move) : [],
        records: staffCompareRecords(
          snapshot.domain,
          snapshot.records,
          copy,
          findings,
        ),
        snapshotAt: snapshot.takenAt,
        recordCount: snapshot.records.length,
        readBackFrom,
      };
    }
  }

  const delegation = move?.steps.find((s) => s.key === "delegation");
  const postOpen =
    move !== null &&
    move.status === "failed" &&
    move.failedStep === "delegation" &&
    delegation?.detail === "post_switch_mismatch";
  let postRecords: StaffPostSwitchRow[] = [];
  if (postOpen && move) {
    postRecords = await postSwitchRecords(orgId, move.toHost, deps).catch(
      () => [],
    );
  }

  return {
    orgId,
    business: org.name,
    live: org.live,
    summary: {
      domain,
      registrar: zone?.row.registrar ?? null,
      expiresAt: zone?.row.expiresAt ?? null,
      dnssec: zone?.row.dnssec ?? null,
      zone: zone
        ? { id: zone.row.providerZoneId, status: zone.row.status }
        : null,
      nameservers: zone ? [...zone.row.nameservers] : [],
      delegatedAt: zone?.delegatedAt ?? null,
      primaryHost: primary?.host ?? null,
      lastHealth: { at: health?.at ?? null, incidents },
    },
    hosts,
    move,
    gate,
    postSwitch: { open: postOpen, records: postRecords },
  };
}

// ---------------------------------------------------------------------------------------
// Actions, feature `domains` (both roles)
// ---------------------------------------------------------------------------------------

/** Retry the open move's current step (audited `domain.retry` by retryStep). */
export async function staffRetryStep(
  ctx: PlatformContext,
  orgId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domains");
  await siteOf(orgId);
  const move = await openMoveOrRefuse(ctx, orgId);
  return retryStep(ctx, move.id, deps);
}

/** Re-take the snapshot, then copy and gate again (audited `domain.snapshot_retaken`). */
export async function staffRetakeSnapshot(
  ctx: PlatformContext,
  orgId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domains");
  await siteOf(orgId);
  const move = await openMoveOrRefuse(ctx, orgId);
  return retakeSnapshot(ctx, move.id, {}, deps);
}

/** Add a zone file to the copy: same parsing and errors as the owner's upload. */
export async function staffAddZoneFile(
  ctx: PlatformContext,
  orgId: string,
  text: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domains");
  await siteOf(orgId);
  const body = typeof text === "string" ? text : "";
  if (Buffer.byteLength(body, "utf8") > MAX_ZONE_FILE_BYTES) {
    throw new InvalidInput(P14_COPY.ZONE_TOO_BIG);
  }
  if (body.trim() === "") throw new InvalidInput(P14_COPY.ZONE_UNREADABLE);
  const move = await openMoveOrRefuse(ctx, orgId);
  try {
    return await retakeSnapshot(ctx, move.id, { zoneFile: body }, deps);
  } catch (err) {
    if (err instanceof ZoneFileError) {
      if (err.code === "too_big") throw new InvalidInput(P14_COPY.ZONE_TOO_BIG);
      if (err.code === "wrong_domain") {
        throw new InvalidInput(
          P14_COPY.ZONE_WRONG_DOMAIN({
            fileDomain: "another domain",
            domain: move.toHost,
          }),
        );
      }
      throw new InvalidInput(P14_COPY.ZONE_UNREADABLE);
    }
    throw err;
  }
}

/** Re-run the post-switch check (step 5) after a mismatch (audited `domain.retry`). */
export async function staffRerunPostSwitch(
  ctx: PlatformContext,
  orgId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domains");
  await siteOf(orgId);
  const move = await openMoveOrRefuse(ctx, orgId);
  if (move.currentStep !== "delegation") {
    throw new InvalidInput("The post-switch check isn't open for this move.");
  }
  return retryStep(ctx, move.id, deps);
}

// ---------------------------------------------------------------------------------------
// Actions, super_admin only (domain_move, domain_override)
// ---------------------------------------------------------------------------------------

/** Cancel the open move (P14-P25; audited `domain.cancelled` by cancelMove). */
export async function staffCancelMove(
  ctx: PlatformContext,
  orgId: string,
  reason: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domain_move");
  await siteOf(orgId);
  const why = staffReason(reason);
  const move = await openMoveOrRefuse(ctx, orgId);
  return cancelMove(ctx, move.id, why, deps);
}

/** Override one gate rule (never G1-email, G3, G6; audited `domain.override`). */
export async function staffOverrideGate(
  ctx: PlatformContext,
  orgId: string,
  rule: GateRule,
  reason: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domain_override");
  await siteOf(orgId);
  const why = staffReason(reason);
  const move = await openMoveOrRefuse(ctx, orgId);
  return overrideGateRule(ctx, move.id, rule, why, deps);
}

/**
 * Move a live site to a new domain (DOM-08, choice 3): live, a custom primary and no open
 * move. Runs `startMove(kind: "move")`; the runner emails/alerts the owner at each owner
 * step. Audit: `domain.started` (startMove) + `domain.move_requested` (reason) here.
 */
export async function staffStartMove(
  ctx: PlatformContext,
  orgId: string,
  input: { domain: string; reason: string },
  deps: MoveDeps = {},
): Promise<StaffStartMoveResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "domain_move");
  const org = await siteOf(orgId);
  const why = staffReason(input?.reason);
  if (!org.live) {
    throw new InvalidInput("Only a live site can move to a new domain.");
  }
  const primary = await withSuperuser((pb) =>
    pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && primary = true && kind = {:k}",
        { org: orgId, k: "custom" },
      ),
      fields: "hostname",
      skipTotal: true,
    }),
  );
  if (primary.items.length === 0) {
    throw new InvalidInput(
      "This site has no custom domain yet. Connect one with a launch.",
    );
  }
  if (await openMoveFor(ctx, orgId)) {
    throw new InvalidInput("This site is already connecting a domain.");
  }
  const move = await startMove(
    ctx,
    orgId,
    { domain: str(input?.domain), kind: "move", by: ctx.actor },
    deps,
  );
  await withSuperuser(async (pb) => {
    await pb.collection("audit_log").create(
      auditBody(ctx, {
        action: "domain.move_requested",
        organization: orgId,
        targetCollection: MOVES,
        targetId: move.id,
        meta: { code: move.code, reason: why },
      }),
    );
  });
  return {
    move,
    message: `Move started. ${org.name || "The site"}'s owner was asked to connect ${move.toHost}.`,
  };
}
