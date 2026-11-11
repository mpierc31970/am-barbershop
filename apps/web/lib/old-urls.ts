// Old marketing-site URLs on platform hosts (HUB-03, D62; P15-P6, P15-P11, P15-P26).
// Owner: 15-06 (15-22 adds MARKETING_ROUTE_PREFIXES only). Pure and Edge-safe: the middleware
// imports it for the platform branch only (tenant hosts own their /services, /book, ... pages).
// Every location is a fixed string from this table; nothing from the request is ever echoed
// (T-15-06-01 open redirect). Paths the hub serves itself (/, /about, /work, /contact, /privacy,
// /unsubscribe) are not listed and return null. The final list matches 15-PARITY-INVENTORY.md.

export type OldUrlTarget = {
  readonly status: 301 | 200 | 410;
  readonly location?: string;
};

/** Exact old path → fixed hub location (301). */
export const OLD_URLS: Readonly<Record<string, string>> = Object.freeze({
  "/services": "/add-ons",
  "/testimonials": "/work",
  "/book": "/contact?topic=call",
  "/terms": "/legal/terms-of-service",
  "/resources": "/",
  "/admin": "/sign-in",
  "/api/newsletter/unsubscribe": "/unsubscribe",
  "/api/newsletter/subscribe": "/",
});

const ADMIN_PREFIX = "/admin/";
const ADMIN_TARGET = "/sign-in";
const UNSUBSCRIBE_API = "/api/newsletter/unsubscribe";
const SUBSCRIBE_API = "/api/newsletter/subscribe";

/** Drops one trailing slash ("/services/" → "/services"); "/" stays "/". */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * The fixed answer for an old URL, or null when the path is not an old URL.
 * Newsletter POSTs: unsubscribe answers 200 with an empty body (RFC 8058 one-click, so old emails'
 * links never fail); subscribe answers 410 Gone (the old newsletter has ended).
 */
export function oldUrlTarget(
  pathname: string,
  method: string,
): OldUrlTarget | null {
  const path = normalize(pathname);
  if (method.toUpperCase() === "POST") {
    if (path === UNSUBSCRIBE_API) return { status: 200 };
    if (path === SUBSCRIBE_API) return { status: 410 };
  }
  if (Object.prototype.hasOwnProperty.call(OLD_URLS, path)) {
    return { status: 301, location: OLD_URLS[path] };
  }
  if (path.startsWith(ADMIN_PREFIX))
    return { status: 301, location: ADMIN_TARGET };
  return null;
}

/**
 * 15-22 (choice 1c, A3-Q4): the marketing route paths, kept here because the middleware must not
 * import `@cds/core/marketing` (edge-boundary root-specifier rule). `test/middleware.test.ts`
 * asserts it equals `MARKETING_ROUTES` paths. "/" matches exactly; every other entry also matches
 * its sub-paths (`/add-ons/<slug>`).
 */
export const MARKETING_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  "/",
  "/standard",
  "/studio",
  "/add-ons",
  "/pricing",
  "/work",
  "/about",
  "/contact",
  "/independent-pros",
  "/hosting-rules",
  "/privacy",
  "/unsubscribe",
  "/report",
]);
