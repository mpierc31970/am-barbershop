// Render-time URL guards for the public site (T-03-26; CONT-09 defence in depth).
//
// Stored content is validated on save and publish (safeHref / safeImageUrl in
// @cds/core/content), but the renderer does not trust that: a row written around the
// validators must still never put javascript:, data: or a protocol-relative URL into an
// href or src. These wrap the same validators and swallow their InvalidInput, so a bad
// value is dropped ("") rather than crashing a visitor's page.
import { safeHref, safeImageUrl } from "@cds/core/content";

/** A safe href (site path, http(s), mailto, tel) or "" when the value is unsafe. */
export function siteHref(value: unknown): string {
  try {
    return safeHref(value);
  } catch {
    return "";
  }
}

/** A safe image src (absolute http(s)) or "" when the value is unsafe. */
export function siteImageSrc(value: unknown): string {
  try {
    return safeImageUrl(value);
  } catch {
    return "";
  }
}

/** A tel: href from a displayed phone number: the shared core helper (CR-B02). */
export { telHref } from "@cds/core/content";

/** Non-blank trimmed string, else "". */
export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
