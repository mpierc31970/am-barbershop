// Shared pieces of the /start/q reopen route handler and the signed reopen page (ONB-08;
// 06-UI-SPEC "Quote links"; T-06-78, T-06-81). Tokens travel in these URLs, so every response is
// no-store and no-referrer. The Location is relative (RFC 9110 allows it), so the redirect
// never depends on the Host the app sees behind the proxy. Only a valid link sets the
// quote cookie; expired, invalid and unknown tokens all go to the one expired page.
import { NextResponse } from "next/server";
import { quoteCookieName, quoteCookieOptions } from "./quote-cookie";

export const REOPEN_VALID_PATH = "/start?welcome=1";
export const REOPEN_EXPIRED_PATH = "/start/q/expired";
export const REOPEN_SUBMITTED_PATH = "/start/q/submitted";

/** Signed reopen links are `<payload>.<mac>` in base64url; anything else is refused unread. */
export const SIGNED_REOPEN_RE = /^[A-Za-z0-9_.-]{1,512}$/;

export const TOKEN_URL_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export type ReopenOutcome =
  { state: "valid"; token: string } | { state: "expired" | "submitted" };

export function reopenResponse(outcome: ReopenOutcome): NextResponse {
  const location =
    outcome.state === "valid"
      ? REOPEN_VALID_PATH
      : outcome.state === "submitted"
        ? REOPEN_SUBMITTED_PATH
        : REOPEN_EXPIRED_PATH;
  const res = new NextResponse(null, {
    status: 302,
    headers: { ...TOKEN_URL_HEADERS, Location: location },
  });
  if (outcome.state === "valid") {
    res.cookies.set(quoteCookieName(), outcome.token, quoteCookieOptions());
  }
  return res;
}
