// Charge confirm tokens (CR-C01, WR-D03; D-UI-P10-14: never charge a figure the owner did not
// see). Internal to @cds/db: minted by the server previews (`previewPack`, `previewCarePlan`,
// `previewAddonCharge`) and read back by the charges and the BillingGate.
//
// A token binds one confirm to the preview the owner saw:
//   - org and item ("pack:media-5gb", "care", "addon:testimonials");
//   - the state it was previewed from (`basis`: the pack quantity before; 0 otherwise), so a
//     retry after the first charge applied (lost response, double click, second tab) is
//     recognised as already done instead of buying again;
//   - the Today and Then figures, so a price that moved since the preview is refused
//     ("price changed") instead of charged;
//   - the preview instant `at`, sent to the provider as the proration date (Stripe
//     `proration_date`), so the charge prorates exactly as previewed;
//   - a nonce, used in the provider idempotency key: a retry of the same confirm can never
//     charge twice, and a new preview (after a decline) is a new attempt.
// Format: base64url(JSON claims) + "." + base64url(HMAC-SHA256(key, payload)), with the key
// derived from CDS_MEDIA_TOKEN_SECRET (no new secret, like the page-gate cookie). A token is
// good for 15 minutes; reading never throws, anything malformed, foreign or stale is null.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mediaTokenSecret } from "../media/store/token";

/** How long a preview may be confirmed (seconds). */
export const CHARGE_TOKEN_TTL_S = 15 * 60;
/** Clock skew allowed for a token minted "in the future" by another app instance. */
const SKEW_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{43}$/;

/** UI-SPEC PRICE-CHANGED for saved-card charges (the checkout has its own). */
export const CHARGE_PRICE_CHANGED_COPY =
  "The price changed since you opened this. Check the new figure, then confirm again.";

export type ChargeTokenClaims = {
  orgId: string;
  /** "pack:media-5gb" | "care" | "addon:<slug>". */
  item: string;
  /** The state previewed from: the pack quantity before the add; 0 otherwise. */
  basis: number;
  todayCents: number;
  thenCents: number;
  /** The preview instant (epoch ms); the proration date sent to the provider. */
  at: number;
  nonce: string;
};

let memo: { secret: string; key: Buffer } | null = null;

function tokenKey(): Buffer {
  const secret = mediaTokenSecret();
  if (memo?.secret !== secret) {
    memo = {
      secret,
      key: createHmac("sha256", secret).update("cds.charge-token.v1").digest(),
    };
  }
  return memo.key;
}

function mac(payload: string): Buffer {
  return createHmac("sha256", tokenKey()).update(payload).digest();
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** A fresh token for one preview (a new nonce every time). */
export function mintChargeToken(
  claims: Omit<ChargeTokenClaims, "nonce">,
): string {
  const body: ChargeTokenClaims = { ...claims, nonce: randomUUID() };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

/**
 * The claims of a token minted for this org and item, still inside its 15 minutes; null for
 * anything else (missing, malformed, tampered, another org's or item's, expired).
 */
export function readChargeToken(
  token: unknown,
  expect: { orgId: string; item: string },
  now: Date,
): ChargeTokenClaims | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  if (!TOKEN_RE.test(token)) return null;
  const [payload, sig] = token.split(".") as [string, string];
  const given = Buffer.from(sig, "base64url");
  const want = mac(payload);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null;
  }
  let c: Partial<ChargeTokenClaims>;
  try {
    c = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<ChargeTokenClaims>;
  } catch {
    return null;
  }
  if (
    c.orgId !== expect.orgId ||
    c.item !== expect.item ||
    !isCount(c.basis) ||
    !isCount(c.todayCents) ||
    !isCount(c.thenCents) ||
    !isCount(c.at) ||
    typeof c.nonce !== "string" ||
    !/^[0-9a-f-]{36}$/.test(c.nonce)
  ) {
    return null;
  }
  const t = now.getTime();
  if (c.at > t + SKEW_MS || t - c.at > CHARGE_TOKEN_TTL_S * 1000) return null;
  return c as ChargeTokenClaims;
}
