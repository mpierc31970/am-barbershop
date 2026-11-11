// apps/web/lib/hub-env.ts: the one runtime production gate for the CDS hub site (P15-P4).
// Owner: 15-01. CDS_ENV is unset at Docker build (RESEARCH Pitfall 1), so it is read inside
// each function on every call, never at module scope and never from a static route. Used by
// claims, proof, noindex, robots, sitemap and canonical (CONTEXT A2-Q4, A3-Q4).
import type { Metadata } from "next";

/** The brand apex. A constant, never read from the request (P15-P26). */
const HUB_APEX = "https://connectionsdesignstudios.com";

/** True only when CDS_ENV is exactly "production", evaluated per call. */
export function isProductionHub(): boolean {
  return process.env.CDS_ENV === "production";
}

/** Robots metadata: default (indexable) in production, noindex/nofollow everywhere else. */
export function hubRobots(): Metadata["robots"] {
  return isProductionHub() ? undefined : { index: false, follow: false };
}

/**
 * The metadataBase for hub pages (15 CR-A02): file-based `opengraph-image` routes become
 * absolute `og:image` URLs through it, and off Vercel Next otherwise falls back to
 * `http://localhost:<PORT>`. Production is the brand apex; elsewhere the configured
 * CDS_PLATFORM_URL (dev host), then localhost. Read per call, like isProductionHub.
 */
export function hubMetadataBase(): URL {
  if (isProductionHub()) return new URL(HUB_APEX);
  const raw = process.env.CDS_PLATFORM_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:")
        return new URL(u.origin);
    } catch {
      // Invalid config: fall through to localhost.
    }
  }
  return new URL(`http://localhost:${process.env.PORT || "3000"}`);
}

/** Canonical URL on the brand apex in production only; undefined elsewhere. */
export function hubCanonical(path: string): string | undefined {
  if (!isProductionHub()) return undefined;
  return `${HUB_APEX}${path.startsWith("/") ? path : `/${path}`}`;
}
