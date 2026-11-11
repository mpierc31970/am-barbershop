// Shared response helpers for the tenant crawler routes (07-31; CONT-13, CONT-15, CONT-37; D170,
// D277; choices 3, 9, 10). The three routes derive only from index.json (getSiteIndex): they
// never filter pages themselves. Origins come from the org's primary host (else the matched
// host), never the request Host header. Server-only.
import { canonicalOrigin } from "@cds/core/seo";
import type { SiteContext } from "@cds/db";

/** https://<primary host>, else the matched host (canonicalOrigin, 07-30). */
export function originFor(site: SiteContext): string {
  return canonicalOrigin({
    primaryHost: site.primaryHost,
    fallbackHost: site.host,
  });
}

export function notFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export function textResponse(
  body: string,
  contentType: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
