// Signed one-tap rating links (STAFF-21, D212; 13-16 choice 3; RESEARCH Pitfall 10). The
// Resolved email carries two links:
//   /hub/support/tickets/<n>/rate?t=<threadId>&r=<up|down>&e=<exp ms>&sig=<mac>
// with mac = base64url(HMAC-SHA256(linkSecret(), "rating.<threadId>.<choice>.<exp>")). The
// `rating.` purpose prefix keeps these MACs apart from every other link signed with the same
// secret (a `support-file.` MAC never verifies here, and the reverse). Links last 14 days.
// A link only lands on a page: the page verifies and shows the choice preselected, and the
// rating is written by a POST (13-42), never by the GET (email scanners prefetch links).
// Verification is timing-safe and never throws.
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput } from "@cds/core";
import { isRatingChoice, type RatingChoice } from "@cds/core/support";
import { linkSecret } from "../email/env";

/** How long a rating link lasts (CONTEXT Area 5: 14 days). */
export const RATING_LINK_MS = 14 * 24 * 60 * 60 * 1000;

const ID_RE = /^[a-z0-9]{15}$/;
const EXP_RE = /^\d{1,15}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

function mac(
  threadId: string,
  choice: RatingChoice,
  expiresAt: number,
): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`rating.${threadId}.${choice}.${expiresAt}`)
    .digest();
}

/** The MAC for one ticket thread, choice and expiry (ms since epoch). */
export function signRatingLink(
  threadId: string,
  choice: RatingChoice,
  expiresAt: number,
): string {
  if (typeof threadId !== "string" || !ID_RE.test(threadId)) {
    throw new InvalidInput("invalid ticket id");
  }
  if (!isRatingChoice(choice)) throw new InvalidInput("invalid rating");
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new InvalidInput("invalid link expiry");
  }
  return mac(threadId, choice, expiresAt).toString("base64url");
}

/** The root-relative hub link for one choice, valid 14 days from `now`. */
export function ratingLinkPath(
  number: number,
  threadId: string,
  choice: RatingChoice,
  now: Date | number = Date.now(),
): string {
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new InvalidInput("invalid ticket number");
  }
  const t = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t)) throw new InvalidInput("now must be a valid date");
  const exp = t + RATING_LINK_MS;
  const sig = signRatingLink(threadId, choice, exp);
  return `/hub/support/tickets/${number}/rate?t=${threadId}&r=${choice}&e=${exp}&sig=${sig}`;
}

export type RatingLinkState = "valid" | "expired" | "invalid";

/**
 * "valid" for an untampered, unexpired link; "expired" for an untampered link past its expiry;
 * "invalid" for anything else (malformed, tampered, another purpose's MAC).
 */
export function ratingLinkState(
  threadId: unknown,
  choice: unknown,
  exp: unknown,
  sig: unknown,
  now: number = Date.now(),
): RatingLinkState {
  if (typeof threadId !== "string" || !ID_RE.test(threadId)) return "invalid";
  if (!isRatingChoice(choice)) return "invalid";
  const expRaw = typeof exp === "number" ? String(exp) : exp;
  if (typeof expRaw !== "string" || !EXP_RE.test(expRaw)) return "invalid";
  if (typeof sig !== "string" || !SIG_RE.test(sig)) return "invalid";
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return "invalid";
  const given = Buffer.from(sig, "base64url");
  if (given.toString("base64url") !== sig) return "invalid";
  const expected = mac(threadId, choice, expiresAt);
  if (given.length !== expected.length) return "invalid";
  if (!timingSafeEqual(given, expected)) return "invalid";
  return expiresAt > now ? "valid" : "expired";
}
