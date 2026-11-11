// Signed "Download my data" links (LIFE-04, D284, D285; 11-40 choice 6). The link is
// /hub/api/data-download/<id>?exp=<ms>&sig=<mac>, with mac = base64url(HMAC-SHA256(
// linkSecret(), "data-download.<id>.<exp>")). The purpose prefix keeps these MACs apart from
// every other link signed with the same secret. Verification is timing-safe, never throws,
// and refuses an expired link. A valid link alone is not enough: the download route also
// requires the Owner's session (11-41, T-11-40-04).
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput } from "@cds/core";
import { linkSecret } from "../email/env";

/** How long a ready download (and its link) lasts (D284). */
export const DOWNLOAD_LINK_DAYS = 7;

const ID_RE = /^[a-z0-9]{15}$/;
const EXP_RE = /^\d{1,15}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

function mac(id: string, expiresAt: number): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`data-download.${id}.${expiresAt}`)
    .digest();
}

/** The MAC for one download id and its expiry (ms since epoch). */
export function signDownloadLink(id: string, expiresAt: number): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new InvalidInput("invalid download id");
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new InvalidInput("invalid download expiry");
  }
  return mac(id, expiresAt).toString("base64url");
}

/** The root-relative link path the email and the hub panel use. */
export function downloadLinkPath(id: string, expiresAt: number): string {
  const sig = signDownloadLink(id, expiresAt);
  return `/hub/api/data-download/${id}?exp=${expiresAt}&sig=${sig}`;
}

/**
 * True only for an untampered, unexpired link. `exp` is the query value as given (string or
 * number); anything malformed is false.
 */
export function verifyDownloadLink(
  id: unknown,
  exp: unknown,
  sig: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof id !== "string" || !ID_RE.test(id)) return false;
  const expRaw = typeof exp === "number" ? String(exp) : exp;
  if (typeof expRaw !== "string" || !EXP_RE.test(expRaw)) return false;
  if (typeof sig !== "string" || !SIG_RE.test(sig)) return false;
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt)) return false;
  const given = Buffer.from(sig, "base64url");
  if (given.toString("base64url") !== sig) return false;
  const expected = mac(id, expiresAt);
  if (given.length !== expected.length) return false;
  if (!timingSafeEqual(given, expected)) return false;
  return expiresAt > now;
}
