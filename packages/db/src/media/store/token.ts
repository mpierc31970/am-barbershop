// Protected-page media tokens for the app stand-in (07-09, CONT-33, D255). Bunny uses its own
// token auth (07-10). Token = base64url(HMAC-SHA256(secret, "media.v1|org|asset|variant|exp")),
// bound to one org + asset + variant, valid for about an hour. The secret fails closed in
// production (copies linkSecret()). Verification never throws: anything malformed is false.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PublicMediaVariant } from "../ports";

const DEV_MEDIA_SECRET =
  "cds-dev-only-media-token-secret-never-used-in-production";
const MIN_SECRET = 32;

/** Token lifetime (1 h, CONTEXT Area 1 Q3). */
export const MEDIA_TOKEN_TTL_S = 3600;
/** `exp` is rounded up to this boundary so a protected page's URLs stay stable (choice 7). */
export const MEDIA_TOKEN_BUCKET_S = 600;

export type MediaTokenRef = {
  orgId: string;
  assetId: string;
  variant: PublicMediaVariant;
};

const EXP_RE = /^\d{1,12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Internal to @cds/db: also the root of the 07-32 page-gate cookie key (derived, never reused raw). */
export function mediaTokenSecret(): string {
  const s = process.env.CDS_MEDIA_TOKEN_SECRET;
  const production = process.env.CDS_ENV === "production";
  if (s !== undefined && s !== "") {
    if (production && s.length < MIN_SECRET) {
      throw new Error(
        `CDS_MEDIA_TOKEN_SECRET must be at least ${MIN_SECRET} characters in production`,
      );
    }
    return s;
  }
  if (production) {
    throw new Error("CDS_MEDIA_TOKEN_SECRET must be set in production");
  }
  return DEV_MEDIA_SECRET;
}

function mac(ref: MediaTokenRef, exp: number): Buffer {
  return createHmac("sha256", mediaTokenSecret())
    .update(`media.v1|${ref.orgId}|${ref.assetId}|${ref.variant}|${exp}`)
    .digest();
}

/** Internal to @cds/db: tokens are minted only through appDelivery.urlFor. */
export function signMediaToken(ref: MediaTokenRef & { exp: number }): string {
  if (!Number.isSafeInteger(ref.exp) || ref.exp < 0) {
    throw new Error("invalid media token expiry");
  }
  return mac(ref, ref.exp).toString("base64url");
}

export function verifyMediaToken(
  ref: MediaTokenRef,
  e: string | null | undefined,
  t: string | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof e !== "string" || !EXP_RE.test(e)) return false;
  if (typeof t !== "string" || !TOKEN_RE.test(t)) return false;
  const exp = Number(e);
  if (!(exp > nowSec)) return false;
  if (exp - nowSec > MEDIA_TOKEN_TTL_S + MEDIA_TOKEN_BUCKET_S) return false;
  const given = Buffer.from(t, "base64url");
  if (given.toString("base64url") !== t) return false;
  const expected = mac(ref, exp);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
