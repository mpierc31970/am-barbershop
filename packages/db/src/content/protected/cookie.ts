// The page-gate cookie (CONT-28, D235 #12; 07-32 choice 4; T-07-32-02).
// invariant 1: org from the context only; never return or log a hash, a password or a cookie.
//
// Name `cds_pp_<pageId>`, value `<exp>.<sig>` where
//   sig = base64url(HMAC-SHA256(gateKey, "gate.v1|<org>|<page>|<version>|<exp>"))
//   gateKey = HMAC-SHA256(mediaTokenSecret(), "cds.page-gate.v1")
// The key is derived from CDS_MEDIA_TOKEN_SECRET (no new secret): rotating it signs every
// visitor out of protected pages. The page's password_version is in the MAC, so changing
// the password invalidates every cookie already handed out. exp is capped at 12 h ahead
// server-side; verification never throws.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mediaTokenSecret } from "../../media/store/token";

/** Cookie lifetime: 12 hours. */
export const GATE_COOKIE_TTL_S = 43200;
export const GATE_COOKIE_PREFIX = "cds_pp_";

const ID_RE = /^[a-z0-9]{15}$/;
const EXP_RE = /^\d{1,12}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

let memo: { secret: string; key: Buffer } | null = null;

function gateKey(): Buffer {
  const secret = mediaTokenSecret();
  if (memo?.secret !== secret) {
    memo = {
      secret,
      key: createHmac("sha256", secret).update("cds.page-gate.v1").digest(),
    };
  }
  return memo.key;
}

function mac(
  orgId: string,
  pageId: string,
  version: number,
  exp: number,
): Buffer {
  return createHmac("sha256", gateKey())
    .update(`gate.v1|${orgId}|${pageId}|${version}|${exp}`)
    .digest();
}

/** `cds_pp_<pageId>`; throws on anything but a record id. */
export function gateCookieName(pageId: string): string {
  if (typeof pageId !== "string" || !ID_RE.test(pageId)) {
    throw new Error("invalid page id");
  }
  return `${GATE_COOKIE_PREFIX}${pageId}`;
}

export type GateCookie = { name: string; value: string; maxAge: number };

/** A fresh cookie for one org + page + password version, valid 12 h from `now`. */
export function mintGateCookie(input: {
  orgId: string;
  pageId: string;
  version: number;
  now: Date;
}): GateCookie {
  const name = gateCookieName(input.pageId);
  const exp = Math.floor(input.now.getTime() / 1000) + GATE_COOKIE_TTL_S;
  const sig = mac(input.orgId, input.pageId, input.version, exp).toString(
    "base64url",
  );
  return { name, value: `${exp}.${sig}`, maxAge: GATE_COOKIE_TTL_S };
}

/** True only for a cookie minted for exactly this org, page and version, not expired. */
export function gateCookieValid(input: {
  orgId: string;
  pageId: string;
  version: number;
  value: string | null | undefined;
  now: Date;
}): boolean {
  try {
    const { value } = input;
    if (typeof value !== "string" || value === "") return false;
    const dot = value.indexOf(".");
    if (dot < 0) return false;
    const expStr = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    if (!EXP_RE.test(expStr) || !SIG_RE.test(sig)) return false;
    if (!ID_RE.test(input.pageId)) return false;
    const exp = Number(expStr);
    const nowS = Math.floor(input.now.getTime() / 1000);
    if (exp <= nowS || exp > nowS + GATE_COOKIE_TTL_S) return false;
    const want = mac(input.orgId, input.pageId, input.version, exp);
    const got = Buffer.from(sig, "base64url");
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}
