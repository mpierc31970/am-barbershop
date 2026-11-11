// GET/HEAD /.well-known/cds-host on tenant hosts (14-18 choice 5; DOM-06, P14-P9). The
// middleware rewrites the public path here (folder `%5Fedge`: `_edge` would be a private App
// Router folder). The body is the host proof `cdsHostProof(host, orgId)`, so the pinned HTTPS
// prober (14-12) can tell this deployment answered for this host and org. Unknown host -> 404.
import { cdsHostProof } from "@cds/db";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

async function serve({ params }: Params, withBody: boolean): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) return new Response(null, { status: 404, headers: NO_STORE });
  try {
    const proof = cdsHostProof(site.host, site.orgId);
    return new Response(withBody ? proof : null, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error(
      "[edge] cds-host proof failed",
      err instanceof Error ? err.name : typeof err,
    );
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}

export function GET(_req: Request, ctx: Params): Promise<Response> {
  return serve(ctx, true);
}

export function HEAD(_req: Request, ctx: Params): Promise<Response> {
  return serve(ctx, false);
}
