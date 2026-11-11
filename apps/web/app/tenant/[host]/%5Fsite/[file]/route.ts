// GET/HEAD /_site/<file> on tenant hosts: the generated favicon set and share image (07-30
// choice 7; CONT-28, D235; T-07-30-05). The folder is `%5Fsite` because `_site` would be a
// private App Router folder; `_site` can never be a page slug (SLUG_RE starts [a-z0-9]).
// Only four allowlisted names are served (never manifest.json), read from the public store
// under the resolved site's own org. `?v=` equal to the manifest's version is cached for a
// year (immutable); anything else for five minutes. Every refusal is a bare 404.
import { isSiteIconFile, readSiteIconFile, readSiteIcons } from "@cds/db";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string; file: string }> };

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

async function serve(
  req: Request,
  { params }: Params,
  withBody: boolean,
): Promise<Response> {
  const { host, file } = await params;
  if (!isSiteIconFile(file)) return notFound();
  const site = await siteForRoute(host);
  if (!site) return notFound();
  try {
    const icons = await readSiteIcons(site);
    if (!icons) return notFound();
    const bytes = await readSiteIconFile(site, file);
    if (!bytes) return notFound();
    const v = new URL(req.url).searchParams.get("v");
    return new Response(withBody ? Buffer.from(bytes) : null, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control":
          v === icons.v
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300",
      },
    });
  } catch {
    console.error("[seo] site icon read failed");
    return new Response(null, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export function GET(req: Request, ctx: Params): Promise<Response> {
  return serve(req, ctx, true);
}

export function HEAD(req: Request, ctx: Params): Promise<Response> {
  return serve(req, ctx, false);
}
