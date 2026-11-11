// Visit source attribution (11-06; DASH-11, DASH-15). UTM source first, then the referrer
// host, then direct. Social bio short links send the platform key as utm_source, so they
// attribute to their platform. Untrusted input: UTM labels keep only [a-z0-9._-] and at
// most 40 chars, anything else becomes "other" (T-11-06-01, T-11-06-02).

/** The ten social preset keys. 11-07's SOCIAL_PRESETS test asserts they match. */
export const SOCIAL_SOURCE_KEYS = Object.freeze([
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
  "x",
  "threads",
  "yelp",
  "nextdoor",
] as const);

export type SocialSourceKey = (typeof SOCIAL_SOURCE_KEYS)[number];

export type SourceKind =
  "social" | "search" | "referral" | "direct" | "campaign";

export interface Attribution {
  source: string;
  kind: SourceKind;
}

export interface AttributionInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  referrer?: string | null;
  ownHost?: string | null;
}

/** Referrer host (without "www.") → social key; subdomains match too. */
const SOCIAL_HOSTS: ReadonlyArray<readonly [string, SocialSourceKey]> = [
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["instagram.com", "instagram"],
  ["t.co", "x"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["tiktok.com", "tiktok"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["pinterest.com", "pinterest"],
  ["pin.it", "pinterest"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
  ["yelp.com", "yelp"],
  ["nextdoor.com", "nextdoor"],
];

/** Search engines by host label: "google." matches google.com, google.co.uk, ... */
const SEARCH_ENGINES = ["google", "bing", "duckduckgo", "yahoo"] as const;

const UTM_RE = /^[a-z0-9._-]+$/;
const UTM_MAX = 40;
const DIRECT: Attribution = Object.freeze({ source: "direct", kind: "direct" });

const SOCIAL_KEY_SET: ReadonlySet<string> = new Set(SOCIAL_SOURCE_KEYS);

/** Clamp an untrusted label to [a-z0-9._-]{1,40}, else "other". */
export function cleanSourceLabel(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === "" || v.length > UTM_MAX || !UTM_RE.test(v)) return "other";
  return v;
}

function hostOf(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

function bareHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function matchesHost(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

export function attributeSource(input: AttributionInput): Attribution {
  const utm = typeof input.utmSource === "string" ? input.utmSource.trim() : "";
  if (utm !== "") {
    const source = cleanSourceLabel(utm);
    return { source, kind: SOCIAL_KEY_SET.has(source) ? "social" : "campaign" };
  }

  const host = hostOf(input.referrer);
  if (!host) return DIRECT;
  const own =
    typeof input.ownHost === "string" ? input.ownHost.trim().toLowerCase() : "";
  if (own !== "" && bareHost(host) === bareHost(own)) return DIRECT;

  for (const [base, key] of SOCIAL_HOSTS) {
    if (matchesHost(host, base)) return { source: key, kind: "social" };
  }
  const labels = bareHost(host).split(".");
  for (const engine of SEARCH_ENGINES) {
    // engine label anywhere before the TLD: www.google.com, search.yahoo.com
    if (labels.slice(0, -1).includes(engine)) {
      return { source: engine, kind: "search" };
    }
  }
  return { source: cleanSourceLabel(bareHost(host)), kind: "referral" };
}
