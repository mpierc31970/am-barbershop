// Page URL helpers for the Pages tab (CONT-30; UI-SPEC "Pages tab", Copywriting slug rows).
// Pure and client-safe: the Add page row validates live with these, so they cannot import
// @cds/db (it would pull the database client into the browser bundle). SLUG_PATTERN must
// equal @cds/db's SLUG_RE (a test checks), and the reserved list is passed in from the
// server. The database re-validates every write; this is only the fast feedback.
import { formatShortUtc } from "@cds/core/content";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 64;
export const HOME_SLUG = "home";

const FORMAT_COPY =
  "Use lowercase letters, numbers and hyphens, like /our-story.";

/** "About Us" -> "about-us": accents dropped, anything else becomes one hyphen. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** What the owner typed in the URL field, tidied: no leading slash, lowercase, spaces to hyphens. */
export function tidySlugInput(raw: string): string {
  return raw.replace(/^\/+/, "").toLowerCase().replace(/\s+/g, "-");
}

/** The UI-SPEC error for a slug, or null when it is fine. */
export function slugError(
  slug: string,
  opts: { reserved: readonly string[]; taken: readonly string[] },
): string | null {
  const s = slug.trim().replace(/^\/+/, "");
  if (opts.reserved.includes(s.toLowerCase())) {
    return `/${s.toLowerCase()} is used by the system. Pick another address.`;
  }
  if (s === "" || s.length > SLUG_MAX || !SLUG_PATTERN.test(s)) {
    return FORMAT_COPY;
  }
  if (opts.taken.includes(s)) {
    const suggestion = `${s.slice(0, SLUG_MAX - 2).replace(/-+$/, "")}-2`;
    return `Another page already uses /${s}. Try /${suggestion}.`;
  }
  return null;
}

/** The page's public path: "/" for home, else "/<slug>". */
export function pagePath(slug: string): string {
  return slug === HOME_SLUG ? "/" : `/${slug}`;
}

/** "12 Sep, 2:14 pm" (UTC until organizations carry a time zone), or "—" if never published. */
export function formatLastPublished(iso: string | null): string {
  if (!iso) return "—";
  return formatShortUtc(iso) || "—";
}
