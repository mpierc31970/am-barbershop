// HMAC-signed email links (EMAIL-01, D-UI-P6-15, RFC 8058; T-06-23). Token =
// base64url("purpose|id|exp") + "." + base64url(HMAC-SHA256(secret, payload)). Verification
// recomputes the MAC and compares with timingSafeEqual on equal-length buffers, then checks
// purpose and expiry. Any malformed input is null, never a throw.
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput } from "@cds/core";
import { linkSecret } from "./env";

const ID_RE = /^[A-Za-z0-9:@._-]{1,200}$/;
const PURPOSE_RE = /^[a-z][a-z0-9._-]{0,39}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 1024;

function mac(payload: string): Buffer {
  return createHmac("sha256", linkSecret()).update(payload).digest();
}

export function signLink(purpose: string, id: string, expSec: number): string {
  if (typeof purpose !== "string" || !PURPOSE_RE.test(purpose)) {
    throw new InvalidInput("invalid link purpose");
  }
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new InvalidInput("invalid link id");
  }
  if (!Number.isSafeInteger(expSec) || expSec < 0) {
    throw new InvalidInput("invalid link expiry");
  }
  const payload = `${purpose}|${id}|${expSec}`;
  return `${Buffer.from(payload).toString("base64url")}.${mac(payload).toString("base64url")}`;
}

export function verifyLink(
  token: string,
  purpose: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { id: string; exp: number } | null {
  if (typeof token !== "string" || token.length === 0) return null;
  if (token.length > MAX_TOKEN) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p64, m64] = parts as [string, string];
  if (!B64URL_RE.test(p64) || !B64URL_RE.test(m64)) return null;
  const payload = Buffer.from(p64, "base64url").toString("utf8");
  // Re-encoding must reproduce the token part exactly (rejects non-canonical base64url).
  if (Buffer.from(payload).toString("base64url") !== p64) return null;
  const given = Buffer.from(m64, "base64url");
  if (given.toString("base64url") !== m64) return null;
  const expected = mac(payload);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;
  const fields = payload.split("|");
  if (fields.length !== 3) return null;
  const [p, id, expRaw] = fields as [string, string, string];
  if (p !== purpose || !ID_RE.test(id) || !/^\d{1,15}$/.test(expRaw)) {
    return null;
  }
  const exp = Number(expRaw);
  if (!(exp > nowSec)) return null;
  return { id, exp };
}
