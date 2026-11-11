// packages/db/src/dns/moves.ts (P14, DOM-08, DOM-05).
// Owner: 14-22 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The domain move state machine, part 1 (14-22): steps 1 snapshot -> 2 zone -> 3 gate ->
// 4 nameservers (the owner's turn) -> 5 delegation verified, "prepare early, launch
// instantly" (D119, D169, D288). Every step is an idempotent function of persisted state:
// the runner takes the org lock, re-reads the row, runs the current step and writes the step,
// the move and ONE audit row in a single batch (T-14-22-04/05). Staff Retry, the owner's
// "I've changed them" and the domains job all call the same runner (`advanceMove`).
//
// A launch move stops at `prepared` after step 5; a post-launch `move` continues to step 6.
// Steps 6-10 live in ./cutover (14-23), loaded lazily through its `LATE_STEPS` export so
// there is no import cycle. No custom org_hosts row is created here (P14-P4): this module
// only reads org_hosts. CDS never edits the old zone (D58): every write goes to the CDS zone.
// Errors are logged by class name only; audit meta carries codes, never record values.
import {
  authorize,
  authorizeStaff,
  Forbidden,
  InvalidInput,
  NotFound,
  parsePlatformHosts,
} from "@cds/core";
import {
  classifyRecord,
  dedupeRecords,
  formatBind,
  fqdn,
  NEEDS_YOU,
  normalizeRecord,
  P14_COPY,
  parseBind,
  parseDomainInput,
  RECORD_SOURCES,
  recordKey,
  registrarFromRdapName,
  registrarName,
  registrarRecordsNotCopied,
  GATE_MAX_AGE_HOURS,
  type DnsRecord,
  type GateFinding,
  type GateRule,
  type MoveStepKey,
  type RecordSource,
  type StaffDomainAlertKind,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  isOrgContext,
  isPlatformContext,
  assertSystemContext,
  mintSystemContext,
  scopedOrgId,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import { computeAcceptedEmailHash } from "../email/sending-domains/ensure";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { assertId, newRecordId } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import { dnsOpen, getDnsProvider, getDnsResolver } from "./factory";
import {
  PUBLIC_RESOLVERS,
  type DnsProvider,
  type DnsResolver,
  type HttpsProber,
  type RegistryLookup,
} from "./ports";
import { runGate, type GateRunResult } from "./gate-runner";
import {
  DnsSweepAtCds,
  latestSnapshot,
  readDnsZoneRow,
  takeSnapshot,
  upsertDnsZoneRow,
  type DnsZoneRow,
  type Snapshot,
} from "./snapshot";

export type { MoveStepKey };

// ---------------------------------------------------------------------------------------
// Contract (14-23, 14-29, 14-37, 14-41)
// ---------------------------------------------------------------------------------------

export const MOVE_STEPS = [
  "snapshot",
  "zone",
  "gate",
  "nameservers",
  "delegation",
  "site_records",
  "edge",
  "https",
  "cutover",
  "search",
] as const satisfies readonly MoveStepKey[];

export type MoveStatus =
  | "running"
  | "waiting_owner"
  | "prepared"
  | "cutover_running"
  | "done"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "waiting"
  | "running"
  | "done"
  | "waiting_owner"
  | "failed"
  | "skipped"
  | "cancelled";

export type MoveStep = {
  key: MoveStepKey;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  /** A code ("waiting_ns", "cds_review", "provider_error:<code>"), never a record value. */
  detail?: string;
  attempts?: number;
  nextAttemptAt?: string;
  /** Gate step only: the latest findings. */
  findings?: GateFinding[];
  /** Gate step only: consecutive DNSSEC-unknown answers (P14-P37). */
  unknownCount?: number;
  /** Notice keys already sent from this step (one alert per event). */
  alerted?: string[];
};

export type MoveOverride = {
  rule: GateRule;
  by: string;
  reason: string;
  at: string;
};
export type MoveAck = { key: string; by: string; at: string };

/** The stored move (internal shape; 14-23's steps receive it). */
export type MoveRow = {
  id: string;
  seq: number;
  orgId: string;
  kind: "launch" | "move";
  fromHost: string;
  toHost: string;
  status: MoveStatus;
  currentStep: MoveStepKey;
  steps: MoveStep[];
  failedStep: MoveStepKey | null;
  overrides: MoveOverride[];
  acks: MoveAck[];
  primaryChoice: "apex" | "www";
  createdBy: string;
  cancelReason: string;
  preparedAt: string | null;
  doneAt: string | null;
  cancelledAt: string | null;
};

export type MoveView = {
  id: string;
  code: string;
  orgId: string;
  kind: "launch" | "move";
  fromHost: string;
  toHost: string;
  status: MoveStatus;
  currentStep: MoveStepKey;
  steps: MoveStep[];
  failedStep: MoveStepKey | null;
  findings: GateFinding[] | null;
  overrides: MoveOverride[];
  acks: MoveAck[];
  primaryChoice: "apex" | "www";
  prepared: boolean;
  /** Set on a move cancelled after delegation: P14_COPY.CANCEL_DELEGATED (P14-P25). */
  cancelNote: string | null;
};

export type MoveDeps = {
  provider?: DnsProvider;
  resolver?: DnsResolver;
  registry?: RegistryLookup;
  prober?: HttpsProber;
  store?: ObjectStore;
  now?: () => Date;
  transport?: EmailTransport;
  /** Run the current step even when its next attempt is not due (P14-P15 owner check). */
  force?: boolean;
  /** The owner's zone file, used by the snapshot step of this run only. */
  zoneFile?: string;
};

/** What a step function returns; the runner persists it. */
export type StepOutcome = {
  status: "done" | "waiting" | "waiting_owner" | "failed";
  detail?: string;
  /** Next attempt after this many ms (waiting / waiting_owner). */
  retryInMs?: number;
  /** Extra step fields to store (findings, unknownCount). */
  patch?: Partial<Pick<MoveStep, "findings" | "unknownCount">>;
  /** Alerts/emails to send after the batch commits, deduped by key per move. */
  notices?: MoveNotice[];
  /** Apply this outcome to an earlier step and move back to it (G7 refresh at step 4). */
  rewindTo?: MoveStepKey;
};

export type MoveNotice =
  | {
      to: "owner_alert";
      key: string;
      type: "domain.your_turn" | "domain.switch_back" | "domain.connected";
      title: string;
      safeTitle: string;
      actionLabel: string;
      /** A dedicated email goes with it (no generic alert email). */
      dedicatedEmail?: boolean;
    }
  | {
      to: "owner_email";
      key: string;
      type: "domain.records_copied" | "domain.connected" | "domain.switch_back";
      /** Admins too (switch back); else Owners only. */
      admins: boolean;
      count?: number;
    }
  | {
      to: "staff";
      key: string;
      kind: StaffDomainAlertKind;
      step?: MoveStepKey;
      rule?: GateRule;
      count?: number;
    };

export type StepRun = {
  move: MoveRow;
  step: MoveStep;
  deps: MoveDeps;
  now: Date;
};

export type StepFn = (run: StepRun) => Promise<StepOutcome>;

// ---------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------

const MOVES = "domain_moves";
const RETRY_MS = 5 * 60_000;
const NS_SLOW_MS = 48 * 3_600_000;
const DNSSEC_UNKNOWN_ALERT_AFTER = 6;
const SITE_TTL = 300;
const SEQ_RETRIES = 5;
const ADVANCE_CAP = 20;
/** WR-A04: a launch move left at step 4 this long is cancelled (its unused zone deleted). */
export const MOVE_ABANDON_DAYS = 30;
const EXPIRE_CAP = 20;
const MAX_FINDING_RECORDS = 40;
const HUB_DOMAIN = "/hub/settings?tab=domain";
const RUNNABLE: ReadonlySet<MoveStatus> = new Set([
  "running",
  "waiting_owner",
  "cutover_running",
]);
const OPEN: readonly MoveStatus[] = [
  "running",
  "waiting_owner",
  "prepared",
  "cutover_running",
  "failed",
];
const ACK_RE = /^G5:(email_forwarding|web_forwarding|parking)$/;
const CODE_RE = /^M-([1-9][0-9]{0,8})$/i;
/** Step 5 detail on a cancelled move whose CDS zone was kept because it may serve (CR-A01). */
const ZONE_KEPT = "zone_kept";

const sysCtx = (): SystemContext => mintSystemContext({ job: "domains" });

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function moveCode(seq: number): string {
  return `M-${seq}`;
}

function stepIndex(key: MoveStepKey): number {
  return MOVE_STEPS.indexOf(key);
}

function isStepKey(v: unknown): v is MoveStepKey {
  return typeof v === "string" && (MOVE_STEPS as readonly string[]).includes(v);
}

function nowOf(deps: MoveDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function provider(deps: MoveDeps): DnsProvider {
  return deps.provider ?? getDnsProvider();
}

function snapDeps(deps: MoveDeps) {
  return {
    resolver: deps.resolver,
    registry: deps.registry,
    provider: deps.provider,
    store: deps.store,
  };
}

function freshSteps(): MoveStep[] {
  return MOVE_STEPS.map((key) => ({ key, status: "waiting" as const }));
}

function parseSteps(v: unknown): MoveStep[] {
  const list = Array.isArray(v) ? v : [];
  return MOVE_STEPS.map((key) => {
    const found = list.find(
      (s): s is MoveStep =>
        typeof s === "object" && s !== null && (s as MoveStep).key === key,
    );
    return found ? { ...found } : { key, status: "waiting" as const };
  });
}

function toMoveRow(rec: RecordModel): MoveRow {
  const status = str(rec.status) as MoveStatus;
  const cur = str(rec.current_step);
  const failed = str(rec.failed_step);
  return {
    id: rec.id,
    seq: Number(rec.seq),
    orgId: str(rec.org_id),
    kind: rec.kind === "move" ? "move" : "launch",
    fromHost: str(rec.from_host),
    toHost: str(rec.to_host),
    status,
    currentStep: isStepKey(cur) ? cur : "snapshot",
    steps: parseSteps(rec.steps),
    failedStep: isStepKey(failed) ? failed : null,
    overrides: Array.isArray(rec.overrides)
      ? (rec.overrides as MoveOverride[])
      : [],
    acks: Array.isArray(rec.acks) ? (rec.acks as MoveAck[]) : [],
    primaryChoice: rec.primary_choice === "www" ? "www" : "apex",
    createdBy: str(rec.created_by),
    cancelReason: str(rec.cancel_reason),
    preparedAt: str(rec.prepared_at) || null,
    doneAt: str(rec.done_at) || null,
    cancelledAt: str(rec.cancelled_at) || null,
  };
}

function stepOf(move: MoveRow, key: MoveStepKey): MoveStep {
  return move.steps[stepIndex(key)] as MoveStep;
}

/** WR-C03: the view of a stored move row (startCutover's fallback after a failed first run). */
export function moveViewOf(move: MoveRow): MoveView {
  return toView(move);
}

function toView(move: MoveRow): MoveView {
  const dstep = stepOf(move, "delegation");
  // CR-A01: a cancel that kept a zone the domain already pointed at marks step 5 `zone_kept`.
  const delegated = dstep.status === "done" || dstep.detail === ZONE_KEPT;
  return {
    id: move.id,
    code: moveCode(move.seq),
    orgId: move.orgId,
    kind: move.kind,
    fromHost: move.fromHost,
    toHost: move.toHost,
    status: move.status,
    currentStep: move.currentStep,
    steps: move.steps.map((s) => ({ ...s })),
    failedStep: move.failedStep,
    findings: stepOf(move, "gate").findings ?? null,
    overrides: move.overrides.map((o) => ({ ...o })),
    acks: move.acks.map((a) => ({ ...a })),
    primaryChoice: move.primaryChoice,
    prepared: move.preparedAt !== null || move.status === "prepared",
    cancelNote:
      move.status === "cancelled" && delegated
        ? P14_COPY.CANCEL_DELEGATED
        : null,
  };
}

async function readMove(pb: PocketBase, moveId: string): Promise<MoveRow> {
  assertId(moveId);
  try {
    return toMoveRow(await pb.collection(MOVES).getOne(moveId));
  } catch {
    throw new NotFound();
  }
}

/** One move by id (no authorization: runner and job use). */
export async function loadMoveRow(moveId: string): Promise<MoveRow> {
  return withSuperuser((pb) => readMove(pb, moveId));
}

/** Load a move for `ctx`: an OrgContext only sees its own org's moves (P14-P34). */
async function moveForCtx(
  ctx: OrgContext | PlatformContext | SystemContext,
  moveId: string,
): Promise<MoveRow> {
  if (typeof moveId !== "string") throw new NotFound();
  const move = await loadMoveRow(moveId);
  if (isOrgContext(ctx) && move.orgId !== ctx.orgId) throw new NotFound();
  return move;
}

function authorizeActor(
  ctx: OrgContext | PlatformContext | SystemContext,
  ownerAction: "read" | "write",
  staffFeature: "domains" | "domain_move" | "domain_override",
): void {
  if (isOrgContext(ctx)) authorize(ctx, "domain", ownerAction);
  else if (isPlatformContext(ctx)) authorizeStaff(ctx.staffRole, staffFeature);
  else assertSystemContext(ctx);
}

function actorId(ctx: OrgContext | PlatformContext | SystemContext): string {
  if (isOrgContext(ctx) || isPlatformContext(ctx)) return ctx.actor;
  return "";
}

function stepBody(move: MoveRow): Record<string, unknown> {
  return {
    status: move.status,
    current_step: move.currentStep,
    steps: move.steps,
    failed_step: move.failedStep ?? "",
    overrides: move.overrides,
    acks: move.acks,
    prepared_at: move.preparedAt ?? "",
    done_at: move.doneAt ?? "",
    cancelled_at: move.cancelledAt ?? "",
    cancel_reason: move.cancelReason,
  };
}

/** Write the move and one audit row in one batch. */
async function commit(
  ctx: OrgContext | PlatformContext | SystemContext,
  move: MoveRow,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(MOVES).update(move.id, stepBody(move));
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action,
        organization: move.orgId,
        targetCollection: MOVES,
        targetId: move.id,
        meta: { code: moveCode(move.seq), ...meta },
      }),
    );
    await batch.send();
  });
}

function registrarDisplay(raw: string | null | undefined): string {
  const id = registrarFromRdapName(raw);
  if (id !== "other") return registrarName(id);
  const name = (raw ?? "").trim();
  return name !== "" ? name.slice(0, 80) : registrarName("other");
}

function ageMs(s: Snapshot, now: Date): number {
  return now.getTime() - Date.parse(s.takenAt);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a.map((v) => fqdn(v)))].sort();
  const y = [...new Set(b.map((v) => fqdn(v)))].sort();
  return x.length > 0 && x.length === y.length && x.every((v, i) => v === y[i]);
}

/** True when any name in `a` is also in `b` (fqdn-normalised). */
function intersects(a: readonly string[], b: readonly string[]): boolean {
  const y = new Set(b.map((v) => fqdn(v)));
  return a.some((v) => y.has(fqdn(v)));
}

/**
 * CR-A01: may this CDS zone already be serving the domain? Asks the provider and the public
 * DNS, never the step status (the dns_zones row only turns `active` at step 5). Fails safe:
 * any error, an `active`/`moved` provider status, or a delegated NS that is one of the zone's
 * assigned nameservers answers true. Only a zone that is provably unused may be deleted.
 */
export async function zoneMayServe(
  zone: {
    domain: string;
    providerZoneId: string;
    nameservers: readonly string[];
  },
  deps: { provider?: DnsProvider; resolver?: DnsResolver } = {},
): Promise<boolean> {
  try {
    const p = deps.provider ?? getDnsProvider();
    const zs = await p.zoneStatus(zone.providerZoneId);
    if (zs !== "pending") return true;
    const ns = await (deps.resolver ?? getDnsResolver()).resolveNsIps(
      zone.domain,
    );
    return intersects(ns.names, zone.nameservers);
  } catch {
    return true;
  }
}

/** Cap G1 record lists so the steps JSON stays small (the gate re-runs anyway). */
function compactFindings(fs: readonly GateFinding[]): GateFinding[] {
  return fs.map((f) => {
    if (f.detail.rule !== "G1") return f;
    return {
      ...f,
      detail: {
        ...f.detail,
        missing: f.detail.missing.slice(0, MAX_FINDING_RECORDS),
        mismatched: f.detail.mismatched.slice(0, MAX_FINDING_RECORDS),
      },
    };
  });
}

// ---------------------------------------------------------------------------------------
// Copying the snapshot into the CDS zone (step 2, and the G7 refresh)
// ---------------------------------------------------------------------------------------

function isApexOrWwwSite(r: DnsRecord, d: string): boolean {
  const name = fqdn(r.name);
  return (
    (name === d || name === `www.${d}`) &&
    (r.type === "A" || r.type === "AAAA" || r.type === "CNAME")
  );
}

/**
 * Snapshot records the CDS zone must hold: no SOA/apex NS and no web forwarding or parking.
 * Email forwarding MX are always copied (CR-B01).
 */
function recordsToCopy(s: Snapshot): DnsRecord[] {
  const d = fqdn(s.domain);
  const g5 = registrarRecordsNotCopied(
    s.records,
    registrarFromRdapName(s.registrar),
  );
  return s.records
    .filter(
      (r) =>
        r.type !== "SOA" &&
        !(r.type === "NS" && fqdn(r.name) === d) &&
        !g5.has(recordKey(r)),
    )
    .map((r) => (isApexOrWwwSite(r, d) ? { ...r, ttl: SITE_TTL } : r));
}

/**
 * Import the snapshot as BIND, then upsert anything the import skipped (and apex/www site
 * records still above TTL 300). Idempotent: a second run writes nothing new.
 */
async function copyIntoZone(
  p: DnsProvider,
  zoneId: string,
  s: Snapshot,
): Promise<number> {
  const d = fqdn(s.domain);
  const wanted = recordsToCopy(s);
  if (wanted.length > 0) await p.importBind(zoneId, formatBind(d, wanted));
  const have = new Map(
    (await p.listRecords(zoneId)).map((r) => [recordKey(r), r]),
  );
  for (const r of wanted) {
    const h = have.get(recordKey(r));
    if (!h || (isApexOrWwwSite(r, d) && h.ttl !== SITE_TTL)) {
      await p.upsertRecord(zoneId, r);
    }
  }
  return wanted.length;
}

/**
 * Re-take the snapshot. Without a new zone file, records only the zone file or the host's
 * scan could see are carried over from `prev` (a sweep cannot see them). The merged JSON
 * replaces the new snapshot under the same key.
 */
async function freshSnapshot(
  orgId: string,
  d: string,
  prev: Snapshot | null,
  zone: DnsZoneRow | null,
  deps: MoveDeps,
  now: Date,
  zoneFile?: string,
): Promise<Snapshot> {
  const t = await takeSnapshot(orgId, d, {
    zoneFile,
    zoneId: zone?.providerZoneId ?? undefined,
    deps: snapDeps(deps),
    now,
  });
  if (zoneFile !== undefined && zoneFile.trim() !== "") return t.snapshot;
  if (!prev) return t.snapshot;
  const kept = new Set(t.snapshot.records.map((r) => recordKey(r)));
  const carried = prev.records.filter(
    (r) =>
      !kept.has(recordKey(r)) &&
      (r.sources ?? []).some((x) => x === "zone_file" || x === "scan"),
  );
  if (carried.length === 0) return t.snapshot;
  const records = dedupeRecords([...t.snapshot.records, ...carried]);
  const used = new Set<RecordSource>();
  for (const r of records) for (const x of r.sources ?? []) used.add(x);
  const merged: Snapshot = {
    ...t.snapshot,
    sources: RECORD_SOURCES.filter((x) => used.has(x)),
    records,
  };
  await (deps.store ?? getObjectStore()).put(
    t.key,
    JSON.stringify(merged),
    "application/json",
  );
  return merged;
}

// ---------------------------------------------------------------------------------------
// Steps 1-5
// ---------------------------------------------------------------------------------------

const done = (
  detail: string,
  extra: Partial<StepOutcome> = {},
): StepOutcome => ({
  status: "done",
  detail,
  ...extra,
});
const waiting = (
  detail: string,
  extra: Partial<StepOutcome> = {},
): StepOutcome => ({
  status: "waiting",
  detail,
  retryInMs: RETRY_MS,
  ...extra,
});
const failed = (
  detail: string,
  extra: Partial<StepOutcome> = {},
): StepOutcome => ({ status: "failed", detail, ...extra });

/** Step 1: snapshot the current zone (zone file + host scan + authoritative sweep). */
const snapshotStep: StepFn = async ({ move, deps, now }) => {
  const zone = await readDnsZoneRow(move.orgId, move.toHost);
  const t = await takeSnapshot(move.orgId, move.toHost, {
    zoneFile: deps.zoneFile,
    zoneId: zone?.providerZoneId ?? undefined,
    deps: snapDeps(deps),
    now,
  });
  return done(
    `${t.snapshot.records.length} records from ${t.snapshot.sources.join("+") || "sweep"}`,
  );
};

/** True when another org's dns_zones row holds this provider zone id (WR-A04). */
async function zoneHeldElsewhere(
  orgId: string,
  zoneId: string,
): Promise<boolean> {
  return withSuperuser(async (pb) => {
    const res = await pb.collection("dns_zones").getList(1, 1, {
      filter: pb.filter("provider_zone_id = {:z} && org_id != {:org}", {
        z: zoneId,
        org: orgId,
      }),
      fields: "id",
      skipTotal: true,
    });
    return res.items.length > 0;
  });
}

/** Step 2: create the CDS zone (once) and copy every snapshot record into it. */
const zoneStep: StepFn = async ({ move, deps, now }) => {
  const p = provider(deps);
  const latest = await latestSnapshot(move.orgId, move.toHost, {
    store: deps.store,
  });
  if (!latest) return failed("no_snapshot");
  let row = latest.row;
  if (!row.providerZoneId) {
    let z: Awaited<ReturnType<DnsProvider["createZone"]>>;
    try {
      z = await p.createZone(move.toHost);
    } catch (err) {
      if ((err as { code?: unknown }).code === "zone_exists") {
        return failed("zone_exists_elsewhere", {
          notices: [
            {
              to: "staff",
              key: "zone_exists",
              kind: "move_failed",
              step: "zone",
            },
          ],
        });
      }
      throw err;
    }
    // WR-A04: an existing zone is adopted only when no other org's row holds it.
    if (await zoneHeldElsewhere(move.orgId, z.zoneId)) {
      return failed("zone_exists_elsewhere", {
        notices: [
          {
            to: "staff",
            key: "zone_exists",
            kind: "move_failed",
            step: "zone",
          },
        ],
      });
    }
    row = await upsertDnsZoneRow(move.orgId, move.toHost, {
      provider: p.name,
      provider_zone_id: z.zoneId,
      nameservers: z.nameservers,
      status: "pending",
    });
  } else if (row.status === "deleted" || row.status === "handed_back") {
    row = await upsertDnsZoneRow(move.orgId, move.toHost, {
      status: "pending",
    });
  }
  const zoneId = row.providerZoneId as string;
  let snapshot = latest.snapshot;
  if (p.name === "cloudflare") {
    // The host's own scan sees names the sweep cannot (Pitfall 10): merge it in.
    try {
      snapshot = await freshSnapshot(
        move.orgId,
        move.toHost,
        snapshot,
        row,
        { ...deps, provider: p },
        now,
      );
    } catch (err) {
      // CR-A02: already pointing at CDS: copy the snapshot taken at the old host.
      if (!(err instanceof DnsSweepAtCds)) throw err;
    }
  }
  await copyIntoZone(p, zoneId, snapshot);
  return done("TTL 300 on apex/www");
};

function ownerTitleFor(
  rules: readonly GateRule[],
  registrar: string,
): { title: string; action: string } {
  if (rules.includes("G3")) {
    const c = NEEDS_YOU.dnssec({ registrar });
    return { title: c.title, action: c.action };
  }
  if (rules.includes("G5")) {
    const c = NEEDS_YOU.forwarding();
    return { title: c.title, action: c.action };
  }
  return {
    title: "A step to connect your domain is waiting on you",
    action: "Open Domain settings",
  };
}

/** The gate's verdict as a step outcome (step 3, and step 4's G7 refresh). */
function gateOutcome(
  res: GateRunResult,
  step: MoveStep,
  registrar: string,
): StepOutcome {
  const findings = compactFindings(res.findings);
  if (res.tooManyRecords) {
    return failed("too_many_records", {
      patch: { findings, unknownCount: 0 },
      notices: [
        {
          to: "staff",
          key: "too_many_records",
          kind: "move_failed",
          step: "gate",
        },
      ],
    });
  }
  if (res.passed) {
    return done("All records copied", {
      patch: { findings, unknownCount: 0 },
      notices: [
        {
          to: "owner_email",
          key: "records_copied",
          type: "domain.records_copied",
          admins: false,
        },
      ],
    });
  }
  const failing = res.findings.filter((f) => !f.pass);
  const ownerRules = failing
    .filter(
      (f) =>
        (f.rule === "G3" &&
          f.detail.rule === "G3" &&
          f.detail.dnssec === true) ||
        f.rule === "G6" ||
        f.rule === "G5" ||
        f.rule === "G2",
    )
    .map((f) => f.rule);
  if (ownerRules.length > 0) {
    const sig = ownerRules.join(",");
    const t = ownerTitleFor(ownerRules, registrar);
    return {
      status: "waiting_owner",
      detail: `owner:${sig}`,
      retryInMs: RETRY_MS,
      patch: { findings, unknownCount: 0 },
      notices: [
        {
          to: "owner_alert",
          key: `your_turn:${sig}`,
          type: "domain.your_turn",
          title: t.title,
          safeTitle: "A step to connect your domain is waiting on you",
          actionLabel: t.action,
        },
      ],
    };
  }
  const unknown = failing.some(
    (f) =>
      f.rule === "G3" && f.detail.rule === "G3" && f.detail.dnssec === null,
  );
  if (unknown) {
    const count = (step.unknownCount ?? 0) + 1;
    return waiting("dnssec_unknown", {
      patch: { findings, unknownCount: count },
      notices:
        count >= DNSSEC_UNKNOWN_ALERT_AFTER
          ? [
              {
                to: "staff",
                key: "dnssec_unknown",
                kind: "dnssec_unknown",
                step: "gate",
                rule: "G3",
              },
            ]
          : [],
    });
  }
  return waiting("cds_review", {
    patch: { findings, unknownCount: 0 },
    notices: [
      {
        to: "staff",
        key: "cds_review",
        kind: "gate_override_needed",
        step: "gate",
        rule: failing[0]?.rule,
      },
    ],
  });
}

function ackSet(move: MoveRow): Set<string> {
  return new Set(move.acks.map((a) => a.key));
}
function overrideSet(move: MoveRow): Set<GateRule> {
  return new Set(move.overrides.map((o) => o.rule));
}

/** Re-snapshot + re-copy when the snapshot is older than 24 h (G7). */
async function refreshIfStale(
  move: MoveRow,
  deps: MoveDeps,
  now: Date,
): Promise<void> {
  const latest = await latestSnapshot(move.orgId, move.toHost, {
    store: deps.store,
  });
  if (!latest || ageMs(latest.snapshot, now) <= GATE_MAX_AGE_HOURS * 3_600_000)
    return;
  let snap: Snapshot;
  try {
    snap = await freshSnapshot(
      move.orgId,
      move.toHost,
      latest.snapshot,
      latest.row,
      deps,
      now,
    );
  } catch (err) {
    // CR-A02: the owner already switched (or half-switched) to CDS. A sweep now would read
    // CDS's own copy; keep the snapshot taken at the old host.
    if (err instanceof DnsSweepAtCds) return;
    throw err;
  }
  if (latest.row.providerZoneId) {
    await copyIntoZone(provider(deps), latest.row.providerZoneId, snap);
  }
}

async function gateNow(
  move: MoveRow,
  deps: MoveDeps,
  now: Date,
): Promise<{ res: GateRunResult; registrar: string }> {
  const res = await runGate(move.orgId, move.toHost, {
    acks: ackSet(move),
    overrides: overrideSet(move),
    deps: snapDeps(deps),
    now,
  });
  const row = await readDnsZoneRow(move.orgId, move.toHost);
  return { res, registrar: registrarDisplay(row?.registrar) };
}

/** Step 3: the zone gate (G1-G7) against the copy read back from the CDS nameservers. */
const gateStep: StepFn = async ({ move, step, deps, now }) => {
  await refreshIfStale(move, deps, now);
  const { res, registrar } = await gateNow(move, deps, now);
  return gateOutcome(res, step, registrar);
};

/** Step 4: the owner changes the nameservers at the registrar. */
const nameserversStep: StepFn = async ({ move, step, deps, now }) => {
  const latest = await latestSnapshot(move.orgId, move.toHost, {
    store: deps.store,
  });
  if (!latest) return failed("no_snapshot");
  // CR-A02: the delegation first. Once the domain points at CDS, a G7 refresh would sweep
  // CDS's own zone and overwrite the old host's copy and original nameservers.
  const row0 = await readDnsZoneRow(move.orgId, move.toHost);
  if (!row0?.providerZoneId) return failed("no_zone");
  const p = provider(deps);
  const status = await p.zoneStatus(row0.providerZoneId);
  if (status === "active") return done("Nameservers point to us");
  const ns = await (deps.resolver ?? getDnsResolver()).resolveNsIps(
    move.toHost,
  );
  if (sameSet(ns.names, row0.nameservers)) {
    return done("Nameservers point to us");
  }
  if (
    !intersects(ns.names, row0.nameservers) &&
    ageMs(latest.snapshot, now) > GATE_MAX_AGE_HOURS * 3_600_000
  ) {
    await refreshIfStale(move, deps, now);
    const { res, registrar } = await gateNow(move, deps, now);
    if (!res.passed) {
      return {
        ...gateOutcome(res, stepOf(move, "gate"), registrar),
        rewindTo: "gate",
      };
    }
  }
  const row = (await readDnsZoneRow(move.orgId, move.toHost)) ?? row0;
  const registrar = registrarDisplay(row.registrar);
  const c = NEEDS_YOU.nameservers({ registrar });
  const notices: MoveNotice[] = [
    {
      to: "owner_alert",
      key: "your_turn:nameservers",
      type: "domain.your_turn",
      title: c.title,
      safeTitle: "A step to connect your domain is waiting on you",
      actionLabel: c.action,
    },
  ];
  const started = step.startedAt ? Date.parse(step.startedAt) : now.getTime();
  if (now.getTime() - started >= NS_SLOW_MS) {
    notices.push({
      to: "staff",
      key: "ns_slow",
      kind: "ns_slow",
      step: "nameservers",
    });
  }
  return {
    status: "waiting_owner",
    detail: "waiting_ns",
    retryInMs: RETRY_MS,
    notices,
  };
};

/**
 * Step 5: the delegation is verified. Every email-class snapshot record must answer the same
 * through each public resolver; any mismatch fails the step with the switch-back path.
 */
const delegationStep: StepFn = async ({ move, step, deps, now }) => {
  const latest = await latestSnapshot(move.orgId, move.toHost, {
    store: deps.store,
  });
  if (!latest) return failed("no_snapshot");
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
  const groups = new Map<string, DnsRecord[]>();
  for (const r of email) {
    const k = `${r.type}\u0000${fqdn(r.name)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const resolver = deps.resolver ?? getDnsResolver();
  const missing = new Set<string>();
  let errors = 0;
  for (const server of PUBLIC_RESOLVERS) {
    for (const rs of groups.values()) {
      const first = rs[0] as DnsRecord;
      const a = await resolver.resolve(fqdn(first.name), first.type, {
        servers: [server],
      });
      if (a.status === "error") {
        errors++;
        continue;
      }
      const got = new Set(
        a.status === "ok"
          ? a.records.map((r) => recordKey(normalizeRecord(r)))
          : [],
      );
      for (const r of rs) if (!got.has(recordKey(r))) missing.add(recordKey(r));
    }
  }
  if (missing.size > 0) {
    const attempt = (step.attempts ?? 0) + 1;
    const registrar = registrarDisplay(row.registrar ?? snapshot.registrar);
    const c = NEEDS_YOU.switchBack({ registrar });
    return failed("post_switch_mismatch", {
      notices: [
        {
          to: "owner_alert",
          key: `switch_back:${attempt}`,
          type: "domain.switch_back",
          title: P14_COPY.MISMATCH_T({ registrar }) || c.title,
          safeTitle: "Switch your nameservers back",
          actionLabel: c.action,
          dedicatedEmail: true,
        },
        {
          to: "owner_email",
          key: `switch_back_mail:${attempt}`,
          type: "domain.switch_back",
          admins: true,
          count: missing.size,
        },
        {
          to: "staff",
          key: `post_switch_mismatch:${attempt}`,
          kind: "post_switch_mismatch",
          step: "delegation",
          count: missing.size,
        },
      ],
    });
  }
  if (errors > 0) return waiting("resolver_error");

  const zoneId = row.providerZoneId;
  if (!zoneId) return failed("no_zone");
  const records = await provider(deps).listRecords(zoneId);
  const at = now.toISOString();
  await upsertDnsZoneRow(move.orgId, move.toHost, {
    status: "active",
    delegated_at: at,
    accepted_email_hash: computeAcceptedEmailHash(records, d, row.cdsKeys.cds),
    accepted_at: at,
  });
  return done("Email records match on 1.1.1.1 and 8.8.8.8", {
    notices: [
      {
        to: "owner_email",
        key: "connected",
        type: "domain.connected",
        admins: false,
      },
      {
        to: "owner_alert",
        key: "connected_alert",
        type: "domain.connected",
        title: P14_COPY.MAIL_CONNECTED_S({ domain: d }),
        safeTitle: "Your domain is connected",
        actionLabel: "Open Domain settings",
        dedicatedEmail: true,
      },
    ],
  });
};

const EARLY_STEPS: Partial<Record<MoveStepKey, StepFn>> = {
  snapshot: snapshotStep,
  zone: zoneStep,
  gate: gateStep,
  nameservers: nameserversStep,
  delegation: delegationStep,
};

/** Steps 6-10 from ./cutover (14-23), loaded lazily; empty until that plan fills it. */
async function lateSteps(): Promise<Partial<Record<MoveStepKey, StepFn>>> {
  const mod = (await import("./cutover")) as unknown as {
    LATE_STEPS?: Partial<Record<MoveStepKey, StepFn>>;
  };
  return mod.LATE_STEPS ?? {};
}

/** A thrown step: provider/DNS trouble waits and retries; a permanent provider code fails. */
function thrownOutcome(err: unknown): StepOutcome {
  const name = errName(err);
  const e = err as { code?: unknown; retryable?: unknown };
  if (name === "CloudflareError") {
    const code = typeof e.code === "string" ? e.code.slice(0, 40) : "unknown";
    return e.retryable === true
      ? waiting(`provider_error:${code}`)
      : failed(`provider_error:${code}`);
  }
  if (name === "ZoneFileError") return failed("zone_file_invalid");
  console.error(`[domains] step error: ${name}`);
  return waiting(`error:${name.slice(0, 40)}`);
}

// ---------------------------------------------------------------------------------------
// Persisting a step (exported for 14-23)
// ---------------------------------------------------------------------------------------

function nextStatusAfterDone(
  move: MoveRow,
  key: MoveStepKey,
): { status: MoveStatus; prepared: boolean; finished: boolean } {
  if (key === "search")
    return { status: "done", prepared: false, finished: true };
  if (key === "delegation" && move.kind === "launch") {
    return { status: "prepared", prepared: true, finished: false };
  }
  return {
    status: move.status === "cutover_running" ? "cutover_running" : "running",
    prepared: false,
    finished: false,
  };
}

/**
 * Apply `out` to step `key` of `move` and commit the move with one audit row (system
 * context, job "domains"). A repeated waiting outcome with the same detail updates the
 * attempt counters only (no audit row). Returns the stored move and the notices to send.
 */
export async function recordStep(
  move: MoveRow,
  key: MoveStepKey,
  out: StepOutcome,
  now: Date,
): Promise<{ move: MoveRow; notices: MoveNotice[] }> {
  const target = out.rewindTo ?? key;
  const ti = stepIndex(target);
  const prev = move.steps[ti] as MoveStep;
  const at = now.toISOString();
  const alreadyAlerted = new Set(move.steps.flatMap((s) => s.alerted ?? []));
  const notices = (out.notices ?? []).filter((n) => !alreadyAlerted.has(n.key));
  const stepNext: MoveStep = {
    ...prev,
    ...(out.patch ?? {}),
    key: target,
    status: out.status,
    startedAt: prev.startedAt ?? at,
    attempts: (prev.attempts ?? 0) + 1,
    alerted: [...(prev.alerted ?? []), ...notices.map((n) => n.key)],
  };
  if (out.detail !== undefined) stepNext.detail = out.detail.slice(0, 200);
  else delete stepNext.detail;
  if (out.status === "done" || out.status === "failed")
    stepNext.finishedAt = at;
  else delete stepNext.finishedAt;
  if (
    out.retryInMs &&
    (out.status === "waiting" || out.status === "waiting_owner")
  ) {
    stepNext.nextAttemptAt = new Date(
      now.getTime() + out.retryInMs,
    ).toISOString();
  } else delete stepNext.nextAttemptAt;
  if (stepNext.alerted?.length === 0) delete stepNext.alerted;

  const steps = move.steps.map((s) => ({ ...s }));
  steps[ti] = stepNext;
  if (out.rewindTo) {
    for (let i = ti + 1; i < steps.length; i++) {
      const s = steps[i] as MoveStep;
      if (s.status !== "done" || i <= stepIndex(key)) {
        steps[i] = {
          key: s.key,
          status: "waiting",
          ...(s.alerted ? { alerted: s.alerted } : {}),
        };
      }
    }
  }

  const next: MoveRow = { ...move, steps };
  let action: string;
  if (out.status === "done") {
    const after = nextStatusAfterDone(move, target);
    next.status = after.status;
    next.failedStep = null;
    if (after.prepared) next.preparedAt = at;
    if (after.finished) next.doneAt = at;
    else {
      const ni = stepIndex(target) + 1;
      next.currentStep = MOVE_STEPS[ni] ?? target;
    }
    action = after.prepared ? "domain.prepared" : "domain.step_done";
  } else {
    next.currentStep = target;
    if (out.status === "failed") {
      next.status = "failed";
      next.failedStep = target;
      action = "domain.step_failed";
    } else if (out.status === "waiting_owner") {
      next.status = "waiting_owner";
      next.failedStep = null;
      action = "domain.step_waiting_owner";
    } else {
      next.status =
        move.status === "cutover_running" ? "cutover_running" : "running";
      next.failedStep = null;
      action = "domain.step_waiting";
    }
  }

  const transition =
    out.status === "done" ||
    out.status === "failed" ||
    prev.status !== out.status ||
    prev.detail !== stepNext.detail ||
    move.status !== next.status ||
    move.currentStep !== next.currentStep;
  if (transition) {
    await commit(sysCtx(), next, action, {
      step: target,
      ...(stepNext.detail ? { detail: stepNext.detail } : {}),
    });
  } else {
    await withSuperuser((pb) =>
      pb.collection(MOVES).update(next.id, stepBody(next)),
    );
  }
  return { move: next, notices };
}

// ---------------------------------------------------------------------------------------
// Notices (after commit; best effort, never throws)
// ---------------------------------------------------------------------------------------

async function addresses(
  pb: PocketBase,
  orgId: string,
  admins: boolean,
): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter(
      admins
        ? "organization = {:org} && (role = 'owner' || role = 'admin')"
        : "organization = {:org} && role = 'owner'",
      { org: orgId },
    ),
    expand: "user",
    fields: "expand.user.email",
  });
  const out = new Set<string>();
  for (const r of rows) {
    const e = str((r.expand?.user as { email?: unknown } | undefined)?.email);
    if (e !== "") out.add(e);
  }
  return [...out];
}

async function sendNotices(
  move: MoveRow,
  notices: readonly MoveNotice[],
  deps: MoveDeps,
  now: Date,
): Promise<void> {
  if (notices.length === 0) return;
  const sys = sysCtx();
  const d = move.toHost;
  let registrar = registrarName("other");
  let business = move.orgId;
  try {
    const row = await readDnsZoneRow(move.orgId, d);
    registrar = registrarDisplay(row?.registrar);
    const org = await withSuperuser((pb) =>
      pb.collection("organizations").getOne(move.orgId, { fields: "id,name" }),
    );
    if (typeof org.name === "string" && org.name !== "") business = org.name;
  } catch {
    // The id and a generic registrar name are enough.
  }
  const mailDeps = deps.transport ? { transport: deps.transport } : {};
  const hubHref = platformUrl(HUB_DOMAIN);
  for (const n of notices) {
    try {
      if (n.to === "owner_alert") {
        await raiseAlert(
          { orgId: move.orgId, as: sys },
          {
            type: n.type,
            sourceKey: `domain:${moveCode(move.seq)}:${n.key}`.slice(0, 100),
            title: n.title,
            safeTitle: n.safeTitle,
            href: HUB_DOMAIN,
            actionLabel: n.actionLabel,
          },
          {
            now,
            ...(deps.transport ? { transport: deps.transport } : {}),
            ...(n.dedicatedEmail ? { dedicatedEmail: true } : {}),
          },
        );
      } else if (n.to === "owner_email") {
        const to = await withSuperuser((pb) =>
          addresses(pb, move.orgId, n.admins),
        );
        for (const addr of to) {
          const as = { kind: "cds" as const, ctx: sys };
          const opts = { ...mailDeps, concernsOrg: move.orgId };
          if (n.type === "domain.connected") {
            await sendEmail(
              as,
              n.type,
              addr,
              { domain: d, href: hubHref },
              opts,
            );
          } else if (n.type === "domain.switch_back") {
            await sendEmail(
              as,
              n.type,
              addr,
              {
                domain: d,
                registrar,
                href: hubHref,
                count: Math.max(1, n.count ?? 1),
              },
              opts,
            );
          } else {
            await sendEmail(
              as,
              n.type,
              addr,
              { domain: d, registrar, href: hubHref },
              opts,
            );
          }
        }
      } else {
        const to = staffAlertAddress();
        if (!to) {
          console.warn(
            "[domains] staff alert not sent: no staff alert address",
          );
          continue;
        }
        await sendEmail(
          { kind: "cds", ctx: sys },
          "staff.domain_alert",
          to,
          {
            kind: n.kind,
            business,
            orgId: move.orgId,
            domain: d,
            moveCode: moveCode(move.seq),
            ...(n.step ? { step: n.step } : {}),
            ...(n.rule ? { rule: n.rule } : {}),
            ...(n.count !== undefined ? { count: n.count } : {}),
            href: platformUrl(`/staff/sites/${move.orgId}?tab=domain`),
          },
          { ...mailDeps, concernsOrg: move.orgId },
        );
      }
    } catch (err) {
      console.error(`[domains] notice not sent: ${errName(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------

function due(step: MoveStep, now: Date): boolean {
  return !step.nextAttemptAt || Date.parse(step.nextAttemptAt) <= now.getTime();
}

/**
 * Run the move's steps until one waits, waits on the owner, fails, or the move is prepared
 * or done (14-22 choice 1). A step whose next attempt is not due is left alone unless
 * `deps.force`. Same runner for the job, staff Retry and the owner's check.
 */
export async function advanceMove(
  moveId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  const first = await loadMoveRow(moveId);
  return withOrgLock(first.orgId, async () => {
    let force = deps.force === true;
    let zoneFile = deps.zoneFile;
    for (let i = 0; i <= MOVE_STEPS.length; i++) {
      const move = await loadMoveRow(moveId);
      if (!RUNNABLE.has(move.status)) return toView(move);
      const key = move.currentStep;
      const step = stepOf(move, key);
      const now = nowOf(deps);
      if (!force && !due(step, now)) return toView(move);
      force = false;
      const fn = EARLY_STEPS[key] ?? (await lateSteps())[key];
      if (!fn) return toView(move);
      let out: StepOutcome;
      try {
        out = await fn({ move, step, deps: { ...deps, zoneFile }, now });
      } catch (err) {
        out = thrownOutcome(err);
      }
      zoneFile = undefined;
      const stored = await recordStep(move, key, out, now);
      await sendNotices(stored.move, stored.notices, deps, now);
      if (out.status !== "done" || out.rewindTo) return toView(stored.move);
    }
    return toView(await loadMoveRow(moveId));
  });
}

/**
 * The job step `moves` (14-41): advance every running / waiting-on-owner / cutover move
 * whose next attempt is due, at most 20 per run. `dryRun` counts only.
 */
export async function advanceMoves(
  opts: { now?: Date; dryRun?: boolean; deps?: MoveDeps } = {},
): Promise<{
  advanced: number;
  waitingOwner: number;
  failed: number;
  expired: number;
}> {
  const now = opts.now ?? new Date();
  const expired = await expireAbandonedMoves(now, opts);
  const rows = await withSuperuser((pb) =>
    pb.collection(MOVES).getFullList({
      filter:
        "status = 'running' || status = 'waiting_owner' || status = 'cutover_running'",
      sort: "created,id",
    }),
  );
  const dueMoves = rows
    .map(toMoveRow)
    .filter((m) => due(stepOf(m, m.currentStep), now))
    .slice(0, ADVANCE_CAP);
  const result = { advanced: 0, waitingOwner: 0, failed: 0, expired };
  for (const m of dueMoves) {
    if (opts.dryRun) {
      result.advanced++;
      continue;
    }
    try {
      const v = await advanceMove(m.id, {
        ...(opts.deps ?? {}),
        now: opts.deps?.now ?? (() => now),
      });
      result.advanced++;
      if (v.status === "waiting_owner") result.waitingOwner++;
      if (v.status === "failed") result.failed++;
    } catch (err) {
      console.error(`[domains] move not advanced: ${errName(err)}`);
    }
  }
  return result;
}

/**
 * WR-A04: cancel launch moves still waiting on the owner's nameserver change after
 * MOVE_ABANDON_DAYS (a squatted or forgotten domain). cancelMove deletes the CDS zone only
 * when it provably does not serve; staff get one alert per move. At most 20 per run.
 */
async function expireAbandonedMoves(
  now: Date,
  opts: { dryRun?: boolean; deps?: MoveDeps },
): Promise<number> {
  const rows = await withSuperuser((pb) =>
    pb.collection(MOVES).getFullList({
      filter:
        "kind = 'launch' && current_step = 'nameservers' && (status = 'waiting_owner' || status = 'running')",
      sort: "created,id",
    }),
  );
  const cutoff = now.getTime() - MOVE_ABANDON_DAYS * 86_400_000;
  const stale = rows
    .map(toMoveRow)
    .filter((m) => {
      const s = stepOf(m, "nameservers").startedAt;
      return typeof s === "string" && Date.parse(s) <= cutoff;
    })
    .slice(0, EXPIRE_CAP);
  if (opts.dryRun) return stale.length;
  let n = 0;
  const deps = { ...(opts.deps ?? {}), now: opts.deps?.now ?? (() => now) };
  for (const m of stale) {
    try {
      await cancelMove(
        sysCtx(),
        m.id,
        `Expired: nameservers not changed in ${MOVE_ABANDON_DAYS} days`,
        deps,
      );
      n++;
      await sendNotices(
        await loadMoveRow(m.id),
        [
          {
            to: "staff",
            key: "abandoned",
            kind: "move_failed",
            step: "nameservers",
          },
        ],
        deps,
        now,
      );
    } catch (err) {
      console.error(`[domains] abandoned move not cancelled: ${errName(err)}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------

let platformHostSet: Set<string> | undefined;
function platformHosts(): Set<string> {
  platformHostSet ??= parsePlatformHosts(process.env.PLATFORM_HOSTS);
  return platformHostSet;
}

function domainError(code: string): InvalidInput {
  if (code === "subdomain") return new InvalidInput(P14_COPY.DOM_SUBDOMAIN);
  if (code === "reserved") return new InvalidInput(P14_COPY.DOM_RESERVED);
  return new InvalidInput(P14_COPY.DOM_INVALID);
}

async function openMoveRow(
  pb: PocketBase,
  orgId: string,
): Promise<MoveRow | null> {
  const res = await pb.collection(MOVES).getList(1, 1, {
    filter:
      pb.filter("org_id = {:org}", { org: orgId }) +
      " && (" +
      OPEN.map((s, i) =>
        pb.filter("status = {:s" + i + "}", { ["s" + i]: s }),
      ).join(" || ") +
      ")",
    sort: "-created,-id",
    skipTotal: true,
  });
  const rec = res.items[0];
  return rec ? toMoveRow(rec) : null;
}

/** P14-P23: another org has a verified host row or an active CDS zone for the domain. */
async function takenElsewhere(
  pb: PocketBase,
  orgId: string,
  d: string,
): Promise<boolean> {
  const hosts = await pb.collection("org_hosts").getList(1, 1, {
    filter: pb.filter(
      "(hostname = {:d} || hostname = {:w}) && verified_at != '' && organization != {:org}",
      { d, w: `www.${d}`, org: orgId },
    ),
    skipTotal: true,
  });
  if (hosts.items.length > 0) return true;
  const zones = await pb.collection("dns_zones").getList(1, 1, {
    filter: pb.filter(
      "domain = {:d} && status = 'active' && org_id != {:org}",
      { d, org: orgId },
    ),
    skipTotal: true,
  });
  return zones.items.length > 0;
}

async function nextSeq(pb: PocketBase): Promise<number> {
  const res = await pb
    .collection(MOVES)
    .getList(1, 1, { sort: "-seq", fields: "seq", skipTotal: true });
  const top = res.items[0];
  return (top && typeof top.seq === "number" ? top.seq : 0) + 1;
}

/**
 * Start connecting a domain (14-22 choice 2). An OrgContext may only start a `launch` move
 * on its own, not-yet-live site (P14-P38); post-launch `move`s are staff-only. Runs the
 * steps synchronously until the first wait.
 */
export async function startMove(
  ctx: OrgContext | PlatformContext | SystemContext,
  orgId: string,
  input: {
    domain: string;
    kind: "launch" | "move";
    zoneFile?: string;
    by: string;
  },
  deps: MoveDeps = {},
): Promise<MoveView> {
  const org = scopedOrgId(ctx, orgId);
  const kind = input?.kind;
  if (kind !== "launch" && kind !== "move") {
    throw new InvalidInput("kind must be launch or move");
  }
  authorizeActor(ctx, "write", kind === "move" ? "domain_move" : "domains");
  if (kind === "move" && !isPlatformContext(ctx)) {
    throw new InvalidInput(P14_COPY.DOM_MOVE_HELP);
  }
  if (!deps.provider && !dnsOpen()) throw new InvalidInput(P14_COPY.DOM_CLOSED);
  const parsed = parseDomainInput(str(input.domain), platformHosts());
  if (!parsed.ok) throw domainError(parsed.code);
  const d = parsed.domain;
  // A bad zone file fails before anything is written (ZoneFileError).
  if (input.zoneFile !== undefined && input.zoneFile.trim() !== "") {
    parseBind(input.zoneFile, d);
  }
  const by = (actorId(ctx) || str(input.by)).slice(0, 15);

  const id = await withOrgLock(org, () =>
    withSuperuser(async (pb) => {
      let orgRow: RecordModel;
      try {
        orgRow = await pb
          .collection("organizations")
          .getOne(org, { fields: "id,stage,demo,status" });
      } catch {
        throw new NotFound();
      }
      if (orgRow.demo === true) {
        throw new InvalidInput("The demo site can't connect a domain.");
      }
      // WR-A05: no new domain while Leaving CDS runs (its DNS would outlive the site).
      const leaving = await pb.collection("offboardings").getList(1, 1, {
        filter: pb.filter("org_id = {:org} && status = 'notice'", { org }),
        fields: "id",
        skipTotal: true,
      });
      if (leaving.items.length > 0) {
        throw new InvalidInput(
          "This site is moving away, so it can't connect a domain.",
        );
      }
      const live = orgRow.stage === "live";
      if (kind === "launch" && live) {
        throw new InvalidInput(P14_COPY.DOM_MOVE_HELP);
      }
      if (kind === "move" && !live) {
        throw new InvalidInput(
          "A site that isn't live connects with a launch.",
        );
      }
      if (await openMoveRow(pb, org)) {
        throw new InvalidInput("This site is already connecting a domain.");
      }
      if (await takenElsewhere(pb, org, d)) {
        throw new InvalidInput(P14_COPY.DOM_TAKEN);
      }
      const primary = await pb.collection("org_hosts").getList(1, 1, {
        filter: pb.filter("organization = {:org} && primary = true", {
          org,
        }),
        fields: "hostname",
        skipTotal: true,
      });
      const fromHost = str(primary.items[0]?.hostname);
      for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
        const seq = await nextSeq(pb);
        const newId = newRecordId();
        const batch = pb.createBatch();
        batch.collection(MOVES).create({
          id: newId,
          seq,
          org_id: org,
          kind,
          from_host: fromHost,
          to_host: d,
          status: "running",
          current_step: "snapshot",
          steps: freshSteps(),
          failed_step: "",
          overrides: [],
          acks: [],
          primary_choice: "apex",
          created_by: by,
        });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "domain.started",
            organization: org,
            targetCollection: MOVES,
            targetId: newId,
            meta: { code: moveCode(seq), kind },
          }),
        );
        try {
          await batch.send();
          return newId;
        } catch (err) {
          if (attempt === SEQ_RETRIES - 1) throw err;
        }
      }
      throw new InvalidInput("could not start the move");
    }),
  );
  return advanceMove(id, { ...deps, force: true, zoneFile: input.zoneFile });
}

// ---------------------------------------------------------------------------------------
// Retry, cancel, override, ack, re-take
// ---------------------------------------------------------------------------------------

/**
 * Retry the current step (14-22 choice 7): a failed step goes back to waiting; a waiting
 * step runs again once its next attempt is due. Audited `domain.retry` by the caller.
 */
export async function retryStep(
  ctx: OrgContext | PlatformContext | SystemContext,
  moveId: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  authorizeActor(ctx, "write", "domains");
  const move = await moveForCtx(ctx, moveId);
  await withOrgLock(move.orgId, async () => {
    const m = await loadMoveRow(move.id);
    const now = nowOf(deps);
    const step = stepOf(m, m.currentStep);
    if (m.status === "failed") {
      const steps = m.steps.map((s) => ({ ...s }));
      const i = stepIndex(m.currentStep);
      const s = steps[i] as MoveStep;
      steps[i] = { ...s, status: "waiting" };
      delete (steps[i] as MoveStep).finishedAt;
      delete (steps[i] as MoveStep).nextAttemptAt;
      const back: MoveStatus = m.preparedAt ? "cutover_running" : "running";
      await commit(
        ctx,
        { ...m, steps, status: back, failedStep: null },
        "domain.retry",
        {
          step: m.currentStep,
        },
      );
      return;
    }
    if (RUNNABLE.has(m.status) && due(step, now)) {
      await commit(ctx, m, "domain.retry", { step: m.currentStep });
      return;
    }
    throw new InvalidInput("Nothing to retry yet.");
  });
  return advanceMove(move.id, { ...deps, force: true });
}

/**
 * Cancel a move (P14-P25). A CDS zone that is provably unused (provider `pending`, public NS
 * elsewhere, step 4 not done; CR-A01) is deleted; otherwise the zone is kept and marked
 * `active` (their DNS lives at CDS: hand it back first) and only the site steps stop.
 * org_hosts rows are never touched.
 */
export async function cancelMove(
  ctx: OrgContext | PlatformContext | SystemContext,
  moveId: string,
  reason: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  authorizeActor(ctx, "write", "domain_move");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3 || why.length > 500) {
    throw new InvalidInput("Give a reason (3 to 500 characters).");
  }
  const move = await moveForCtx(ctx, moveId);
  return withOrgLock(move.orgId, async () => {
    const m = await loadMoveRow(move.id);
    if (m.status === "done" || m.status === "cancelled") {
      throw new InvalidInput("This move has already finished.");
    }
    let delegated = stepOf(m, "delegation").status === "done";
    let kept = false;
    const at = nowOf(deps).toISOString();
    if (!delegated) {
      const row = await readDnsZoneRow(m.orgId, m.toHost);
      if (row?.providerZoneId && row.status !== "active") {
        // CR-A01: step 4 done, a failed step 5 or an owner who switched before the job ran
        // all mean the domain may already point here. Keep such a zone (hand it back first).
        const nsDone = stepOf(m, "nameservers").status === "done";
        const mayServe =
          nsDone ||
          (await zoneMayServe(
            {
              domain: m.toHost,
              providerZoneId: row.providerZoneId,
              nameservers: row.nameservers,
            },
            deps,
          ));
        if (mayServe) {
          delegated = true;
          kept = true;
          await upsertDnsZoneRow(m.orgId, m.toHost, {
            status: "active",
            delegated_at: at,
          });
        } else {
          await provider(deps).deleteZone(row.providerZoneId);
          await upsertDnsZoneRow(m.orgId, m.toHost, {
            status: "deleted",
            provider_zone_id: "",
            nameservers: [],
          });
        }
      }
    }
    const steps = m.steps.map((s) =>
      s.status === "done" || s.status === "skipped"
        ? { ...s }
        : {
            ...s,
            status: "cancelled" as const,
            ...(kept && s.key === "delegation" ? { detail: ZONE_KEPT } : {}),
          },
    );
    const next: MoveRow = {
      ...m,
      steps,
      status: "cancelled",
      cancelledAt: at,
      cancelReason: why,
    };
    await commit(ctx, next, "domain.cancelled", {
      step: m.currentStep,
      ...(delegated ? { detail: "CANCEL_DELEGATED" } : {}),
    });
    return toView(next);
  });
}

/**
 * A super_admin override of one gate rule (14-22 choice 7). Only a rule whose current
 * finding is `overridable && !hardBlock` qualifies: G1-email, G3 and G6 never do.
 */
export async function overrideGateRule(
  ctx: PlatformContext,
  moveId: string,
  rule: GateRule,
  reason: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  if (!isPlatformContext(ctx)) throw new Forbidden("staff only");
  authorizeStaff(ctx.staffRole, "domain_override");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 10 || why.length > 500) {
    throw new InvalidInput("Give a reason (10 to 500 characters).");
  }
  const move = await moveForCtx(ctx, moveId);
  await withOrgLock(move.orgId, async () => {
    const m = await loadMoveRow(move.id);
    if (!RUNNABLE.has(m.status) || m.currentStep !== "gate") {
      throw new InvalidInput(P14_COPY.NO_OVERRIDE);
    }
    const f = (stepOf(m, "gate").findings ?? []).find((x) => x.rule === rule);
    if (!f || f.pass || f.hardBlock || !f.overridable) {
      throw new InvalidInput(P14_COPY.NO_OVERRIDE);
    }
    const at = nowOf(deps).toISOString();
    const overrides = [
      ...m.overrides.filter((o) => o.rule !== rule),
      { rule, by: ctx.actor, reason: why, at },
    ];
    await commit(ctx, { ...m, overrides }, "domain.override", {
      step: "gate",
      rule,
    });
  });
  return advanceMove(move.id, { ...deps, force: true });
}

/** The owner acknowledges a registrar-only service that stops at the switch (G5). */
export async function acknowledgeFinding(
  ctx: OrgContext,
  moveId: string,
  key: string,
  deps: MoveDeps = {},
): Promise<MoveView> {
  if (!isOrgContext(ctx)) throw new Forbidden("owner only");
  authorize(ctx, "domain", "write");
  const move = await moveForCtx(ctx, moveId);
  if (typeof key !== "string" || !ACK_RE.test(key)) {
    throw new InvalidInput("unknown acknowledgement");
  }
  await withOrgLock(move.orgId, async () => {
    const m = await loadMoveRow(move.id);
    if (!RUNNABLE.has(m.status)) throw new InvalidInput("Nothing to confirm.");
    if (m.acks.some((a) => a.key === key)) return;
    const acks = [
      ...m.acks,
      { key, by: ctx.actor, at: nowOf(deps).toISOString() },
    ];
    await commit(ctx, { ...m, acks }, "domain.ack", {
      step: m.currentStep,
      key,
    });
  });
  return advanceMove(move.id, { ...deps, force: true });
}

/**
 * Re-take the snapshot (owner zone-file upload for G2, or staff), then copy and gate again.
 * Only before the delegation is verified.
 */
export async function retakeSnapshot(
  ctx: OrgContext | PlatformContext | SystemContext,
  moveId: string,
  opts: { zoneFile?: string } = {},
  deps: MoveDeps = {},
): Promise<MoveView> {
  authorizeActor(ctx, "write", "domains");
  const move = await moveForCtx(ctx, moveId);
  if (opts.zoneFile !== undefined && opts.zoneFile.trim() !== "") {
    parseBind(opts.zoneFile, move.toHost);
  }
  await withOrgLock(move.orgId, async () => {
    const m = await loadMoveRow(move.id);
    if (!RUNNABLE.has(m.status) && m.status !== "failed") {
      throw new InvalidInput("This move can't take a new snapshot now.");
    }
    if (stepOf(m, "delegation").status === "done") {
      throw new InvalidInput("The domain already points to us.");
    }
    const now = nowOf(deps);
    const latest = await latestSnapshot(m.orgId, m.toHost, {
      store: deps.store,
    });
    let snap: Snapshot;
    try {
      snap = await freshSnapshot(
        m.orgId,
        m.toHost,
        latest?.snapshot ?? null,
        latest?.row ?? null,
        deps,
        now,
        opts.zoneFile,
      );
    } catch (err) {
      // CR-A02: never snapshot CDS's own copy.
      if (err instanceof DnsSweepAtCds) {
        throw new InvalidInput("The domain already points to us.");
      }
      throw err;
    }
    const at = now.toISOString();
    const steps = m.steps.map((s, i) => {
      if (s.key === "snapshot") {
        return {
          ...s,
          status: "done" as const,
          detail: `${snap.records.length} records from ${snap.sources.join("+") || "sweep"}`,
          finishedAt: at,
        };
      }
      if (i >= stepIndex("zone") && i <= stepIndex("delegation")) {
        return {
          key: s.key,
          status: "waiting" as const,
          ...(s.alerted ? { alerted: s.alerted } : {}),
        };
      }
      return s;
    });
    await commit(
      ctx,
      { ...m, steps, currentStep: "zone", status: "running", failedStep: null },
      "domain.snapshot_retaken",
      { step: "snapshot" },
    );
  });
  return advanceMove(move.id, { ...deps, force: true });
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

/** One move, for its own org (OrgContext) or staff. */
export async function getMove(
  ctx: OrgContext | PlatformContext | SystemContext,
  moveId: string,
): Promise<MoveView> {
  authorizeActor(ctx, "read", "domains");
  return toView(await moveForCtx(ctx, moveId));
}

/** The org's open move (not done or cancelled), or null. */
export async function openMoveFor(
  ctx: OrgContext | PlatformContext | SystemContext,
  orgId?: string,
): Promise<MoveView | null> {
  const org = scopedOrgId(ctx, orgId);
  authorizeActor(ctx, "read", "domains");
  const row = await withSuperuser((pb) => openMoveRow(pb, org));
  return row ? toView(row) : null;
}

/** A move by its display code `M-<seq>` (staff and jobs). */
export async function moveByCode(
  ctx: PlatformContext | SystemContext,
  code: string,
): Promise<MoveView> {
  if (isOrgContext(ctx)) throw new NotFound();
  authorizeActor(ctx, "read", "domains");
  const m = typeof code === "string" ? CODE_RE.exec(code.trim()) : null;
  if (!m) throw new NotFound();
  const rec = await withSuperuser((pb) =>
    pb
      .collection(MOVES)
      .getFirstListItem(pb.filter("seq = {:seq}", { seq: Number(m[1]) }))
      .catch(() => null),
  );
  if (!rec) throw new NotFound();
  return toView(toMoveRow(rec));
}
