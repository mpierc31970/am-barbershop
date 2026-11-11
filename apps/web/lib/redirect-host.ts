// Tenant host redirects and path header (14-18; DOM-06, DOM-02; P14-P5, P14-P6, D170).
// Pure and Node/Edge-safe: the middleware imports it. The 301 target host only ever comes from
// `org_hosts.redirect_to` or the org's primary host (system-written), never from the request
// (T-14-18-02 open redirect). Path and query are kept.
import { normalizeHost } from "@cds/core";
import { NextResponse } from "next/server";

/**
 * The tenant request path for path-aware chrome (the review strip, 14-19/14-35). The
 * middleware deletes any client-sent copy on every request and sets it on tenant rewrites only
 * (T-14-18-01).
 */
export const TENANT_PATH_HEADER = "x-cds-tenant-path";

/** Longer paths are omitted (never truncated); the layout then renders without the path. */
export const MAX_TENANT_PATH_HEADER = 512;

/**
 * Host-only draft cookies on the preview host: `cds_pv` (draft preview link, 14-20) and
 * `cds_rv` (review mode, 14-35). Either, valid and org-matched, keeps the preview host
 * rendering after launch instead of the 301 (T-14-18-03).
 */
export const PREVIEW_COOKIE = "cds_pv";

/** `/_site/preview` fallback cookie lifetime for an invalid or expired link (seconds, 14-20).
 * Lives here, not in the route: a Next route file may export only route fields. */
export const INVALID_LINK_COOKIE_SECONDS = 300;
export const REVIEW_COOKIE = "cds_rv";

/** Redirect hosts change rarely; a 5-minute cache keeps a cutover fix quick to apply. */
export const REDIRECT_CACHE_CONTROL = "public, max-age=300";

export type RedirectOrigin = {
  /** The request's protocol. Ignored in production (always https). */
  protocol?: string;
  /** The request's port (dev only; production never adds one). */
  port?: string;
};

/**
 * The absolute Location for a 301 to `to`, or null when `to` is not a valid bare host.
 * Production is always `https://<to><path><search>`; outside production an `http:` request
 * stays on http and keeps its port, so `*.localhost:3000` redirects work in dev.
 */
export function redirectLocation(
  to: string,
  path: string,
  search: string,
  origin: RedirectOrigin = {},
): string | null {
  const host = normalizeHost(to);
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return null;
  const prod = process.env.NODE_ENV === "production";
  const scheme = !prod && origin.protocol === "http:" ? "http" : "https";
  const port =
    !prod && origin.port && /^\d{1,5}$/.test(origin.port)
      ? `:${origin.port}`
      : "";
  const p = path.startsWith("/") ? path : `/${path}`;
  const q = search && search !== "?" ? search : "";
  return `${scheme}://${host}${port}${p}${q}`;
}

/**
 * 301 to `to` keeping `path` and `search` (redirect hosts, P14-P6). Cache-Control defaults to
 * five public minutes; the preview-after-launch 301 depends on a cookie and passes `no-store`.
 * Returns null when `to` is invalid (the caller then serves the site, failing open).
 */
export function redirectResponse(
  to: string,
  path: string,
  search: string,
  origin: RedirectOrigin = {},
  cacheControl: string = REDIRECT_CACHE_CONTROL,
): NextResponse | null {
  const location = redirectLocation(to, path, search, origin);
  if (!location) return null;
  return new NextResponse(null, {
    status: 301,
    headers: { Location: location, "Cache-Control": cacheControl },
  });
}

// ------------------------------------------------------------ tenant internal edge routes

/** The host proof the HTTPS prober fetches (14-18 choice 3; 14-12, P14-P9). */
export const CDS_HOST_PATH = "/.well-known/cds-host";

const INDEXNOW_KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;

/** `CDS_INDEXNOW_KEY` when it is a valid IndexNow key, else null (read per request). */
export function indexNowKey(): string | null {
  const k = process.env.CDS_INDEXNOW_KEY;
  return k && INDEXNOW_KEY_RE.test(k) ? k : null;
}

/**
 * The tenant-internal route segment for a public path, or null. The folders are
 * `app/tenant/[host]/%5Fedge/cds-host` and `%5Fedge/indexnow` (the `_edge` URL segment;
 * `%5F` because `_edge` would be a private App Router folder). The IndexNow key file is
 * `/<CDS_INDEXNOW_KEY>.txt` and only exists while the env key is valid.
 */
export function edgeInternalPath(
  pathname: string,
): "_edge/cds-host" | "_edge/indexnow" | null {
  if (pathname === CDS_HOST_PATH) return "_edge/cds-host";
  const key = indexNowKey();
  if (key && pathname === `/${key}.txt`) return "_edge/indexnow";
  return null;
}
