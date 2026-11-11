// Link check sub-port (13-08 choices 2 and 3; STAFF-23, D248, D295).
//
// skippedLinkChecker: the stand-in; reports `skipped`, never calls anything.
// webRiskLinkChecker: the Google Web Risk Lookup API adapter. Built, not enabled (GO-LIVE:
//   CDS_LINK_CHECKER=webrisk + CDS_WEBRISK_API_KEY). Full URLs are deduped per scan (fragment
//   dropped, host lowercased), never by host alone: Web Risk is URL-based and phishing sits
//   on shared hosts (WR-A03). At most MAX_LOOKUPS_PER_SCAN per scan, and every batch first
//   reserves lookups against the monthly cap (budget.ts, P13-P27); links past either cap
//   are `unchecked`, never looked up. `{}` is
//   clean, `{threat:…}` is held. A non-2xx answer or a 3 s timeout throws, which the
//   composite turns into verdict `error` (publish and queue, D248).
// The API key travels only in the request URL; neither the URL nor the key is ever logged.
//
// CDS_LINK_CHECKER unset / "skip" → stand-in; "webrisk" → the adapter (needs the key);
// anything else throws (fail loud).
import type { LinkChecker, ScanInput, SubResult } from "../ports";
import { reserveWebRiskLookups } from "./budget";

export const LINKS_UNCHECKED_REASON = "links unchecked: monthly cap";

const WEBRISK_ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search";
const THREAT_TYPES = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"];
const TIMEOUT_MS = 3_000;
const MAX_REASONS = 10;
/** Lookups one scan may spend; the rest are `unchecked` (WR-A03). */
export const MAX_LOOKUPS_PER_SCAN = 50;

export const skippedLinkChecker: LinkChecker = {
  name: "skipped",
  async check(): Promise<SubResult> {
    return { verdict: "skipped", reasons: ["stand-in"], provider: "skipped" };
  },
};

export type WebRiskDeps = {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Defaults to reserveWebRiskLookups (platform_meta counter under a lock). */
  reserve?: (n: number, now: Date) => Promise<number>;
  timeoutMs?: number;
};

/** Each distinct http(s) URL (fragment dropped), in input order, with its host. */
export function uniqueUrls(urls: unknown): { host: string; url: string }[] {
  const out: { host: string; url: string }[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(urls)) return out;
  for (const u of urls) {
    if (typeof u !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const host = parsed.hostname.toLowerCase();
    if (host === "") continue;
    parsed.hash = "";
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ host, url });
  }
  return out;
}

function threatTypesOf(body: unknown): string[] | null {
  if (body === null || typeof body !== "object") return null;
  const threat = (body as { threat?: unknown }).threat;
  if (threat === undefined || threat === null) return null;
  const types = (threat as { threatTypes?: unknown }).threatTypes;
  const list = Array.isArray(types)
    ? types.filter((t): t is string => typeof t === "string")
    : [];
  return list.length > 0 ? list : ["THREAT"];
}

export function webRiskLinkChecker(
  apiKey: string,
  deps: WebRiskDeps = {},
): LinkChecker {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("webRiskLinkChecker needs an API key");
  }
  const key = apiKey.trim();
  const doFetch = deps.fetch ?? fetch;
  const clock = deps.now ?? (() => new Date());
  const reserve =
    deps.reserve ??
    ((n: number, now: Date) => reserveWebRiskLookups(n, { now }));
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  async function lookup(url: string): Promise<string[] | null> {
    const qs = new URLSearchParams();
    for (const t of THREAT_TYPES) qs.append("threatTypes", t);
    qs.append("uri", url);
    qs.append("key", key);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await doFetch(`${WEBRISK_ENDPOINT}?${qs.toString()}`, {
        method: "GET",
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`webrisk answered ${res.status}`);
      return threatTypesOf(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: "webrisk",
    async check(input: ScanInput): Promise<SubResult> {
      const hosts = uniqueUrls(input?.urls);
      if (hosts.length === 0) {
        return { verdict: "clean", reasons: [], provider: "webrisk" };
      }
      const allowed = Math.max(
        0,
        Math.min(
          hosts.length,
          await reserve(Math.min(hosts.length, MAX_LOOKUPS_PER_SCAN), clock()),
        ),
      );
      const checked = hosts.slice(0, allowed);
      const results = await Promise.all(checked.map((h) => lookup(h.url)));
      const held: string[] = [];
      results.forEach((types, i) => {
        if (types) held.push(`link: ${types.join(", ")} (${checked[i]!.host})`);
      });
      const unchecked = allowed < hosts.length;
      if (held.length > 0) {
        const reasons = held.slice(0, MAX_REASONS);
        if (unchecked) reasons.push(LINKS_UNCHECKED_REASON);
        return { verdict: "held", reasons, provider: "webrisk" };
      }
      if (unchecked) {
        return {
          verdict: "unchecked",
          reasons: [LINKS_UNCHECKED_REASON],
          provider: "webrisk",
        };
      }
      return { verdict: "clean", reasons: [], provider: "webrisk" };
    },
  };
}

export function getLinkChecker(): LinkChecker {
  const v = process.env.CDS_LINK_CHECKER;
  if (v === undefined || v === "" || v === "skip") return skippedLinkChecker;
  if (v === "webrisk") {
    const apiKey = process.env.CDS_WEBRISK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        'CDS_LINK_CHECKER="webrisk" needs CDS_WEBRISK_API_KEY (unset CDS_LINK_CHECKER to use the skipped stand-in)',
      );
    }
    return webRiskLinkChecker(apiKey);
  }
  throw new Error(
    `CDS_LINK_CHECKER="${v}" has no implementation yet (unset it to use the skipped stand-in)`,
  );
}
