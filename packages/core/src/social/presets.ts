// Social account presets and bio short codes (11-07; DASH-14, DASH-15; D198, D199).
// Pure and browser-safe: no Node built-ins, no next/* imports.
//
// Ten fixed presets in D198 order. Each has a fixed bio short code served at the site root
// (`/ig`), a host allowlist for URL validation, and the P7 brand-icon key where one exists
// (`packages/ui/src/site/icons/brands.ts`; threads, yelp and nextdoor have none yet: null).
// Custom accounts get `/go/<code>`. A page that already owns a preset slug wins, and that
// account falls back to `/go/<code>` (RESEARCH Pitfall 19).

export type SocialPreset = {
  readonly key: string;
  readonly label: string;
  /** Fixed bio short code (D199), served at `/<code>`. */
  readonly code: string;
  /** Allowed hosts; a subdomain of any of them is allowed too. */
  readonly hosts: readonly string[];
  /** P7 brand-icon key, or null when no brand icon exists yet. */
  readonly icon: string | null;
};

const preset = (p: SocialPreset): SocialPreset =>
  Object.freeze({ ...p, hosts: Object.freeze([...p.hosts]) });

export const SOCIAL_PRESETS: readonly SocialPreset[] = Object.freeze([
  preset({
    key: "facebook",
    label: "Facebook",
    code: "fb",
    hosts: ["facebook.com", "fb.com", "m.facebook.com"],
    icon: "facebook",
  }),
  preset({
    key: "instagram",
    label: "Instagram",
    code: "ig",
    hosts: ["instagram.com"],
    icon: "instagram",
  }),
  preset({
    key: "tiktok",
    label: "TikTok",
    code: "tt",
    hosts: ["tiktok.com"],
    icon: "tiktok",
  }),
  preset({
    key: "youtube",
    label: "YouTube",
    code: "yt",
    hosts: ["youtube.com", "youtu.be"],
    icon: "youtube",
  }),
  preset({
    key: "linkedin",
    label: "LinkedIn",
    code: "li",
    hosts: ["linkedin.com"],
    icon: "linkedin",
  }),
  preset({
    key: "pinterest",
    label: "Pinterest",
    code: "pin",
    hosts: ["pinterest.com", "pin.it"],
    icon: "pinterest",
  }),
  preset({
    key: "x",
    label: "X",
    code: "x",
    hosts: ["x.com", "twitter.com"],
    icon: "x",
  }),
  preset({
    key: "threads",
    label: "Threads",
    code: "th",
    hosts: ["threads.net", "threads.com"],
    icon: null,
  }),
  preset({
    key: "yelp",
    label: "Yelp",
    code: "yelp",
    hosts: ["yelp.com"],
    icon: null,
  }),
  preset({
    key: "nextdoor",
    label: "Nextdoor",
    code: "nd",
    hosts: ["nextdoor.com"],
    icon: null,
  }),
]);

export const CUSTOM_PLATFORM = "custom";

export const PRESET_KEYS: readonly string[] = Object.freeze(
  SOCIAL_PRESETS.map((p) => p.key),
);
export const PRESET_CODES: readonly string[] = Object.freeze(
  SOCIAL_PRESETS.map((p) => p.code),
);

/** Slugs a page may not take for granted: the page still wins on collision (Pitfall 19). */
export const RESERVED_BIO_SLUGS: readonly string[] = Object.freeze([
  ...PRESET_CODES,
  "go",
]);

export const SOCIAL_URL_MAX = 500;
export const CUSTOM_CODE_MAX = 20;
export const CUSTOM_LABEL_MAX = 40;

export function isPresetKey(key: unknown): boolean {
  return typeof key === "string" && PRESET_KEYS.includes(key);
}

export function isPresetCode(code: unknown): boolean {
  return typeof code === "string" && PRESET_CODES.includes(code);
}

export function findPreset(key: unknown): SocialPreset | undefined {
  return SOCIAL_PRESETS.find((p) => p.key === key);
}

export type SocialUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "https" | "host" | "invalid" | "length" };

function bareHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  return h.startsWith("www.") ? h.slice(4) : h;
}

function onHost(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Validates an owner-entered social URL (T-11-07-01). `https:` only, at most 500 chars, no
 * credentials. Preset URLs must be on the platform's hosts (or a subdomain); custom URLs may
 * be on any host except the tenant's own (`ownHost`).
 */
export function validateSocialUrl(
  platform: string,
  raw: string,
  opts: { ownHost?: string | null } = {},
): SocialUrlResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "invalid" };
  if (value.length > SOCIAL_URL_MAX) return { ok: false, reason: "length" };
  const isCustom = platform === CUSTOM_PLATFORM;
  const p = isCustom ? undefined : findPreset(platform);
  if (!isCustom && !p) return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https" };
  if (url.username || url.password || !url.hostname)
    return { ok: false, reason: "invalid" };
  const host = url.hostname.toLowerCase();
  if (p) {
    if (!p.hosts.some((h) => onHost(host, h)))
      return { ok: false, reason: "host" };
  } else if (opts.ownHost) {
    const own = bareHost(opts.ownHost);
    if (own && onHost(bareHost(host), own))
      return { ok: false, reason: "host" };
  }
  const out = url.href;
  if (out.length > SOCIAL_URL_MAX) return { ok: false, reason: "length" };
  return { ok: true, url: out };
}

export type BioLinkAccount = {
  platform: string;
  short_code?: string | null;
  /** True when a page owns the preset slug: the account uses `/go/<code>` instead. */
  fallback?: boolean;
};

/** The bio short-link path for an account (D199). */
export function bioLinkPath(account: BioLinkAccount): string {
  const p = findPreset(account.platform);
  if (p) return account.fallback ? `/go/${p.code}` : `/${p.code}`;
  return `/go/${account.short_code ?? ""}`;
}

function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimTo(base: string, max: number): string {
  return base.slice(0, max).replace(/-+$/g, "");
}

/**
 * A custom account's short code from its label (T-11-07-02): `[a-z0-9-]`, at most 20 chars,
 * suffixed `-2`, `-3`… when taken, never a preset code or `go`.
 */
export function customCodeFor(label: string, taken: readonly string[]): string {
  const blocked = new Set<string>([...RESERVED_BIO_SLUGS, ...taken]);
  const base =
    trimTo(slugify(typeof label === "string" ? label : ""), CUSTOM_CODE_MAX) ||
    "link";
  if (!blocked.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${trimTo(base, CUSTOM_CODE_MAX - suffix.length) || "link"}${suffix}`;
    if (!blocked.has(candidate)) return candidate;
  }
}

// ---- Social accounts as the hub sees them (11-35; DASH-14, DASH-15) ----

/** One row of My social accounts (11-35). Browser-safe: client components type props with it. */
export type SocialAccount = {
  id: string;
  /** A preset key or "custom". */
  platform: string;
  /** The preset label, or the owner's name for a custom account. */
  name: string;
  /** "" for presets; the owner's name for a custom account. */
  label: string;
  url: string;
  shortCode: string;
  order: number;
  /** True when a page owns the preset slug, so the bio link is /go/<code> (Pitfall 19). */
  fallback: boolean;
  /** The bio short-link path (`/ig`, `/go/ig`, `/go/etsy`). */
  bioPath: string;
};

/** Most accounts one site may list (11-35 choice 1). */
export const SOCIAL_ACCOUNTS_MAX = 20;

/** UI-SPEC Copywriting Contract (SOCIAL-URL-HTTPS, SOCIAL-DUP) plus the repository's own lines. */
export const SOCIAL_COPY = Object.freeze({
  https: "Enter the full address, starting with https://.",
  dup: "You've already added this account.",
  invalid: "That address doesn't look right. Check it and try again.",
  length: `Keep the address to ${SOCIAL_URL_MAX} characters or fewer.`,
  ownHost:
    "That's your own site. Add the address of your account on the other site.",
  platform: "Pick a platform from the list.",
  label: "Give this account a name.",
  labelLength: `Keep the name to ${CUSTOM_LABEL_MAX} characters or fewer.`,
  full: `You can add up to ${SOCIAL_ACCOUNTS_MAX} accounts.`,
});

/** SOCIAL-URL-HOST: "That isn't an Instagram address. It should start with https://instagram.com/." */
export function socialHostCopy(platform: string): string {
  const p = findPreset(platform);
  if (!p) return SOCIAL_COPY.ownHost;
  const article = /^[aeiou]/i.test(p.label) ? "an" : "a";
  return `That isn't ${article} ${p.label} address. It should start with https://${p.hosts[0]}/.`;
}

/** The owner-facing line for a validateSocialUrl failure. */
export function socialUrlErrorCopy(
  platform: string,
  reason: "https" | "host" | "invalid" | "length",
): string {
  if (reason === "https") return SOCIAL_COPY.https;
  if (reason === "length") return SOCIAL_COPY.length;
  if (reason === "host") return socialHostCopy(platform);
  return SOCIAL_COPY.invalid;
}
