// packages/core/src/dns/providers.ts (P14, DOM-05).
// Owner: 14-05 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Mail providers as frozen data (14-05 choice 2). The gate's G2 rule detects the provider
// from MX (then the apex SPF includes) and requires its expected DKIM/autodiscover names.
// Patterns use `mailHostMatches` syntax: `*.x.y` = x.y or any name under it, `mx*` = `mx`
// plus at least one character, a trailing `.*` = any suffix. Pure and Edge-safe.

import { BUILTIN_MAIL_HOST_PATTERNS, mailHostMatches } from "./classify";
import { canonicalValue, fqdn, type DnsRecord } from "./record";

export type MailProviderId =
  "google" | "microsoft" | "zoho" | "titan" | "proton" | "fastmail" | "icloud";

export type MailProvider = {
  readonly id: MailProviderId;
  /** Display name for owner copy (FIND-G2-T "{Google Workspace}"). */
  readonly name: string;
  readonly mxPatterns: readonly string[];
  readonly spfIncludes: readonly string[];
  /**
   * Expected names relative to the domain. Each inner list is one requirement met by any
   * of its alternatives; `*._domainkey` means "any DKIM selector". The first alternative
   * is the one reported as missing.
   */
  readonly expected: readonly (readonly string[])[];
};

const p = (x: MailProvider): MailProvider =>
  Object.freeze({
    ...x,
    mxPatterns: Object.freeze([...x.mxPatterns]),
    spfIncludes: Object.freeze([...x.spfIncludes]),
    expected: Object.freeze(x.expected.map((e) => Object.freeze([...e]))),
  });

export const MAIL_PROVIDERS: readonly MailProvider[] = Object.freeze([
  p({
    id: "google",
    name: "Google Workspace",
    mxPatterns: ["*.google.com", "*.googlemail.com"],
    spfIncludes: ["_spf.google.com"],
    expected: [["google._domainkey"]],
  }),
  p({
    id: "microsoft",
    name: "Microsoft 365",
    mxPatterns: ["*.mail.protection.outlook.com"],
    spfIncludes: ["spf.protection.outlook.com"],
    expected: [
      ["selector1._domainkey"],
      ["selector2._domainkey"],
      ["autodiscover"],
    ],
  }),
  p({
    id: "zoho",
    name: "Zoho Mail",
    mxPatterns: ["*.zoho.*"],
    spfIncludes: ["zoho.*", "*.zoho.*"],
    expected: [["zmail._domainkey", "*._domainkey"]],
  }),
  p({
    id: "titan",
    name: "Hostinger Email",
    mxPatterns: ["*.titan.email", "mx*.hostinger.com"],
    spfIncludes: ["*.titan.email", "*.mail.hostinger.com"],
    expected: [["titan1._domainkey"]],
  }),
  p({
    id: "proton",
    name: "Proton Mail",
    mxPatterns: ["*.protonmail.ch"],
    spfIncludes: ["*.protonmail.ch"],
    expected: [
      [
        "protonmail._domainkey",
        "protonmail2._domainkey",
        "protonmail3._domainkey",
      ],
    ],
  }),
  p({
    id: "fastmail",
    name: "Fastmail",
    mxPatterns: ["*.messagingengine.com"],
    spfIncludes: ["*.messagingengine.com"],
    expected: [["fm1._domainkey"], ["fm2._domainkey"], ["fm3._domainkey"]],
  }),
  p({
    id: "icloud",
    name: "iCloud Mail",
    mxPatterns: ["*.mail.icloud.com"],
    spfIncludes: ["icloud.com"],
    expected: [["sig1._domainkey"]],
  }),
]);

/** Fuller mail-host list for `classifyRecord(…, { mailHosts })` (14-04 note). */
export const MAIL_HOST_PATTERNS: readonly string[] = Object.freeze([
  ...new Set([
    ...BUILTIN_MAIL_HOST_PATTERNS,
    ...MAIL_PROVIDERS.flatMap((x) => x.mxPatterns),
  ]),
]);

export function mailProvider(id: MailProviderId): MailProvider {
  return MAIL_PROVIDERS.find((x) => x.id === id) as MailProvider;
}

function spfIncludes(value: string): string[] {
  return value
    .split(/\s+/)
    .map((t) => /^[+~?-]?include:(.+)$/i.exec(t)?.[1])
    .filter((t): t is string => !!t)
    .map((t) => fqdn(t));
}

/**
 * The mail provider behind a zone: the first provider whose MX pattern matches any MX
 * target; otherwise the first whose include appears in an apex `v=spf1` TXT. With no
 * `domain`, any `v=spf1` TXT counts. `null` = none or unknown.
 */
export function detectMailProvider(
  records: readonly DnsRecord[],
  domain?: string,
): MailProviderId | null {
  const d = domain === undefined ? undefined : fqdn(domain);
  const mx = records
    .filter((r) => r.type === "MX" && (d === undefined || fqdn(r.name) === d))
    .map((r) => canonicalValue(r));
  for (const prov of MAIL_PROVIDERS) {
    if (mx.some((t) => prov.mxPatterns.some((pat) => mailHostMatches(t, pat))))
      return prov.id;
  }
  const includes = records
    .filter(
      (r) =>
        r.type === "TXT" &&
        (d === undefined || fqdn(r.name) === d) &&
        /^v=spf1(\s|$)/i.test(canonicalValue(r)),
    )
    .flatMap((r) => spfIncludes(canonicalValue(r)));
  for (const prov of MAIL_PROVIDERS) {
    if (
      includes.some((t) =>
        prov.spfIncludes.some((pat) => mailHostMatches(t, pat)),
      )
    )
      return prov.id;
  }
  return null;
}

/**
 * Expected names (relative) of `id` with no record of any type in `records`, in the
 * provider's order. Empty = complete.
 */
export function expectedMissing(
  id: MailProviderId,
  records: readonly DnsRecord[],
  domain: string,
): string[] {
  const d = fqdn(domain);
  const names = new Set(records.map((r) => fqdn(r.name)));
  const anyDkim = [...names].some((n) => n.endsWith(`._domainkey.${d}`));
  const has = (rel: string): boolean =>
    rel === "*._domainkey" ? anyDkim : names.has(`${rel}.${d}`);
  return mailProvider(id)
    .expected.filter((alts) => !alts.some(has))
    .map((alts) => alts[0] as string);
}
