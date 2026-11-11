// Hostname -> organization resolution (TEN-04, D4, D54). Rejects, never defaults: an
// unknown host, a platform host, an IP literal or an org that is not `active` (held,
// disabled) resolves to null and the tenant page 404s (T-02-20).
//
// This is the one sanctioned context-free query in the chokepoint: it runs before any
// organization context can exist (it is how the context is found), and it returns only
// orgId, slug and host, never tenant data.
//
// 07-30 (CONT-13, D170, choice 1): it also returns the matched row's `kind` (`preview` |
// `custom`) and the org's `primary = true` hostname, read in the same cached lookup with one
// bound-param query. Canonical URLs and robots use these, never the request Host header.
//
// 14-14 (DOM-06, P14-P5, choice 1): `redirect` joins the kinds. A redirect row (an old custom
// host after a move, or the apex when `www` is main) resolves with hostKind "redirect" and its
// normalised `redirectTo`, never as preview, so old live domains never get the preview strip
// or noindex. `live` is the org's stage (used by the preview-after-launch 301, 14-18).
// `forgetHost` drops one cached entry so cutover and redirect changes apply at once.
//
// Cache (T-02-21): Map<host, entry>, 30 s positive / 5 s negative TTL, bounded at
// 1000 entries evicting the oldest insertion, so a Host-header flood cannot grow memory.
import { classifyHost, normalizeHost, parsePlatformHosts } from "@cds/core";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "./client";

export type HostKind = "preview" | "custom" | "redirect";

export type ResolvedOrg = {
  orgId: string;
  slug: string;
  host: string;
  /** The matched org_hosts row's kind; anything unknown is treated as preview (noindex). */
  hostKind: HostKind;
  /** The org's primary hostname, or null when it has none. */
  primaryHost: string | null;
  /**
   * 13-17 (STAFF-22, P13-P3): the org is active but suspended (`suspended_at` set). Never a
   * status value; the public host answers 503 while this is true.
   */
  suspended: boolean;
  /** 14-14: the 301 target host of a `redirect` row (normalised), else null. */
  redirectTo: string | null;
  /** 14-14: the org's stage is `live`. */
  live: boolean;
};

const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;
export const RESOLVER_CACHE_MAX = 1000;

type Entry = { value: ResolvedOrg | null; expires: number };
const cache = new Map<string, Entry>();

// Parsed on first use, not at import, so `next build` never evaluates it (same lazy
// pattern as apps/web/middleware.ts).
let platformHosts: Set<string> | undefined;
function platform(): Set<string> {
  platformHosts ??= parsePlatformHosts(process.env.PLATFORM_HOSTS);
  return platformHosts;
}

function remember(host: string, value: ResolvedOrg | null): void {
  cache.delete(host);
  while (cache.size >= RESOLVER_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(host, {
    value,
    expires: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
}

async function primaryHostOf(orgId: string): Promise<string | null> {
  try {
    const row = await withSuperuser((pb) =>
      pb
        .collection("org_hosts")
        .getFirstListItem(
          pb.filter("organization = {:org} && primary = true", { org: orgId }),
          { fields: "hostname" },
        ),
    );
    const h = typeof row.hostname === "string" ? row.hostname.trim() : "";
    return h === "" ? null : h;
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

async function lookup(host: string): Promise<ResolvedOrg | null> {
  try {
    const row = await withSuperuser((pb) =>
      pb
        .collection("org_hosts")
        .getFirstListItem(pb.filter("hostname = {:h}", { h: host }), {
          expand: "organization",
        }),
    );
    const org = row.expand?.organization as
      | {
          id?: string;
          slug?: string;
          status?: string;
          stage?: string;
          suspended_at?: string;
        }
      | undefined;
    if (!org?.id || org.status !== "active") return null;
    const hostKind: HostKind =
      row.kind === "custom"
        ? "custom"
        : row.kind === "redirect"
          ? "redirect"
          : "preview";
    const redirectTo =
      row.kind === "redirect"
        ? normalizeHost(
            typeof row.redirect_to === "string" ? row.redirect_to : "",
          )
        : null;
    const primaryHost =
      row.primary === true ? host : await primaryHostOf(org.id);
    return {
      orgId: org.id,
      slug: String(org.slug ?? ""),
      host,
      hostKind,
      primaryHost,
      suspended: Boolean(org.suspended_at),
      redirectTo,
      live: org.stage === "live",
    };
  } catch (err) {
    // A miss is a 404. Anything else (PB down, auth failure) propagates, so an outage is
    // a 500 rather than a silent "no such site".
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

/** The active organization serving `host`, or null (the caller then 404s). */
export async function resolveOrganization(
  host: string | null | undefined,
): Promise<ResolvedOrg | null> {
  const h = normalizeHost(host);
  if (!h) return null;
  const c = classifyHost(h, platform());
  if (c.kind !== "tenant") return null;

  const hit = cache.get(c.host);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await lookup(c.host);
  remember(c.host, value);
  return value;
}

/**
 * 13-17 (P13-P3): true when `host` resolves to an active org that is suspended. Reads through
 * resolveOrganization, so it shares the 30 s / 5 s cache; an unknown host is not suspended.
 */
export async function isHostSuspended(
  host: string | null | undefined,
): Promise<boolean> {
  const org = await resolveOrganization(host);
  return org?.suspended === true;
}

/** 14-14: drop one cached resolution (cutover, redirect changes). Other hosts stay cached. */
export function forgetHost(host: string): void {
  const h = normalizeHost(host);
  if (h) cache.delete(h);
}

/** Drop every cached resolution (tests; suspend and lift, 13-17). */
export function clearResolverCache(): void {
  cache.clear();
  platformHosts = undefined;
}

/** Current cache size (tests only: proves the bound). */
export function resolverCacheSize(): number {
  return cache.size;
}
