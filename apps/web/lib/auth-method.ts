// The signed auth-method cookie value (AGR-03 evidence; 09 review CR-C01). How the member
// signed in (`otp` / `password`) is recorded on every signature, so the browser must not be
// able to choose it. The cookie value is `<method>.<mac>` where
//   mac = base64url(HMAC-SHA256(key, "auth-method.v1|<method>|<sha256(session token)>"))
//   key = HMAC-SHA256(CDS_LINK_SECRET, "cds.auth-method.v1")
// No new secret: the key is derived from the link secret (rotating it turns every recorded
// method into "unknown" until the next sign-in, never a sign-out). Binding the MAC to the
// session token means a value copied from another session, or left over from an earlier
// login when a new session is set without a new method, verifies as "unknown".
// Pure (node:crypto only): the secret is passed in, so this is tested directly.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type AuthMethod = "otp" | "password";

const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

function isMethod(v: unknown): v is AuthMethod {
  return v === "otp" || v === "password";
}

function mac(secret: string, method: AuthMethod, token: string): Buffer {
  const key = createHmac("sha256", secret)
    .update("cds.auth-method.v1")
    .digest();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return createHmac("sha256", key)
    .update(`auth-method.v1|${method}|${tokenHash}`)
    .digest();
}

/** The cookie value for `method`, bound to the session `token`. */
export function signAuthMethod(
  method: AuthMethod,
  token: string,
  secret: string,
): string {
  if (!isMethod(method)) throw new Error("invalid auth method");
  if (typeof token !== "string" || token === "") {
    throw new Error("missing session token");
  }
  return `${method}.${mac(secret, method, token).toString("base64url")}`;
}

/**
 * The method a cookie value proves for this session `token`, else "unknown". Never throws:
 * a missing, malformed, forged or other-session value is "unknown".
 */
export function verifyAuthMethod(
  value: string | undefined,
  token: string | undefined,
  secret: string,
): AuthMethod | "unknown" {
  if (typeof value !== "string" || value.length > 64) return "unknown";
  if (typeof token !== "string" || token === "") return "unknown";
  const dot = value.indexOf(".");
  if (dot < 0) return "unknown";
  const method = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!isMethod(method) || !SIG_RE.test(sig)) return "unknown";
  const want = mac(secret, method, token);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return "unknown";
  }
  return method;
}
