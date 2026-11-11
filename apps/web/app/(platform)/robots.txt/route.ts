// GET /robots.txt on the platform host (13-25 choice 5; P13-P33; 15-22 choice 3, A3-Q4, P15-P4).
// Dynamic: CDS_ENV is unset at Docker build, so the body is chosen per request by
// isProductionHub(). Production lets crawlers in except the staff console, the owner hub and saved
// quote links, and names the sitemap; every other environment disallows all.
// The staff console also carries X-Robots-Tag (middleware) and noindex pages. /report is NOT
// disallowed (15 WR-A02): every tenant footer links to it, and a disallowed URL with inbound
// links is indexed URL-only; crawlable, its noindex page + X-Robots-Tag keep it out.
// Tenant hosts never reach this route (the middleware rewrites them to /tenant/<host>, whose
// robots.txt is unchanged).
import { isProductionHub } from "../../../lib/hub-env";

export const dynamic = "force-dynamic";

// Not exported: a route module may only export handlers and route config.
const PRODUCTION_ROBOTS_TXT =
  "User-agent: *\nDisallow: /staff\nDisallow: /hub\nDisallow: /start/q/\nSitemap: https://connectionsdesignstudios.com/sitemap.xml\n";
const DEV_ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

export function GET(): Response {
  return new Response(
    isProductionHub() ? PRODUCTION_ROBOTS_TXT : DEV_ROBOTS_TXT,
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
