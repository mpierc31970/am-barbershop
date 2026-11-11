// packages/core/src/dns/gate.ts (P14, DOM-05).
// Owner: 14-05 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The zone gate (14-CONTEXT "The gate"): "Change your nameservers" stays locked until every
// rule passes. "This gate is enforced by the tooling, not by memory" (DOM-05): every step
// that depends on the copy calls zoneGate again. Hard blocks with no override (D58, D288):
// G1 on any email-class record, G3 (DNSSEC on or unknown, P14-P37), G6 (more than one apex
// SPF). Every other failing rule may be overridden by a super_admin (the caller audits it).
// Pure and Edge-safe.

import { classifyRecord } from "./classify";
import {
  detectMailProvider,
  expectedMissing,
  MAIL_HOST_PATTERNS,
  type MailProviderId,
} from "./providers";
import { canonicalValue, fqdn, recordKey, type DnsRecord } from "./record";
import {
  registrarOnlyServices,
  registrarRecordsNotCopied,
  registrarServiceAckKey,
  type RegistrarId,
  type RegistrarServiceKind,
} from "./registrar";

export type GateRule = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";

export const GATE_RULES: readonly GateRule[] = Object.freeze([
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
]);

/** Rules that can block with no override (G1 only for email-class records). */
export const HARD_BLOCKS: readonly GateRule[] = Object.freeze([
  "G1",
  "G3",
  "G6",
]);

/** Cloudflare free plan caps a zone at 200 records; the gate refuses above 190 (Pitfall 14). */
export const MAX_GATE_RECORDS = 190;

/** G7: the snapshot must be at most this old when the gate runs. */
export const GATE_MAX_AGE_HOURS = 24;

export type GateG5Service = {
  kind: RegistrarServiceKind;
  registrar: RegistrarId;
  records: DnsRecord[];
  acknowledged: boolean;
};

export type GateDetail =
  | {
      rule: "G1";
      missing: DnsRecord[];
      mismatched: { original: DnsRecord; copy: DnsRecord | null }[];
      /** Email-class records among missing + mismatched (> 0 = hard block). */
      emailMissing: number;
    }
  | { rule: "G2"; provider: MailProviderId | null; missingExpected: string[] }
  | { rule: "G3"; dnssec: boolean | null }
  | { rule: "G4"; caaPresent: boolean; addRecord: DnsRecord | null }
  | { rule: "G5"; services: GateG5Service[] }
  | { rule: "G6"; spfCount: number; values: string[] }
  | { rule: "G7"; ageHours: number };

export type GateFinding = {
  rule: GateRule;
  /** The rule is satisfied (by the zone, an upload, acks or a staff override). */
  pass: boolean;
  /** Failing as a hard block: no override can clear it. */
  hardBlock: boolean;
  /** Failing and a super_admin override would clear it. */
  overridable: boolean;
  /** Passing only because of a staff override. */
  overridden: boolean;
  detail: GateDetail;
};

export type ZoneGateInput = {
  domain: string;
  /** The old zone as snapshotted (sources merged). */
  snapshot: DnsRecord[];
  /** The new zone, read back from the CDS nameservers. */
  copy: DnsRecord[];
  takenAt: Date;
  now: Date;
  /** RDAP/DoH answer: true on, false off, null unknown. */
  dnssec: boolean | null;
  zoneFileUploaded: boolean;
  /** Owner acknowledgements (`G5:<kind>`). */
  acks: ReadonlySet<string>;
  /** Staff overrides; ignored for hard blocks. */
  overrides: ReadonlySet<GateRule>;
  /** Registrar (from RDAP) for registrar-conditional G5 patterns. */
  registrar?: RegistrarId;
};

export type ZoneGateResult = {
  findings: GateFinding[];
  passed: boolean;
  hardBlocked: boolean;
  tooManyRecords: boolean;
};

const CAA_LE: string = "letsencrypt.org";

/** Records the copy must hold: everything except SOA and the apex NS set. */
function copyable(rs: readonly DnsRecord[], domain: string): DnsRecord[] {
  return rs.filter(
    (r) => r.type !== "SOA" && !(r.type === "NS" && fqdn(r.name) === domain),
  );
}

const typeName = (r: DnsRecord): string => `${r.type}\u0000${fqdn(r.name)}`;

function g1(
  domain: string,
  wanted: DnsRecord[],
  copy: readonly DnsRecord[],
): Extract<GateDetail, { rule: "G1" }> {
  const copyKeys = new Map<string, DnsRecord>();
  for (const r of copy) copyKeys.set(recordKey(r), r);
  const matched = new Set<string>();
  const unmatched: DnsRecord[] = [];
  for (const r of wanted) {
    const k = recordKey(r);
    if (copyKeys.has(k)) matched.add(k);
    else unmatched.push(r);
  }
  // Copy records not matched by any snapshot record, by type+name, for mismatch pairing.
  const spare = new Map<string, DnsRecord[]>();
  for (const [k, r] of copyKeys) {
    if (matched.has(k)) continue;
    const tn = typeName(r);
    spare.set(tn, [...(spare.get(tn) ?? []), r]);
  }
  const missing: DnsRecord[] = [];
  const mismatched: { original: DnsRecord; copy: DnsRecord | null }[] = [];
  for (const r of unmatched) {
    const pool = spare.get(typeName(r));
    const other = pool?.shift();
    if (other) mismatched.push({ original: r, copy: other });
    else missing.push(r);
  }
  const emailMissing = [
    ...missing,
    ...mismatched.map((m) => m.original),
  ].filter(
    (r) =>
      classifyRecord(r, domain, { mailHosts: MAIL_HOST_PATTERNS }) === "email",
  ).length;
  return { rule: "G1", missing, mismatched, emailMissing };
}

type CaaParts = { tag: string; value: string };

function caaParts(r: DnsRecord): CaaParts | null {
  const m = /^\d+\s+(\S+)\s+"([\s\S]*)"$/.exec(canonicalValue(r));
  return m ? { tag: m[1] as string, value: m[2] as string } : null;
}

function caaAllowsLe(rs: readonly DnsRecord[]): boolean {
  return rs.some((r) => {
    const p = caaParts(r);
    return (
      p?.tag === "issue" &&
      (p.value.split(";")[0] as string).trim().toLowerCase() === CAA_LE
    );
  });
}

/**
 * Run G1-G7 over a snapshot and its copy. `passed` = every rule passes (overrides applied
 * to overridable failures only) and the snapshot is within MAX_GATE_RECORDS.
 */
export function zoneGate(input: ZoneGateInput): ZoneGateResult {
  const domain = fqdn(input.domain);
  const snapshot = copyable(input.snapshot, domain);
  const tooManyRecords = snapshot.length > MAX_GATE_RECORDS;

  // G5 first: web forwarding and parking are acknowledged, never copied, so they leave G1.
  // Email forwarding is acknowledged too, but its MX are always copied and stay in G1 so the
  // email hard block still holds (CR-B01).
  const registrar = input.registrar ?? "other";
  const services = registrarOnlyServices(snapshot, registrar);
  const g5Keys = registrarRecordsNotCopied(snapshot, registrar);
  const g5Services: GateG5Service[] = services.map((s) => ({
    ...s,
    acknowledged: input.acks.has(registrarServiceAckKey(s.kind)),
  }));

  const findings: GateFinding[] = [];
  const push = (
    rule: GateRule,
    rawPass: boolean,
    hard: boolean,
    detail: GateDetail,
  ): void => {
    const hardBlock = !rawPass && hard;
    const overridden = !rawPass && !hardBlock && input.overrides.has(rule);
    findings.push({
      rule,
      pass: rawPass || overridden,
      hardBlock,
      overridable: !rawPass && !hardBlock && !overridden,
      overridden,
      detail,
    });
  };

  // G1 exact copy.
  const d1 = g1(
    domain,
    snapshot.filter((r) => !g5Keys.has(recordKey(r))),
    input.copy,
  );
  push(
    "G1",
    d1.missing.length === 0 && d1.mismatched.length === 0,
    d1.emailMissing > 0,
    d1,
  );

  // G2 mail provider complete.
  const provider = detectMailProvider(snapshot, domain);
  const missingExpected = provider
    ? expectedMissing(provider, [...snapshot, ...input.copy], domain)
    : [];
  push(
    "G2",
    provider === null || missingExpected.length === 0 || input.zoneFileUploaded,
    false,
    { rule: "G2", provider, missingExpected },
  );

  // G3 DNSSEC off (on or unknown: hard block, P14-P37).
  push("G3", input.dnssec === false, true, {
    rule: "G3",
    dnssec: input.dnssec,
  });

  // G4 CAA allows Let's Encrypt.
  const apexCaa = snapshot.filter(
    (r) => r.type === "CAA" && fqdn(r.name) === domain,
  );
  const restricts = apexCaa.some((r) => caaParts(r)?.tag === "issue");
  const addRecord: DnsRecord | null =
    restricts && !caaAllowsLe(apexCaa)
      ? { type: "CAA", name: domain, value: `0 issue "${CAA_LE}"` }
      : null;
  const copyCaa = input.copy.filter(
    (r) => r.type === "CAA" && fqdn(r.name) === domain,
  );
  push("G4", addRecord === null || caaAllowsLe(copyCaa), false, {
    rule: "G4",
    caaPresent: apexCaa.length > 0,
    addRecord,
  });

  // G5 registrar-only services acknowledged.
  push(
    "G5",
    g5Services.every((s) => s.acknowledged),
    false,
    { rule: "G5", services: g5Services },
  );

  // G6 one apex SPF.
  const spf = snapshot
    .filter((r) => r.type === "TXT" && fqdn(r.name) === domain)
    .map((r) => canonicalValue(r))
    .filter((v) => /^v=spf1(\s|$)/i.test(v));
  push("G6", spf.length <= 1, true, {
    rule: "G6",
    spfCount: spf.length,
    values: spf,
  });

  // G7 fresh.
  const ageMs = input.now.getTime() - input.takenAt.getTime();
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;
  push("G7", ageMs <= GATE_MAX_AGE_HOURS * 3_600_000, false, {
    rule: "G7",
    ageHours,
  });

  return {
    findings,
    passed: !tooManyRecords && findings.every((f) => f.pass),
    hardBlocked: findings.some((f) => f.hardBlock),
    tooManyRecords,
  };
}
