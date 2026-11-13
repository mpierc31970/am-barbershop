// Hostname routing (PLAT-02, D4): one app, one deployment.
// - Platform hosts (PLATFORM_HOSTS, exact match) are served by the platform route group.
// - Any other valid host is rewritten to /tenant/<host>/<path>.
// - A malformed host gets 400. Direct /tenant paths on a platform host get 404.
// Only the `host` header is read; proxy-forwarded host headers are never trusted (T-01-04).
// Every response gets the security headers below (WR-B06).
// 13-22 (STAFF-22, P13-P3): Node.js runtime. On tenant hosts only, a lazily imported
// `isHostSuspended(host)` (shared 30 s / 5 s resolver cache) answers the neutral 503 for
// every path before the rewrite (except the host proof, WR-B01); platform hosts never load
// @cds/db.
// 15-22 (HUB-03, HUB-04, P15-P11, P15-P17): on platform hosts only, www.<apex> 301s to the apex,
// old archived URLs answer from the fixed `oldUrlTarget` table, and marketing paths carry
// X-Robots-Tag noindex outside production.
import type { ResolvedOrg } from "@cds/db";
import { NextResponse, type NextRequest } from "next/server";
import {
  TENANT_HOST_HEADER,
  classifyHost,
  normalizeHost,
  parsePlatformHosts,
} from "@cds/core";
import { FORM_QUERY_HEADER, MAX_FORM_QUERY } from "./lib/form-status";
import { MARKETING_ROUTE_PREFIXES, oldUrlTarget } from "./lib/old-urls";
import { MAX_PATH_HEADER, PATH_HEADER } from "./lib/path-header";
import {
  MAX_TENANT_PATH_HEADER,
  PREVIEW_COOKIE,
  REVIEW_COOKIE,
  TENANT_PATH_HEADER,
  edgeInternalPath,
  redirectResponse,
} from "./lib/redirect-host";
import { securityHeaders } from "./lib/security-headers";
import { STUDIO_NOTE_COOKIE, STUDIO_NOTE_HEADER } from "./lib/studio";
import { suspendedResponse } from "./lib/suspended-page";

// Parsed on first request, not at import, so `next build` never evaluates it. In
// production a missing or empty PLATFORM_HOSTS throws (every request fails loudly)
// rather than silently treating the dev domain as the hub.
let platformHosts: Set<string> | undefined;
function platform(): Set<string> {
  platformHosts ??= parsePlatformHosts(process.env.PLATFORM_HOSTS);
  return platformHosts;
}

// 15-22 (P15-P17, P15-P26): the brand apex is the host of CDS_PLATFORM_URL, parsed once on the
// first request (never at import, never from the request). Unset or unparsable → null: no www
// redirect.
let apexHost: string | null | undefined;
function apex(): string | null {
  if (apexHost === undefined) {
    try {
      const raw = process.env.CDS_PLATFORM_URL?.trim();
      apexHost = raw ? new URL(raw).hostname.toLowerCase() || null : null;
    } catch {
      apexHost = null;
    }
  }
  return apexHost;
}

/** A marketing route or one of its sub-paths ("/" matches exactly). */
function isMarketingPath(pathname: string): boolean {
  return MARKETING_ROUTE_PREFIXES.some((p) =>
    p === "/"
      ? pathname === "/"
      : pathname === p || pathname.startsWith(`${p}/`),
  );
}

// A&M fork (single-site): CDS marketing, signup, billing and the abuse /report page answer 404.
// /privacy and /unsubscribe stay (email links point at them).
const CDS_ONLY_KEEP = new Set(["/privacy", "/unsubscribe"]);
const CDS_ONLY_EXTRA = [
  "/start",
  "/hub/checkout",
  "/hub/settings/billing",
  "/hub/settings/connect",
  "/hub/settings/quotes",
];
function isCdsOnlyPath(pathname: string): boolean {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if ([...CDS_ONLY_KEEP].some(under)) return false;
  return isMarketingPath(pathname) || CDS_ONLY_EXTRA.some(under);
}

// A&M fork: the admin area lives on the site's own host. On SITE_ADMIN_HOST these paths are
// served by the platform route group (sign-in, owner hub, staff console, invites, legal
// pages) instead of the tenant site; every other path stays the public site. A
// platform host (admin.<site>) then 301s its pages there (GET only; /api/* stays put for
// webhooks and email links already sent).
const SITE_ADMIN_PATHS = [
  "/sign-in",
  "/hub",
  "/staff",
  "/invite",
  "/legal",
  "/unsubscribe",
  "/download-expired",
  "/support-file-expired",
];
let siteAdminHostValue: string | null | undefined;
function siteAdminHost(): string | null {
  siteAdminHostValue ??=
    normalizeHost(process.env.SITE_ADMIN_HOST?.trim() || null) ?? null;
  return siteAdminHostValue;
}
function isSiteAdminPath(pathname: string): boolean {
  return SITE_ADMIN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function secured(
  res: NextResponse,
  kind: "platform" | "tenant" | "invalid",
): NextResponse {
  for (const [name, value] of Object.entries(securityHeaders(kind))) {
    res.headers.set(name, value);
  }
  return res;
}

type TokenVerifiers = Pick<
  typeof import("@cds/db"),
  "verifyPreviewToken" | "verifyReviewToken"
>;

/** A valid, org-matched `cds_pv` or `cds_rv` cookie: drafts and review stay reachable. */
function hasDraftCookie(
  req: NextRequest,
  orgId: string,
  db: TokenVerifiers,
): boolean {
  const pv = db.verifyPreviewToken(req.cookies.get(PREVIEW_COOKIE)?.value);
  if (pv.status === "valid" && pv.orgId === orgId) return true;
  const rv = db.verifyReviewToken(req.cookies.get(REVIEW_COOKIE)?.value);
  return rv.status === "valid" && rv.orgId === orgId;
}

/**
 * 14-18 choice 2 (P14-P5, P14-P6, D170): a `redirect` host 301s to its `redirect_to`; after
 * launch the preview host 301s plain visitors to the live primary host (no-store: the answer
 * depends on the cookie). The target is never taken from the request (T-14-18-02).
 */
function hostRedirect(
  req: NextRequest,
  org: ResolvedOrg,
  db: TokenVerifiers,
): NextResponse | null {
  const { pathname, search, protocol, port } = req.nextUrl;
  const origin = { protocol, port };
  if (org.hostKind === "redirect" && org.redirectTo) {
    return redirectResponse(org.redirectTo, pathname, search, origin);
  }
  // 14-35 (14-20 carry-forward): the token landing routes run before any cookie exists, so the
  // preview-after-launch 301 skips them; each route checks its own token (review routes also
  // refuse a launched org through reviewContextForToken).
  const landing =
    pathname === "/_site/preview" || pathname.startsWith("/_site/review/");
  if (
    !landing &&
    org.hostKind === "preview" &&
    org.live &&
    org.primaryHost &&
    org.primaryHost !== org.host &&
    !hasDraftCookie(req, org.orgId, db)
  ) {
    return redirectResponse(
      org.primaryHost,
      pathname,
      search,
      origin,
      "no-store",
    );
  }
  return null;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const c = classifyHost(req.headers.get("host"), platform());
  if (c.kind === "invalid") {
    return secured(new NextResponse("Bad Request", { status: 400 }), c.kind);
  }

  // Tenant identity travels only in TENANT_HOST_HEADER, set here from the validated
  // host. Any client-sent copy is stripped on every path (WR-02).
  const headers = new Headers(req.headers);
  headers.delete(TENANT_HOST_HEADER);
  headers.delete(FORM_QUERY_HEADER);
  // 09-15 (RESEARCH Pattern 7): the re-acceptance gate reads the request path from here.
  headers.delete(PATH_HEADER);
  // 14-18 (T-14-18-01): x-cds-tenant-path is server-set on tenant rewrites only.
  headers.delete(TENANT_PATH_HEADER);

  const { pathname } = req.nextUrl;
  const adminHost = siteAdminHost();
  if (
    c.kind === "platform" &&
    adminHost &&
    (req.method === "GET" || req.method === "HEAD") &&
    !pathname.startsWith("/api/")
  ) {
    return secured(
      NextResponse.redirect(
        new URL(pathname + req.nextUrl.search, `https://${adminHost}`),
        301,
      ),
      c.kind,
    );
  }
  // A&M fork: phones capitalise typed addresses (/Sign-in). An admin path in the wrong case
  // 301s to its lowercase form instead of falling through to the public site's 404.
  if (
    c.kind === "tenant" &&
    adminHost !== null &&
    c.host === adminHost &&
    (req.method === "GET" || req.method === "HEAD") &&
    pathname !== pathname.toLowerCase() &&
    isSiteAdminPath(pathname.toLowerCase())
  ) {
    return secured(
      NextResponse.redirect(
        new URL(pathname.toLowerCase() + req.nextUrl.search, req.nextUrl),
        301,
      ),
      c.kind,
    );
  }
  // Next renders a Server Action's redirect with an internal fetch on localhost: those admin
  // paths are the same platform pages (an outside "Host: localhost" sees nothing else).
  const onSiteAdmin =
    c.kind === "tenant" &&
    adminHost !== null &&
    (c.host === adminHost ||
      c.host === "localhost" ||
      c.host === "127.0.0.1") &&
    isSiteAdminPath(pathname);
  if (c.kind === "platform" || onSiteAdmin) {
    // Second layer: the tenant page also 404s without the header.
    if (pathname === "/tenant" || pathname.startsWith("/tenant/")) {
      return secured(new NextResponse(null, { status: 404 }), "platform");
    }
    // 15-22 (HUB-04, P15-P17): www.<apex> → https://<apex> + path + query. The host is the
    // configured apex, never the request's (a spoofed X-Forwarded-Host changes nothing).
    const a = apex();
    const host = a ? normalizeHost(req.headers.get("host")) : null;
    if (a && host === `www.${a}` && platform().has(host)) {
      return secured(
        NextResponse.redirect(
          new URL(pathname + req.nextUrl.search, `https://${a}`),
          301,
        ),
        "platform",
      );
    }
    // A&M fork: CDS-only surfaces (marketing hub, signup/quote flow, CDS billing) are off.
    if (isCdsOnlyPath(pathname)) {
      return secured(new NextResponse(null, { status: 404 }), "platform");
    }
    // 15-22 (HUB-03, P15-P11, A1-Q5): old archived URLs answer from the fixed table, on platform
    // hosts only (a tenant's own /services or /book page is rewritten below, never redirected).
    const old = oldUrlTarget(pathname, req.method);
    if (old) {
      if (old.status === 301 && old.location) {
        return secured(
          NextResponse.redirect(new URL(old.location, req.nextUrl), 301),
          "platform",
        );
      }
      return secured(
        new NextResponse(null, { status: old.status }),
        "platform",
      );
    }
    const path = pathname + req.nextUrl.search;
    if (path.length <= MAX_PATH_HEADER) headers.set(PATH_HEADER, path);
    // A&M fork: deleting the note cookie below also hides it from this render, so hand the
    // note to the page in a request header first.
    const note = req.cookies.get(STUDIO_NOTE_COOKIE)?.value;
    if (req.method === "GET" && note)
      headers.set(STUDIO_NOTE_HEADER, note.slice(0, 600));
    else headers.delete(STUDIO_NOTE_HEADER);
    const res = secured(
      NextResponse.next({ request: { headers } }),
      "platform",
    );
    // A&M fork: the hub's one-time save note is shown by this GET (via the header above),
    // then dropped so the next screen doesn't repeat it.
    if (req.method === "GET" && req.cookies.has(STUDIO_NOTE_COOKIE)) {
      res.cookies.delete({ name: STUDIO_NOTE_COOKIE, path: "/hub" });
    }
    // 13-25 (P13-P33, T-13-25-02): the staff console is never indexed. Set here, on platform
    // hosts only, so a tenant's own /staff page keeps its normal indexing.
    if (pathname === "/staff" || pathname.startsWith("/staff/")) {
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    // 15-22 (A3-Q4, P15-P4): outside production the hub is never indexed (defence in depth beside
    // the pages' robots metadata and the dev robots.txt). Read per request.
    if (process.env.CDS_ENV !== "production" && isMarketingPath(pathname)) {
      res.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return res;
  }

  // 13-22: a suspended site is offline on every path (pages, /_media, /api/*, robots.txt,
  // sitemap.xml, llms.txt), checked before any cached render (T-13-22-01). A failed read
  // fails open: the tenant route then resolves (and errors) on its own, as before.
  // 14-18 (P14-P6): the same single resolveOrganization read (shared 30 s / 5 s cache) also
  // answers the redirect-host 301 and the preview-after-launch 301, so every path (pages,
  // robots.txt, sitemap.xml, /_media) redirects, never just the page component.
  const edgePath = edgeInternalPath(pathname);
  try {
    const db = await import("@cds/db");
    const org = await db.resolveOrganization(c.host);
    // The host proof carries no tenant content, so it answers on a suspended site too:
    // otherwise the HTTPS prober counts suspension as a TLS failure (WR-B01).
    if (org?.suspended && edgePath !== "_edge/cds-host") {
      return secured(suspendedResponse(), c.kind);
    }
    // The host proof answers on every allowed host (redirect, post-launch preview and
    // suspended too), so the prober never follows a 301 or gets a 503 (P14-P9).
    const redirect =
      org && edgePath !== "_edge/cds-host" ? hostRedirect(req, org, db) : null;
    if (redirect) return secured(redirect, c.kind);
  } catch (err) {
    console.error(
      "[middleware] suspension check failed",
      err instanceof Error ? err.name : typeof err,
    );
  }

  headers.set(TENANT_HOST_HEADER, c.host);
  // 14-18 choice 4: x-cds-tenant-path = pathname (<= 512) for path-aware chrome (review strip).
  if (pathname.length <= MAX_TENANT_PATH_HEADER) {
    headers.set(TENANT_PATH_HEADER, pathname);
  }
  // WR-C02: the tenant 404 page gets no searchParams; it reads a no-JS form status here.
  const search = req.nextUrl.search;
  if (search.length > 1 && search.length <= MAX_FORM_QUERY) {
    headers.set(FORM_QUERY_HEADER, search);
  }
  const url = req.nextUrl.clone();
  // 14-18 choice 3: /.well-known/cds-host -> the %5Fedge/cds-host route (host proof) and
  // /<CDS_INDEXNOW_KEY>.txt -> the %5Fedge/indexnow route (key file, custom hosts only).
  url.pathname = edgePath
    ? `/tenant/${encodeURIComponent(c.host)}/${edgePath}`
    : `/tenant/${encodeURIComponent(c.host)}${pathname}`;
  return secured(NextResponse.rewrite(url, { request: { headers } }), c.kind);
}

// Exclusions are exact paths (or the /_next/static/ directory), never prefixes: a path
// that skips the middleware also skips the TENANT_HOST_HEADER strip, so /api/healthz or
// /favicon-ico must still run it (IN-01). Tested with Next's own matcher.
// am-barber/ (A&M fork): the static intro logo in public/, served as-is on every host.
// api/jobs/quotes$ (06-09, RESEARCH Pitfall 5): the Coolify scheduled task calls it on
// 127.0.0.1, which host routing would reject with 400. The route guards itself (bearer).
// api/jobs/media$ (07-27; 07-02, Finding 5): the hourly media job, called on 127.0.0.1 by the
// Coolify scheduled task; its route guards itself with the CDS_JOB_TOKEN bearer. Until 07-27
// ships, the path simply 404s.
// api/jobs/assembly$ (08-17): hourly assembly sweep, Coolify scheduled task on 127.0.0.1; route
// guards itself with the CDS_JOB_TOKEN bearer.
// api/jobs/exports, exact path (milestone audit, TEN-12): nightly tenant export, Coolify
// scheduled task on 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer.
// api/jobs/retention$ (09-21, RESEARCH Pitfall 11): daily retention job, Coolify scheduled
// task on 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer.
// api/jobs/billing, exact path (10-21, RESEARCH Pitfall 12): hourly billing reconcile, Coolify
// scheduled task on 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer.
// api/jobs/alerts, exact path (11-23): every-5-minutes alert job (held push release, collapse,
// 7am summary), Coolify scheduled task on 127.0.0.1; route guards itself with the
// CDS_JOB_TOKEN bearer.
// api/jobs/studio, exact path (Studio Booking): every-15-minutes booking reminders and
// overdue chair rent alerts, Coolify scheduled task on 127.0.0.1; CDS_JOB_TOKEN bearer.
// api/jobs/reports, exact path (11-34): daily trigger of the monthly "Your site this month"
// email job, Coolify scheduled task on 127.0.0.1; route guards itself with the CDS_JOB_TOKEN
// bearer.
// api/jobs/support, exact path (12-31): hourly support job (7-day auto-close, SLA warnings,
// planned-work window alerts and clearing, rescans, prunes), Coolify scheduled task on
// 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer.
// api/jobs/indexing, exact path (13-19): weekly indexing job (resubmit live sites, check
// sitemaps), Coolify scheduled task on 127.0.0.1 (Sundays 06:00 UTC); route guards itself with
// the CDS_JOB_TOKEN bearer.
// api/jobs/review, exact path (13-29): hourly review job (rescan queued scans, suspend at
// fix_by, Monday spot checks), Coolify scheduled task on 127.0.0.1; route guards itself with the
// CDS_JOB_TOKEN bearer.
// api/jobs/demo, exact path (13-31): hourly demo reset trigger (acts at 3 am America/Chicago once
// a day), Coolify scheduled task on 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer.
// api/monitor/status, exact path (13-40, D175): the monitor app's read-only status document,
// polled from outside on any Host; route guards itself with the MONITOR_TOKEN bearer (404 else).
// api/jobs/health, exact path (13-44): every-5-minutes health job (staff alert emails once per
// incident, fail-safe pull, staff session prune), Coolify scheduled task on 127.0.0.1; route
// guards itself with the CDS_JOB_TOKEN bearer.
// api/edge/ask, api/edge/routes, exact paths (14-17, 14-18; RESEARCH Pitfall 3): the edge proxy
// (Caddy on-demand TLS ask / Traefik HTTP provider) calls them on any Host; each route guards
// itself (CDS_EDGE_TOKEN bearer, 404 otherwise).
// api/jobs/domains, exact path (14-41): every-5-minutes domains job, Coolify scheduled task on
// 127.0.0.1; route guards itself with the CDS_JOB_TOKEN bearer. Until 14-41 ships, the path
// simply 404s.
// runtime "nodejs" (13-22, P13-P3; stable since Next 15.5): the suspension read needs @cds/db.
export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!api/health$|api/jobs/quotes$|api/jobs/media$|api/jobs/assembly$|api/jobs/retention$|api/jobs/billing$|api/jobs/alerts$|api/jobs/reports$|api/jobs/support$|api/jobs/indexing$|api/jobs/review$|api/jobs/demo$|api/monitor/status$|api/jobs/health$|api/edge/ask$|api/edge/routes$|api/jobs/domains$|api/jobs/exports$|api/jobs/studio$|_next/static/|_next/image$|favicon\\.ico$|am-barber/).*)",
  ],
};
