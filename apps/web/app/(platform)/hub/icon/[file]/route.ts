// /hub/icon/<file>: the installable hub's icons on the platform origin (11-22; DASH-34;
// 11-UI-SPEC "Push" icon). icon-180.png / icon-512.png are the org's generated site icons
// (07-30: the logo on an opaque padded square, or the wordmark initials); monogram.svg is the
// neutral fallback (initials, ink on #F2F2EF), never a CDS mark. Session org only; signed out
// → 404 (T-11-22-05). A PNG that was never generated redirects to the monogram.
import { readOwnSiteIconFile } from "@cds/db";
import { monogramSvg } from "../../../../../lib/hub-pwa";
import { getHubSession } from "../../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = new Set(["icon-180.png", "icon-512.png", "monogram.svg"]);
const BASE = {
  "Cache-Control": "private, max-age=3600",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Review 11 IN-E01: the same URL serves every org's icon, so an unversioned request (the
 * layout's apple-touch-icon, the monogram) must revalidate, or an org switch keeps showing
 * the previous org's icon for up to an hour. A `?v=<iconVersion>` URL (the manifest's) names
 * one exact icon and may be cached.
 */
function cacheFor(req: Request): string {
  return new URL(req.url).searchParams.has("v")
    ? "private, max-age=3600"
    : "private, no-cache";
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { ...BASE, "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  if (typeof file !== "string" || !FILES.has(file)) return notFound();
  const session = await getHubSession().catch(() => null);
  if (!session) return notFound();
  if (file === "monogram.svg") {
    return new Response(monogramSvg(session.org.name), {
      headers: {
        ...BASE,
        "Cache-Control": cacheFor(req),
        "Content-Type": "image/svg+xml",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readOwnSiteIconFile(session.ctx, file);
  } catch {
    bytes = null;
  }
  if (!bytes) {
    return new Response(null, {
      status: 302,
      headers: {
        ...BASE,
        "Cache-Control": "private, no-store",
        Location: "/hub/icon/monogram.svg",
      },
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...BASE,
      "Cache-Control": cacheFor(req),
      "Content-Type": "image/png",
    },
  });
}
