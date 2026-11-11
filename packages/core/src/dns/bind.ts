// packages/core/src/dns/bind.ts (P14, DOM-05).
// Owner: 14-04 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// A narrow BIND zone-file parser and formatter (14-04 choice 3). Untrusted input (owner or
// staff upload): size capped before parsing, one linear pass, `$INCLUDE` refused, every
// owner must sit under the domain (T-14-04-02, T-14-04-03). Values come out canonical
// (`canonicalValue`), so TXT chunks are joined exactly (T-14-04-01, Pitfall 9).
// `formatBind` writes Cloudflare-import-compatible text: FQDN targets with a trailing dot,
// TXT in 255-byte chunks, no NS/SOA. Pure and Edge-safe: no Node imports.

import {
  fqdn,
  isRType,
  normalizeRecord,
  unquoteTxt,
  type DnsRecord,
  type RType,
} from "./record";

/** Cloudflare's import limit (RESEARCH "importBind"). */
export const MAX_ZONE_FILE_BYTES = 256 * 1024;

export type ZoneFileErrorCode =
  "too_big" | "unreadable" | "wrong_domain" | "include";

/** `too_big` -> ZONE-TOO-BIG, `wrong_domain` -> ZONE-WRONG-DOMAIN, the rest -> ZONE-UNREADABLE. */
export class ZoneFileError extends Error {
  readonly code: ZoneFileErrorCode;
  constructor(code: ZoneFileErrorCode, message: string) {
    super(message);
    this.name = "ZoneFileError";
    this.code = code;
  }
}

type Tok = { text: string; quoted: boolean };
type Line = { lineNo: number; blankOwner: boolean; toks: Tok[] };

const unreadable = (lineNo: number, why: string) =>
  new ZoneFileError("unreadable", `line ${lineNo}: ${why}`);

/** Logical lines: comments dropped, parentheses joined, leading whitespace = blank owner. */
function tokenize(text: string): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let depth = 0;
  let lineNo = 1;
  let atLineStart = true;
  const n = text.length;
  let i = 0;
  const ensure = (blankOwner: boolean): Line => {
    if (!cur) cur = { lineNo, blankOwner, toks: [] };
    return cur;
  };
  while (i < n) {
    const ch = text[i] as string;
    if (ch === "\n") {
      lineNo += 1;
      if (depth === 0) {
        if (cur && (cur as Line).toks.length) lines.push(cur);
        cur = null;
        atLineStart = true;
      }
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (atLineStart && depth === 0) ensure(true);
      atLineStart = false;
      i += 1;
      continue;
    }
    atLineStart = false;
    if (ch === ";") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    const line = ensure(false);
    if (ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth < 0) throw unreadable(lineNo, "unbalanced parenthesis");
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === "\n") throw unreadable(lineNo, "unterminated quote");
        j += text[j] === "\\" ? 2 : 1;
      }
      if (j >= n) throw unreadable(lineNo, "unterminated quote");
      line.toks.push({ text: text.slice(i + 1, j), quoted: true });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s;()"]/.test(text[j] as string))
      j += text[j] === "\\" ? 2 : 1;
    line.toks.push({ text: text.slice(i, Math.min(j, n)), quoted: false });
    i = j;
  }
  if (depth !== 0) throw unreadable(lineNo, "unbalanced parenthesis");
  if (cur && (cur as Line).toks.length) lines.push(cur);
  return lines;
}

const TTL_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/** `3600`, `1h`, `1h30m` -> seconds; anything else -> undefined. */
function parseTtl(s: string): number | undefined {
  if (/^\d+$/.test(s)) {
    const v = Number(s);
    return v <= 2147483647 ? v : undefined;
  }
  if (!/^(\d+[smhdw])+$/i.test(s)) return undefined;
  let total = 0;
  for (const m of s.toLowerCase().matchAll(/(\d+)([smhdw])/g)) {
    total += Number(m[1]) * (TTL_UNITS[m[2] as string] as number);
  }
  return total <= 2147483647 ? total : undefined;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIpv4 = (s: string) => {
  const m = IPV4.exec(s);
  return !!m && m.slice(1).every((p) => Number(p) <= 255);
};
const isUint16 = (s: string) => /^\d{1,5}$/.test(s) && Number(s) <= 65535;

const inDomain = (name: string, d: string) =>
  name === d || name.endsWith(`.${d}`);

function nameOf(tok: Tok, origin: string): string {
  return tok.text === "@" ? origin : fqdn(tok.text, origin);
}

/** Rdata -> record in canonical shape (or throws `unreadable`). */
function buildRecord(
  type: RType,
  owner: string,
  rd: Tok[],
  origin: string,
  lineNo: number,
): DnsRecord {
  const bad = (why: string) => unreadable(lineNo, `${type} ${why}`);
  const want = (k: number) => {
    if (rd.length !== k) throw bad(`needs ${k} value${k === 1 ? "" : "s"}`);
  };
  const t = (k: number) => (rd[k] as Tok).text;
  switch (type) {
    case "A":
      want(1);
      if (!isIpv4(t(0))) throw bad("value is not an IPv4 address");
      return normalizeRecord({ type, name: owner, value: t(0) });
    case "AAAA":
      want(1);
      if (!/^[0-9a-f:.]+$/i.test(t(0)) || !t(0).includes(":")) {
        throw bad("value is not an IPv6 address");
      }
      return normalizeRecord({ type, name: owner, value: t(0) });
    case "CNAME":
    case "NS":
      want(1);
      return normalizeRecord({
        type,
        name: owner,
        value: nameOf(rd[0] as Tok, origin),
      });
    case "MX":
      want(2);
      if (!isUint16(t(0))) throw bad("priority is not a number");
      return normalizeRecord({
        type,
        name: owner,
        value: nameOf(rd[1] as Tok, origin),
        priority: Number(t(0)),
      });
    case "SRV":
      want(4);
      if (![0, 1, 2].every((k) => isUint16(t(k))))
        throw bad("priority/weight/port not numbers");
      return normalizeRecord({
        type,
        name: owner,
        value: `${Number(t(1))} ${Number(t(2))} ${nameOf(rd[3] as Tok, origin)}`,
        priority: Number(t(0)),
      });
    case "TXT":
      if (rd.length === 0) throw bad("has no value");
      return normalizeRecord({
        type,
        name: owner,
        value: rd.map((tok) => unquoteTxt(`"${tok.text}"`)).join(""),
      });
    case "CAA":
      want(3);
      if (!/^\d{1,3}$/.test(t(0)) || Number(t(0)) > 255)
        throw bad("flags is not a number");
      if (!/^[a-z0-9]+$/i.test(t(1))) throw bad("tag is not valid");
      return normalizeRecord({
        type,
        name: owner,
        value: `${t(0)} ${t(1)} "${t(2)}"`,
      });
    case "SOA": {
      want(7);
      // The serial is an unsigned 32-bit number (RFC 1982); real exports often pass 2^31
      // (WR-B02). Only the four timers use the TTL rules.
      const serial = /^\d{1,10}$/.test(t(2)) ? Number(t(2)) : undefined;
      if (serial === undefined || serial > 4294967295)
        throw bad("serial is not a number");
      const timers = [3, 4, 5, 6].map((k) => parseTtl(t(k)));
      if (timers.some((v) => v === undefined))
        throw bad("timers are not numbers");
      const nums = [serial, ...timers];
      const mname = nameOf(rd[0] as Tok, origin);
      const rname = nameOf(rd[1] as Tok, origin);
      return normalizeRecord({
        type,
        name: owner,
        value: `${mname} ${rname} ${nums.join(" ")}`,
      });
    }
  }
}

/**
 * Parse a BIND zone file for `domain` (14-04 choice 3). Supports `$ORIGIN`, `$TTL`, `@`,
 * relative names, blank owner (= previous owner), parentheses, `;` comments (Cloudflare
 * `cf_tags=` included), optional class `IN` and TTL in either order. A relative name that
 * already ends in the origin is taken as absolute (Cloudflare's SOA line). Every record
 * gets `sources: ["zone_file"]`; SOA and NS are returned (formatBind skips them).
 */
export function parseBind(text: string, domain: string): DnsRecord[] {
  if (
    text.length > MAX_ZONE_FILE_BYTES ||
    new TextEncoder().encode(text).length > MAX_ZONE_FILE_BYTES
  ) {
    throw new ZoneFileError(
      "too_big",
      `zone file is over ${MAX_ZONE_FILE_BYTES} bytes`,
    );
  }
  const d = fqdn(domain);
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  let origin = d;
  let defaultTtl: number | undefined;
  let lastTtl: number | undefined;
  let prevOwner: string | undefined;
  const out: DnsRecord[] = [];

  for (const line of tokenize(body)) {
    const t0 = line.toks[0] as Tok;
    if (!line.blankOwner && !t0.quoted && t0.text.startsWith("$")) {
      const dir = t0.text.toUpperCase();
      const arg = line.toks[1];
      if (dir === "$INCLUDE") {
        throw new ZoneFileError(
          "include",
          `line ${line.lineNo}: $INCLUDE is not supported`,
        );
      }
      if (dir === "$ORIGIN") {
        if (!arg || arg.quoted)
          throw unreadable(line.lineNo, "$ORIGIN needs a name");
        origin = nameOf(arg, origin);
        if (!inDomain(origin, d)) {
          throw new ZoneFileError(
            "wrong_domain",
            `line ${line.lineNo}: $ORIGIN is outside ${d}`,
          );
        }
        continue;
      }
      if (dir === "$TTL") {
        const v = arg && !arg.quoted ? parseTtl(arg.text) : undefined;
        if (v === undefined)
          throw unreadable(line.lineNo, "$TTL needs a number");
        defaultTtl = v;
        continue;
      }
      throw unreadable(
        line.lineNo,
        `directive ${dir.slice(0, 20)} is not supported`,
      );
    }

    let idx = 0;
    let owner: string;
    if (line.blankOwner) {
      if (prevOwner === undefined)
        throw unreadable(line.lineNo, "record has no owner name");
      owner = prevOwner;
    } else {
      owner = nameOf(t0, origin);
      idx = 1;
    }
    if (!inDomain(owner, d)) {
      throw new ZoneFileError(
        "wrong_domain",
        `line ${line.lineNo}: a record is outside ${d}`,
      );
    }

    let ttl: number | undefined;
    let sawClass = false;
    for (; idx < line.toks.length; idx++) {
      const tok = line.toks[idx] as Tok;
      if (tok.quoted) break;
      const asTtl = ttl === undefined ? parseTtl(tok.text) : undefined;
      if (asTtl !== undefined) {
        ttl = asTtl;
        continue;
      }
      if (!sawClass && /^(IN|CH|HS|CS)$/i.test(tok.text)) {
        if (tok.text.toUpperCase() !== "IN") {
          throw unreadable(
            line.lineNo,
            `class ${tok.text.toUpperCase()} is not supported`,
          );
        }
        sawClass = true;
        continue;
      }
      break;
    }
    const typeTok = line.toks[idx];
    if (!typeTok || typeTok.quoted)
      throw unreadable(line.lineNo, "record has no type");
    const type = typeTok.text.toUpperCase();
    if (!isRType(type)) {
      throw unreadable(
        line.lineNo,
        `record type ${type.slice(0, 20)} is not supported`,
      );
    }

    const effTtl = ttl ?? defaultTtl ?? lastTtl;
    lastTtl = effTtl;
    const rec = buildRecord(
      type,
      owner,
      line.toks.slice(idx + 1),
      origin,
      line.lineNo,
    );
    if (effTtl !== undefined) rec.ttl = effTtl;
    rec.sources = ["zone_file"];
    out.push(rec);
    prevOwner = owner;
  }
  return out;
}

/** TXT/CAA string -> quoted chunks of at most 255 bytes, `"`/`\` escaped, non-ASCII as \DDD. */
function quoteChunks(value: string, chunkBytes = 255): string[] {
  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  for (
    let start = 0;
    start < bytes.length || start === 0;
    start += chunkBytes
  ) {
    let s = "";
    for (const b of bytes.subarray(start, start + chunkBytes)) {
      if (b === 0x22 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
      else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
      else s += `\\${String(b).padStart(3, "0")}`;
    }
    chunks.push(`"${s}"`);
    if (bytes.length === 0) break;
  }
  return chunks;
}

const abs = (name: string) => `${fqdn(name)}.`;

/**
 * Format records for `domain` as a BIND zone file Cloudflare can import: absolute owners
 * and targets with a trailing dot, TTL per line (default 3600), no NS/SOA. A record
 * outside the domain throws `wrong_domain`.
 */
export function formatBind(
  domain: string,
  records: readonly DnsRecord[],
): string {
  const d = fqdn(domain);
  const lines = [`; Zone file for ${d}`, `$ORIGIN ${d}.`];
  for (const raw of records) {
    if (raw.type === "NS" || raw.type === "SOA") continue;
    const r = normalizeRecord(raw);
    if (!inDomain(r.name, d)) {
      throw new ZoneFileError("wrong_domain", `a record is outside ${d}`);
    }
    let rdata: string;
    switch (r.type) {
      case "NS":
      case "SOA":
        continue;
      case "A":
      case "AAAA":
        rdata = r.value;
        break;
      case "CNAME":
        rdata = abs(r.value);
        break;
      case "MX":
        rdata = `${r.priority ?? 0} ${abs(r.value)}`;
        break;
      case "SRV": {
        const [w, p, target] = r.value.split(" ");
        rdata = `${r.priority ?? 0} ${w} ${p} ${abs(target ?? "")}`;
        break;
      }
      case "TXT":
        rdata = quoteChunks(r.value).join(" ");
        break;
      case "CAA": {
        const m = /^(\d+) (\S+) "([\s\S]*)"$/.exec(r.value);
        const inner = m ? unquoteTxt(`"${m[3]}"`) : "";
        rdata = m
          ? `${m[1]} ${m[2]} ${quoteChunks(inner, Number.MAX_SAFE_INTEGER).join("")}`
          : r.value;
        break;
      }
    }
    lines.push(`${abs(r.name)}\t${r.ttl ?? 3600}\tIN\t${r.type}\t${rdata}`);
  }
  return `${lines.join("\n")}\n`;
}
