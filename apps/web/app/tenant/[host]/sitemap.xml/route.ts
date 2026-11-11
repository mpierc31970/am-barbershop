// GET /sitemap.xml on tenant hosts (07-31 choices 3, 10; CONT-13, CONT-37; D170, D277).
// Derives only from index.json (getSiteIndex): one <loc> per indexable page, origin + stored
// path, equal to the page's canonical (canonicalUrl/slugPathFor), with <lastmod>. Served on
// preview hosts too (the Site settings "Your sitemap" link) with X-Robots-Tag: noindex.
// No index yet -> an empty urlset. Unknown host -> 404.
// 09-22 (AGR-08; UI-SPEC): /privacy and /terms join once published (same loader as the
// routes and the footer), lastmod = the page's Last updated day. A failed read leaves them out.
import { sitemapXml } from "@cds/core/seo";
import {
  notFoundResponse,
  originFor,
  textResponse,
} from "../../../../lib/site-index-route";
import { getSiteIndex } from "../../../../lib/site-cache";
import { sitePolicyForSite } from "../../../../lib/site-policy-pages";
import { siteForRoute } from "../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

const SYSTEM_PATHS: ReadonlySet<string> = new Set(["/privacy", "/terms"]);

export async function GET(
  _req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return notFoundResponse();
  // A failed read is treated as no index (never a 500).
  const [index, privacy, terms] = await Promise.all([
    getSiteIndex(site).catch(() => null),
    sitePolicyForSite(site, "privacy").catch(() => null),
    sitePolicyForSite(site, "terms").catch(() => null),
  ]);
  // The static /privacy and /terms routes shadow any builder page at those paths (review
  // IN-C05), so such a page is never listed: no unreachable URL, no duplicate <loc>.
  const pages: { path: string; lastmod: string }[] = (
    index?.pages ?? []
  ).filter((p) => !SYSTEM_PATHS.has(p.path.replace(/\/+$/, "").toLowerCase()));
  if (privacy) pages.push({ path: "/privacy", lastmod: privacy.lastUpdated });
  if (terms) pages.push({ path: "/terms", lastmod: terms.lastUpdated });
  const body = sitemapXml({ origin: originFor(site), pages });
  return textResponse(
    body,
    "application/xml; charset=utf-8",
    site.hostKind === "custom" ? {} : { "X-Robots-Tag": "noindex" },
  );
}
