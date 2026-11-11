// One consent rule (CONT-34, D279; CONTEXT Area 2 row 3; owner 07-14).
//
// Every third-party frame (video links, audio links, booking calendars, maps) waits behind a
// click-to-load placeholder. This module is the pure half:
// - framesIn / consentNeeds / needsConsent: what a site loads from other companies, found by
//   a bounded deep walk over stored page sections and enabled pop-ups (choice 4). Depth ≤ 12,
//   nodes ≤ 20 000, own keys only, so hostile JSON cannot stall a render (T-07-14-04). A
//   walk cut off by the node budget fails closed: the notice is needed (WR-B03). Gallery
//   photo lists are never walked; they cannot hold frames.
// - consentFrameUrl / mapFrameUrl: the browser builds the frame URL from { provider, id } (or
//   a map query) only after consent; the server never ships it (choice 1, Pitfall 7).
// - cookieText / consentStatusText / consentLine: visitor and owner copy (choice 11).
// - CONSENT_COOKIE / parseConsentChoice: the first-party `cds_consent` cookie, exact-match
//   parse (T-07-14-03).
// GA4 counts from 11-32 (DASH-11): the site cache passes whether the org has a measurement id.
// Pure and Edge-safe: imports only from ../media-link.
import {
  AUDIO_PROVIDERS,
  EMBED_PROVIDERS,
  PROVIDER_FRAME_HOSTS,
  PROVIDER_LABELS,
  VIDEO_PROVIDERS,
  mediaLinkFrom,
  type MediaProvider,
} from "../media-link";

export const CONSENT_COOKIE = "cds_consent";
/** 180 days, in seconds. */
export const CONSENT_MAX_AGE_S = 15_552_000;

export type ConsentChoice = "all" | "necessary";

/** Exact match only: anything else (case, whitespace, undefined) is no choice. */
export function parseConsentChoice(value: unknown): ConsentChoice | null {
  return value === "all" || value === "necessary" ? value : null;
}

export type ConsentFrameKind = "video" | "audio" | "booking" | "map";
export const MAP_PROVIDER = "google-maps";
export const MAP_PROVIDER_LABEL = "Google Maps";

export interface ConsentFrameUse {
  kind: ConsentFrameKind;
  provider: string;
}

export type ConsentFrameSource =
  | { kind: "link"; provider: string; id: string }
  | { kind: "map"; query: string; key?: string };

/** Every host a consent frame may load from (the SSR scan checks server markup for these). */
export const CONSENT_FRAME_HOSTS: readonly string[] = Object.freeze([
  ...PROVIDER_FRAME_HOSTS,
  "maps.google.com",
  "www.google.com",
]);

/** iframe `allow` per kind; "" = no allow attribute. */
export const FRAME_ALLOW: Readonly<Record<ConsentFrameKind, string>> =
  Object.freeze({
    video: "autoplay; encrypted-media; picture-in-picture; fullscreen",
    audio: "autoplay; encrypted-media",
    booking: "",
    map: "",
  });

const MAX_QUERY = 500;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A Maps Embed API browser key (07-24 exports it for the db MapEmbed adapter). */
export const MAP_EMBED_KEY_RE = /^[A-Za-z0-9_-]{20,100}$/;
const MAP_KEY = MAP_EMBED_KEY_RE;

function cleanQuery(query: unknown): string | null {
  if (typeof query !== "string") return null;
  const q = query.trim();
  if (q === "" || q.length > MAX_QUERY || CONTROL.test(q)) return null;
  return q;
}

/** The Google Maps frame URL for an address; with a valid browser key, the Embed API. */
export function mapFrameUrl(query: unknown, key?: unknown): string | null {
  const q = cleanQuery(query);
  if (q === null) return null;
  const enc = encodeURIComponent(q);
  if (typeof key === "string" && MAP_KEY.test(key)) {
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${enc}`;
  }
  return `https://maps.google.com/maps?q=${enc}&output=embed`;
}

/** The plain Google Maps page for an address (the no-JS map link). */
export function mapPlaceUrl(query: unknown): string | null {
  const q = cleanQuery(query);
  if (q === null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Build a frame URL in the browser after consent; null for anything invalid. */
export function consentFrameUrl(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const s = source as Record<string, unknown>;
  if (s.kind === "link") {
    return mediaLinkFrom(s.provider, s.id)?.embedUrl ?? null;
  }
  if (s.kind === "map") return mapFrameUrl(s.query, s.key);
  return null;
}

// ---- detection ------------------------------------------------------------------------------

const MAX_DEPTH = 12;
const MAX_NODES = 20_000;
const KIND_ORDER: readonly ConsentFrameKind[] = [
  "video",
  "audio",
  "booking",
  "map",
];

function isOneOf(list: readonly string[], value: unknown): value is string {
  return (
    typeof value === "string" &&
    Object.hasOwn(PROVIDER_LABELS, value) &&
    list.includes(value)
  );
}

function frameOf(node: Record<string, unknown>): ConsentFrameUse | null {
  // A&M fork: the map block renders MapLibre + OpenFreeMap (no third-party cookies), so it
  // no longer needs consent.
  const kind = node.kind;
  if (kind === "video" && node.source === "link") {
    return isOneOf(VIDEO_PROVIDERS, node.provider)
      ? { kind: "video", provider: node.provider }
      : null;
  }
  if (kind === "audio" && node.source === "link") {
    return isOneOf(AUDIO_PROVIDERS, node.provider)
      ? { kind: "audio", provider: node.provider }
      : null;
  }
  if (kind === "embed") {
    return isOneOf(EMBED_PROVIDERS, node.provider)
      ? { kind: "booking", provider: node.provider }
      : null;
  }
  return null;
}

/** The bounded walk; `truncated` when the node budget ran out before the end. */
function walkFrames(value: unknown): {
  frames: ConsentFrameUse[];
  truncated: boolean;
} {
  const found = new Map<string, ConsentFrameUse>();
  // [node, depth, whether node is a gallery section's content (its `images` are skipped)]
  const stack: [unknown, number, boolean][] = [[value, 0, false]];
  let nodes = 0;
  let truncated = false;
  while (stack.length > 0) {
    const [node, depth, galleryContent] = stack.pop() as [
      unknown,
      number,
      boolean,
    ];
    if (!node || typeof node !== "object") continue;
    nodes += 1;
    if (nodes > MAX_NODES) {
      truncated = true;
      break;
    }
    const rec = Array.isArray(node) ? null : (node as Record<string, unknown>);
    if (rec) {
      const use = frameOf(rec);
      if (use) found.set(`${use.kind}:${use.provider}`, use);
    }
    if (depth >= MAX_DEPTH) continue;
    const gallery = rec?.section_type === "gallery";
    const entries: [string, unknown][] = rec
      ? Object.keys(rec).map((k) => [k, rec[k]])
      : (node as unknown[]).map((c, i) => [String(i), c]);
    // Reverse push keeps document order for the pop()-based walk.
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [key, child] = entries[i];
      if (!child || typeof child !== "object") continue;
      if (galleryContent && key === "images") continue;
      stack.push([child, depth + 1, gallery && key === "content"]);
      if (stack.length > MAX_NODES) {
        truncated = true;
        break;
      }
    }
  }
  const frames = KIND_ORDER.flatMap((kind) =>
    [...found.values()].filter((u) => u.kind === kind),
  );
  return { frames, truncated };
}

/** Every third-party frame in a stored JSON value (bounded walk; duplicates collapse). */
export function framesIn(value: unknown): ConsentFrameUse[] {
  return walkFrames(value).frames;
}

export interface ConsentNeedsInput {
  /** Each published page's `sections`. */
  pages: readonly unknown[];
  /** Raw pop-up records; only `enabled === true` ones count (their `content` is walked). */
  popups: readonly unknown[];
  /** A GA4 measurement id is set (DASH-11, 11-32); GA4 loads only on "all". */
  analytics: boolean;
}

export interface ConsentNeeds {
  needed: boolean;
  frames: ConsentFrameUse[];
  analytics: boolean;
  /** The walk hit its node budget: more may load from other companies (fails closed). */
  truncated?: true;
}

export function consentNeeds(input: ConsentNeedsInput): ConsentNeeds {
  const pages = Array.isArray(input?.pages) ? input.pages : [];
  const popups = (Array.isArray(input?.popups) ? input.popups : [])
    .filter(
      (p): p is Record<string, unknown> =>
        !!p &&
        typeof p === "object" &&
        (p as Record<string, unknown>).enabled === true,
    )
    .map((p) => p.content);
  const { frames, truncated } = walkFrames([...pages, ...popups]);
  const analytics = input?.analytics === true;
  const needs: ConsentNeeds = {
    needed: frames.length > 0 || analytics || truncated,
    frames,
    analytics,
  };
  if (truncated) needs.truncated = true;
  return needs;
}

export function needsConsent(input: ConsentNeedsInput): boolean {
  return consentNeeds(input).needed;
}

// ---- copy -----------------------------------------------------------------------------------

const KIND_NOUNS: Readonly<Record<ConsentFrameKind, string>> = Object.freeze({
  video: "videos",
  audio: "audio players",
  booking: "booking calendars",
  map: "maps",
});

/** The noun for frames past a truncated walk (WR-B03). */
const OTHER_CONTENT = "content";

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function kindsOf(frames: readonly ConsentFrameUse[]): ConsentFrameKind[] {
  return KIND_ORDER.filter((k) => frames.some((f) => f.kind === k));
}

/** COOKIE-TEXT: the banner sentence, built from what the site uses; "" when nothing. */
export function cookieText(needs: ConsentNeeds): string {
  const frames = Array.isArray(needs?.frames) ? needs.frames : [];
  const kinds = kindsOf(frames).map((k) => KIND_NOUNS[k]);
  if (needs?.truncated === true) kinds.push(OTHER_CONTENT);
  const tail = "Choose what to allow.";
  if (kinds.length > 0 && needs.analytics) {
    return `This site uses cookies for embedded ${joinList(kinds)}, and for visitor statistics, from other companies. ${tail}`;
  }
  if (kinds.length > 0) {
    return `This site uses cookies for embedded ${joinList(kinds)} from other companies. ${tail}`;
  }
  if (needs?.analytics) {
    return `This site uses cookies for visitor statistics from other companies. ${tail}`;
  }
  return "";
}

export function providerLabel(provider: string): string {
  if (provider === MAP_PROVIDER) return MAP_PROVIDER_LABEL;
  return Object.hasOwn(PROVIDER_LABELS, provider)
    ? PROVIDER_LABELS[provider as MediaProvider]
    : provider;
}

function article(word: string): string {
  return /^[AEIOU]/.test(word) || word === "X" ? "an" : "a";
}

function usePhrase(use: ConsentFrameUse): string {
  if (use.kind === "map") return "a map";
  const label = providerLabel(use.provider);
  const noun =
    use.kind === "video"
      ? "video"
      : use.kind === "audio"
        ? "audio player"
        : "booking calendar";
  return `${article(label)} ${label} ${noun}`;
}

/** Owner-facing status line for Site settings (07-26). */
export function consentStatusText(needs: ConsentNeeds): string {
  if (!needs?.needed) {
    return "No cookie notice needed: your site doesn't load anything from other companies.";
  }
  const phrases = (Array.isArray(needs.frames) ? needs.frames : []).map(
    usePhrase,
  );
  if (needs.truncated === true) {
    phrases.push("embedded content from other companies");
  }
  if (needs.analytics) phrases.push("visitor statistics");
  const list =
    phrases.length > 3
      ? `${phrases.slice(0, 3).join(", ")} and more`
      : joinList(phrases);
  return `Your site shows a cookie notice because it has ${list}.`;
}

/** The one-line note under a placeholder. */
export function consentLine(kind: ConsentFrameKind, label: string): string {
  return kind === "video"
    ? `Plays from ${label}, which may set cookies.`
    : `Loads ${label}, which may set cookies.`;
}
