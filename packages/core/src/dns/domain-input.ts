// packages/core/src/dns/domain-input.ts (P14, DOM-03, DOM-04).
// Owner: 14-06 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// What the owner may type (14-06 choices 4 and 5). `parseDomainInput` turns the Domain
// field (S0) into a registrable domain or a UI-SPEC error code; CDS never offers to buy,
// renew or transfer one (DOM-04, D56). `ownerRecordPolicy` is the only gate on owner
// record writes (D-UI-P14-19): verification TXT/CNAME on non-protected names, nothing
// that could take over the site, the certificates or email. Pure and Edge-safe.

import { isDomainName } from "../email/address";
import { isReservedHost, normalizeHost } from "../host";
import {
  fqdn,
  recordKey,
  unquoteTxt,
  type DnsRecord,
  type RType,
} from "./record";

/**
 * Two-level public suffixes accepted as `name.<suffix>` (P14-P22). Frozen on purpose: no
 * public-suffix-list dependency; any other three-label name is a subdomain.
 */
export const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = Object.freeze(
  new Set([
    "co.uk",
    "org.uk",
    "me.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "co.za",
    "com.br",
    "com.mx",
    "co.jp",
    "co.in",
  ]),
) as ReadonlySet<string>;

export type DomainInputCode = "invalid" | "subdomain" | "reserved";

export type DomainInputResult =
  { ok: true; domain: string } | { ok: false; code: DomainInputCode };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;

/**
 * Normalise a pasted domain: trim, lowercase, strip the scheme, path/query/fragment,
 * port, one leading `www.` and the trailing dot. Then: not a domain name -> `invalid`;
 * a CDS or platform host (or anything under one) -> `reserved`; more labels than the
 * registrable domain -> `subdomain`. Reserved is checked first so a CDS preview host is
 * never reported as "a part of your domain".
 */
export function parseDomainInput(
  raw: string,
  platformHosts: Set<string>,
): DomainInputResult {
  let s = raw.trim().toLowerCase().replace(SCHEME, "");
  const cut = s.search(/[/?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  let host = normalizeHost(s);
  if (!host) return { ok: false, code: "invalid" };
  if (host.startsWith("www.")) host = host.slice(4);
  if (host.length > 253 || !isDomainName(host)) {
    return { ok: false, code: "invalid" };
  }
  if (isReservedHost(host, platformHosts)) {
    return { ok: false, code: "reserved" };
  }
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(host)) return { ok: false, code: "invalid" };
  const registrable = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length > registrable) return { ok: false, code: "subdomain" };
  return { ok: true, domain: host };
}

export type OwnerRecordCode =
  "name_invalid" | "value_empty" | "exists" | "protected" | "spf" | "type";

export type OwnerRecordResult =
  { ok: true; record: DnsRecord } | { ok: false; code: OwnerRecordCode };

/** Owner-writable types (D-UI-P14-19). Everything else is CDS-only. */
export const OWNER_RECORD_TYPES: readonly RType[] = Object.freeze([
  "TXT",
  "CNAME",
]);

/** Names that are, or sit under, a site/email/certificate name CDS keeps safe. */
const PROTECTED_SUBTREES: readonly string[] = Object.freeze([
  "www",
  "send",
  "mta-sts",
  "autodiscover",
  "autoconfig",
]);

/** Labels that are protected wherever they appear in the name. */
const PROTECTED_LABELS: readonly string[] = Object.freeze([
  "*",
  "_domainkey",
  "_dmarc",
  "_mta-sts",
]);

const NAME_LABEL = /^[a-z0-9_-]{1,63}$/;
const TARGET_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * True when an owner may never write at `rel` (relative name, `@` = apex) with `type`.
 * Apex CNAME, `www`, `_acme-challenge*`, `*`, anything under `_domainkey`, `_dmarc`,
 * `_mta-sts`, `mta-sts`, `_smtp._tls`, `send`, `autodiscover`, `autoconfig`.
 */
export function isProtectedOwnerName(rel: string, type: string): boolean {
  if (rel === "@") return type.toUpperCase() === "CNAME";
  const labels = rel.split(".");
  if (labels.some((l) => PROTECTED_LABELS.includes(l))) return true;
  if (labels.some((l) => l.startsWith("_acme-challenge"))) return true;
  if (`.${rel}.`.includes("._smtp._tls.")) return true;
  return PROTECTED_SUBTREES.some((x) => rel === x || rel.endsWith(`.${x}`));
}

function isHostTarget(v: string): boolean {
  if (v.length < 1 || v.length > 253) return false;
  const labels = v.split(".");
  return labels.length >= 2 && labels.every((l) => TARGET_LABEL.test(l));
}

/**
 * The policy for one owner-added record. `name` is `@`, a relative name (`em123`), a full
 * name (`em123.<domain>`) or an absolute one with a trailing dot. TXT values are unquoted
 * (`unquoteTxt`), CNAME targets lowercased without the trailing dot. Checks run in this
 * order: type, name, protected, value, SPF, exists. `exists`: a TXT with the same name and
 * value, any record at a name that has a CNAME, or any record at a name a new CNAME wants
 * (several TXT at one name are normal: verification next to SPF at the apex).
 */
export function ownerRecordPolicy(
  input: { type: string; name: string; value: string },
  domain: string,
  existing: readonly DnsRecord[],
): OwnerRecordResult {
  const type = input.type.trim().toUpperCase();
  if (type !== "TXT" && type !== "CNAME") return { ok: false, code: "type" };

  const d = fqdn(domain);
  const rawName = input.name.trim().toLowerCase();
  if (!rawName) return { ok: false, code: "name_invalid" };
  let full: string;
  if (rawName === "@") {
    full = d;
  } else if (rawName.endsWith(".")) {
    full = fqdn(rawName);
    if (full !== d && !full.endsWith(`.${d}`)) {
      return { ok: false, code: "name_invalid" };
    }
  } else {
    full = fqdn(rawName, d);
  }
  const rel = full === d ? "@" : full.slice(0, -(d.length + 1));
  if (rel !== "@" && rel.split(".").includes("*")) {
    return { ok: false, code: "protected" };
  }
  if (
    rel !== "@" &&
    (full.length > 253 || !rel.split(".").every((l) => NAME_LABEL.test(l)))
  ) {
    return { ok: false, code: "name_invalid" };
  }
  if (isProtectedOwnerName(rel, type)) return { ok: false, code: "protected" };

  let record: DnsRecord;
  if (type === "TXT") {
    const value = unquoteTxt(input.value.trim());
    if (!value.trim()) return { ok: false, code: "value_empty" };
    if (/^v=spf1(\s|$)/i.test(value.trim())) return { ok: false, code: "spf" };
    record = { type: "TXT", name: full, value };
  } else {
    const value = fqdn(input.value);
    if (!isHostTarget(value)) return { ok: false, code: "value_empty" };
    record = { type: "CNAME", name: full, value };
  }

  const atName = existing.filter((r) => fqdn(r.name) === full);
  if (type === "CNAME" && atName.length > 0)
    return { ok: false, code: "exists" };
  if (atName.some((r) => r.type === "CNAME"))
    return { ok: false, code: "exists" };
  const key = recordKey(record);
  if (atName.some((r) => recordKey(r) === key)) {
    return { ok: false, code: "exists" };
  }
  return { ok: true, record };
}
