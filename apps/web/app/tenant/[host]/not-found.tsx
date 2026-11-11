// Tenant 404 (CONT-28; D235 #11, D-UI-P7-31; 07-UI-SPEC lines 528-529; 07-32 choice 11;
// T-07-32-09; invariant 7: inside the tenant layout, so the full site chrome and theme show).
//
// Every unknown address on a tenant site lands here (notFound() from the catch-all page,
// including /system-404 itself). Next sets the 404 status and a noindex robots meta for
// not-found responses. Content: the owner's published "Page not found" page (kind system-404,
// manifest slug NOT_FOUND_SLUG) through the normal PageRenderer, else the default title and
// line; then always NotFoundExtras (search form when search is on, and Popular pages: the
// menu's top-level links, through 07-31's popularPages). Every data read is guarded: any
// failure falls back to the default, never a 500. No site (unknown host) -> the default only.
// 11-31: every branch carries a hidden `[data-cds-404]` marker for the layout's Beacon island.
import { TENANT_HOST_HEADER } from "@cds/core";
import { ADDON_SITE_RENDERERS } from "@cds/addon-registry/site";
import { NOT_FOUND_SLUG, type SiteContext } from "@cds/db";
import {
  NOT_FOUND_COPY,
  NotFoundExtras,
  PageRenderer,
  PageTitleHeader,
  SiteButton,
  type PopularLink,
} from "@cds/ui/site";
import type { PublishedPage } from "@cds/core/content";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { isDrawnFor, loadAddonBlockData } from "../../../lib/addon-site";
import { loadCoreBlockData } from "../../../lib/core-block-data";
import { SECTION_REGISTRY } from "../../../lib/section-registry";
import {
  getAddonSiteState,
  getLiveSite,
  getManifest,
  getPublishedPage,
} from "../../../lib/site-cache";
import {
  FORM_QUERY_HEADER,
  formQueryParams,
  parseFormStatus,
} from "../../../lib/form-status";
import { popularPages } from "../../../lib/site-chrome";
import { siteForRoute } from "../../../lib/tenant";

/** 11-31: the beacon sends a 404 marker (`t: "n"`) instead of a view when this is present. */
function NotFoundMarker() {
  return <span hidden data-cds-404="" />;
}

function DefaultNotFound({ children }: { children?: ReactNode }) {
  return (
    <main id="content" tabIndex={-1} className="outline-none" data-not-found="">
      <NotFoundMarker />
      {/* A&M fork: the logo and a way home on every missing page. */}
      <div className="mx-auto max-w-[1120px] px-6 pt-12 md:px-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/am-barber/logo.png"
          alt="A&M Barber Studio"
          width={647}
          height={472}
          className="h-auto w-[200px]"
        />
      </div>
      <PageTitleHeader title={NOT_FOUND_COPY.title} />
      <div className="mx-auto flex max-w-[1120px] flex-col items-start gap-6 px-6 pb-8 md:px-8">
        <p className="max-w-[720px] text-[length:var(--site-text-body)] leading-[1.6] text-site-text-muted">
          {NOT_FOUND_COPY.body}
        </p>
        <SiteButton text="Back to the homepage" style="primary" href="/" />
      </div>
      {children}
    </main>
  );
}

async function siteOrNull(): Promise<SiteContext | null> {
  try {
    const host = (await headers()).get(TENANT_HOST_HEADER);
    return host ? await siteForRoute(host) : null;
  } catch {
    return null;
  }
}

async function extrasFor(site: SiteContext): Promise<{
  links: PopularLink[];
  showSearch: boolean;
}> {
  try {
    const [live, manifest] = await Promise.all([
      getLiveSite(site),
      getManifest(site).catch(() => null),
    ]);
    return {
      links: await popularPages(site, { live, manifest }),
      showSearch: live.settings?.show_search === true,
    };
  } catch {
    return { links: [], showSearch: false };
  }
}

/** WR-C02: a no-JS send from this page returns here (/system-404); its status, if any. */
async function formStatusOrNull(): Promise<ReturnType<typeof parseFormStatus>> {
  try {
    const raw = (await headers()).get(FORM_QUERY_HEADER);
    return parseFormStatus(formQueryParams(raw));
  } catch {
    return null;
  }
}

/** The owner's published 404 page, or null (none, or any failed read). */
async function notFoundPage(
  site: SiteContext,
): Promise<{ id: string; page: PublishedPage } | null> {
  try {
    const manifest = await getManifest(site);
    const entry =
      manifest && Object.hasOwn(manifest.pages, NOT_FOUND_SLUG)
        ? manifest.pages[NOT_FOUND_SLUG]
        : undefined;
    if (!entry) return null;
    const page = await getPublishedPage(site, entry.id);
    return page ? { id: entry.id, page } : null;
  } catch {
    console.error("[404] page read failed");
    return null;
  }
}

export default async function TenantNotFound() {
  const site = await siteOrNull();
  if (!site) return <DefaultNotFound />;
  const [extras, owned] = await Promise.all([
    extrasFor(site),
    notFoundPage(site),
  ]);
  const extrasNode = (
    <NotFoundExtras links={extras.links} showSearch={extras.showSearch} />
  );
  if (!owned) return <DefaultNotFound>{extrasNode}</DefaultNotFound>;

  try {
    const now = new Date();
    const sections = Array.isArray(owned.page.sections)
      ? owned.page.sections
      : [];
    const active = await getAddonSiteState(site)
      .then((s) => s.active)
      .catch(() => [] as string[]);
    const [boundData, coreData] = await Promise.all([
      loadAddonBlockData(site, sections, active, now),
      loadCoreBlockData(site, sections, {
        pageId: owned.id,
        protectedPage: false,
        forms: { pageId: owned.id, status: await formStatusOrNull() },
        page: {
          url: `https://${site.primaryHost ?? site.host}/`,
          title: owned.page.page?.title ?? NOT_FOUND_COPY.title,
        },
      }),
    ]);
    return (
      <>
        <NotFoundMarker />
        <PageRenderer
          page={owned.page}
          registry={SECTION_REGISTRY}
          now={now}
          openablePopups={new Set<string>()}
          renderers={ADDON_SITE_RENDERERS}
          boundData={boundData}
          isDrawn={isDrawnFor(active, boundData)}
          coreData={coreData}
        />
        {extrasNode}
      </>
    );
  } catch {
    console.error("[404] render failed");
    return <DefaultNotFound>{extrasNode}</DefaultNotFound>;
  }
}
