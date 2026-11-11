// packages/core/src/dns/selectors.ts (P14, DOM-05).
// Owner: 14-05 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Authoritative-sweep name lists as frozen data (14-05 choice 3; 14-CONTEXT "Snapshot";
// RESEARCH Pattern 2). The caller (14-13) queries each name for each type against the old
// zone's nameservers and makes its own random-label wildcard probe. Pure and Edge-safe.

import { fqdn, type RType } from "./record";

/** DKIM selectors for the common providers. `titan1` is verified live (Hostinger/Titan). */
export const DKIM_SELECTORS: readonly string[] = Object.freeze([
  "google",
  "selector1",
  "selector2",
  "zmail",
  "titan1",
  "protonmail",
  "protonmail2",
  "protonmail3",
  "fm1",
  "fm2",
  "fm3",
  "sig1",
  "k1",
  "k2",
  "k3",
  "s1",
  "s2",
  "mg",
  "smtp",
  "mxvault",
  "hs1",
  "hs2",
  "default",
  "dkim",
  "mail",
  "amazonses",
]);

/** Common host labels (relative). Underscore names are TXT/CNAME only. */
export const COMMON_HOSTS: readonly string[] = Object.freeze([
  "www",
  "mail",
  "webmail",
  "smtp",
  "imap",
  "pop",
  "autodiscover",
  "autoconfig",
  "shop",
  "blog",
  "email",
  "links",
  "ftp",
  "cpanel",
  "lyncdiscover",
  "sip",
  "enterpriseregistration",
  "enterpriseenrollment",
  "mta-sts",
  "_mta-sts",
  "_smtp._tls",
  "default._bimi",
  "_dmarc",
]);

/** Mail SRV services (queried for SRV only). */
export const MAIL_SRV_NAMES: readonly string[] = Object.freeze([
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

export const APEX_TYPES: readonly RType[] = Object.freeze([
  "A",
  "AAAA",
  "MX",
  "TXT",
  "CAA",
  "NS",
]);
export const HOST_TYPES: readonly RType[] = Object.freeze([
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "MX",
]);
const UNDERSCORE_TYPES: readonly RType[] = Object.freeze(["TXT", "CNAME"]);
const DKIM_TYPES: readonly RType[] = Object.freeze(["TXT", "CNAME"]);
const SRV_TYPES: readonly RType[] = Object.freeze(["SRV"]);

export type SweepName = { name: string; types: RType[] };

/** Every name (FQDN) and the types to query: apex, common hosts, DKIM selectors, mail SRV. */
export function sweepNames(domain: string): SweepName[] {
  const d = fqdn(domain);
  const out: SweepName[] = [{ name: d, types: [...APEX_TYPES] }];
  const seen = new Set([d]);
  const add = (rel: string, types: readonly RType[]): void => {
    const name = `${rel}.${d}`;
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, types: [...types] });
  };
  for (const h of COMMON_HOSTS)
    add(
      h,
      h.startsWith("_") || h.includes("._") ? UNDERSCORE_TYPES : HOST_TYPES,
    );
  for (const s of DKIM_SELECTORS) add(`${s}._domainkey`, DKIM_TYPES);
  for (const s of MAIL_SRV_NAMES) add(s, SRV_TYPES);
  return out;
}
