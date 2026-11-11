// Tenant request helpers (PLAT-02, CONT-08; WR-02, IN-11, TEN-04; T-03-48).
//
// Tenant identity comes from TENANT_HOST_HEADER, which only the middleware sets from the
// validated `host` header (WR-02). The [host] path segment is never trusted: if it does
// not match the header (or the header is absent), the request 404s (IN-11). The site is
// then resolved from the header value only, through org_hosts; an unknown host or a
// held/disabled org 404s, never falls back to a default (TEN-04).
// siteForRoute is wrapped in React cache() (07-26 choice 5): the root layout (<html lang>)
// and the tenant layout share one host lookup per request.
import { TENANT_HOST_HEADER } from "@cds/core";
import { siteContextForHost, type SiteContext } from "@cds/db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * The visitor SiteContext for this request, or null. The one trust check: tenant identity
 * only from TENANT_HOST_HEADER, and the [host] param must equal it raw or decoded (WR-02,
 * IN-11, TEN-04). For tenant route handlers (`%5Fmedia`, `api/forms`, `api/gate`,
 * `sitemap.xml`, `robots.txt`, `llms.txt`), which answer
 * `new Response(null, { status: 404 })` on null (07-02, Finding 7).
 */
export async function siteForRoute(
  hostParam: string,
): Promise<SiteContext | null> {
  return routeSite(hostParam);
}

/** The per-request memo behind siteForRoute (React cache; 07-26 choice 5). */
const routeSite = cache(async function routeSite(
  hostParam: string,
): Promise<SiteContext | null> {
  const tenantHost = (await headers()).get(TENANT_HOST_HEADER);
  if (
    !tenantHost ||
    (hostParam !== tenantHost && safeDecode(hostParam) !== tenantHost)
  ) {
    return null;
  }
  return siteContextForHost(tenantHost);
});

/** The visitor SiteContext for this request, or notFound(). Pages use this. */
export async function siteForRequest(hostParam: string): Promise<SiteContext> {
  const site = await siteForRoute(hostParam);
  if (!site) notFound();
  return site;
}

/**
 * The page slug for a catch-all path: [] -> "home"; one segment -> decoded, lowercased;
 * nested paths or an undecodable segment -> null (the caller 404s).
 */
export function resolveSlug(path?: string[]): string | null {
  if (!path || path.length === 0) return "home";
  if (path.length > 1) return null;
  const decoded = safeDecode(path[0]!);
  if (decoded === null || decoded === "") return null;
  return decoded.toLowerCase();
}
