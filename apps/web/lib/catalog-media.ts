// GET/HEAD /_catalog/<slug>/<id>.<ext>: catalog screenshots (13-37; STAFF-07, P13-P21, 13-20
// deviation). Screenshots live in the private platform store at platform/catalog/<slug>/…
// and are public by design (the /start and hub add-on cards show them), so any host serves
// them: the platform route `(platform)/%5Fcatalog/…` and the tenant route
// `tenant/[host]/%5Fcatalog/…` (the middleware rewrite) both call this. The folder is `%5F…`
// because `_catalog` would be a private App Router folder. readCatalogScreenshot refuses any
// unsafe slug or file name (NotFound); every refusal is a bare 404. Server-only.
//
// WR-D10: only a screenshot in a current public listing (the merged catalog view: not
// hidden, not private, not removed) is served publicly, cached for a day and never
// `immutable`, so a removal (legal or content) takes effect within a day. Anything else is
// served only to a signed-in staff member (the listing editor previews hidden listings and
// unsaved uploads), never cached; everyone else gets the bare 404. A failed listing read
// fails closed (the fallback view carries no screenshots).
import { NotFound } from "@cds/core";
import { readCatalogScreenshot } from "@cds/db";
import { catalogEntryFor, getCatalogState } from "./catalog-view";
import { getStaffSession, staffCan } from "./staff-session";

/** A public hit is cached for a day: short enough that a removal takes effect. */
export const CATALOG_PUBLIC_CACHE = "public, max-age=86400";

export type CatalogMediaParams = {
  params: Promise<{ slug: string; file: string }>;
};

function bare(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** The screenshot is in a current public listing (WR-D10). */
async function publiclyListed(slug: string, file: string): Promise<boolean> {
  const { view, degraded } = await getCatalogState();
  if (degraded) return false;
  const id = file.replace(/\.[a-z]+$/, "");
  const entry = catalogEntryFor(view, slug);
  return entry !== null && entry.screenshots.some((s) => s.id === id);
}

async function staffViewer(): Promise<boolean> {
  try {
    const s = await getStaffSession();
    return s !== null && staffCan(s.role, "catalog_listings");
  } catch {
    return false;
  }
}

export async function serveCatalogScreenshot(
  { params }: CatalogMediaParams,
  withBody: boolean,
): Promise<Response> {
  const { slug, file } = await params;
  try {
    const listed =
      typeof slug === "string" &&
      typeof file === "string" &&
      (await publiclyListed(slug, file));
    if (!listed && !(await staffViewer())) return bare(404);
    const shot = await readCatalogScreenshot(slug, file);
    if (!shot) return bare(404);
    return new Response(withBody ? Buffer.from(shot.bytes) : null, {
      status: 200,
      headers: {
        "Content-Type": shot.contentType,
        "Content-Length": String(shot.bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": listed ? CATALOG_PUBLIC_CACHE : "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFound) return bare(404);
    console.error(
      "[catalog] screenshot read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return bare(500);
  }
}
