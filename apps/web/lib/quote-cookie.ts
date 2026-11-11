// The /start quote cookie (ONB-08, CONTEXT A1-Q2; T-06-69). It holds the raw quote token,
// the only credential for an anonymous quote, so it is httpOnly, SameSite=Lax, path "/",
// and `__Host-` prefixed + Secure in production (no Domain, never readable by client JS).
// The token never goes into HTML, a URL or a log line from here. A cookie that is not a
// well-shaped token is treated as absent, so junk never reaches the database.
// Server-only: imports next/headers.
import { QUOTE_TOKEN_RE } from "@cds/db";
import { cookies } from "next/headers";

/** A quote lives 30 days after its last change (QUOTE_TTL_DAYS); the cookie matches. */
const QUOTE_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function quoteCookieName(): string {
  return isProduction() ? "__Host-cds_quote" : "cds_quote";
}

/** The raw token from the cookie, or null (absent or malformed). */
export async function readQuoteCookie(): Promise<string | null> {
  const value = (await cookies()).get(quoteCookieName())?.value;
  return typeof value === "string" && QUOTE_TOKEN_RE.test(value) ? value : null;
}

/** The cookie flags, shared by setQuoteCookie and the /start/q reopen route handlers. */
export function quoteCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    maxAge: QUOTE_COOKIE_MAX_AGE_S,
  };
}

export async function setQuoteCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(quoteCookieName(), token, quoteCookieOptions());
}

export async function clearQuoteCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: quoteCookieName(), path: "/", secure: isProduction() });
}
