// Shared helpers for the P7 column item validators (07-08).
//
// Reference ids are strict: a malformed form or asset id throws; it is never replaced with a
// fresh id the way item ids are (safeId), because a minted id would silently point nowhere.
// Pure and Edge-safe.
import { InvalidInput } from "../../errors";
import {
  mediaLinkFrom,
  parseMediaLinkFor,
  type MediaLink,
  type MediaLinkCategory,
} from "../media-link";
import {
  MALFORMED_COPY,
  SAFE_ID,
  own,
  text,
  type Raw,
} from "../validate-helpers";

/**
 * "media" or "link". A pasted `link` forces "link"; otherwise the stored `source`, and when
 * that is missing, "link" only if a provider is set.
 */
export function itemSource(raw: Raw): "media" | "link" {
  const link = own(raw, "link");
  if (typeof link === "string" && link.trim() !== "") return "link";
  const source = own(raw, "source");
  if (source === "media" || source === "link") return source;
  const provider = own(raw, "provider");
  return typeof provider === "string" && provider !== "" ? "link" : "media";
}

/**
 * The provider link of an item, or null when it has none. A raw `link` (a paste: URL or
 * <iframe> code) is parsed for the category and never stored; otherwise the stored
 * `{ provider, provider_id }` pair is re-validated by mediaLinkFrom. A pair that fails,
 * or belongs to another category, throws `refused`.
 */
export function itemLink(
  raw: Raw,
  category: MediaLinkCategory,
  refused: string,
): MediaLink | null {
  const link = own(raw, "link");
  if (typeof link === "string" && link.trim() !== "") {
    return parseMediaLinkFor(category, link);
  }
  const provider = own(raw, "provider");
  const providerId = own(raw, "provider_id");
  const blank = (v: unknown) =>
    v === undefined || v === null || (typeof v === "string" && v === "");
  if (blank(provider) && blank(providerId)) return null;
  const found = mediaLinkFrom(provider, providerId);
  if (!found || found.category !== category) throw new InvalidInput(refused);
  return found;
}

/** A required record id: a SAFE_ID string, trimmed, else InvalidInput(copy). */
export function refId(value: unknown, copy: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s === "" || !SAFE_ID.test(s)) throw new InvalidInput(copy);
  return s;
}

/** An optional record id: "" for undefined, null or blank; otherwise a strict refId. */
export function optionalRefId(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" && value.trim() === "") return "";
  return refId(value, MALFORMED_COPY);
}

/** A required plain-text title (trimmed, capped), else InvalidInput(copy). */
export function requiredTitle(raw: Raw, copy: string): string {
  const title = text(raw, "title");
  if (title === "") throw new InvalidInput(copy);
  return title;
}
