// packages/core/src/dns/classify.ts (P14, DOM-05).
// Owner: 14-04 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Record classes (14-CONTEXT "Record classes"). Every record lands in exactly one class.
// Order (P14-P39): cds first, so CDS's own records (SES DKIM CNAMEs, `send.` MX/TXT, a
// CDS-added `_dmarc`, CAA, site A/www after cutover) never enter the tenant's email set or
// its hash; then email, site, verification, other. Pure and Edge-safe.

import { canonicalValue, fqdn, recordKey, type DnsRecord } from "./record";

export type RecordClass = "email" | "verification" | "site" | "cds" | "other";

/**
 * Minimal built-in mail-host patterns for mail-ish CNAMEs (`mail`, `webmail`, `email`).
 * `*.x.y` matches `x.y` and any name under it; a trailing `.*` matches any suffix
 * (`*.zoho.*` -> `mx.zoho.com`, `mail.zoho.eu`). The fuller list belongs to 14-05; callers
 * may pass it as `ctx.mailHosts`.
 */
export const BUILTIN_MAIL_HOST_PATTERNS: readonly string[] = Object.freeze([
  "*.outlook.com",
  "*.office365.com",
  "*.google.com",
  "*.zoho.*",
  "*.titan.email",
  "*.hostinger.com",
  "*.protonmail.ch",
  "*.messagingengine.com",
]);

/** Mail SRV services (first two labels of the name). */
const MAIL_SRV = new Set([
  "_autodiscover._tcp",
  "_submission._tcp",
  "_submissions._tcp",
  "_imap._tcp",
  "_imaps._tcp",
  "_pop3._tcp",
  "_pop3s._tcp",
  "_sip._tls",
  "_sipfederationtls._tcp",
]);

/** CNAME names that only ever serve mail/Microsoft 365 clients: email regardless of target. */
const MAIL_ONLY_CNAMES = new Set([
  "autodiscover",
  "autoconfig",
  "lyncdiscover",
  "sip",
  "enterpriseregistration",
  "enterpriseenrollment",
]);

/** CNAME names that are email only when the target is a known mail host. */
const MAIL_MAYBE_CNAMES = new Set(["mail", "webmail", "email"]);

export function mailHostMatches(target: string, pattern: string): boolean {
  const t = fqdn(target);
  let p = fqdn(pattern);
  let anySuffix = false;
  if (p.endsWith(".*")) {
    anySuffix = true;
    p = p.slice(0, -2);
  }
  const wildcardHead = p.startsWith("*.");
  if (wildcardHead) p = p.slice(2);
  const esc = p
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[a-z0-9-]+");
  const head = wildcardHead ? "(?:[a-z0-9-]+\\.)*" : "";
  const tail = anySuffix ? "(?:\\.[a-z0-9-]+)+" : "";
  return new RegExp(`^${head}${esc}${tail}$`).test(t);
}

export type ClassifyContext = {
  /** `recordKey`s of records CDS manages in this zone (`dns_zones.cds_keys.cds`). */
  cdsKeys?: ReadonlySet<string>;
  /** Mail-host patterns; defaults to BUILTIN_MAIL_HOST_PATTERNS. */
  mailHosts?: readonly string[];
};

export function classifyRecord(
  r: DnsRecord,
  domain: string,
  ctx: ClassifyContext = {},
): RecordClass {
  if (ctx.cdsKeys?.has(recordKey(r))) return "cds";

  const d = fqdn(domain);
  const name = fqdn(r.name);
  const apex = name === d;
  const rel = apex
    ? ""
    : name.endsWith(`.${d}`)
      ? name.slice(0, -(d.length + 1))
      : name;
  const labels = rel === "" ? [] : rel.split(".");
  const first = labels[0] ?? "";

  // email
  if (r.type === "MX") return "email";
  if (r.type === "TXT" && apex && /^v=spf1(\s|$)/i.test(canonicalValue(r)))
    return "email";
  if (labels.includes("_domainkey")) return "email";
  if (first === "_dmarc" || first === "_mta-sts" || first === "mta-sts")
    return "email";
  if (labels[0] === "_smtp" && labels[1] === "_tls") return "email";
  if (labels.includes("_bimi")) return "email";
  if (
    r.type === "SRV" &&
    labels.length >= 2 &&
    MAIL_SRV.has(`${labels[0]}.${labels[1]}`)
  ) {
    return "email";
  }
  if (r.type === "CNAME" && labels.length === 1) {
    if (MAIL_ONLY_CNAMES.has(first)) return "email";
    if (MAIL_MAYBE_CNAMES.has(first)) {
      const target = canonicalValue(r);
      const patterns = ctx.mailHosts ?? BUILTIN_MAIL_HOST_PATTERNS;
      if (patterns.some((p) => mailHostMatches(target, p))) return "email";
    }
  }

  // site
  if (
    (apex || rel === "www") &&
    (r.type === "A" || r.type === "AAAA" || r.type === "CNAME")
  ) {
    return "site";
  }

  if (r.type === "TXT") return "verification";
  return "other";
}
