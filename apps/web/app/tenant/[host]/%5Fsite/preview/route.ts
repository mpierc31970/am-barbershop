// GET /_site/preview?t=<token> on a preview host (14-20; DOM-07, D22, D57; RESEARCH Pattern 7;
// T-14-20-02, T-14-20-03). The hub mints the signed 60-minute `preview.` token (mintPreviewLink);
// this route turns it into the host-only `cds_pv` cookie and 303s to the page, so the token
// leaves the address bar and the hub session cookie never crosses hosts (Invariant 10).
//   - valid, token org = this site's org, preview host -> cds_pv=<token> (HttpOnly, SameSite=Lax,
//     Secure in production, Max-Age = the remaining TTL), 303 to the page's path
//   - anything else (expired, tampered, another org, custom host) -> cds_pv=<raw token> with
//     Max-Age=300 and 303 to "/": the strip (14-19) sees a present-but-invalid cookie and shows
//     the expired variant while the published page renders. Never a draft.
// SameSite=Lax, not Strict: the first hop is a cross-site navigation from the hub (Pattern 7).
// The page path: the manifest's published slug for the page id; a draft-only page uses its
// draft slug (read through previewPageForLink). Every response is no-store.
import { previewPageForLink, verifyPreviewToken } from "@cds/db";
import {
  INVALID_LINK_COOKIE_SECONDS,
  PREVIEW_COOKIE,
} from "../../../../../lib/redirect-host";
import { SECTION_REGISTRY } from "../../../../../lib/section-registry";
import { getManifest } from "../../../../../lib/site-cache";
import { siteForRoute } from "../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

function cookieHeader(value: string, maxAge: number): string {
  // The token alphabet is [A-Za-z0-9._-]; anything else is never echoed into a header.
  const safe = /^[A-Za-z0-9._-]{0,200}$/.test(value) ? value : "invalid";
  const secure = process.env.CDS_ENV === "production" ? "; Secure" : "";
  return `${PREVIEW_COOKIE}=${safe}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function redirect303(location: string, cookie?: string): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function pathForSlug(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}

/** The published slug for a page id (own properties only), or null. */
function publishedSlug(
  manifest: Awaited<ReturnType<typeof getManifest>>,
  pageId: string,
): string | null {
  if (!manifest) return null;
  for (const slug of Object.keys(manifest.pages)) {
    if (
      Object.hasOwn(manifest.pages, slug) &&
      manifest.pages[slug]?.id === pageId
    ) {
      return slug;
    }
  }
  return null;
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { host } = await params;
  const site = await siteForRoute(host);
  if (!site) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const now = Date.now();
  const v = verifyPreviewToken(raw, now);
  const refused = () =>
    redirect303(
      "/",
      raw ? cookieHeader(raw, INVALID_LINK_COOKIE_SECONDS) : undefined,
    );
  if (
    v.status !== "valid" ||
    v.orgId !== site.orgId ||
    site.hostKind !== "preview"
  ) {
    return refused();
  }
  let slug: string | null = null;
  try {
    slug = publishedSlug(await getManifest(site), v.pageId);
    if (slug === null) {
      const draft = await previewPageForLink(site, raw, SECTION_REGISTRY, now);
      if (draft.status !== "draft") return refused();
      const s = draft.page.page?.slug ?? "";
      slug = SLUG_RE.test(s) ? s : null;
    }
  } catch (err) {
    console.error(
      "[preview-link] landing failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  const maxAge = Math.max(1, Math.floor((v.expiresAt - now) / 1000));
  return redirect303(slug ? pathForSlug(slug) : "/", cookieHeader(raw, maxAge));
}
