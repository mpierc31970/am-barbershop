// packages/core/src/dns/record.ts (P14, DOM-05).
// Owner: 14-04 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Record identity (RESEARCH Pattern 1, Pitfall 9; D58 exact recreation). Every P14
// comparison (gate G1, post-switch check, health drift, reverse gate) calls recordKey:
// two records are the same record exactly when type, case-folded FQDN name, canonical
// value and priority match. TTL never matters. Pure and Edge-safe: no Node imports.

export type RType =
  "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SOA" | "CAA" | "SRV";

export const RTYPES: readonly RType[] = Object.freeze([
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SOA",
  "CAA",
  "SRV",
]);

export type RecordSource = "zone_file" | "scan" | "sweep" | "cds";

/** Fixed order used when merging `sources`. */
export const RECORD_SOURCES: readonly RecordSource[] = Object.freeze([
  "zone_file",
  "scan",
  "sweep",
  "cds",
]);

/**
 * One DNS record. `name` is an FQDN, lowercase, without trailing dot. SRV `value` is
 * `"<weight> <port> <target>"` with `priority` separate; MX `value` is the target with
 * `priority` separate (an embedded `"10 host"` value is accepted and split by `recordKey`).
 */
export type DnsRecord = {
  type: RType;
  name: string;
  value: string;
  priority?: number;
  ttl?: number;
  sources?: RecordSource[];
};

export function isRType(s: string): s is RType {
  return (RTYPES as readonly string[]).includes(s);
}

/**
 * Lowercase, trim, drop one trailing dot. Without a trailing dot and with an `origin`,
 * `@`/empty resolve to the origin and a name not already under the origin is made
 * relative to it (`www` -> `www.example.com`). A trailing dot means absolute.
 */
export function fqdn(name: string, origin?: string): string {
  const n = name.trim().toLowerCase();
  const o =
    origin === undefined ? undefined : stripDot(origin.trim().toLowerCase());
  if (n.endsWith(".")) return stripDot(n);
  if (n === "" || n === "@") return o ?? "";
  if (!o) return n;
  if (n === o || n.endsWith(`.${o}`)) return n;
  return `${n}.${o}`;
}

function stripDot(s: string): string {
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Decode one quoted char-string body (`\"`, `\\`, `\DDD`) as UTF-8 bytes. */
function decodeEscapes(body: string): string {
  if (!body.includes("\\")) return body;
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "\\" && i + 1 < body.length) {
      const ddd = body.slice(i + 1, i + 4);
      if (/^\d{3}$/.test(ddd) && Number(ddd) <= 255) {
        bytes.push(Number(ddd));
        i += 3;
        continue;
      }
      const next = body[i + 1] as string;
      for (const b of utf8Encoder.encode(next)) bytes.push(b);
      i += 1;
      continue;
    }
    // Keep surrogate pairs whole.
    const cp = body.codePointAt(i) as number;
    const s = String.fromCodePoint(cp);
    for (const b of utf8Encoder.encode(s)) bytes.push(b);
    if (s.length === 2) i += 1;
  }
  return utf8Decoder.decode(new Uint8Array(bytes));
}

/**
 * TXT canonical form: chunks unquoted and joined with no separator, case kept.
 * - `'"a" "b"'` (BIND / Cloudflare) -> `"ab"`, escapes decoded.
 * - `["a", "b"]` (one record's chunks) and `[["a", "b"]]` (Node `resolveTxt`) -> `"ab"`.
 * - An unquoted string is returned as is.
 */
export function unquoteTxt(raw: string | string[] | string[][]): string {
  if (Array.isArray(raw)) {
    return (raw as (string | string[])[])
      .map((c) => (Array.isArray(c) ? c.join("") : c))
      .join("");
  }
  const s = raw.trim();
  if (!s.startsWith('"')) return raw;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      let j = i + 1;
      let body = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\" && j + 1 < s.length) {
          body += s.slice(j, j + 2);
          j += 2;
        } else {
          body += s[j];
          j += 1;
        }
      }
      out += decodeEscapes(body);
      i = j + 1;
    } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
    } else {
      // Unquoted chunk between quoted ones: read to the next whitespace or quote.
      let j = i;
      while (j < s.length && !/[\s"]/.test(s[j] as string)) j += 1;
      out += s.slice(i, j);
      i = j;
    }
  }
  return out;
}

/** RFC 5952 form (lowercase, longest zero run compressed); invalid input is lowercased. */
function canonicalIpv6(raw: string): string {
  const v = raw.trim().toLowerCase();
  let s = v;
  // Embedded IPv4 tail (::ffff:1.2.3.4) -> two hex groups.
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (m) {
    const parts = (m[2] as string).split(".").map(Number);
    if (parts.some((p) => p > 255)) return v;
    const [a, b, c, d] = parts as [number, number, number, number];
    s = `${m[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return v;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail =
    halves.length === 2 && halves[1] ? (halves[1] as string).split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return v;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return v;
  const words = groups.map((g) => parseInt(g, 16).toString(16));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (words[i] !== "0") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === "0") j += 1;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestLen < 2) return words.join(":");
  return `${words.slice(0, bestStart).join(":")}::${words.slice(bestStart + bestLen).join(":")}`;
}

type Split = { value: string; priority?: number };

/** MX/SRV: pull an embedded leading priority out of the value. */
function splitPriority(r: DnsRecord): Split {
  const parts = r.value.trim().split(/\s+/);
  const want = r.type === "MX" ? 2 : r.type === "SRV" ? 4 : 0;
  if (want && parts.length === want && /^\d+$/.test(parts[0] as string)) {
    return {
      value: parts.slice(1).join(" "),
      priority: r.priority ?? Number(parts[0]),
    };
  }
  return r.priority === undefined
    ? { value: r.value }
    : { value: r.value, priority: r.priority };
}

/** CAA: `flags tag "value"`, tag lowercased, value unquoted then re-quoted. */
function canonicalCaa(value: string): string {
  const m = /^\s*(\d+)\s+(\S+)\s+([\s\S]*?)\s*$/.exec(value);
  if (!m) return value.trim();
  const v = unquoteTxt(m[3] as string);
  return `${Number(m[1])} ${(m[2] as string).toLowerCase()} "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Canonical value (14-04 choice 1): TXT unquoted+joined (case kept); CNAME/MX/NS/SRV
 * targets via `fqdn`; CAA `flags tag "value"`; A trimmed; AAAA compressed lowercase;
 * SOA whitespace-collapsed lowercase (SOA is never compared by callers).
 */
export function canonicalValue(r: DnsRecord): string {
  switch (r.type) {
    case "TXT":
      return unquoteTxt(r.value);
    case "CNAME":
    case "NS":
      return fqdn(r.value);
    case "MX":
      return fqdn(splitPriority(r).value);
    case "SRV": {
      const parts = splitPriority(r).value.trim().split(/\s+/);
      if (parts.length !== 3) return parts.join(" ").toLowerCase();
      return `${Number(parts[0])} ${Number(parts[1])} ${fqdn(parts[2] as string)}`;
    }
    case "CAA":
      return canonicalCaa(r.value);
    case "AAAA":
      return canonicalIpv6(r.value);
    case "A":
      return r.value.trim();
    case "SOA":
      return r.value.trim().replace(/\s+/g, " ").toLowerCase();
  }
}

/** Effective priority: MX and SRV only (embedded or explicit); undefined otherwise. */
export function recordPriority(r: DnsRecord): number | undefined {
  if (r.type !== "MX" && r.type !== "SRV") return undefined;
  return splitPriority(r).priority;
}

/** Identity: type, FQDN name, canonical value, priority. TTL and sources never count. */
export function recordKey(r: DnsRecord): string {
  return [
    r.type,
    fqdn(r.name),
    canonicalValue(r),
    recordPriority(r) ?? "",
  ].join("\u0000");
}

export function sameRecord(a: DnsRecord, b: DnsRecord): boolean {
  return recordKey(a) === recordKey(b);
}

/**
 * The same record in canonical shape: FQDN name, canonical value, split priority.
 * TTL and sources are carried over unchanged.
 */
export function normalizeRecord(r: DnsRecord): DnsRecord {
  const out: DnsRecord = {
    type: r.type,
    name: fqdn(r.name),
    value: canonicalValue(r),
  };
  const p = recordPriority(r);
  if (p !== undefined) out.priority = p;
  if (r.ttl !== undefined) out.ttl = r.ttl;
  if (r.sources) out.sources = [...r.sources];
  return out;
}

/** One record per key, first wins (TTL included); `sources` merged in fixed order. */
export function dedupeRecords(rs: readonly DnsRecord[]): DnsRecord[] {
  const byKey = new Map<string, DnsRecord>();
  for (const r of rs) {
    const k = recordKey(r);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...r, ...(r.sources ? { sources: [...r.sources] } : {}) });
      continue;
    }
    if (!r.sources?.length) continue;
    const merged = new Set([...(prev.sources ?? []), ...r.sources]);
    prev.sources = RECORD_SOURCES.filter((s) => merged.has(s));
  }
  return [...byKey.values()];
}
