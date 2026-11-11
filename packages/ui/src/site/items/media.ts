// Media map lookup and src guards for site items (07-08; T-07-08-06). 07-17 (image library)
// and 07-23 (video, audio) reuse these.
//
// The media map comes from the page loader, but an item's asset id is tenant data: it is
// looked up as an own property only, so "__proto__" or "constructor" never resolve. A src
// is a same-origin path ("/_media/…") or an absolute https URL; anything else is "".
import type { ResolvedMedia } from "../types";

/** The asset for `id`, own-property lookup only, optionally of one kind; else null. */
export function resolveMedia(
  media: Readonly<Record<string, ResolvedMedia>> | undefined,
  id: unknown,
  kind?: ResolvedMedia["kind"],
): ResolvedMedia | null {
  if (!media || typeof id !== "string" || id === "") return null;
  if (!Object.hasOwn(media, id)) return null;
  const entry = media[id];
  if (!entry || typeof entry !== "object") return null;
  if (kind !== undefined && entry.kind !== kind) return null;
  return entry;
}

// Control characters, whitespace, backslashes and quotes never belong in a media src.
const UNSAFE = /[\u0000- \u007f\\"'<>]/;

/** A same-origin path or an absolute https URL; "" for anything else. */
export function mediaSrc(value: unknown): string {
  if (typeof value !== "string") return "";
  const s = value.trim();
  if (s === "" || s.length > 2048 || UNSAFE.test(s)) return "";
  if (s.startsWith("/")) return s.startsWith("//") ? "" : s;
  try {
    const url = new URL(s);
    return url.protocol === "https:" && url.username === "" ? url.href : "";
  } catch {
    return "";
  }
}

/** A srcset whose every candidate URL passes mediaSrc; "" if any one fails. */
export function mediaSrcSet(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  if (value.length > 8192) return "";
  const out: string[] = [];
  for (const part of value.split(",")) {
    const [url, descriptor, ...rest] = part.trim().split(/\s+/);
    if (rest.length > 0) return "";
    const src = mediaSrc(url);
    if (src === "") return "";
    if (
      descriptor !== undefined &&
      !/^\d{1,5}(?:w|(?:\.\d{1,2})?x)$/.test(descriptor)
    ) {
      return "";
    }
    out.push(descriptor ? `${src} ${descriptor}` : src);
  }
  return out.join(", ");
}
