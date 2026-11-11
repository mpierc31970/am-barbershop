// packages/db/src/dns/owner.ts (P14, DOM-02, DOM-04, DOM-08).
// Owner: 14-29 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The owner side of connecting a domain: ONE read model naming the owner's state (UI-SPEC
// Settings › Domain S-closed, S0-S8) that the Domain tab (14-31) renders as is, and the owner
// actions that drive the same move machine staff and the job use (14-22 `moves.ts`).
//
// Org scoping (P14-P34): every function takes only an OrgContext and resolves its org with
// `scopedOrgId(ctx)`; a move is only ever the org's own `openMoveFor(ctx)` (or its last done
// move). Nothing here accepts an org id or a move id from the caller.
//
// The view is an allowlist (T-14-29-01, D-UI-P14-4): owner step words, finding kinds, record
// type/name/value only. Never record sources, provider zone ids, staff findings, step detail
// codes or failure words: a failed late step shows as "Finishing" with the step "Now".
// Errors are logged by class name only.
import { can, InvalidInput, parsePlatformHosts, RateLimited } from "@cds/core";
import {
  classifyRecord,
  detectMailProvider,
  fqdn,
  mailProvider,
  MAX_ZONE_FILE_BYTES,
  NEEDS_YOU,
  OWNER_STEP_FOR,
  OWNER_STEP_WORDS,
  recordKey,
  registrarFromRdapName,
  registrarName,
  registrarRecordsNotCopied,
  registrarSteps,
  P14_COPY,
  parseDomainInput,
  ZoneFileError,
  type DnsRecord,
  type GateFinding,
  type MoveStepKey,
  type RegistrarId,
  type RType,
} from "@cds/core/dns";
import { isEmail } from "@cds/core/email";
import type { NeedsYouItem } from "@cds/core/today";
import { appendAudit } from "../audit";
import { withSuperuser } from "../client";
import { assertOrgContext, scopedOrgId, type OrgContext } from "../context";
import { sendEmail } from "../email/send";
import { readPlatformMeta } from "../platform-meta";
import { SlidingWindowLimiter } from "../rate-limit";
import { requirePermission } from "../repository";
import {
  dnsOpen,
  getDnsProvider,
  getDnsResolver,
  getRegistryLookup,
} from "./factory";
import {
  acknowledgeFinding,
  advanceMove,
  cancelMove,
  getMove,
  MOVE_STEPS,
  openMoveFor,
  retakeSnapshot,
  startMove,
  type MoveDeps,
  type MoveStep,
  type MoveView,
} from "./moves";
import {
  latestSnapshot,
  readDnsZoneRow,
  type DnsZoneRow,
  type Snapshot,
} from "./snapshot";

// ---------------------------------------------------------------------------------------
// Contract (14-31, 14-32, 14-46, 14-50)
// ---------------------------------------------------------------------------------------

export type OwnerDomainState =
  | "closed"
  | "none"
  | "checking"
  | "findings"
  | "nameservers"
  | "waiting"
  | "connected"
  | "finishing"
  | "live"
  | "switch_back"
  | "lost";

/** Same words as `@cds/ui/hub/domain` OwnerFindingKind (14-30 GateFinding). */
export type OwnerDomainFindingKind =
  | "dnssec"
  | "spf"
  | "email_forwarding"
  | "web_forwarding"
  | "parking"
  | "mail_incomplete"
  | "cds_review";

/** One open finding before the switch, in the owner's words (no rule ids, no values). */
export type OwnerDomainFinding = {
  kind: OwnerDomainFindingKind;
  /** Registrar display name for the copy ("GoDaddy", "your registrar"). */
  registrar: string;
  /** The checkbox key for `ownerAcknowledge` (forwarding / parking findings only). */
  ackKey?: string;
  /** SPF record count (spf) or records under review (cds_review). */
  count?: number;
  /** Mail provider display name (mail_incomplete). */
  provider?: string;
  /** "This step can't be skipped." */
  hardBlock: boolean;
};

export type OwnerDomainCopyGroup = "email" | "verification" | "site" | "other";

/** One "What we'll copy" row: no sources, no provider ids (UI-SPEC S2 item 3). */
export type OwnerDomainCopyRow = {
  group: OwnerDomainCopyGroup;
  type: RType;
  name: string;
  value: string;
  priority?: number;
  status: "copied" | "checking" | "added" | "pending";
};

export type OwnerDomainStep = {
  label: string;
  status: "done" | "now" | "todo";
  at?: string;
};

export type OwnerDomainView = {
  state: OwnerDomainState;
  domain: string | null;
  previewHost: string | null;
  registrar: { id: RegistrarId; name: string } | null;
  expiresAt: string | null;
  expiry: "ok" | "30d" | "7d";
  email: { provider: string | null; count: number };
  findings: OwnerDomainFinding[];
  records: OwnerDomainCopyRow[];
  /** The two CDS nameservers to set at the registrar. */
  nameservers: string[];
  /** The nameservers before the switch (S7 "Your old nameservers"). */
  oldNameservers: string[];
  lastCheckedAt: string | null;
  waitingSince: string | null;
  /** 48 h at the nameserver step without the change (NS-SLOW). */
  nsSlow: boolean;
  /** Six owner step words (S5b BuildTracker); empty without a move. */
  steps: OwnerDomainStep[];
  primaryChoice: "apex" | "www";
  /** Owner (or impersonating staff) may act; Admin reads only. */
  canAct: boolean;
  /** "Records copied 9 Oct · Nameservers changed 10 Oct" (collapsed history line). */
  history: string | null;
};

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

const MOVES = "domain_moves";
const DAY_MS = 86_400_000;
const NS_SLOW_MS = 48 * 3_600_000;
/** moves.ts RETRY_MS: a waiting step's next attempt is this long after its last check. */
const STEP_RETRY_MS = 5 * 60_000;
/** Read-only: 14-27 opens/closes `domains:incident:<org>:<kind>` in platform_meta. */
const LOST_KEY = (org: string) => `domains:incident:${org}:delegation_lost`;
const EARLY: ReadonlySet<MoveStepKey> = new Set(["snapshot", "zone", "gate"]);
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

/** PocketBase dates ("YYYY-MM-DD HH:MM:SS.sssZ") or ISO as ISO; null otherwise. */
function ownerIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "9 Oct" (UTC). */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function registrarOf(
  raw: string | null | undefined,
): { id: RegistrarId; name: string } | null {
  const name = (raw ?? "").trim();
  if (name === "") return null;
  const id = registrarFromRdapName(name);
  return { id, name: id === "other" ? name.slice(0, 80) : registrarName(id) };
}

function registrarWord(r: { name: string } | null): string {
  return r?.name ?? registrarName("other");
}

function stepOf(move: MoveView, key: MoveStepKey): MoveStep {
  return move.steps.find((s) => s.key === key) ?? { key, status: "waiting" };
}

function stepIdx(key: MoveStepKey): number {
  return MOVE_STEPS.indexOf(key as (typeof MOVE_STEPS)[number]);
}

type OrgFacts = {
  stage: string;
  demo: boolean;
  previewHost: string | null;
  customPrimary: string | null;
};

async function orgFacts(org: string): Promise<OrgFacts> {
  return withSuperuser(async (pb) => {
    const o = await pb
      .collection("organizations")
      .getOne(org, { fields: "id,stage,demo" });
    const hosts = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:org}", { org }),
      fields: "hostname,kind,primary",
    });
    const preview = hosts.find((h) => h.kind === "preview");
    const custom = hosts.find((h) => h.kind === "custom" && h.primary === true);
    return {
      stage: str(o.stage),
      demo: o.demo === true,
      previewHost: preview ? str(preview.hostname) : null,
      customPrimary: custom ? str(custom.hostname) : null,
    };
  });
}

/** The org's open move, else its last done move (live sites), else null. */
async function currentMove(ctx: OrgContext): Promise<MoveView | null> {
  const open = await openMoveFor(ctx);
  if (open) return open;
  const id = await withSuperuser(async (pb) => {
    const res = await pb.collection(MOVES).getList(1, 1, {
      filter: pb.filter("org_id = {:org} && status = 'done'", {
        org: ctx.orgId,
      }),
      sort: "-created,-id",
      fields: "id",
      skipTotal: true,
    });
    return res.items[0]?.id ?? null;
  });
  // getMove re-checks the org (P14-P34) and the read permission.
  return id ? getMove(ctx, id) : null;
}

/** Owner check times from the audit log (`domain.owner_check`), oldest and newest. */
async function ownerChecks(
  org: string,
  moveId: string,
): Promise<{ first: string | null; last: string | null }> {
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && target_id = {:id} && action = 'domain.owner_check'",
        { org, id: moveId },
      ),
      sort: "created,id",
      fields: "created",
    });
    return {
      first: ownerIso(str(rows[0]?.created)),
      last: ownerIso(str(rows.at(-1)?.created)),
    };
  });
}

/** The state (14-29 choice 2). `lost` and `live` need the org facts. */
function stateOf(
  move: MoveView | null,
  facts: OrgFacts,
  lost: boolean,
  ownerChecked: boolean,
): OwnerDomainState {
  if (!move) {
    if (facts.stage === "live" && facts.customPrimary) {
      return lost ? "lost" : "live";
    }
    return "none";
  }
  if (move.status === "done") {
    if (facts.stage !== "live") return "finishing";
    return lost ? "lost" : "live";
  }
  if (move.status === "prepared") return "connected";
  if (move.status === "cutover_running") return "finishing";
  if (move.status === "failed") {
    const f = move.failedStep ?? move.currentStep;
    if (stepIdx(f) >= stepIdx("site_records")) return "finishing";
    const det = stepOf(move, f).detail ?? "";
    if (f === "delegation" && det === "post_switch_mismatch") {
      return "switch_back";
    }
    // An early step CDS has to sort out: the owner sees CDS reviewing it.
    return "findings";
  }
  // running | waiting_owner
  const cur = move.currentStep;
  if (EARLY.has(cur)) {
    const gate = stepOf(move, "gate");
    if (
      cur === "gate" &&
      (gate.status === "waiting_owner" || gate.detail === "cds_review")
    ) {
      return "findings";
    }
    return "checking";
  }
  if (cur === "nameservers") return ownerChecked ? "waiting" : "nameservers";
  if (cur === "delegation") return "waiting";
  return "finishing";
}

/** Gate findings in owner words; hard blocks first, then acknowledgements, then CDS-side. */
function ownerFindings(
  move: MoveView,
  registrar: string,
  state: OwnerDomainState,
): OwnerDomainFinding[] {
  if (state !== "findings") return [];
  const out: OwnerDomainFinding[] = [];
  const failing = (move.findings ?? []).filter((f) => !f.pass);
  const acked = new Set(move.acks.map((a) => a.key));
  let cds = 0;
  for (const f of failing as GateFinding[]) {
    const d = f.detail;
    if (d.rule === "G3") {
      if (d.dnssec === true) {
        out.push({ kind: "dnssec", registrar, hardBlock: true });
      }
      // Unknown: CDS keeps checking (P14-P37); nothing for the owner to do.
    } else if (d.rule === "G6") {
      out.push({
        kind: "spf",
        registrar,
        count: d.spfCount,
        hardBlock: true,
      });
    } else if (d.rule === "G5") {
      for (const s of d.services) {
        const key = `G5:${s.kind}`;
        if (s.acknowledged || acked.has(key)) continue;
        out.push({
          kind: s.kind,
          registrar:
            registrarName(s.registrar) === registrarName("other")
              ? registrar
              : registrarName(s.registrar),
          ackKey: key,
          hardBlock: false,
        });
      }
    } else if (d.rule === "G2") {
      out.push({
        kind: "mail_incomplete",
        registrar,
        provider: d.provider ? mailProvider(d.provider).name : "your email",
        hardBlock: false,
      });
    } else if (d.rule === "G1") {
      cds += Math.max(1, d.missing.length + d.mismatched.length);
    } else {
      cds += 1;
    }
  }
  const gate = stepOf(move, "gate");
  const cdsSide =
    cds > 0 ||
    gate.detail === "cds_review" ||
    move.status === "failed" ||
    (out.length === 0 && failing.length > 0);
  if (cdsSide) {
    out.push({
      kind: "cds_review",
      registrar,
      count: Math.max(1, cds),
      hardBlock: false,
    });
  }
  const rank = (f: OwnerDomainFinding) =>
    f.hardBlock ? 0 : f.ackKey ? 1 : f.kind === "cds_review" ? 3 : 2;
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The records CDS copies (moves.ts recordsToCopy): no SOA, no apex NS, no web forwarding or parking. */
function copiedRecords(s: Snapshot): DnsRecord[] {
  const d = fqdn(s.domain);
  const g5 = registrarRecordsNotCopied(
    s.records,
    registrarFromRdapName(s.registrar),
  );
  return s.records.filter(
    (r) =>
      r.type !== "SOA" &&
      !(r.type === "NS" && fqdn(r.name) === d) &&
      !g5.has(recordKey(r)),
  );
}

function groupOf(cls: string): OwnerDomainCopyGroup {
  if (cls === "email" || cls === "verification" || cls === "site") return cls;
  return "other";
}

function row(
  r: DnsRecord,
  group: OwnerDomainCopyGroup,
  status: OwnerDomainCopyRow["status"],
): OwnerDomainCopyRow {
  return {
    group,
    type: r.type,
    name: r.name,
    value: r.value,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    status,
  };
}

async function copyRows(
  move: MoveView,
  snap: Snapshot,
  zone: DnsZoneRow,
  deps: MoveDeps,
): Promise<OwnerDomainCopyRow[]> {
  const d = fqdn(snap.domain);
  const cdsKeys = new Set(zone.cdsKeys.cds);
  const wanted = copiedRecords(snap);
  const zoneDone = stepOf(move, "zone").status === "done";
  let inZone: Set<string> | null = null;
  let added: DnsRecord[] = [];
  if (zoneDone && zone.providerZoneId) {
    try {
      const listed = await (deps.provider ?? getDnsProvider()).listRecords(
        zone.providerZoneId,
      );
      inZone = new Set(listed.map((r) => recordKey(r)));
      const snapKeys = new Set(wanted.map((r) => recordKey(r)));
      added = listed.filter(
        (r) => cdsKeys.has(recordKey(r)) && !snapKeys.has(recordKey(r)),
      );
    } catch (err) {
      console.error(`[domains] owner view zone read: ${errName(err)}`);
    }
  }
  const out = wanted.map((r) => {
    const cls = classifyRecord(r, d, { cdsKeys });
    const status: OwnerDomainCopyRow["status"] = !inZone
      ? "checking"
      : inZone.has(recordKey(r))
        ? "copied"
        : "pending";
    return row(r, groupOf(cls), status);
  });
  for (const r of added) out.push(row(r, "other", "added"));
  const order: OwnerDomainCopyGroup[] = [
    "email",
    "verification",
    "site",
    "other",
  ];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

function ownerSteps(move: MoveView, domain: string): OwnerDomainStep[] {
  const words = OWNER_STEP_WORDS({ domain });
  return words.map((label, i) => {
    const keys = MOVE_STEPS.filter((k) => OWNER_STEP_FOR[k] === i);
    const steps = keys.map((k) => stepOf(move, k));
    const allDone =
      move.status === "done" ||
      steps.every((s) => s.status === "done" || s.status === "skipped");
    if (allDone) {
      const at = steps
        .map((s) => s.finishedAt ?? "")
        .filter((x) => x !== "")
        .sort()
        .at(-1);
      return at
        ? { label, status: "done" as const, at }
        : { label, status: "done" as const };
    }
    const now = keys.includes(move.currentStep);
    return { label, status: now ? ("now" as const) : ("todo" as const) };
  });
}

function historyLine(move: MoveView): string | null {
  const parts: string[] = [];
  const copied = stepOf(move, "gate");
  if (copied.status === "done" && copied.finishedAt) {
    parts.push(`Records copied ${dayMonth(copied.finishedAt)}`);
  }
  const ns = stepOf(move, "delegation");
  if (ns.status === "done" && ns.finishedAt) {
    parts.push(`Nameservers changed ${dayMonth(ns.finishedAt)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function expiryOf(expiresAt: string | null, now: Date): "ok" | "30d" | "7d" {
  if (!expiresAt) return "ok";
  const days = (Date.parse(expiresAt) - now.getTime()) / DAY_MS;
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return "ok";
}

function emptyView(
  state: OwnerDomainState,
  facts: OrgFacts | null,
  canAct: boolean,
): OwnerDomainView {
  return {
    state,
    domain: null,
    previewHost: facts?.previewHost ?? null,
    registrar: null,
    expiresAt: null,
    expiry: "ok",
    email: { provider: null, count: 0 },
    findings: [],
    records: [],
    nameservers: [],
    oldNameservers: [],
    lastCheckedAt: null,
    waitingSince: null,
    nsSlow: false,
    steps: [],
    primaryChoice: "apex",
    canAct,
    history: null,
  };
}

/** The apex a live primary host belongs to (`www.x` -> `x`). */
function apexOf(host: string): string {
  const h = fqdn(host);
  return h.startsWith("www.") ? h.slice(4) : h;
}

type BuildOpts = { now?: Date; deps?: MoveDeps; records?: boolean };

/** Internal: the view plus the move it came from (actions need its id). */
async function buildOwnerDomainView(
  ctx: OrgContext,
  opts: BuildOpts = {},
): Promise<{ view: OwnerDomainView; move: MoveView | null }> {
  assertOrgContext(ctx);
  const org = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "read");
  const canAct = can(ctx, "domain", "write");
  const now = opts.now ?? opts.deps?.now?.() ?? new Date();
  const deps = opts.deps ?? {};
  if (!deps.provider && !dnsOpen()) {
    return { view: emptyView("closed", null, false), move: null };
  }
  const facts = await orgFacts(org);
  if (facts.demo) {
    return { view: emptyView("none", facts, false), move: null };
  }
  const move = await currentMove(ctx);
  const lost =
    facts.stage === "live" &&
    ((await readPlatformMeta(LOST_KEY(org)).catch(() => null)) ?? "") !== "";
  const checks = move
    ? await ownerChecks(org, move.id)
    : { first: null, last: null };
  const state = stateOf(move, facts, lost, checks.first !== null);
  if (state === "none") {
    return { view: emptyView("none", facts, canAct), move: null };
  }

  const domain = move ? move.toHost : apexOf(facts.customPrimary ?? "");
  const zone = await readDnsZoneRow(org, domain).catch(() => null);
  const latest = await latestSnapshot(org, domain, {
    store: deps.store,
  }).catch(() => null);
  const snap = latest?.snapshot ?? null;
  const registrar = registrarOf(zone?.registrar ?? snap?.registrar ?? null);
  const regWord = registrarWord(registrar);
  const expiresAt = ownerIso(zone?.expiresAt);

  let email = { provider: null as string | null, count: 0 };
  if (snap) {
    const d = fqdn(snap.domain);
    const cdsKeys = new Set(zone?.cdsKeys.cds ?? []);
    const id = detectMailProvider(snap.records, d);
    email = {
      provider: id ? mailProvider(id).name : null,
      count: copiedRecords(snap).filter(
        (r) => classifyRecord(r, d, { cdsKeys }) === "email",
      ).length,
    };
  }

  const preLive = state !== "live" && state !== "lost" && state !== "finishing";
  const records =
    opts.records !== false && move && snap && zone && preLive
      ? await copyRows(move, snap, zone, deps)
      : [];

  const nsStep = move ? stepOf(move, "nameservers") : null;
  const nsWaiting =
    move !== null &&
    (move.currentStep === "nameservers" || move.currentStep === "delegation") &&
    (move.status === "running" || move.status === "waiting_owner");
  const jobChecked =
    nsWaiting && nsStep?.nextAttemptAt
      ? new Date(Date.parse(nsStep.nextAttemptAt) - STEP_RETRY_MS).toISOString()
      : null;
  const lastCheckedAt = nsWaiting
    ? ([checks.last, jobChecked]
        .filter((x): x is string => x !== null)
        .sort()
        .at(-1) ?? null)
    : null;
  const started = nsStep?.startedAt ? Date.parse(nsStep.startedAt) : NaN;

  const view: OwnerDomainView = {
    state,
    domain,
    previewHost: facts.previewHost,
    registrar,
    expiresAt,
    expiry: expiryOf(expiresAt, now),
    email,
    findings: move ? ownerFindings(move, regWord, state) : [],
    records,
    nameservers: [...(zone?.nameservers ?? [])],
    oldNameservers: [
      ...(snap?.originalNameservers.length
        ? snap.originalNameservers
        : (zone?.originalNameservers ?? [])),
    ],
    lastCheckedAt,
    waitingSince: nsWaiting ? checks.first : null,
    nsSlow:
      nsWaiting &&
      move?.currentStep === "nameservers" &&
      !Number.isNaN(started) &&
      now.getTime() - started >= NS_SLOW_MS,
    steps: move ? ownerSteps(move, domain) : [],
    primaryChoice: move?.primaryChoice ?? "apex",
    canAct,
    history: move ? historyLine(move) : null,
  };
  return { view, move };
}

/**
 * The owner's Domain tab view (Owner and Admin; `canAct` only for the Owner or impersonating
 * staff). One state per UI-SPEC Settings › Domain; allowlisted fields only.
 */
export async function ownerDomainView(
  ctx: OrgContext,
  now?: Date,
  deps: MoveDeps = {},
): Promise<OwnerDomainView> {
  return (await buildOwnerDomainView(ctx, { now, deps })).view;
}

// ---------------------------------------------------------------------------------------
// Owner actions (14-29 choices 3-5)
// ---------------------------------------------------------------------------------------

export type OwnerDomainCode =
  | "closed"
  | "demo"
  | "move_help"
  | "invalid"
  | "subdomain"
  | "reserved"
  | "taken"
  | "not_registered"
  | "cf_registrar"
  | "zone_too_big"
  | "zone_unreadable"
  | "zone_wrong_domain"
  | "email_invalid"
  | "note_too_long"
  | "too_late"
  | "nothing_open";

/** An owner domain action refused with owner copy (the UI maps `reason` to its field). */
export class OwnerDomainRefused extends InvalidInput {
  readonly reason: OwnerDomainCode;
  constructor(reason: OwnerDomainCode, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** "I've changed them" / Check again: 1 per 30 s per org (P14-P15, T-14-29-02). */
const OWNER_CHECK_MS = 30_000;
let checkLimiter = new SlidingWindowLimiter(1, OWNER_CHECK_MS);
/** Nameserver steps mail: at most 5 per org per rolling day (T-14-29-03). */
export const OWNER_STEPS_SENDS_PER_DAY = 5;
const NOTE_MAX = 500;
const INVITE_INVALID = "Enter an email address like name@example.com.";
const NOTHING_OPEN = "There's no domain step to do right now.";

/** Tests only: forget the per-org check limiter. */
export function resetOwnerDomainLimitsForTests(): void {
  checkLimiter = new SlidingWindowLimiter(1, OWNER_CHECK_MS);
}

let ownerPlatformHosts: Set<string> | undefined;
function platformHosts(): Set<string> {
  ownerPlatformHosts ??= parsePlatformHosts(process.env.PLATFORM_HOSTS);
  return ownerPlatformHosts;
}

function assertWrite(ctx: OrgContext, deps: MoveDeps): string {
  assertOrgContext(ctx);
  const org = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "write");
  if (!deps.provider && !dnsOpen()) {
    throw new OwnerDomainRefused("closed", P14_COPY.DOM_CLOSED);
  }
  return org;
}

async function openMoveOrRefuse(ctx: OrgContext): Promise<MoveView> {
  const move = await openMoveFor(ctx);
  if (!move) throw new OwnerDomainRefused("nothing_open", NOTHING_OPEN);
  return move;
}

/**
 * Connect a domain (S0 "Check my domain"; D54, D56, D288). Pre-launch only: a live site or
 * one with a custom main address asks CDS Support (DOM-MOVE-HELP, P14-P38). The RDAP read
 * never blocks except "not registered" and "registered at Cloudflare". Returns the view.
 */
export async function ownerConnectDomain(
  ctx: OrgContext,
  raw: string,
  deps: MoveDeps = {},
): Promise<OwnerDomainView> {
  const org = assertWrite(ctx, deps);
  const facts = await orgFacts(org);
  if (facts.demo) {
    throw new OwnerDomainRefused(
      "demo",
      "The demo site can't connect a domain.",
    );
  }
  if (facts.stage === "live" || facts.customPrimary) {
    throw new OwnerDomainRefused("move_help", P14_COPY.DOM_MOVE_HELP);
  }
  const parsed = parseDomainInput(
    typeof raw === "string" ? raw.slice(0, 300) : "",
    platformHosts(),
  );
  if (!parsed.ok) {
    if (parsed.code === "subdomain") {
      throw new OwnerDomainRefused("subdomain", P14_COPY.DOM_SUBDOMAIN);
    }
    if (parsed.code === "reserved") {
      throw new OwnerDomainRefused("reserved", P14_COPY.DOM_RESERVED);
    }
    throw new OwnerDomainRefused("invalid", P14_COPY.DOM_INVALID);
  }
  const domain = parsed.domain;
  let info: Awaited<
    ReturnType<ReturnType<typeof getRegistryLookup>["lookup"]>
  > | null = null;
  try {
    info = await (deps.registry ?? getRegistryLookup()).lookup(domain);
  } catch (err) {
    // RDAP-UNKNOWN never blocks.
    console.error(`[domains] owner connect registry: ${errName(err)}`);
  }
  if (info && !info.found) {
    throw new OwnerDomainRefused(
      "not_registered",
      P14_COPY.DOM_NOT_REGISTERED({ domain }),
    );
  }
  if (info?.registrar && /cloudflare/i.test(info.registrar)) {
    throw new OwnerDomainRefused(
      "cf_registrar",
      P14_COPY.DOM_CF_REGISTRAR({ domain }),
    );
  }
  try {
    await startMove(ctx, org, { domain, kind: "launch", by: ctx.actor }, deps);
  } catch (err) {
    if (err instanceof InvalidInput && err.message === P14_COPY.DOM_TAKEN) {
      throw new OwnerDomainRefused("taken", P14_COPY.DOM_TAKEN);
    }
    throw err;
  }
  return ownerDomainView(ctx, undefined, deps);
}

/** The domain a zone file names ($ORIGIN, else the SOA owner), for ZONE-WRONG-DOMAIN. */
function zoneFileDomain(text: string): string {
  const origin = /^\$ORIGIN\s+(\S+)/im.exec(text)?.[1];
  const soa = /^(\S+)\s+(?:\d+\s+)?(?:IN\s+)?(?:\d+\s+)?SOA\s/im.exec(
    text,
  )?.[1];
  const name = (origin ?? soa ?? "").replace(/\.$/, "").toLowerCase();
  return /^[a-z0-9.-]{1,253}$/.test(name) && name !== "@"
    ? name
    : "another domain";
}

/**
 * Add the owner's zone file to the copy (S2 zone file disclosure, G2). Allowed while the
 * domain still points to the old host. Returns how many records it added and the view.
 */
export async function ownerUploadZoneFile(
  ctx: OrgContext,
  text: string,
  deps: MoveDeps = {},
): Promise<{ added: number; message: string; view: OwnerDomainView }> {
  const org = assertWrite(ctx, deps);
  const body = typeof text === "string" ? text : "";
  if (Buffer.byteLength(body, "utf8") > MAX_ZONE_FILE_BYTES) {
    throw new OwnerDomainRefused("zone_too_big", P14_COPY.ZONE_TOO_BIG);
  }
  if (body.trim() === "") {
    throw new OwnerDomainRefused("zone_unreadable", P14_COPY.ZONE_UNREADABLE);
  }
  const move = await openMoveOrRefuse(ctx);
  if (stepOf(move, "delegation").status === "done") {
    throw new OwnerDomainRefused("too_late", NOTHING_OPEN);
  }
  const before =
    (await latestSnapshot(org, move.toHost, { store: deps.store }))?.snapshot
      .records.length ?? 0;
  try {
    await retakeSnapshot(ctx, move.id, { zoneFile: body }, deps);
  } catch (err) {
    if (err instanceof ZoneFileError) {
      if (err.code === "too_big") {
        throw new OwnerDomainRefused("zone_too_big", P14_COPY.ZONE_TOO_BIG);
      }
      if (err.code === "wrong_domain") {
        throw new OwnerDomainRefused(
          "zone_wrong_domain",
          P14_COPY.ZONE_WRONG_DOMAIN({
            fileDomain: zoneFileDomain(body),
            domain: move.toHost,
          }),
        );
      }
      throw new OwnerDomainRefused("zone_unreadable", P14_COPY.ZONE_UNREADABLE);
    }
    throw err;
  }
  const after =
    (await latestSnapshot(org, move.toHost, { store: deps.store }))?.snapshot
      .records.length ?? before;
  const added = Math.max(0, after - before);
  return {
    added,
    message: P14_COPY.ZONE_ADDED({ count: added }),
    view: await ownerDomainView(ctx, undefined, deps),
  };
}

/** Tick a forwarding / parking finding (G5) on the org's own open move only (P14-P34). */
export async function ownerAcknowledge(
  ctx: OrgContext,
  key: string,
  deps: MoveDeps = {},
): Promise<OwnerDomainView> {
  assertWrite(ctx, deps);
  const move = await openMoveOrRefuse(ctx);
  await acknowledgeFinding(ctx, move.id, key, deps);
  return ownerDomainView(ctx, undefined, deps);
}

/**
 * "I've changed them" / "Check again" / "Check now" / "I've switched them back" (P14-P15):
 * runs the step waiting on the owner now, 1 per 30 s per org. `notYet` is true while the
 * nameserver change is still not seen (NS-NOT-YET).
 */
export async function ownerCheckNameservers(
  ctx: OrgContext,
  deps: MoveDeps = {},
): Promise<{
  state: OwnerDomainState;
  notYet: boolean;
  view: OwnerDomainView;
}> {
  const org = assertWrite(ctx, deps);
  const { view: before, move } = await buildOwnerDomainView(ctx, {
    deps,
    records: false,
  });
  if (
    !move ||
    !["findings", "nameservers", "waiting", "switch_back"].includes(
      before.state,
    )
  ) {
    throw new OwnerDomainRefused("nothing_open", NOTHING_OPEN);
  }
  if (!checkLimiter.hit(org)) {
    throw new RateLimited("You can check again in 30 seconds.");
  }
  await appendAudit(ctx, {
    action: "domain.owner_check",
    organization: org,
    targetCollection: MOVES,
    targetId: move.id,
    meta: { step: move.currentStep },
  });
  if (before.state === "switch_back") {
    // Back at the old host: re-read, re-copy and re-check (the switch-back path). Still at
    // CDS: nothing to run; the owner keeps the switch-back steps.
    const ns = await (deps.resolver ?? getDnsResolver())
      .resolveNsIps(move.toHost)
      .catch(() => null);
    const cds = new Set(before.nameservers.map((x) => fqdn(x)));
    // CR-A02: switched back only when no CDS nameserver is left in the delegation (a mixed
    // set would sweep CDS's own copy).
    const stillAtCds =
      !ns || ns.names.length === 0 || ns.names.some((x) => cds.has(fqdn(x)));
    if (!stillAtCds) await retakeSnapshot(ctx, move.id, {}, deps);
  } else {
    await advanceMove(move.id, { ...deps, force: true });
  }
  const view = await ownerDomainView(ctx, undefined, deps);
  return {
    state: view.state,
    notYet:
      view.state === "waiting" ||
      view.state === "nameservers" ||
      view.state === "switch_back",
    view,
  };
}

/**
 * Send the nameserver steps to someone who manages the domain (S3 SendStepsDialog). Owner
 * only, 5 per org per day, logged-not-sent stand-in until SES; the audit row carries a count,
 * never the address (T-14-29-03).
 */
export async function ownerSendNameserverSteps(
  ctx: OrgContext,
  input: { to: string; note?: string },
  deps: MoveDeps = {},
): Promise<{ sent: true }> {
  const org = assertWrite(ctx, deps);
  const to = (typeof input?.to === "string" ? input.to : "")
    .trim()
    .toLowerCase();
  if (to.length > 254 || !isEmail(to)) {
    throw new OwnerDomainRefused("email_invalid", INVITE_INVALID);
  }
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (note.length > NOTE_MAX) {
    throw new OwnerDomainRefused(
      "note_too_long",
      `Keep the note under ${NOTE_MAX} characters.`,
    );
  }
  const { view, move } = await buildOwnerDomainView(ctx, {
    deps,
    records: false,
  });
  if (
    !move ||
    !["nameservers", "waiting", "lost"].includes(view.state) ||
    view.nameservers.length !== 2 ||
    !view.domain
  ) {
    throw new OwnerDomainRefused("nothing_open", NOTHING_OPEN);
  }
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - DAY_MS)
    .toISOString()
    .replace("T", " ");
  const sentToday = await withSuperuser(
    async (pb) =>
      (
        await pb.collection("audit_log").getList(1, 1, {
          filter: pb.filter(
            "organization = {:org} && action = 'domain.steps_sent' && created >= {:since}",
            { org, since },
          ),
        })
      ).totalItems,
  );
  if (sentToday >= OWNER_STEPS_SENDS_PER_DAY) {
    throw new RateLimited(
      "You've sent these steps 5 times today. Try again tomorrow.",
    );
  }
  const names = await withSuperuser(async (pb) => {
    const o = await pb
      .collection("organizations")
      .getOne(org, { fields: "id,name" });
    const u = await pb
      .collection("users")
      .getOne(ctx.actor, { fields: "id,name" })
      .catch(() => null);
    return { business: str(o.name), sender: str(u?.name).trim() };
  });
  const regId = view.registrar?.id ?? "other";
  await sendEmail(
    { kind: "org", ctx, orgId: org },
    "domain.nameserver_steps",
    to,
    {
      sender: (names.sender || names.business).split(/\s+/)[0] ?? "",
      business: names.business,
      domain: view.domain,
      registrar: registrarWord(view.registrar),
      nameservers: [view.nameservers[0] ?? "", view.nameservers[1] ?? ""],
      steps: registrarSteps("nameservers", regId),
      ...(note ? { note } : {}),
    },
    deps.transport ? { transport: deps.transport } : {},
  );
  await appendAudit(ctx, {
    action: "domain.steps_sent",
    organization: org,
    targetCollection: MOVES,
    targetId: move.id,
    meta: { count: 1 },
  });
  return { sent: true };
}

/**
 * "Use a different domain" (S1/S2): only before the nameserver step started. Cancels the
 * move (the CDS zone is deleted: nothing was delegated) and returns to S0.
 */
export async function ownerUseDifferentDomain(
  ctx: OrgContext,
  deps: MoveDeps = {},
): Promise<OwnerDomainView> {
  assertWrite(ctx, deps);
  const move = await openMoveOrRefuse(ctx);
  const ns = stepOf(move, "nameservers");
  const started =
    stepIdx(move.currentStep) >= stepIdx("nameservers") ||
    ns.status !== "waiting" ||
    ns.startedAt !== undefined;
  if (started) {
    throw new OwnerDomainRefused(
      "too_late",
      "Your nameserver step has started. Ask CDS Support to use a different domain.",
    );
  }
  await cancelMove(ctx, move.id, "owner chose a different domain", deps);
  return ownerDomainView(ctx, undefined, deps);
}

// ---------------------------------------------------------------------------------------
// Needs you (14-29 choice 6; UI-SPEC "Today and Needs you")
// ---------------------------------------------------------------------------------------

const HUB_DOMAIN = "/hub/settings?tab=domain";
const CONNECT_STAGES: ReadonlySet<string> = new Set([
  "being_built",
  "ready_for_review",
]);

/**
 * The owner's domain items for Needs you (Owner only through the provider's `domain:write`
 * grant). Keys `domain:<kind>`; all link to Settings › Domain.
 */
export async function domainNeedsYou(
  ctx: OrgContext,
  now: Date = new Date(),
  deps: MoveDeps = {},
): Promise<NeedsYouItem[]> {
  assertOrgContext(ctx);
  requirePermission(ctx, "domain", "write");
  const { view, move } = await buildOwnerDomainView(ctx, {
    now,
    deps,
    records: false,
  });
  const at = now.toISOString();
  const reg = registrarWord(view.registrar);
  const d = view.domain ?? "";
  const items: NeedsYouItem[] = [];
  const add = (
    kind: string,
    level: "urgent" | "normal",
    c: { title: string; sub: string; action: string },
    since: string = at,
  ) =>
    items.push({
      key: `domain:${kind}`,
      kind: `domain.${kind}`,
      level,
      title: c.title,
      sub: c.sub,
      actionLabel: c.action,
      href: HUB_DOMAIN,
      section: "settings",
      tab: "domain",
      at: since,
    });
  if (view.state === "none") {
    if (view.canAct && !move) {
      const facts = await orgFacts(scopedOrgId(ctx));
      if (CONNECT_STAGES.has(facts.stage) && !facts.demo) {
        add("connect", "normal", NEEDS_YOU.connect());
      }
    }
    return items;
  }
  const gateAt = move ? stepOf(move, "gate").startedAt : undefined;
  if (view.state === "findings") {
    if (view.findings.some((f) => f.kind === "dnssec")) {
      add("dnssec", "normal", NEEDS_YOU.dnssec({ registrar: reg }), gateAt);
    }
    if (view.findings.some((f) => f.ackKey)) {
      add("forwarding", "normal", NEEDS_YOU.forwarding(), gateAt);
    }
  }
  if (view.state === "nameservers" || view.state === "waiting") {
    const nsAt = move ? stepOf(move, "nameservers").startedAt : undefined;
    add(
      "nameservers",
      "normal",
      NEEDS_YOU.nameservers({ registrar: reg }),
      nsAt,
    );
  }
  if (view.state === "switch_back") {
    add("switch_back", "urgent", NEEDS_YOU.switchBack({ registrar: reg }));
  }
  if (view.state === "lost") {
    add("lost", "urgent", NEEDS_YOU.lostDelegation({ domain: d }));
  }
  if (view.expiry !== "ok" && view.expiresAt && d) {
    add(
      "renew",
      view.expiry === "7d" ? "urgent" : "normal",
      // Owner copy "Renew at <registrar>"; CDS never renews (DOM-04 identifier scan).
      NEEDS_YOU["renew"]({
        domain: d,
        registrar: reg,
        date: dayMonth(view.expiresAt),
      }),
    );
  }
  return items;
}
