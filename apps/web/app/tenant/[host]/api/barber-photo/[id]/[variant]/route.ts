// GET /api/barber-photo/<mediaId>/<web|thumb> on tenant hosts: a published barber's photo.
// The site comes only from siteForRoute; readPublicSeatPhoto serves only images that belong
// to a published seat of that site's org. Every refusal is 404.
import { readPublicSeatPhoto } from "@cds/db";
import { siteForRoute } from "../../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ host: string; id: string; variant: string }>;
};

export async function GET(
  _req: Request,
  { params }: Params,
): Promise<Response> {
  const { host, id, variant } = await params;
  const site = await siteForRoute(host);
  if (!site || (variant !== "web" && variant !== "thumb")) {
    return new Response(null, { status: 404 });
  }
  try {
    const { bytes, mime } = await readPublicSeatPhoto(site, id, variant);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
