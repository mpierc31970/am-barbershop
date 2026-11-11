// GET/HEAD /<CDS_INDEXNOW_KEY>.txt on tenant hosts (14-18 choice 5; CONT-16, RESEARCH IndexNow
// key file). The middleware rewrites the key path here only while the env key is valid. The
// key is served only on a custom (live) host: preview and redirect hosts are never submitted.
// Everything else is a bare 404.
import { indexNowKey } from "../../../../../lib/redirect-host";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

async function serve({ params }: Params, withBody: boolean): Promise<Response> {
  const key = indexNowKey();
  if (!key) return notFound();
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site || site.hostKind !== "custom") return notFound();
  return new Response(withBody ? key : null, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function GET(_req: Request, ctx: Params): Promise<Response> {
  return serve(ctx, true);
}

export function HEAD(_req: Request, ctx: Params): Promise<Response> {
  return serve(ctx, false);
}
