// The only place an embed URL is built. Tenants never store iframe HTML or a URL we did not
// construct (D281). Privacy-enhanced sources per D279 (youtube-nocookie, Vimeo dnt=1, X
// dnt=true). Adding a provider is one table row + one extractor + corpus cases
// (__fixtures__/media-links.ts).
//
// Accepts any link form or a pasted <iframe> for the D219 video set, the audio set and the
// curated embed allowlist (CONT-17, CONT-27, CONT-34). Pure and Edge-safe: only URL,
// URLSearchParams, atob and encodeURIComponent. Every regex is anchored and bounded (no nested
// quantifiers), and input length is capped before any parsing (T-07-08-07).
import { InvalidInput } from "../errors";

export const VIDEO_PROVIDERS = Object.freeze([
  "youtube",
  "vimeo",
  "wistia",
  "loom",
  "facebook",
  "instagram",
  "x",
  "tiktok",
] as const);
export const AUDIO_PROVIDERS = Object.freeze([
  "spotify",
  "soundcloud",
  "apple-podcasts",
] as const);
export const EMBED_PROVIDERS = Object.freeze([
  "calendly",
  "google-calendar",
] as const);

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export type AudioProvider = (typeof AUDIO_PROVIDERS)[number];
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];
export type MediaProvider = VideoProvider | AudioProvider | EmbedProvider;
export type MediaLinkCategory = "video" | "audio" | "embed";

export const PROVIDER_LABELS: Readonly<Record<MediaProvider, string>> =
  Object.freeze({
    youtube: "YouTube",
    vimeo: "Vimeo",
    wistia: "Wistia",
    loom: "Loom",
    facebook: "Facebook",
    instagram: "Instagram",
    x: "X",
    tiktok: "TikTok",
    spotify: "Spotify",
    soundcloud: "SoundCloud",
    "apple-podcasts": "Apple Podcasts",
    calendly: "Calendly",
    "google-calendar": "Google Calendar",
  });

/** Every host a built embed URL loads from (07-14 scans server markup for these). */
export const PROVIDER_FRAME_HOSTS: readonly string[] = Object.freeze([
  "www.youtube-nocookie.com",
  "i.ytimg.com",
  "player.vimeo.com",
  "fast.wistia.net",
  "www.loom.com",
  "www.facebook.com",
  "www.instagram.com",
  "platform.twitter.com",
  "www.tiktok.com",
  "open.spotify.com",
  "w.soundcloud.com",
  "embed.podcasts.apple.com",
  "calendly.com",
  "calendar.google.com",
]);

export const LINK_NOT_ALLOWED_COPY =
  "We can't show videos from this site. Use YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X or TikTok, or upload it as an MP4 instead.";
export const AUDIO_NOT_ALLOWED_COPY =
  "We can't play audio from this site. Use Spotify, SoundCloud or Apple Podcasts, or upload an MP3 instead.";
export const EMBED_NOT_ALLOWED_COPY =
  "This site isn't on the allowed list. You can add a Calendly or public Google Calendar link.";
export const VIDEO_LINK_EMPTY_COPY = "Paste a link to your video.";
export const AUDIO_LINK_EMPTY_COPY = "Paste a link to your audio.";
export const EMBED_LINK_EMPTY_COPY =
  "Paste your Calendly or public Google Calendar link.";

export interface MediaLink {
  provider: MediaProvider;
  category: MediaLinkCategory;
  /** Provider id in our own grammar; stored as `provider_id`, re-validated on every read. */
  id: string;
  /** The privacy-enhanced frame URL we build (never one the tenant pasted). */
  embedUrl: string;
  /** Canonical public page, for display and "Open on …"; parses back to the same link. */
  pageUrl: string;
  /** YouTube only. Fetched server-side at save (07-23), never hot-linked (Pitfall 7). */
  thumbnailUrl?: string;
  /** Frame height in px for calendars. */
  height?: number;
}

export type MediaLinkResult =
  | { ok: true; link: MediaLink }
  | { ok: false; reason: "empty" | "not-a-link" | "not-allowed" };

const MAX_INPUT = 4096;
const MAX_URL = 2048;

const enc = encodeURIComponent;

// ---- per-provider id grammar + builder ------------------------------------------------------

interface ProviderDef {
  category: MediaLinkCategory;
  grammar: RegExp;
  build: (id: string) => Omit<MediaLink, "provider" | "category" | "id">;
}

const DIGITS = /^\d{1,20}$/;
const SC_SEG = "[A-Za-z0-9_-]{1,100}";
const SC_ID = new RegExp(
  `^(?:(?:tracks|playlists)/\\d{1,20}|${SC_SEG}/sets/${SC_SEG}|${SC_SEG}/${SC_SEG})$`,
);
const SC_API = /^(?:tracks|playlists)\/\d{1,20}$/;
const CAL_SEG = "[A-Za-z0-9_-]{1,64}";
const GCAL_ID = /^[A-Za-z0-9._%+#-]{1,128}@[A-Za-z0-9.-]{1,128}$/;

const PROVIDERS: Readonly<Record<MediaProvider, ProviderDef>> = Object.freeze({
  youtube: {
    category: "video",
    grammar: /^[A-Za-z0-9_-]{11}$/,
    build: (id) => ({
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      pageUrl: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }),
  },
  vimeo: {
    category: "video",
    grammar: /^\d{1,12}(?::[a-f0-9]{6,20})?$/,
    build: (id) => {
      const [num, hash] = id.split(":");
      return {
        embedUrl: `https://player.vimeo.com/video/${num}?dnt=1${hash ? `&h=${hash}` : ""}`,
        pageUrl: `https://vimeo.com/${num}${hash ? `/${hash}` : ""}`,
      };
    },
  },
  wistia: {
    category: "video",
    grammar: /^[a-z0-9]{10}$/,
    build: (id) => ({
      embedUrl: `https://fast.wistia.net/embed/iframe/${id}`,
      pageUrl: `https://fast.wistia.net/embed/iframe/${id}`,
    }),
  },
  loom: {
    category: "video",
    grammar: /^[a-f0-9]{32}$/,
    build: (id) => ({
      embedUrl: `https://www.loom.com/embed/${id}`,
      pageUrl: `https://www.loom.com/share/${id}`,
    }),
  },
  facebook: {
    category: "video",
    grammar: DIGITS,
    build: (id) => ({
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${enc(
        `https://www.facebook.com/video.php?v=${id}`,
      )}`,
      pageUrl: `https://www.facebook.com/watch/?v=${id}`,
    }),
  },
  instagram: {
    category: "video",
    grammar: /^(?:p|reel|tv)\/[A-Za-z0-9_-]{5,40}$/,
    build: (id) => ({
      embedUrl: `https://www.instagram.com/${id}/embed`,
      pageUrl: `https://www.instagram.com/${id}/`,
    }),
  },
  x: {
    category: "video",
    grammar: DIGITS,
    build: (id) => ({
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`,
      pageUrl: `https://x.com/i/status/${id}`,
    }),
  },
  tiktok: {
    category: "video",
    grammar: DIGITS,
    build: (id) => ({
      embedUrl: `https://www.tiktok.com/embed/v2/${id}`,
      pageUrl: `https://www.tiktok.com/embed/v2/${id}`,
    }),
  },
  spotify: {
    category: "audio",
    grammar: /^(?:track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{22}$/,
    build: (id) => ({
      embedUrl: `https://open.spotify.com/embed/${id}`,
      pageUrl: `https://open.spotify.com/${id}`,
    }),
  },
  soundcloud: {
    category: "audio",
    grammar: SC_ID,
    build: (id) => {
      const canonical = SC_API.test(id)
        ? `https://api.soundcloud.com/${id}`
        : `https://soundcloud.com/${id}`;
      return {
        embedUrl: `https://w.soundcloud.com/player/?url=${enc(canonical)}`,
        pageUrl: canonical,
      };
    },
  },
  "apple-podcasts": {
    category: "audio",
    grammar: /^[a-z]{2}\/[a-z0-9-]{1,120}\/\d{1,20}(?:\/\d{1,20})?$/,
    build: (id) => {
      const [cc, slug, show, episode] = id.split("/");
      const path = `${cc}/podcast/${slug}/id${show}${episode ? `?i=${episode}` : ""}`;
      return {
        embedUrl: `https://embed.podcasts.apple.com/${path}`,
        pageUrl: `https://podcasts.apple.com/${path}`,
      };
    },
  },
  calendly: {
    category: "embed",
    grammar: new RegExp(`^${CAL_SEG}(?:/${CAL_SEG})?$`),
    build: (id) => ({
      embedUrl: `https://calendly.com/${id}?embed_type=Inline&hide_gdpr_banner=1`,
      pageUrl: `https://calendly.com/${id}`,
      height: 704,
    }),
  },
  "google-calendar": {
    category: "embed",
    grammar: GCAL_ID,
    build: (id) => {
      const url = `https://calendar.google.com/calendar/embed?src=${enc(id)}`;
      return { embedUrl: url, pageUrl: url, height: 600 };
    },
  },
});

function build(provider: MediaProvider, id: string): MediaLink | null {
  const def = PROVIDERS[provider];
  if (!def.grammar.test(id)) return null;
  return { provider, category: def.category, id, ...def.build(id) };
}

// ---- host map ------------------------------------------------------------------------------

const HOSTS: ReadonlyMap<string, MediaProvider> = new Map<
  string,
  MediaProvider
>([
  ["youtube.com", "youtube"],
  ["www.youtube.com", "youtube"],
  ["m.youtube.com", "youtube"],
  ["music.youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["youtube-nocookie.com", "youtube"],
  ["www.youtube-nocookie.com", "youtube"],
  ["vimeo.com", "vimeo"],
  ["www.vimeo.com", "vimeo"],
  ["player.vimeo.com", "vimeo"],
  ["fast.wistia.net", "wistia"],
  ["loom.com", "loom"],
  ["www.loom.com", "loom"],
  ["facebook.com", "facebook"],
  ["www.facebook.com", "facebook"],
  ["m.facebook.com", "facebook"],
  ["web.facebook.com", "facebook"],
  ["instagram.com", "instagram"],
  ["www.instagram.com", "instagram"],
  ["x.com", "x"],
  ["www.x.com", "x"],
  ["mobile.x.com", "x"],
  ["twitter.com", "x"],
  ["www.twitter.com", "x"],
  ["mobile.twitter.com", "x"],
  ["platform.twitter.com", "x"],
  ["tiktok.com", "tiktok"],
  ["www.tiktok.com", "tiktok"],
  ["open.spotify.com", "spotify"],
  ["soundcloud.com", "soundcloud"],
  ["www.soundcloud.com", "soundcloud"],
  ["m.soundcloud.com", "soundcloud"],
  ["w.soundcloud.com", "soundcloud"],
  ["api.soundcloud.com", "soundcloud"],
  ["podcasts.apple.com", "apple-podcasts"],
  ["embed.podcasts.apple.com", "apple-podcasts"],
  ["calendly.com", "calendly"],
  ["www.calendly.com", "calendly"],
  ["calendar.google.com", "google-calendar"],
]);

const ONE_LABEL = /^[a-z0-9-]{1,63}$/;

/** `<one label>.wistia.com` or `<one label>.wi.st` (fast.wistia.com included). */
function wistiaSubdomain(host: string): boolean {
  for (const suffix of [".wistia.com", ".wi.st"]) {
    if (host.endsWith(suffix)) {
      return ONE_LABEL.test(host.slice(0, -suffix.length));
    }
  }
  return false;
}

function providerForHost(host: string): MediaProvider | null {
  return HOSTS.get(host) ?? (wistiaSubdomain(host) ? "wistia" : null);
}

// ---- extractors: URL -> id in our grammar (or null) -----------------------------------------

type Extractor = (url: URL, segs: string[], depth: number) => string | null;

const YT_PATH_KINDS = new Set(["embed", "shorts", "live", "v"]);

const EXTRACT: Readonly<Record<MediaProvider, Extractor>> = {
  youtube: (url, segs) => {
    if (url.hostname === "youtu.be") return segs[0] ?? null;
    if (segs[0] === "watch" && segs.length === 1) {
      return url.searchParams.get("v");
    }
    if (segs.length === 2 && YT_PATH_KINDS.has(segs[0] ?? "")) {
      return segs[1] ?? null;
    }
    return null;
  },
  vimeo: (url, segs) => {
    let rest = segs;
    if (url.hostname === "player.vimeo.com") {
      if (segs[0] !== "video" || segs.length !== 2) return null;
      rest = segs.slice(1);
    } else if (segs.length > 2) {
      return null;
    }
    const num = rest[0] ?? "";
    const hash = rest[1] ?? url.searchParams.get("h") ?? "";
    return hash ? `${num}:${hash}` : num;
  },
  wistia: (_url, segs) => {
    if (segs.length === 2 && segs[0] === "medias") return segs[1] ?? null;
    if (segs.length === 3 && segs[0] === "embed") {
      if (segs[1] === "iframe" || segs[1] === "medias") return segs[2] ?? null;
    }
    return null;
  },
  loom: (_url, segs) =>
    segs.length === 2 && (segs[0] === "share" || segs[0] === "embed")
      ? (segs[1] ?? null)
      : null,
  facebook: (url, segs, depth) => {
    const path = segs.join("/");
    if (path === "plugins/video.php") {
      if (depth > 0) return null;
      const href = url.searchParams.get("href");
      if (!href) return null;
      const inner = parseUrl(href, 1);
      return inner && inner.provider === "facebook" ? inner.id : null;
    }
    if (path === "watch" || path === "video.php") {
      return url.searchParams.get("v");
    }
    if (segs.length === 2 && segs[0] === "reel") return segs[1] ?? null;
    // /<page>/videos/<id> or /<page>/videos/<slug>/<id>
    if ((segs.length === 3 || segs.length === 4) && segs[1] === "videos") {
      return segs[segs.length - 1] ?? null;
    }
    return null;
  },
  instagram: (_url, segs) => {
    if (segs.length < 2 || segs.length > 4) return null;
    const tail = segs.slice(2).join("/");
    if (tail !== "" && tail !== "embed" && tail !== "embed/captioned") {
      return null;
    }
    return `${segs[0]}/${segs[1]}`;
  },
  x: (url, segs) => {
    if (url.hostname === "platform.twitter.com") {
      return segs.join("/") === "embed/Tweet.html"
        ? url.searchParams.get("id")
        : null;
    }
    if (
      segs.length === 3 &&
      segs[1] === "status" &&
      /^[A-Za-z0-9_]{1,15}$/.test(segs[0] ?? "")
    ) {
      return segs[2] ?? null;
    }
    return null;
  },
  tiktok: (_url, segs) => {
    if (segs.length === 3 && segs[0]?.startsWith("@") && segs[1] === "video") {
      return segs[2] ?? null;
    }
    if (segs.length === 3 && segs[0] === "embed" && segs[1] === "v2") {
      return segs[2] ?? null;
    }
    if (segs.length === 2 && segs[0] === "embed") return segs[1] ?? null;
    return null;
  },
  spotify: (_url, segs) => {
    let rest = segs;
    if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(rest[0] ?? "")) {
      rest = rest.slice(1);
    }
    if (rest[0] === "embed") rest = rest.slice(1);
    return rest.length === 2 ? `${rest[0]}/${rest[1]}` : null;
  },
  soundcloud: (url, segs, depth) => {
    if (url.hostname === "w.soundcloud.com") {
      if (depth > 0 || segs.join("/") !== "player") return null;
      const inner = url.searchParams.get("url");
      if (!inner) return null;
      const parsed = parseUrl(inner, 1);
      return parsed && parsed.provider === "soundcloud" ? parsed.id : null;
    }
    if (url.hostname === "api.soundcloud.com") {
      const id = segs.join("/");
      return SC_API.test(id) ? id : null;
    }
    const id = segs.join("/");
    return SC_API.test(id) ? null : id;
  },
  "apple-podcasts": (url, segs) => {
    if (segs.length !== 4 || segs[1] !== "podcast") return null;
    const show = /^id(\d{1,20})$/.exec(segs[3] ?? "");
    if (!show) return null;
    const episode = url.searchParams.get("i");
    return `${segs[0]}/${segs[2]}/${show[1]}${episode ? `/${episode}` : ""}`;
  },
  calendly: (_url, segs) =>
    segs.length === 1 || segs.length === 2 ? segs.join("/") : null,
  "google-calendar": (url, segs) => {
    if (segs[0] !== "calendar") return null;
    const src = url.searchParams.get("src");
    if (src) return src;
    const cid = url.searchParams.get("cid");
    if (cid) {
      if (GCAL_ID.test(cid)) return cid;
      try {
        return atob(cid);
      } catch {
        return null;
      }
    }
    if (segs.length === 5 && segs[1] === "ical" && segs[3] === "public") {
      try {
        return decodeURIComponent(segs[2] ?? "");
      } catch {
        return null;
      }
    }
    return null;
  },
};

// ---- parsing -------------------------------------------------------------------------------

// Whitespace, ASCII control chars and backslashes are never part of a link we accept.
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f\\]/;
const SPOTIFY_URI =
  /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{22})$/;
const BARE_HOST = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,5}\//i;
const IFRAME_SRC =
  /\ssrc\s{0,8}=\s{0,8}(?:"([^"<>]{1,2048})"|'([^'<>]{1,2048})')/i;

/** The first <iframe> tag's quoted src, entity-decoded; every other byte of HTML dropped. */
function iframeSrc(html: string): string | null {
  const start = html.toLowerCase().indexOf("<iframe");
  if (start === -1) return null;
  const end = html.indexOf(">", start);
  const tag = html.slice(start, end === -1 ? undefined : end);
  const m = IFRAME_SRC.exec(tag);
  const src = m ? (m[1] ?? m[2]) : undefined;
  if (!src) return null;
  return src
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .trim();
}

function parseUrl(
  raw: string,
  depth: number,
): { provider: MediaProvider; id: string } | null {
  let s = raw;
  if (s.startsWith("//")) s = `https:${s}`;
  if (s.length > MAX_URL || UNSAFE_CHARS.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.includes("xn--")) return null;
  const provider = providerForHost(host);
  if (!provider) return null;
  const segs = url.pathname.split("/").filter((p) => p !== "");
  const id = EXTRACT[provider](url, segs, depth);
  return typeof id === "string" ? { provider, id } : null;
}

export function parseMediaLink(input: unknown): MediaLinkResult {
  if (typeof input !== "string") return { ok: false, reason: "not-a-link" };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_INPUT) return { ok: false, reason: "not-allowed" };

  let candidate = trimmed;
  if (/<iframe/i.test(trimmed)) {
    const src = iframeSrc(trimmed);
    if (!src) return { ok: false, reason: "not-allowed" };
    candidate = src;
  } else if (trimmed.includes("<")) {
    return { ok: false, reason: "not-a-link" };
  }

  const uri = SPOTIFY_URI.exec(candidate);
  if (uri) {
    const link = build("spotify", `${uri[1]}/${uri[2]}`);
    return link ? { ok: true, link } : { ok: false, reason: "not-allowed" };
  }

  // A link pasted without its scheme ("youtu.be/…") is read as https (D119: less friction).
  if (BARE_HOST.test(candidate)) candidate = `https://${candidate}`;
  if (!/^(?:https?:)?\/\//i.test(candidate)) {
    // Not an http(s) link at all: prose, javascript:, data:, file: ...
    return /^[a-z][a-z0-9+.-]{0,30}:/i.test(candidate)
      ? { ok: false, reason: "not-allowed" }
      : { ok: false, reason: "not-a-link" };
  }
  const found = parseUrl(candidate, 0);
  const link = found ? build(found.provider, found.id) : null;
  return link ? { ok: true, link } : { ok: false, reason: "not-allowed" };
}

/** Rebuild a stored `{ provider, provider_id }` pair, re-validating the id (T-07-08-03). */
export function mediaLinkFrom(
  provider: unknown,
  id: unknown,
): MediaLink | null {
  if (typeof provider !== "string" || typeof id !== "string") return null;
  if (!Object.hasOwn(PROVIDERS, provider)) return null;
  return build(provider as MediaProvider, id);
}

const COPY: Readonly<
  Record<MediaLinkCategory, { empty: string; refused: string }>
> = Object.freeze({
  video: { empty: VIDEO_LINK_EMPTY_COPY, refused: LINK_NOT_ALLOWED_COPY },
  audio: { empty: AUDIO_LINK_EMPTY_COPY, refused: AUDIO_NOT_ALLOWED_COPY },
  embed: { empty: EMBED_LINK_EMPTY_COPY, refused: EMBED_NOT_ALLOWED_COPY },
});

/** Parse for one category, throwing the category's copy on anything else. */
export function parseMediaLinkFor(
  category: MediaLinkCategory,
  input: unknown,
): MediaLink {
  const result = parseMediaLink(input);
  const copy = COPY[category];
  if (result.ok) {
    if (result.link.category === category) return result.link;
    throw new InvalidInput(copy.refused);
  }
  throw new InvalidInput(result.reason === "empty" ? copy.empty : copy.refused);
}
