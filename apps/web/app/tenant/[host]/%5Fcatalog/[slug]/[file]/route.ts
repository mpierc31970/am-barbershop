// GET/HEAD /_catalog/<slug>/<file> on tenant hosts (13-37): catalog screenshots, the same
// public bytes on every host (lib/catalog-media.ts). A suspended tenant host already got the
// 503 in the middleware.
import {
  serveCatalogScreenshot,
  type CatalogMediaParams,
} from "../../../../../../lib/catalog-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ host: string; slug: string; file: string }>;
};

export function GET(_req: Request, ctx: Params): Promise<Response> {
  return serveCatalogScreenshot(ctx as CatalogMediaParams, true);
}

export function HEAD(_req: Request, ctx: Params): Promise<Response> {
  return serveCatalogScreenshot(ctx as CatalogMediaParams, false);
}
