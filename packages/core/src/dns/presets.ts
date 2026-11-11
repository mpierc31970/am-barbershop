// packages/core/src/dns/presets.ts (P14, DOM-03, DOM-04).
// Owner: 14-06 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// "Set up email for my domain" (D119, D-UI-P14-26): six provider presets as data, a pure
// merge into the ONE apex SPF record (RESEARCH Pitfall 8) and `presetRecords`, which turns
// a preset + the owner's pasted values into add / replace / remove lists. Replacing MX of
// another provider sets `replacesProvider` so the UI asks "Replace my current email"
// (14-06 choice 3). `_dmarc` is never touched. Pure and Edge-safe.
//
// Preset values are the providers' published setup values as of 2026-10 (14-06 choice 1;
// HUMAN-CHECK in 14-49 re-verifies them against each provider's current docs).

import { CdsError, InvalidInput } from "../errors";
import {
  detectMailProvider,
  mailProvider,
  type MailProviderId,
} from "./providers";
import {
  canonicalValue,
  fqdn,
  recordKey,
  unquoteTxt,
  type DnsRecord,
} from "./record";

export type EmailPresetId =
  "google" | "microsoft" | "zoho" | "hostinger" | "proton" | "fastmail";

/** UI order of the provider picker (UI-SPEC Email setup step 1). */
export const EMAIL_PRESET_IDS: readonly EmailPresetId[] = Object.freeze([
  "google",
  "microsoft",
  "zoho",
  "hostinger",
  "proton",
  "fastmail",
]);

export type EmailPresetFieldKey = "verification" | "dkim";

export type EmailPresetField = {
  key: EmailPresetFieldKey;
  label: string;
  help: string;
  pattern: RegExp;
  example: string;
};

/**
 * How the DKIM records are built:
 * - `txt`: one TXT at `dkimName` from the owner's DKIM value;
 * - `microsoft`: `selector1`/`selector2` CNAMEs, the owner pastes both targets;
 * - `proton`: three CNAMEs derived from the first target the owner pastes;
 * - `fastmail`: three CNAMEs derived from the domain, no input.
 */
export type EmailPresetDkim = "txt" | "microsoft" | "proton" | "fastmail";

export type EmailPreset = {
  name: string;
  /** The 14-05 mail provider the preset's MX belong to (`hostinger` -> `titan`). */
  provider: MailProviderId;
  fields: EmailPresetField[];
  /** `{domain-dashes}` = the domain with dots as dashes (Microsoft). */
  mx: { priority: number; host: string }[];
  spfInclude: string;
  /** TXT DKIM name (relative), or null when DKIM is CNAMEs or none. */
  dkimName: string | null;
  dkim: EmailPresetDkim;
  /** Start of a valid verification value (EMAIL-VALUE-FORMAT `prefix`), or null. */
  verificationPrefix: string | null;
  /** Where the owner finishes (EMAIL-DONE-B `console`). */
  console: string;
  /** Extra CNAMEs (relative name -> target) the provider needs. */
  extraCnames: { name: string; target: string }[];
};

/** A DKIM TXT value: `v=DKIM1;` tags, then a base64 `p=` key. */
const DKIM_TXT =
  /^v=DKIM1;(?:\s*[a-z]+=[^;]*;)*\s*p=[A-Za-z0-9+/]{40,}={0,2}\s*;?$/i;
const DKIM_EXAMPLE = `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx7Qm2R1fK9pL0sYtW3vB`;

const dkimField = (help: string): EmailPresetField => ({
  key: "dkim",
  label: "DKIM value",
  help,
  pattern: DKIM_TXT,
  example: DKIM_EXAMPLE,
});

const verificationField = (
  help: string,
  pattern: RegExp,
  example: string,
): EmailPresetField => ({
  key: "verification",
  label: "Verification value",
  help,
  pattern,
  example,
});

const preset = (p: EmailPreset): EmailPreset =>
  Object.freeze({
    ...p,
    fields: Object.freeze(
      p.fields.map((f) => Object.freeze({ ...f })),
    ) as EmailPreset["fields"],
    mx: Object.freeze(
      p.mx.map((m) => Object.freeze({ ...m })),
    ) as EmailPreset["mx"],
    extraCnames: Object.freeze(
      p.extraCnames.map((c) => Object.freeze({ ...c })),
    ) as EmailPreset["extraCnames"],
  });

export const EMAIL_PRESETS: Readonly<Record<EmailPresetId, EmailPreset>> =
  Object.freeze({
    google: preset({
      name: "Google Workspace",
      provider: "google",
      fields: [
        verificationField(
          "In Google Admin, open Domains › Verify. Copy the line starting google-site-verification=.",
          /^google-site-verification=[A-Za-z0-9_-]{10,}$/,
          "google-site-verification=rXOxyZounnZasA8Z7oaD3c14JdjS9aKSWvsR1EbUSIQ",
        ),
        dkimField(
          "In Google Admin, open Apps › Gmail › Authenticate email, then Generate new record. Copy the long value starting v=DKIM1.",
        ),
      ],
      mx: [{ priority: 1, host: "smtp.google.com" }],
      spfInclude: "_spf.google.com",
      dkimName: "google._domainkey",
      dkim: "txt",
      verificationPrefix: "google-site-verification=",
      console: "Google Admin",
      extraCnames: [],
    }),
    microsoft: preset({
      name: "Microsoft 365",
      provider: "microsoft",
      fields: [
        verificationField(
          "In the Microsoft 365 admin center, open Settings › Domains › Add domain. Copy the TXT value starting MS=.",
          /^MS=ms\d{6,10}$/,
          "MS=ms12345678",
        ),
        {
          key: "dkim",
          label: "DKIM values",
          help: "In Microsoft Defender, open Email authentication settings › DKIM and choose your domain. Copy both CNAME values (selector1 and selector2), one per line.",
          pattern:
            /^selector1-[a-z0-9-]+\._domainkey\.[a-z0-9.-]+\s+selector2-[a-z0-9-]+\._domainkey\.[a-z0-9.-]+$/i,
          example:
            "selector1-riverabakery-com._domainkey.rivera.onmicrosoft.com\nselector2-riverabakery-com._domainkey.rivera.onmicrosoft.com",
        },
      ],
      mx: [
        { priority: 0, host: "{domain-dashes}.mail.protection.outlook.com" },
      ],
      spfInclude: "spf.protection.outlook.com",
      dkimName: null,
      dkim: "microsoft",
      verificationPrefix: "MS=",
      console: "the Microsoft 365 admin center",
      extraCnames: [
        { name: "autodiscover", target: "autodiscover.outlook.com" },
      ],
    }),
    zoho: preset({
      name: "Zoho Mail",
      provider: "zoho",
      fields: [
        verificationField(
          "In Zoho Mail Admin, open Domains and choose your domain. Copy the TXT value starting zoho-verification=.",
          /^zoho-verification=zb[a-z0-9]+\.zmverify\.zoho\.[a-z.]+$/,
          "zoho-verification=zb12345678.zmverify.zoho.com",
        ),
        dkimField(
          "In Zoho Mail Admin, open Domains › Email configuration › DKIM, add selector zmail, then copy the value starting v=DKIM1.",
        ),
      ],
      mx: [
        { priority: 10, host: "mx.zoho.com" },
        { priority: 20, host: "mx2.zoho.com" },
        { priority: 50, host: "mx3.zoho.com" },
      ],
      spfInclude: "zoho.com",
      dkimName: "zmail._domainkey",
      dkim: "txt",
      verificationPrefix: "zoho-verification=",
      console: "Zoho Mail Admin",
      extraCnames: [],
    }),
    hostinger: preset({
      name: "Hostinger Email",
      provider: "titan",
      fields: [
        dkimField(
          "In hPanel, open Emails › your domain › DNS settings. Copy the DKIM value starting v=DKIM1.",
        ),
      ],
      mx: [
        { priority: 5, host: "mx1.hostinger.com" },
        { priority: 10, host: "mx2.hostinger.com" },
      ],
      spfInclude: "_spf.mail.hostinger.com",
      dkimName: "titan1._domainkey",
      dkim: "txt",
      verificationPrefix: null,
      console: "Hostinger hPanel",
      extraCnames: [],
    }),
    proton: preset({
      name: "Proton Mail",
      provider: "proton",
      fields: [
        verificationField(
          "In Proton Mail, open Settings › Domain names › your domain › Verify. Copy the value starting protonmail-verification=.",
          /^protonmail-verification=[A-Za-z0-9]{20,}$/,
          "protonmail-verification=3f5c0b8e2a9d4c1f7e6b5a4d3c2b1a0f9e8d7c6b",
        ),
        {
          key: "dkim",
          label: "DKIM value",
          help: "In Proton Mail, open the DKIM step for your domain. Copy the first CNAME value, starting protonmail.domainkey.",
          pattern: /^protonmail\.domainkey\.[a-z0-9]+\.domains\.proton\.ch$/i,
          example: "protonmail.domainkey.dabc123xyz.domains.proton.ch",
        },
      ],
      mx: [
        { priority: 10, host: "mail.protonmail.ch" },
        { priority: 20, host: "mailsec.protonmail.ch" },
      ],
      spfInclude: "_spf.protonmail.ch",
      dkimName: null,
      dkim: "proton",
      verificationPrefix: "protonmail-verification=",
      console: "Proton Mail settings",
      extraCnames: [],
    }),
    fastmail: preset({
      name: "Fastmail",
      provider: "fastmail",
      fields: [],
      mx: [
        { priority: 10, host: "in1-smtp.messagingengine.com" },
        { priority: 20, host: "in2-smtp.messagingengine.com" },
      ],
      spfInclude: "spf.messagingengine.com",
      dkimName: null,
      dkim: "fastmail",
      verificationPrefix: null,
      console: "Fastmail settings",
      extraCnames: [],
    }),
  });

/** Trim, unquote (`"a" "b"` pasted from a TXT box) and trim again. */
function cleanValue(raw: string): string {
  return unquoteTxt(raw.trim()).trim();
}

/** True when `value` is a valid pasted value for that preset field. */
export function checkPresetValue(
  id: EmailPresetId,
  key: EmailPresetFieldKey,
  value: string,
): boolean {
  const field = EMAIL_PRESETS[id].fields.find((f) => f.key === key);
  return !!field && field.pattern.test(cleanValue(value));
}

// ---- SPF ----

export type SpfMergeCode = "too_many_lookups" | "two_spf";

/** Most DNS-querying terms one SPF evaluation may need (RFC 7208 §4.6.4). */
export const SPF_MAX_LOOKUPS = 10;

const ALL = /^[+~?-]?all$/i;
const MODIFIER = /^[a-z][a-z0-9_.-]*=/i;
const LOOKUP_MECHS = new Set(["include", "a", "mx", "ptr", "exists"]);

function mechName(token: string): string {
  return (
    token
      .replace(/^[+~?-]/, "")
      .split(/[:/=]/)[0]
      ?.toLowerCase() ?? ""
  );
}

function includeTarget(token: string): string | null {
  const m = /^\+?include:(.+)$/i.exec(token);
  return m ? fqdn(m[1] as string) : null;
}

function isLookup(token: string): boolean {
  if (/^redirect=/i.test(token)) return true;
  return !MODIFIER.test(token) && LOOKUP_MECHS.has(mechName(token));
}

/**
 * Known total lookup cost of an `include:` / `redirect=` target, nested includes counted
 * (WR-B03; checked 2026-10). The function is pure, so it cannot resolve includes: anything
 * not listed is estimated at UNKNOWN_INCLUDE_COST.
 */
export const SPF_KNOWN_INCLUDE_COSTS: Readonly<Record<string, number>> =
  Object.freeze({
    "_spf.google.com": 4,
    "spf.protection.outlook.com": 2,
    "zoho.com": 2,
    "zoho.eu": 2,
    "_spf.mail.hostinger.com": 2,
    "spf.messagingengine.com": 1,
    "_spf.protonmail.ch": 1,
  });

/** Estimated cost of an include we do not know: the term itself plus one nested lookup. */
export const UNKNOWN_INCLUDE_COST = 2;

function targetOf(token: string): string | null {
  const m = /^(?:\+?include:|redirect=)(.+)$/i.exec(token);
  return m ? fqdn(m[1] as string) : null;
}

/** Estimated lookups one term costs at evaluation (RFC 7208 §4.6.4), nested includes included. */
function lookupCost(token: string): number {
  if (!isLookup(token)) return 0;
  const target = targetOf(token);
  if (target === null) return 1;
  return SPF_KNOWN_INCLUDE_COSTS[target] ?? UNKNOWN_INCLUDE_COST;
}

/**
 * Merge `include` into the one SPF value (14-06 choice 2): unquote; two `v=spf1` -> `two_spf`;
 * dedupe includes (case-insensitive) and repeated mechanisms; add `include:` if absent; keep
 * exactly one `all` (the first existing qualifier, default `~all`; none after a `redirect=`);
 * estimate the evaluation's DNS lookups (`a`, `mx`, `ptr`, `exists` cost 1; `include` and
 * `redirect` cost their known nested total, or UNKNOWN_INCLUDE_COST) and refuse an estimate
 * > 10 with `too_many_lookups` (WR-B03: an estimate, never an exact count). Order: `v=spf1`,
 * existing mechanisms, new include, `all`, modifiers.
 */
export function mergeSpf(
  current: string | null,
  include: string,
): { value: string } | { error: SpfMergeCode } {
  const inc = fqdn(include.trim().replace(/^include:/i, ""));
  const cur = current === null ? "" : cleanValue(current);
  if (!cur) return { value: `v=spf1 include:${inc} ~all` };
  if ((cur.match(/(^|\s)v=spf1(?=\s|$)/gi) ?? []).length > 1) {
    return { error: "two_spf" };
  }
  const tokens = cur.split(/\s+/).filter((t) => !/^v=spf1$/i.test(t));
  const mechs: string[] = [];
  const modifiers: string[] = [];
  const seen = new Set<string>();
  let all: string | null = null;
  for (const t of tokens) {
    if (ALL.test(t)) {
      all ??= t;
      continue;
    }
    if (MODIFIER.test(t)) {
      modifiers.push(t);
      continue;
    }
    const target = includeTarget(t);
    const key = target === null ? t.toLowerCase() : `include:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mechs.push(t);
  }
  if (!seen.has(`include:${inc}`)) mechs.push(`include:${inc}`);
  const hasRedirect = modifiers.some((m) => /^redirect=/i.test(m));
  if (all === null && !hasRedirect) all = "~all";
  const lookups = [...mechs, ...modifiers].reduce(
    (n, t) => n + lookupCost(t),
    0,
  );
  if (lookups > SPF_MAX_LOOKUPS) return { error: "too_many_lookups" };
  return {
    value: ["v=spf1", ...mechs, ...(all ? [all] : []), ...modifiers].join(" "),
  };
}

/** Thrown by `presetRecords` when the SPF cannot be merged safely (UI: REC-SPF / ask CDS). */
export class SpfMergeError extends CdsError {
  override readonly code: SpfMergeCode;
  constructor(code: SpfMergeCode) {
    super(`SPF merge refused: ${code}`);
    this.code = code;
  }
}

// ---- Preset records ----

export type PresetRecordsResult = {
  add: DnsRecord[];
  replace: DnsRecord[];
  remove: DnsRecord[];
  spf: { before: string | null; after: string };
  replacesProvider: string | null;
};

const PRESET_TTL = 3600;

const isSpf = (r: DnsRecord): boolean =>
  r.type === "TXT" && /^v=spf1(\s|$)/i.test(canonicalValue(r).trim());

/**
 * The records a preset writes into `domain`'s zone given its `current` records:
 * - `add`: new records (TTL 3600, canonical shape);
 * - `replace`: existing records the new ones supersede (MX of the old set, the old SPF, a
 *   same-type record at a DKIM/autodiscover name with another value);
 * - `remove`: existing records of another type at a name a new record needs;
 * - `replacesProvider`: set when existing MX belong to another provider (its name, or the
 *   first MX host when unknown) — the UI then requires "Replace my current email".
 * Values are validated against the preset fields (`InvalidInput` names the field only);
 * a refused SPF merge throws `SpfMergeError`. `_dmarc` is never in any list.
 */
export function presetRecords(
  id: EmailPresetId,
  domain: string,
  values: { verification?: string; dkim?: string },
  current: readonly DnsRecord[],
): PresetRecordsResult {
  const p = EMAIL_PRESETS[id];
  const d = fqdn(domain);
  const verification = values.verification?.trim()
    ? cleanValue(values.verification)
    : undefined;
  const dkim = values.dkim?.trim() ? cleanValue(values.dkim) : undefined;
  for (const [key, v] of [
    ["verification", verification],
    ["dkim", dkim],
  ] as const) {
    if (v !== undefined && !checkPresetValue(id, key, v)) {
      throw new InvalidInput(`Email preset value is not valid: ${key}`);
    }
  }

  const add: DnsRecord[] = [];
  const replace: DnsRecord[] = [];
  const remove: DnsRecord[] = [];
  const has = (r: DnsRecord): boolean => {
    const k = recordKey(r);
    return current.some((c) => recordKey(c) === k);
  };
  const rec = (r: Omit<DnsRecord, "ttl">): DnsRecord => ({
    ...r,
    ttl: PRESET_TTL,
  });

  // MX: the preset's set; any other apex MX is replaced.
  const wantMx = p.mx.map((m) =>
    rec({
      type: "MX",
      name: d,
      value: fqdn(m.host.replace("{domain-dashes}", d.replace(/\./g, "-"))),
      priority: m.priority,
    }),
  );
  const wantMxKeys = new Set(wantMx.map(recordKey));
  const apexMx = current.filter((r) => r.type === "MX" && fqdn(r.name) === d);
  const staleMx = apexMx.filter((r) => !wantMxKeys.has(recordKey(r)));
  let replacesProvider: string | null = null;
  if (staleMx.length > 0) {
    replace.push(...staleMx);
    const other = detectMailProvider(staleMx, d);
    if (other === null) replacesProvider = canonicalValue(staleMx[0]!);
    else if (other !== p.provider) replacesProvider = mailProvider(other).name;
  }
  add.push(...wantMx.filter((r) => !has(r)));

  // SPF: one apex record, merged.
  const apexSpf = current.filter((r) => fqdn(r.name) === d && isSpf(r));
  const before =
    apexSpf.length === 0
      ? null
      : apexSpf.map((r) => canonicalValue(r).trim()).join(" ");
  const merged = mergeSpf(before, p.spfInclude);
  if ("error" in merged) throw new SpfMergeError(merged.error);
  if (merged.value !== before) {
    replace.push(...apexSpf);
    add.push(rec({ type: "TXT", name: d, value: merged.value }));
  }

  // Verification: one more apex TXT (several are normal).
  if (verification !== undefined) {
    const v = rec({ type: "TXT", name: d, value: verification });
    if (!has(v)) add.push(v);
  }

  // Named records (autodiscover, DKIM): one record per name.
  const named: DnsRecord[] = p.extraCnames.map((c) =>
    rec({ type: "CNAME", name: fqdn(c.name, d), value: fqdn(c.target) }),
  );
  if (p.dkim === "txt" && p.dkimName && dkim !== undefined) {
    named.push(rec({ type: "TXT", name: fqdn(p.dkimName, d), value: dkim }));
  } else if (p.dkim === "microsoft" && dkim !== undefined) {
    const [t1, t2] = dkim.split(/\s+/);
    named.push(
      rec({
        type: "CNAME",
        name: fqdn("selector1._domainkey", d),
        value: fqdn(t1 as string),
      }),
      rec({
        type: "CNAME",
        name: fqdn("selector2._domainkey", d),
        value: fqdn(t2 as string),
      }),
    );
  } else if (p.dkim === "proton" && dkim !== undefined) {
    const first = fqdn(dkim);
    const rest = first.slice("protonmail.".length);
    for (const sel of ["protonmail", "protonmail2", "protonmail3"]) {
      named.push(
        rec({
          type: "CNAME",
          name: fqdn(`${sel}._domainkey`, d),
          value: `${sel}.${rest}`,
        }),
      );
    }
  } else if (p.dkim === "fastmail") {
    for (const sel of ["fm1", "fm2", "fm3"]) {
      named.push(
        rec({
          type: "CNAME",
          name: fqdn(`${sel}._domainkey`, d),
          value: `${sel}.${d}.dkim.fmhosted.com`,
        }),
      );
    }
  }
  for (const r of named) {
    if (has(r)) continue;
    const at = current.filter((c) => fqdn(c.name) === r.name);
    replace.push(...at.filter((c) => c.type === r.type));
    remove.push(...at.filter((c) => c.type !== r.type));
    add.push(r);
  }

  return {
    add,
    replace,
    remove,
    spf: { before, after: merged.value },
    replacesProvider,
  };
}
