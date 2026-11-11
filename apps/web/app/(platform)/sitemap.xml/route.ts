// GET /sitemap.xml on the platform host (15-22 choice 4; A3-Q4, P15-P3, P15-P4; UI-SPEC SEO).
// Lists every MARKETING_ROUTES entry with `sitemap: true` plus /add-ons/<slug> for each public
// add-on in the listing view. URLs are always on the brand apex (never the request origin); on dev
// that is harmless because robots.txt disallows all there. The view read never throws, and any
// error still answers 200 with the routes only. Tenant hosts never reach this route (the
// middleware rewrites them to /tenant/<host>/sitemap.xml).
import { sitemapXml } from "@cds/core/seo";
import { MARKETING_ROUTES } from "@cds/core/marketing";
import { getCatalogView } from "../../../lib/catalog-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Not exported: a route module may only export handlers and route config.
const ORIGIN = "https://connectionsdesignstudios.com";
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

async function addonPaths(): Promise<string[]> {
  try {
    const view = await getCatalogView();
    return view
      .filter((e) => !e.private && SLUG.test(e.slug))
      .map((e) => `/add-ons/${e.slug}`);
  } catch (err) {
    console.error(
      "[sitemap] add-on view failed:",
      err instanceof Error ? err.name : typeof err,
    );
    return [];
  }
}

export async function GET(): Promise<Response> {
  const routes = MARKETING_ROUTES.filter((r) => r.sitemap).map((r) => r.path);
  const paths = [...new Set([...routes, ...(await addonPaths())])];
  const body = sitemapXml({
    origin: ORIGIN,
    pages: paths.map((path) => ({ path, lastmod: "" })),
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
