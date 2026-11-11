// Content scanner and search pinger stand-ins (CONT-31, D248, D270; RESEARCH Open
// Question 4). Both sit behind the real ports in ports.ts.
//
// keywordScanner: GO-LIVE P6 row "keyword-only screening". A short, unambiguous list,
// matched case-insensitively as whole words over the texts and the URL hostnames. Since
// 13-08 it is the TextChecker stand-in inside the composite scanner (content/scan/*). Tests use the
// synthetic tokens "__cds_test_held__" / "__cds_test_unsure__", so the real lists can
// change without breaking them.
//
// loggingPinger: GO-LIVE P14 row "IndexNow". It never sends anything and logs the URL
// COUNT only, never the URLs or any content (T-03-22). 13-19: it answers `logged` per org.
//
// CDS_CONTENT_SCANNER / CDS_SEARCH_PINGER select the implementation (14-21: CDS_SEARCH_PINGER=indexnow
// selects the real IndexNow pinger, content/indexnow.ts). Unset gives the
// composite scanner / the logging stand-in; any unknown value throws (fail loudly, like
// getObjectStore).
import type {
  ContentScanner,
  PingResult,
  ScanInput,
  ScanResult,
  SearchPinger,
} from "./ports";
import { indexNowPinger, requireIndexNowKey } from "./indexnow";
import { compositeScanner } from "./scan/composite";

/** Content CDS never hosts: the save is held for staff review. */
export const HELD_TERMS: readonly string[] = Object.freeze([
  "__cds_test_held__",
  "csam",
  "child pornography",
  "stolen credit cards",
  "ransomware for sale",
]);

/** Content a person should look at; it publishes and a flag is written. */
export const UNSURE_TERMS: readonly string[] = Object.freeze([
  "__cds_test_unsure__",
  "casino",
  "online pharmacy",
  "crypto giveaway",
  "payday loan",
]);

const MAX_REASONS = 10;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeWord(term: string): RegExp {
  const body = term.trim().split(/\s+/).map(escapeRe).join("\\s+");
  return new RegExp(`(^|[^a-z0-9_])${body}(?=$|[^a-z0-9_])`, "i");
}

const HELD_RES = HELD_TERMS.map((t) => [t, wholeWord(t)] as const);
const UNSURE_RES = UNSURE_TERMS.map((t) => [t, wholeWord(t)] as const);

/** A URL's hostname split into words ("best-casino.example.com" -> "best casino example com"). */
function hostWords(url: string): string {
  try {
    return new URL(url).hostname.replace(/[.-]+/g, " ");
  } catch {
    return "";
  }
}

function matches(
  haystacks: string[],
  list: readonly (readonly [string, RegExp])[],
): string[] {
  const out: string[] = [];
  for (const [term, re] of list) {
    if (haystacks.some((h) => re.test(h))) out.push(term);
  }
  return out;
}

export const keywordScanner: ContentScanner = {
  async scan(input: ScanInput): Promise<ScanResult> {
    const texts = Array.isArray(input?.texts)
      ? input.texts.filter((t): t is string => typeof t === "string")
      : [];
    const urls = Array.isArray(input?.urls)
      ? input.urls.filter((u): u is string => typeof u === "string")
      : [];
    const haystacks = [...texts, ...urls.map(hostWords)];
    const held = matches(haystacks, HELD_RES);
    if (held.length > 0) {
      return {
        verdict: "held",
        reasons: held.slice(0, MAX_REASONS).map((t) => `keyword: ${t}`),
      };
    }
    const unsure = matches(haystacks, UNSURE_RES);
    if (unsure.length > 0) {
      return {
        verdict: "unsure",
        reasons: unsure.slice(0, MAX_REASONS).map((t) => `keyword: ${t}`),
      };
    }
    return { verdict: "clean", reasons: [] };
  },
};

export const loggingPinger: SearchPinger = {
  async ping(urls: string[], opts?: { orgId?: string }): Promise<PingResult> {
    const count = Array.isArray(urls) ? urls.length : 0;
    console.info("INDEXNOW_STANDIN", count);
    // 13-19: nothing was sent, so the per-org result says so ("logged (stand-in)" in the console).
    return { orgId: opts?.orgId ?? "", result: "logged" };
  },
};

/**
 * 13-08 (choice 6): unset / "composite" → the composite of TextChecker, ImageModerator and
 * LinkChecker (each env-selected, stand-ins by default); "keyword" → keywordScanner alone
 * (kept for tests); anything else throws.
 */
export function getContentScanner(): ContentScanner {
  const v = process.env.CDS_CONTENT_SCANNER;
  if (v === undefined || v === "" || v === "composite") {
    return compositeScanner();
  }
  if (v === "keyword") return keywordScanner;
  throw new Error(
    `CDS_CONTENT_SCANNER="${v}" has no implementation yet (unset it to use the composite scanner)`,
  );
}

let memoPinger: { env: string; pinger: SearchPinger } | null = null;

/**
 * 14-21 (choice 2): unset / "" / "log" → loggingPinger (the stand-in); "indexnow" → the real
 * IndexNow pinger with `CDS_INDEXNOW_KEY` (throws naming it when missing or malformed);
 * anything else throws. Memoised per process (per env value).
 */
export function getSearchPinger(): SearchPinger {
  const v = process.env.CDS_SEARCH_PINGER;
  if (v === undefined || v === "" || v === "log") return loggingPinger;
  if (v === "indexnow") {
    if (memoPinger && memoPinger.env === v) return memoPinger.pinger;
    const pinger = indexNowPinger(requireIndexNowKey());
    memoPinger = { env: v, pinger };
    return pinger;
  }
  throw new Error(
    `CDS_SEARCH_PINGER="${v}" is not supported (use "indexnow", or unset it / "log" for the logging stand-in)`,
  );
}

/** Tests only: forget the memoised pinger. */
export function resetSearchPingerForTests(): void {
  memoPinger = null;
}
