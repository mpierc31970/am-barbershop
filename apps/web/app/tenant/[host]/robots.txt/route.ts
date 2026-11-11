// GET /robots.txt on tenant hosts (07-31 choice 9; CONT-15, CONT-37; D170, D277).
// Derives only from index.json (getSiteIndex) plus the matched host's kind. Preview host:
// "User-agent: *" + "Disallow: /" only. Custom host: allow all, the AI crawler group when the
// site's AI toggle is off, then "Sitemap: https://<primary>/sitemap.xml" (choice 3). Page
// paths are never listed. No index yet -> defaults (AI allowed). Unknown host -> 404.
import { robotsTxt } from "@cds/core/seo";
import {
  notFoundResponse,
  originFor,
  textResponse,
} from "../../../../lib/site-index-route";
import { getSiteIndex } from "../../../../lib/site-cache";
import { siteForRoute } from "../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

export async function GET(
  _req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return notFoundResponse();
  // A failed read is treated as no index (never a 500).
  const index = await getSiteIndex(site).catch(() => null);
  const body = robotsTxt({
    hostKind: site.hostKind,
    allowAiCrawlers: index?.site.allow_ai_crawlers ?? true,
    sitemapUrl: `${originFor(site)}/sitemap.xml`,
  });
  return textResponse(body, "text/plain; charset=utf-8");
}
