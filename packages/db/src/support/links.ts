// Signed support-file links (COMM-04; 12-07 choice 5; RESEARCH Pattern 5). The link is
// /hub/api/support-file/<id>?exp=<ms>&sig=<mac>, with mac = base64url(HMAC-SHA256(
// linkSecret(), "support-file.<id>.<exp>")). The purpose prefix keeps these MACs apart from
// every other link signed with the same secret (a data-download. MAC never verifies here).
// A link lasts 15 minutes and is minted on click, never rendered into HTML. Verification is
// timing-safe and never throws. A valid link alone is not enough: the download route also
// requires a hub session with support:read in the file's org (T-12-07-02).
import { createHmac, timingSafeEqual } from "node:crypto";
import { CdsError, InvalidInput } from "@cds/core";
import { linkSecret } from "../email/env";

/** How long a support-file link lasts (CONTEXT Area 2: 15 minutes). */
export const SUPPORT_FILE_LINK_MS = 15 * 60 * 1000;

/** The link is genuine but past its 15 minutes (the route shows the expired page). */
export class SupportLinkExpired extends CdsError {
  override readonly code = "support_link_expired";
}

const ID_RE = /^[a-z0-9]{15}$/;
const EXP_RE = /^\d{1,15}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

function mac(id: string, expiresAt: number): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`support-file.${id}.${expiresAt}`)
    .digest();
}

/** The MAC for one file id and its expiry (ms since epoch). */
export function signSupportFileLink(id: string, expiresAt: number): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new InvalidInput("invalid file id");
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new InvalidInput("invalid link expiry");
  }
  return mac(id, expiresAt).toString("base64url");
}

/** The root-relative link path for the download route. */
export function supportFileLinkPath(id: string, expiresAt: number): string {
  const sig = signSupportFileLink(id, expiresAt);
  return `/hub/api/support-file/${id}?exp=${expiresAt}&sig=${sig}`;
}

export type SupportFileLinkState = "valid" | "expired" | "invalid";

/**
 * "valid" for an untampered, unexpired link; "expired" for an untampered link past its
 * expiry; "invalid" for anything else (malformed, tampered, another purpose's MAC).
 */
export function supportFileLinkState(
  id: unknown,
  exp: unknown,
  sig: unknown,
  now: number = Date.now(),
): SupportFileLinkState {
  if (typeof id !== "string" || !ID_RE.test(id)) return "invalid";
  const expRaw = typeof exp === "number" ? String(exp) : exp;
  if (typeof expRaw !== "string" || !EXP_RE.test(expRaw)) return "invalid";
  if (typeof sig !== "string" || !SIG_RE.test(sig)) return "invalid";
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return "invalid";
  const given = Buffer.from(sig, "base64url");
  if (given.toString("base64url") !== sig) return "invalid";
  const expected = mac(id, expiresAt);
  if (given.length !== expected.length) return "invalid";
  if (!timingSafeEqual(given, expected)) return "invalid";
  return expiresAt > now ? "valid" : "expired";
}

/** True only for an untampered, unexpired link. */
export function verifySupportFileLink(
  id: unknown,
  exp: unknown,
  sig: unknown,
  now: number = Date.now(),
): boolean {
  return supportFileLinkState(id, exp, sig, now) === "valid";
}
