// Public tenant page (PLAT-02, CONT-08, CONT-12, CONT-31; D22, D187, D188, D253, D254;
// CONTEXT A3-Q1; T-03-48..T-03-52). Middleware rewrites every non-platform host here.
// Route is /tenant/[host], not an underscore folder: those are private in the App Router.
//
// host -> SiteContext (header-checked, tenant.ts) -> slug -> manifest -> published JSON ->
// PageRenderer. Only published JSON is ever read: drafts, hidden blocks and unpublished
// edits live in PocketBase rows this route never touches (preview is the builder's job).
//   - [] is home; one segment is a slug; nested paths 404
//   - a previous slug in manifest.redirects 308s to its current slug, only when that
//     target is itself a published page of this org (no open redirect, T-03-52)
//   - a password-protected page shows the themed PasswordGate until the visitor's
//     cds_pp_<pageId> cookie matches (07-32; fail closed: gated when the manifest entry OR
//     the per-request, uncached readPageGate says protected; Pitfall 12)
//   - /system-404 is never visitable: the 404 page renders only through not-found.tsx
//   - a resolved org without a published home shows the EMPTY_TITLE placeholder (monitor 1b)
//   - a page seeded by a disabled add-on 404s (hiddenPageIds, ADDON-05); add-on blocks draw
//     live data (D253) only while their add-on is active and has something to show
//     (05-10). Published JSON is never changed by an install or uninstall.
//   - 11-36: when no page matched, a bio short link (/ig, /go/<code>) of this host's org
//     307s to "/?utm_source=<platform>&utm_medium=social&utm_campaign=bio" (DASH-15, D199)
// Manifest keys are looked up as own properties only, so "constructor" is just a 404.
// SEO (07-30; CONT-13, CONT-14, CONT-28; D170, D188, D253; Pitfalls 9, 15): generateMetadata
// maps core pageMeta (canonical from the org's primary host, never the Host header; robots
// from the matched host's kind; OG/Twitter with the share image chain). The page renders one
// escaped JSON-LD script (buildJsonLd + serializeJsonLd) from live data; any failed read omits
// its part, never a 500. Share buttons get the canonical URL.
// Protected pages (07-32; CONT-28, CONT-33; D255; choices 3, 7): gate view and unlocked view
// are both noindex (robotsFor protectedPage), carry no description and no share image, give
// JSON-LD no sections, and tokenize every media URL (loadCoreBlockData protectedPage). The gate
// view renders no pop-ups. The route is force-dynamic, so Next sends Cache-Control no-store.
// Draft preview links (14-20; DOM-07, D22; T-14-20-01, -02): on a preview host only, a valid
// `cds_pv` cookie (set by /_site/preview, MAC-verified, token org = this site's org) makes the
// page it names render its draft through previewPageForLink (never the site cache) instead of
// the published JSON; a draft-only page is reachable at its draft slug. Every other page, and
// any invalid, expired or other-org cookie, renders published. Draft renders are noindex,
// nofollow and no-store (force-dynamic).
import {
  parseGalleryPages,
  type PublishedPage,
  type SiteManifest,
} from "@cds/core/content";
import {
  buildJsonLd,
  canonicalOrigin,
  canonicalUrl,
  pageMeta,
  robotsFor,
  sanitizeAddonNodes,
  serializeJsonLd,
  slugPathFor,
  type JsonLdGraph,
  type MetaImageSource,
} from "@cds/core/seo";
import {
  NOT_FOUND_SLUG,
  gateCookieName,
  gateCookieValid,
  readPageGate,
  resolvePublicMedia,
  resolveShortCode,
  verifyPreviewToken,
  type SiteContext,
} from "@cds/db";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  PageRenderer,
  PasswordGate,
  PopupHost,
  openablePopupIds,
} from "@cds/ui/site";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ADDON_SITE_RENDERERS } from "@cds/addon-registry/site";
import { isDrawnFor, loadAddonBlockData } from "../../../../lib/addon-site";
import { loadCoreBlockData } from "../../../../lib/core-block-data";
import { parseFormResume, parseFormStatus } from "../../../../lib/form-status";
import { parseGateStatus } from "../../../../lib/gate-status";
import { draftFor } from "../../../../lib/preview-draft";
import { PREVIEW_COOKIE } from "../../../../lib/redirect-host";
import { SECTION_REGISTRY } from "../../../../lib/section-registry";
import {
  getPublicRecords,
  getSiteIcons,
  siteAssetHref,
} from "../../../../lib/seo-cache";
import {
  getAddonSiteState,
  getLiveSite,
  getManifest,
  getPublicBusiness,
  getPublishedPage,
} from "../../../../lib/site-cache";
import { resolveSlug, siteForRequest } from "../../../../lib/tenant";

export const dynamic = "force-dynamic";

// The empty-site placeholder is never indexed, on any host (treated like a preview host).
const PLACEHOLDER_ROBOTS = robotsFor({ hostKind: "preview" });

// Monitor check 1b looks for this text to tell a tenant placeholder from the hub.
const EMPTY_TITLE = "No site here yet";

type Props = {
  params: Promise<{ host: string; path?: string[] }>;
  // 07-19: the no-JS form status (?form=&item=&sent=|err=&f=), parsed by parseFormStatus.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type Resolved =
  | { kind: "empty"; site: SiteContext }
  | {
      kind: "page";
      site: SiteContext;
      pageId: string;
      /** 07-24: the resolved slug (share URL; 07-30 swaps in the canonical URL). */
      slug: string;
      page: PublishedPage;
      active: string[];
      /** 07-32: the manifest entry says protected (the live row is read per request too). */
      entryProtected: boolean;
      /** 14-20: the draft of this page, shown through a valid preview link. */
      draft: boolean;
    };

function own<T>(rec: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

function pageTitle(page: PublishedPage): string {
  const seo = page.page?.seo ?? {};
  return seo.meta_title?.trim() || page.page?.title?.trim() || "";
}

function entryFor(manifest: SiteManifest | null, slug: string) {
  return manifest ? own(manifest.pages, slug) : undefined;
}

/** utm_source value: lower-case letters, digits and dashes only, at most 32 characters. */
function utmSource(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * 11-36 (DASH-15, D199; T-11-36-01, -02): a bio short link (`/ig`, `/go/<code>`) redirects
 * to this site's own home with UTM tags. Called only after the page lookups failed, so a
 * page always wins (Pitfall 19). Codes resolve for the host's org only; the target is
 * always "/" on the same host, only the encoded query varies. Unknown codes (or a failed
 * read) return and the caller 404s.
 */
async function redirectShortLink(
  site: SiteContext,
  path: readonly string[] | undefined,
): Promise<void> {
  if (!path || path.length < 1 || path.length > 2) return;
  let hit: { platform: string } | null = null;
  try {
    hit = await resolveShortCode(site, path);
  } catch {
    console.error("[short-link] lookup failed");
    return;
  }
  if (!hit) return;
  // A custom account's source is its own code (the label slug, e.g. "etsy").
  const code = path[path.length - 1] ?? "";
  const source = utmSource(hit.platform === "custom" ? code : hit.platform);
  if (!source) return;
  redirect(
    `/?utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=bio`,
  );
}

type DraftLink = { token: string; pageId: string };

/** 14-20: the valid, org-matched `cds_pv` link on a preview host, or null. */
async function draftLinkFor(site: SiteContext): Promise<DraftLink | null> {
  if (site.hostKind !== "preview") return null;
  let token: string | undefined;
  try {
    token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;
  const v = verifyPreviewToken(token);
  if (v.status !== "valid" || v.orgId !== site.orgId) return null;
  return { token, pageId: v.pageId };
}

async function resolveRequest(params: Props["params"]): Promise<Resolved> {
  const { host, path } = await params;
  const site = await siteForRequest(host);
  const slug = resolveSlug(path);
  const link = slug === null ? null : await draftLinkFor(site);
  // 14-20: a draft-only page (no published entry) at its draft slug, via the link only.
  const draftBySlug = async (): Promise<Resolved | null> => {
    if (!link || slug === null) return null;
    const page = await draftFor(site.orgId, link.token);
    if (!page || page.page?.slug !== slug) return null;
    const addons = await getAddonSiteState(site);
    if (addons.hiddenPageIds.includes(link.pageId)) return null;
    return {
      kind: "page",
      site,
      pageId: link.pageId,
      slug,
      page,
      active: addons.active,
      entryProtected: false,
      draft: true,
    };
  };
  if (slug === null) {
    // `/go/<code>` arrives as two segments, which no page can own.
    await redirectShortLink(site, path);
    notFound();
  }
  // 07-32 (T-07-32-09): the 404 page is shown only by not-found.tsx, never at its slug.
  if (slug === NOT_FOUND_SLUG) notFound();
  if (slug === "home" && path && path.length > 0) permanentRedirect("/");

  const manifest = await getManifest(site);
  if (slug === "home" && !entryFor(manifest, "home")) {
    return (await draftBySlug()) ?? { kind: "empty", site };
  }
  if (!manifest) {
    const d = await draftBySlug();
    if (d) return d;
    await redirectShortLink(site, path);
    notFound();
  }

  const target = own(manifest.redirects, slug);
  if (target !== undefined && !own(manifest.pages, slug)) {
    if (typeof target === "string" && own(manifest.pages, target)) {
      permanentRedirect(slugPathFor(target));
    }
    notFound();
  }

  const entry = own(manifest.pages, slug);
  if (!entry) {
    const d = await draftBySlug();
    if (d) return d;
    await redirectShortLink(site, path);
    notFound();
  }
  // A disabled add-on's seeded page is hidden, never deleted (ADDON-05, T-05-49).
  const addons = await getAddonSiteState(site);
  if (addons.hiddenPageIds.includes(entry.id)) notFound();
  // 14-20: the page the preview link names renders its draft (published when it fails).
  const draft =
    link && link.pageId === entry.id
      ? await draftFor(site.orgId, link.token)
      : null;
  if (draft) {
    return {
      kind: "page",
      site,
      pageId: entry.id,
      slug,
      page: draft,
      active: addons.active,
      entryProtected: entry.protected === true,
      draft: true,
    };
  }
  const page = await getPublishedPage(site, entry.id);
  if (!page) {
    if (slug === "home") return { kind: "empty", site };
    notFound();
  }
  return {
    kind: "page",
    site,
    pageId: entry.id,
    slug,
    page,
    active: addons.active,
    entryProtected: entry.protected === true,
    draft: false,
  };
}

type Gate = { protectedPage: boolean; unlocked: boolean };

/**
 * Per request, never cached (Pitfall 12): protected when the manifest entry or the live row
 * says so; unlocked only with a cookie minted for this org, page and current password
 * version. A failed gate read is treated as protected and locked (fail closed).
 */
async function gateFor(r: Extract<Resolved, { kind: "page" }>): Promise<Gate> {
  let gate: Awaited<ReturnType<typeof readPageGate>> = null;
  let failed = false;
  try {
    gate = await readPageGate(r.site, r.pageId);
  } catch {
    failed = true;
    console.error("[gate] read failed");
  }
  const protectedPage = r.entryProtected || failed || gate?.protected === true;
  if (!protectedPage) return { protectedPage: false, unlocked: false };
  if (!gate) return { protectedPage: true, unlocked: false };
  let value: string | undefined;
  try {
    value = (await cookies()).get(gateCookieName(r.pageId))?.value;
  } catch {
    return { protectedPage: true, unlocked: false };
  }
  const unlocked = gateCookieValid({
    orgId: r.site.orgId,
    pageId: r.pageId,
    version: gate.version,
    value,
    now: new Date(),
  });
  return { protectedPage: true, unlocked };
}

async function businessOrNull(site: SiteContext) {
  try {
    return await getPublicBusiness(site);
  } catch {
    console.error("[seo] business read failed");
    return null;
  }
}

async function iconsOrNull(site: SiteContext) {
  try {
    return await getSiteIcons(site);
  } catch {
    return null;
  }
}

/** One library photo as a share image source, or null (missing, failed read). */
async function shareSource(
  site: SiteContext,
  id: string | undefined,
): Promise<MetaImageSource | null> {
  if (!id) return null;
  try {
    const m = (await resolvePublicMedia(site, [id]))[id];
    if (!m || m.kind !== "image" || !m.src) return null;
    return { src: m.src, width: m.width, height: m.height, alt: m.alt };
  } catch {
    return null;
  }
}

function canonicalFor(site: SiteContext, slug: string): string {
  return canonicalUrl({
    primaryHost: site.primaryHost,
    fallbackHost: site.host,
    slug,
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await resolveRequest(params);
  if (r.kind === "empty") {
    return { title: EMPTY_TITLE, robots: PLACEHOLDER_ROBOTS };
  }
  const { protectedPage } = await gateFor(r);
  const fullSeo = r.page.page?.seo ?? {};
  // 07-32 (choice 7): a protected page has no description and no share image.
  const seo = protectedPage
    ? fullSeo.meta_title
      ? { meta_title: fullSeo.meta_title }
      : {}
    : fullSeo;
  const [business, live, icons, pageImage] = await Promise.all([
    businessOrNull(r.site),
    protectedPage ? null : getLiveSite(r.site).catch(() => null),
    protectedPage ? null : iconsOrNull(r.site),
    protectedPage ? null : shareSource(r.site, fullSeo.share_image),
  ]);
  const siteImage = protectedPage
    ? null
    : await shareSource(r.site, live?.settings?.share_image);
  const meta = pageMeta({
    primaryHost: r.site.primaryHost,
    fallbackHost: r.site.host,
    hostKind: r.site.hostKind,
    pageKind: "builder",
    protectedPage,
    slug: r.slug,
    isHome: r.slug === "home",
    pageTitle: r.page.page?.title ?? "",
    seo,
    businessName: business?.name || r.site.host,
    sections:
      !protectedPage && Array.isArray(r.page.sections) ? r.page.sections : [],
    pageImage,
    siteImage,
    generatedImage: protectedPage ? null : siteAssetHref(icons, "share.png"),
  });
  // 14-20 (T-14-20-01): a draft render is never indexed or followed.
  const robots = r.draft
    ? { index: false, follow: false }
    : protectedPage
      ? robotsFor({ hostKind: r.site.hostKind, protectedPage: true })
      : meta.robots;
  const description = protectedPage ? "" : meta.description;
  const images = meta.openGraph.images.map((i) => ({
    url: i.url,
    alt: i.alt,
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
  }));
  return {
    title: meta.title,
    ...(description ? { description } : {}),
    alternates: { canonical: meta.canonical },
    robots,
    openGraph: {
      type: "website",
      url: meta.openGraph.url,
      title: meta.openGraph.title,
      ...(description ? { description } : {}),
      ...(meta.openGraph.siteName ? { siteName: meta.openGraph.siteName } : {}),
      ...(images.length > 0 && !protectedPage ? { images } : {}),
    },
    twitter: {
      card: meta.twitter.card,
      title: meta.twitter.title,
      ...(description ? { description } : {}),
      ...(meta.twitter.images.length > 0 && !protectedPage
        ? { images: meta.twitter.images }
        : {}),
    },
  };
}

/** Active add-ons' JSON-LD nodes, through the registry only; each call isolated (T-07-30-10). */
function addonJsonLd(
  active: readonly string[],
  pageUrl: string,
  origin: string,
): unknown[] {
  const out: unknown[] = [];
  for (const m of ADDON_REGISTRY.list()) {
    if (!active.includes(m.slug) || typeof m.jsonLd !== "function") continue;
    try {
      out.push(...sanitizeAddonNodes(m.jsonLd({ pageUrl, origin, data: {} })));
    } catch {
      console.error("[seo] add-on json-ld failed", m.slug);
    }
  }
  return out;
}

/** The page's @graph from live data, or null when building it fails. */
async function pageJsonLd(
  r: Extract<Resolved, { kind: "page" }>,
  media: Readonly<Record<string, { src: string; poster?: string }>>,
  protectedPage = false,
): Promise<JsonLdGraph | null> {
  try {
    const origin = canonicalOrigin({
      primaryHost: r.site.primaryHost,
      fallbackHost: r.site.host,
    });
    const pageUrl = canonicalFor(r.site, r.slug);
    const [business, records, icons] = await Promise.all([
      businessOrNull(r.site),
      getPublicRecords(r.site).catch(() => ({ services: [], team: [] })),
      iconsOrNull(r.site),
    ]);
    return buildJsonLd({
      origin,
      pageUrl,
      page: {
        title: r.page.page?.title ?? "",
        slug: r.slug,
        isHome: r.slug === "home",
        publishedAt: r.page.published_at ?? "",
      },
      business: business
        ? {
            name: business.name,
            businessType: business.business_type,
            phone: business.phone,
            email: business.public_email,
            address: business.address,
            timeZone: business.time_zone,
            hours: business.hours,
            socials: business.socials,
            logoUrl:
              icons?.source === "logo"
                ? (siteAssetHref(icons, "icon-512.png") ?? undefined)
                : undefined,
          }
        : null,
      services: records.services.map((s) => ({
        name: s.name,
        description: s.description,
        priceCents: s.price_cents,
        priceDisplay: s.price_display,
      })),
      team: records.team.map((m) => ({ name: m.name, role: m.role })),
      // 07-32 (choice 7): a protected page's sections never reach JSON-LD.
      sections:
        !protectedPage && Array.isArray(r.page.sections) ? r.page.sections : [],
      media: protectedPage ? {} : media,
      addonNodes: addonJsonLd(r.active, pageUrl, origin),
    });
  } catch {
    console.error("[seo] json-ld failed");
    return null;
  }
}

export default async function TenantPage({ params, searchParams }: Props) {
  const r = await resolveRequest(params);
  if (r.kind === "empty") {
    return (
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-[60vh] max-w-[1120px] flex-col justify-center px-6 py-16 outline-none md:px-8"
      >
        <h1 className="text-[length:var(--site-text-h2)] leading-tight font-semibold">
          {EMPTY_TITLE}
        </h1>
        <p className="mt-4 text-site-text-muted">
          This website is being built. Please check back soon.
        </p>
      </main>
    );
  }
  const now = new Date();
  const sections = Array.isArray(r.page.sections) ? r.page.sections : [];
  // One await of searchParams (07-22): form status (07-19), gallery pages (?g<id>=N) and the
  // gate status (07-32, ?gate=wrong|rate&wait=N).
  const sp = searchParams ? await searchParams : null;
  const { protectedPage, unlocked } = await gateFor(r);
  if (protectedPage && !unlocked) {
    // The gate: the page title only; no sections, media, JSON-LD or pop-ups.
    return (
      <PasswordGate
        title={r.page.page?.title ?? ""}
        action={`/api/gate/${r.pageId}`}
        status={parseGateStatus(sp)}
      />
    );
  }
  const formStatus = parseFormStatus(sp);
  const [live, boundData, coreData] = await Promise.all([
    getLiveSite(r.site),
    loadAddonBlockData(r.site, sections, r.active, now),
    loadCoreBlockData(r.site, sections, {
      // 07-32: protected pages tokenize every media URL (CONT-33, D255).
      pageId: r.pageId,
      protectedPage,
      // 10-40: a "Finish your form" link (?resume=) pre-fills its Builder Pro form.
      forms: {
        pageId: r.pageId,
        status: formStatus,
        resume: parseFormResume(sp),
      },
      // 07-24 (choice 5): share buttons get the canonical URL (07-30).
      page: {
        url: canonicalFor(r.site, r.slug),
        title: pageTitle(r.page) || r.site.host,
      },
    }),
  ]);
  const graph = await pageJsonLd(r, coreData.media ?? {}, protectedPage);
  return (
    <>
      {graph && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
        />
      )}
      {/* Buttons for a disabled or deleted pop-up are not rendered (WR-C07). */}
      <PageRenderer
        page={r.page}
        registry={SECTION_REGISTRY}
        now={now}
        openablePopups={openablePopupIds(live.popups, r.pageId)}
        renderers={ADDON_SITE_RENDERERS}
        boundData={boundData}
        isDrawn={isDrawnFor(r.active, boundData)}
        coreData={{ ...coreData, galleryPages: parseGalleryPages(sp) }}
      />
      <PopupHost
        popups={live.popups}
        pageId={r.pageId}
        now={now}
        coreData={coreData}
      />
    </>
  );
}
