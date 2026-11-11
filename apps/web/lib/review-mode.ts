// Review mode on the preview host (14-35; DOM-10, D172, D-UI-P14-12, D-UI-P14-13; RESEARCH
// Pattern 7). Pure helpers shared by the `/_site/review/*` routes, the note page and the tenant
// layout. The review token travels only in the host-only `cds_rv` cookie (HttpOnly,
// SameSite=Lax: the first hop is a cross-site navigation from the hub). Every review POST
// checks that Origin is the preview host itself (T-14-35-01) and acts only through
// reviewContextForToken (owner, not impersonating; T-14-35-02).
import { P14_COPY } from "@cds/core/dns";
import { REVIEW_COOKIE } from "./redirect-host";

export { REVIEW_COOKIE };

/** The review routes (URL segment `_site`, folder `%5Fsite`). */
export const REVIEW_START_PATH = "/_site/review/start";
export const REVIEW_MARK_PATH = "/_site/review/mark";
export const REVIEW_NOTE_PATH = "/_site/review/note";
export const REVIEW_SEND_PATH = "/_site/review/send";

/** A review page id: a 15-char page id, or the policy pages (14-33). */
export const REVIEW_PAGE_ID_RE = /^(?:[a-z0-9]{15}|privacy|terms)$/;

/** A reviewPages path ('/', '/<slug>'); anything else is never used as a Location. */
const REVIEW_PATH_RE = /^\/(?:[a-z0-9][a-z0-9-]{0,99})?$/;

export type ReviewChoice = "looks_good" | "needs_change" | "phone";

export type ReviewStatusKey =
  "marked" | "done" | "phone" | "sent" | "error" | "test";

/** The minimal page shape the helpers need (structurally @cds/db ReviewPage). */
export type ReviewPageLike = {
  id: string;
  title: string;
  path: string;
  status: string;
};

/** UI-SPEC "Review mode" status lines (shown once, `role="status"`). */
export const REVIEW_STATUS_COPY = Object.freeze({
  marked: (title: string) => `Marked ${title} as looks good.`,
  done: "All pages looked over. Back to your review.",
  phone: "Thanks. Phone check done.",
  sent: "Sent. Support will make the change and tell you.",
  error: P14_COPY.ERR_SEND_STRIP,
  test: "Test message sent. It's in your Inbox.",
});

/** The note page copy (UI-SPEC "Needs a change"). */
export const REVIEW_NOTE_COPY = Object.freeze({
  heading: (title: string) => `What should change on ${title}?`,
  label: "Your note",
  helper:
    'Be specific, like "Change the phone number in the footer." Support sees the page with your note.',
  send: "Send to Support",
  back: P14_COPY.BTN_BACK_TO_PAGE,
  short: P14_COPY.NOTE_SHORT,
  error: P14_COPY.ERR_SEND_STRIP,
});

function production(): boolean {
  return process.env.CDS_ENV === "production";
}

/** `cds_rv=<token>` (host-only: no Domain). Only the token alphabet is ever echoed. */
export function reviewCookieHeader(token: string, maxAge: number): string {
  const safe = /^[A-Za-z0-9._-]{1,300}$/.test(token) ? token : "invalid";
  const secure = production() ? "; Secure" : "";
  const age = Math.max(0, Math.floor(maxAge));
  return `${REVIEW_COOKIE}=${safe}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

/** One cookie's value from a Request's Cookie header, or undefined. */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * T-14-35-01: the request's `Origin` must be the preview host itself. Production: exactly
 * `https://<host>` (no port). Elsewhere `http(s)://<host>[:port]` (dev runs on :3000). A
 * missing, `null` or foreign Origin is refused.
 */
export function sameOrigin(req: Request, host: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.hostname !== host.toLowerCase()) return false;
  if (production()) return u.protocol === "https:" && u.port === "";
  return u.protocol === "https:" || u.protocol === "http:";
}

/** A safe same-host review path (the `next` parameter), or null. */
export function safeReviewPath(p: unknown): string | null {
  return typeof p === "string" && REVIEW_PATH_RE.test(p) ? p : null;
}

/** `path?k=v…` for a same-host Location. */
export function withQuery(path: string, q: Record<string, string>): string {
  const s = new URLSearchParams(q).toString();
  return s ? `${path}?${s}` : path;
}

/** The first page not marked Looks good, or null. */
export function firstUnreviewed<T extends ReviewPageLike>(
  pages: readonly T[],
): T | null {
  return pages.find((p) => p.status !== "looks_good") ?? null;
}

/**
 * After Looks good on `currentId`: the next page (in review order, wrapping) that is not
 * Looks good and is not the current one, or null when every page is done.
 */
export function nextUnreviewed<T extends ReviewPageLike>(
  pages: readonly T[],
  currentId: string,
): T | null {
  const at = pages.findIndex((p) => p.id === currentId);
  for (let k = 1; k <= pages.length; k += 1) {
    const p = pages[(Math.max(at, 0) + k) % pages.length];
    if (p && p.id !== currentId && p.status !== "looks_good") return p;
  }
  return null;
}

/** The review page a request path shows, by its reviewPages path ('/about/' = '/about'). */
export function pageIndexForPath(
  pages: readonly ReviewPageLike[],
  path: string | null | undefined,
): number {
  if (typeof path !== "string" || path === "") return -1;
  let p = path.toLowerCase();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return pages.findIndex((x) => x.path === p);
}

/** The status line for `?rs=` (and a review-mode form send, `sent=1`), or null. */
export function reviewStatusLine(
  query: Record<string, string> | null,
  pages: readonly ReviewPageLike[],
): string | null {
  if (!query) return null;
  switch (query.rs) {
    case "marked": {
      const title = pages.find((p) => p.id === query.rp)?.title;
      return title ? REVIEW_STATUS_COPY.marked(title) : null;
    }
    case "done":
      return REVIEW_STATUS_COPY.done;
    case "phone":
      return REVIEW_STATUS_COPY.phone;
    case "sent":
      return REVIEW_STATUS_COPY.sent;
    case "error":
      return REVIEW_STATUS_COPY.error;
    default:
      break;
  }
  // A form sent under the review cookie is stored as a test (P14-P26).
  return query.sent === "1" && typeof query.form === "string"
    ? REVIEW_STATUS_COPY.test
    : null;
}

/** 303 with no-store and no Referer (the token never leaks onward). */
export function see303(location: string, cookie?: string): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** The plain 403/404 every refused review request gets (no detail, no-store). */
export function refuse(status: 403 | 404 = 403): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
