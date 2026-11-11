// Where /sign-in sends a member afterwards (review 11 WR-E02). Only an invite page is
// allowed: `/invite/<43-char token>`, nothing else (no open redirect). An invited person
// whose account has no password (owners created at Submit sign in by emailed code) uses
// "No password? Sign in with an emailed code" on the invite page and comes straight back
// to it, signed in, where the page offers Join.

export const SIGN_IN_NEXT_RE = /^\/invite\/[A-Za-z0-9_-]{43}$/;

/** The validated `next` target, or null (the caller then uses its default). */
export function safeSignInNext(v: unknown): string | null {
  return typeof v === "string" && SIGN_IN_NEXT_RE.test(v) ? v : null;
}

/** The invite page's link to the emailed-code sign-in that returns to it. */
export function codeSignInHrefFor(invitePath: string): string {
  const next = safeSignInNext(invitePath);
  return next
    ? `/sign-in?method=code&next=${encodeURIComponent(next)}`
    : "/sign-in";
}
