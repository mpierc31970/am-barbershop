// packages/db/src/dns/check.ts (P14, DOM-05, DOM-04).
// Owner: 14-13 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The read-only domain check behind `npm run domains:check` (14-13 choice 4; UI-SPEC "Staff
// CLI output"). Public DNS and RDAP only, through getPublicDnsTools() (always the real
// resolver, P14-P32): the authoritative sweep plus a gate run with copy = snapshot, so G1
// trivially passes and G2-G6 report what a move would hit. Never touches PocketBase or the
// object store (T-14-13-04), never buys, renews or transfers anything (DOM-04).
import {
  canonicalValue,
  classifyRecord,
  detectMailProvider,
  EMAIL_PRESETS,
  fqdn,
  MAIL_HOST_PATTERNS,
  MAIL_PROVIDERS,
  MAX_GATE_RECORDS,
  registrarFromRdapName,
  zoneGate,
  type DnsRecord,
  type GateFinding,
  type MailProviderId,
} from "@cds/core/dns";
import { getPublicDnsTools } from "./factory";
import type { DnsResolver, RegistryLookup } from "./ports";
import { sweepZone } from "./snapshot";

export type CheckEmailParts = {
  mx: number;
  spf: number;
  dkim: number;
  dmarc: number;
  /** The mail provider's own verification TXTs (e.g. google-site-verification=). */
  verification: number;
  other: number;
};

export type CheckReport = {
  domain: string;
  /** RDAP knows the domain (false only on an RDAP 404). */
  found: boolean;
  registrar: string | null;
  expiresAt: string | null;
  dnssec: boolean | null;
  nameservers: string[];
  email: {
    count: number;
    provider: MailProviderId | null;
    providerName: string | null;
    parts: CheckEmailParts;
    dkimHidden: boolean;
  };
  counts: { verification: number; site: number; other: number };
  wildcard: boolean;
  recordCount: number;
  tooManyRecords: boolean;
  gate: GateFinding[];
  records: DnsRecord[];
};

export const CHECK_READ_ONLY_LINE = "Read-only: nothing was written.";

function verificationPrefix(provider: MailProviderId | null): string | null {
  if (!provider) return null;
  for (const p of Object.values(EMAIL_PRESETS)) {
    if (p.provider === provider && p.verificationPrefix) {
      return p.verificationPrefix;
    }
  }
  return null;
}

/** Sweep + RDAP + gate for one domain, read-only. Throws DnsSweepFailed when DNS is unreadable. */
export async function checkDomainPublic(
  domain: string,
  deps: {
    resolver?: DnsResolver;
    registry?: RegistryLookup;
    now?: Date;
  } = {},
): Promise<CheckReport> {
  const tools =
    deps.resolver && deps.registry
      ? { resolver: deps.resolver, registry: deps.registry }
      : getPublicDnsTools();
  const resolver = deps.resolver ?? tools.resolver;
  const registry = deps.registry ?? tools.registry;
  const now = deps.now ?? new Date();
  const d = fqdn(domain);

  const sweep = await sweepZone(d, { resolver });
  const info = await registry.lookup(d);
  const records = sweep.records;

  const provider = detectMailProvider(records, d);
  const prefix = verificationPrefix(provider);
  const parts: CheckEmailParts = {
    mx: 0,
    spf: 0,
    dkim: 0,
    dmarc: 0,
    verification: 0,
    other: 0,
  };
  const counts = { verification: 0, site: 0, other: 0 };
  for (const r of records) {
    const cls = classifyRecord(r, d, { mailHosts: MAIL_HOST_PATTERNS });
    const name = fqdn(r.name);
    const value = canonicalValue(r);
    if (cls === "email") {
      if (r.type === "MX") parts.mx++;
      else if (r.type === "TXT" && /^v=spf1(\s|$)/i.test(value)) parts.spf++;
      else if (name.includes("._domainkey.")) parts.dkim++;
      else if (name === `_dmarc.${d}`) parts.dmarc++;
      else parts.other++;
    } else if (
      cls === "verification" &&
      prefix !== null &&
      name === d &&
      value.startsWith(prefix)
    ) {
      parts.verification++;
    } else if (cls === "verification") counts.verification++;
    else if (cls === "site") counts.site++;
    else counts.other++;
  }

  const gate = zoneGate({
    domain: d,
    snapshot: records,
    copy: records,
    takenAt: now,
    now,
    dnssec: info.dnssec,
    zoneFileUploaded: false,
    acks: new Set<string>(),
    overrides: new Set(),
    registrar: registrarFromRdapName(info.registrar),
  });

  return {
    domain: d,
    found: info.found,
    registrar: info.registrar,
    expiresAt: info.expiresAt,
    dnssec: info.dnssec,
    nameservers: sweep.nameservers,
    email: {
      count: Object.values(parts).reduce((a, b) => a + b, 0),
      provider,
      providerName: provider
        ? (MAIL_PROVIDERS.find((p) => p.id === provider)?.name ?? null)
        : null,
      parts,
      dkimHidden: sweep.dkimHidden,
    },
    counts,
    wildcard: sweep.wildcard,
    recordCount: records.length,
    tooManyRecords: gate.tooManyRecords,
    gate: gate.findings,
    records,
  };
}

function part(n: number, label: string, numberedAlways: boolean): string {
  if (n === 0) return "";
  return n === 1 && !numberedAlways ? label : `${n} ${label}`;
}

function gateWord(f: GateFinding): string {
  const d = f.detail;
  switch (d.rule) {
    case "G2":
      return f.pass ? "G2 pass" : `G2 missing ${d.missingExpected.join(", ")}`;
    case "G3":
      return d.dnssec === false
        ? "G3 pass"
        : `G3 DNSSEC ${d.dnssec ? "on" : "unknown"} (hard block)`;
    case "G4":
      if (!d.caaPresent) return "G4 none";
      return d.addRecord ? "G4 adds letsencrypt.org" : "G4 pass";
    case "G5":
      return d.services.length === 0
        ? "G5 none"
        : `G5 ${d.services.map((s) => s.kind.replace("_", " ")).join(", ")}`;
    case "G6":
      return `G6 ${f.pass ? "pass" : "fail"} (${d.spfCount === 0 ? "no" : d.spfCount} SPF)`;
    default:
      return "";
  }
}

const pad = (label: string): string => label.padEnd(12, " ");

/** The five UI-SPEC lines (14-UI-SPEC "Staff CLI output", `domains:check`). */
export function formatCheckReport(r: CheckReport): string[] {
  const head = r.found
    ? [
        r.domain,
        `registrar ${r.registrar ?? "unknown"}`,
        `expires ${r.expiresAt ? r.expiresAt.slice(0, 10) : "unknown"}`,
        `DNSSEC ${r.dnssec === null ? "unknown" : r.dnssec ? "on" : "off"}`,
      ].join(" · ")
    : `${r.domain} · not registered`;

  const p = r.email.parts;
  const detail = [
    part(p.mx, "MX", false),
    part(p.spf, "SPF", false),
    part(p.dkim, "DKIM", false),
    part(p.dmarc, "DMARC", false),
    part(p.verification, "verification", true),
    part(p.other, "other", true),
  ].filter((s) => s !== "");
  let email =
    r.email.count === 0
      ? `${pad("Email")} none`
      : `${pad("Email")} ${r.email.count} record${r.email.count === 1 ? "" : "s"} · provider ${r.email.providerName ?? "unknown"} (${detail.join(", ")})`;
  if (r.email.dkimHidden) email += " · DKIM hidden: ask for the zone file";

  const kinds = [
    `${pad("Verification")} ${r.counts.verification}`,
    `Site ${r.counts.site}`,
    `Other ${r.counts.other}`,
    `wildcard ${r.wildcard ? "yes" : "no"}`,
  ].join(" · ");

  let gate = `${pad("Gate")} ${r.gate
    .filter((f) => f.rule !== "G1" && f.rule !== "G7")
    .map(gateWord)
    .join(" · ")}`;
  if (r.tooManyRecords) {
    gate += ` · too many records (${r.recordCount} > ${MAX_GATE_RECORDS})`;
  }

  return [head, email, kinds, gate, CHECK_READ_ONLY_LINE];
}
