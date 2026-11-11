// GET/HEAD /_catalog/<slug>/<file> on platform hosts (13-37; STAFF-07, 13-20): the catalog
// screenshots /start and the hub add-on screens show (lib/catalog-media.ts).
import {
  serveCatalogScreenshot,
  type CatalogMediaParams,
} from "../../../../../lib/catalog-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: CatalogMediaParams): Promise<Response> {
  return serveCatalogScreenshot(ctx, true);
}

export function HEAD(
  _req: Request,
  ctx: CatalogMediaParams,
): Promise<Response> {
  return serveCatalogScreenshot(ctx, false);
}
