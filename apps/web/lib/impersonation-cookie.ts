// The signed impersonation cookie value (STAFF-06, P13-P4; copies auth-method.ts). The value is
//   v1.<base64url(json{org,view,staff,startId,exp})>.<mac>
//   mac = base64url(HMAC-SHA256(key, "impersonation.v1|<json>|<sha256(staff token) hex>"))
//   key = HMAC-SHA256(CDS_LINK_SECRET, "cds.impersonation.v1")
// No new secret: the key is derived from the link secret with its own purpose string. The MAC
// covers sha256 of the staff session token, so the cookie dies with the staff session; `exp`
// (ms since epoch) caps the 60-minute box client-side, and resumeImpersonation in @cds/db
// re-checks the start row, the 60 minutes and the end row server-side on every request.
// Pure (node:crypto only): the secret and clock are passed in, so this is tested directly.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ImpersonationCookiePayload = {
  org: string;
  view: "admin" | "owner";
  staff: string;
  startId: string;
  /** Expiry, ms since epoch. */
  exp: number;
};

const MAX_LEN = 512;
const VALUE_RE = /^v1\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/;
const ID_RE = /^[a-z0-9]{15}$/;

/**
 * `__Host-cds_imp` in production (Secure + host-only), `cds_imp` otherwise. Production is
 * `NODE_ENV === "production"`, the same test as the session and quote cookies.
 */
export function impersonationCookieName(
  env: string | undefined = process.env.NODE_ENV,
): string {
  return env === "production" ? "__Host-cds_imp" : "cds_imp";
}

function isPayload(v: unknown): v is ImpersonationCookiePayload {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return (
    Object.keys(p).length === 5 &&
    typeof p.org === "string" &&
    ID_RE.test(p.org) &&
    (p.view === "admin" || p.view === "owner") &&
    typeof p.staff === "string" &&
    ID_RE.test(p.staff) &&
    typeof p.startId === "string" &&
    ID_RE.test(p.startId) &&
    typeof p.exp === "number" &&
    Number.isSafeInteger(p.exp) &&
    p.exp > 0
  );
}

function mac(secret: string, json: string, staffToken: string): Buffer {
  const key = createHmac("sha256", secret)
    .update("cds.impersonation.v1")
    .digest();
  const tokenHash = createHash("sha256").update(staffToken).digest("hex");
  return createHmac("sha256", key)
    .update(`impersonation.v1|${json}|${tokenHash}`)
    .digest();
}

/** The cookie value for `payload`, bound to the staff session `staffToken`. */
export function signImpersonation(
  payload: ImpersonationCookiePayload,
  staffToken: string,
  secret: string,
): string {
  if (!isPayload(payload)) throw new Error("invalid impersonation payload");
  if (typeof staffToken !== "string" || staffToken === "") {
    throw new Error("missing staff token");
  }
  if (typeof secret !== "string" || secret === "") {
    throw new Error("missing secret");
  }
  const json = JSON.stringify({
    org: payload.org,
    view: payload.view,
    staff: payload.staff,
    startId: payload.startId,
    exp: payload.exp,
  });
  const value = `v1.${Buffer.from(json, "utf8").toString("base64url")}.${mac(secret, json, staffToken).toString("base64url")}`;
  if (value.length > MAX_LEN) throw new Error("impersonation cookie too long");
  return value;
}

/**
 * The payload a cookie value proves for this staff session, else `null`. Never throws: a
 * missing, malformed, forged, tampered, expired or other-session value is `null`.
 */
export function verifyImpersonation(
  value: string | undefined,
  staffToken: string | undefined,
  secret: string,
  now: Date = new Date(),
): ImpersonationCookiePayload | null {
  if (typeof value !== "string" || value.length > MAX_LEN) return null;
  if (typeof staffToken !== "string" || staffToken === "") return null;
  if (typeof secret !== "string" || secret === "") return null;
  const m = VALUE_RE.exec(value);
  if (!m) return null;
  const json = Buffer.from(m[1]!, "base64url").toString("utf8");
  const want = mac(secret, json, staffToken);
  const got = Buffer.from(m[2]!, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  const t = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(t) || parsed.exp <= t) return null;
  return parsed;
}
