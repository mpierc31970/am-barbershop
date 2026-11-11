// Cached visitor reads for tenant sites (CONT-08, CONT-31, D187, D253; CONTEXT A3-Q2;
// RESEARCH Pattern 7, Pitfalls 5 and 9, State of the Art).
//
// The only file that imports unstable_cache, so the later swap to "use cache" is one file.
// Every key and tag carries the org id from the SiteContext (T-03-50: no cross-org hits):
//   - manifest       tag org:<id>:site          revalidate 300 s
//   - published page tag org:<id>:page:<pid> + org:<id>:addons  revalidate 300 s (10-42:
//     Pro tables follow Builder Pro, so a lapse or restore refreshes the page)
//   - banner+pop-ups+nav+footer tag org:<id>:live  revalidate 60 s (read live, D253; nav and
//     footer 07-25). The settings group rides the same live read (07-26: language,
//     Translate, Search, AI toggle; org:<id>:live, 60 s); 07-31 reads allow_ai_crawlers and
//     language from LiveSite.settings (or getSiteLanguage).
//   - logo id        tag org:<id>:live          revalidate 60 s (07-25 choice 8; id only, the
//     URL is resolved per request and never cached)
//   - add-on state   tag org:<id>:addons        revalidate 60 s (05-10; active slugs + hidden pages)
//   - add-on records tag org:<id>:addon:<slug>  revalidate 60 s (D253: live, public fields only)
//   - theme          tag org:<id>:theme         revalidate 60 s (THEME-02, RESEARCH Pitfall 6).
//     The CLI import records invalidation, so the 60 s window is the self-heal. Only the raw
//     PublicDesign projection is cached; resolveTheme runs per render.
//   - business       tag org:<id>:live          revalidate 60 s (07-07; business_profile writes
//     do not invalidate yet, so the 60 s window is the self-heal, like theme)
//   - consent        tag org:<id>:site + org:<id>:live  revalidate 300 s (07-14 choice 3:
//     site-wide, so publish (site tag) and pop-up saves (live tag) both refresh it)
//   - site index     tag org:<id>:site + org:<id>:live + org:<id>:addons  revalidate 300 s
//     (07-31; CONT-37, D277: index.json behind sitemap.xml, robots.txt, llms.txt and /search;
//     every rebuild point invalidates one of the three tags right after it writes)
//   - site policy    tag org:<id>:live + org:<id>:addons  revalidate 60 s (09-22; /privacy,
//     /terms and the footer links; rendered live from the acked template version)
//   - GA4 id         tag org:<id>:site + org:<id>:live  revalidate 60 s (11-32; DASH-11: the
//     measurement id only; analytics:set invalidates both tags in-process, else the window)
// Writers invalidate by tag through nextInvalidator. The 300 s / 60 s windows are a safety
// net so out-of-process writes (CLI restore, tenants:restore) self-heal without a tag.
// Only raw records are cached: the banner window is evaluated per request at render
// (isBannerVisible(banner, new Date())), never stored as an on/off flag (Pitfall 9).
import {
  addonsTag,
  addonTag,
  liveTag,
  pageTag,
  readPublicPopups,
  readPublicSiteSettings,
  readPublishedPage,
  readSiteManifest,
  readPublicDesign,
  readAddonSiteState,
  readPublicAddonRecords,
  readPublicAnalytics,
  readPublicBusiness,
  readPublicLogoId,
  readSiteIndex,
  readPublishedSitePolicy,
  siteTag,
  themeTag,
  type AddonRecord,
  type AddonSiteState,
  type PublicAnalytics,
  type PublicBusiness,
  type PublishedSitePolicy,
  type SiteContext,
  type SiteIndex,
} from "@cds/db";
import {
  SITE_SETTINGS_DEFAULTS,
  consentNeeds,
  type ConsentNeeds,
  type SiteSettingsGroup,
} from "@cds/core/content";
import type {
  BannerSettings,
  FooterSettings,
  NavSettings,
  PopupRecord,
  PublishedPage,
  SiteManifest,
} from "@cds/core/content";
import type { SitePolicyPage } from "@cds/core/legal";
import type { PublicDesign } from "@cds/core/theme";
import { unstable_cache } from "next/cache";

const PUBLISHED_REVALIDATE_S = 300;
const LIVE_REVALIDATE_S = 60;
const THEME_REVALIDATE_S = 60;
const ADDON_REVALIDATE_S = 60;

export type LiveSite = {
  banner: BannerSettings | null;
  popups: PopupRecord[];
  nav: NavSettings | null;
  footer: FooterSettings | null;
  settings: SiteSettingsGroup;
};

export function getManifest(site: SiteContext): Promise<SiteManifest | null> {
  return unstable_cache(
    () => readSiteManifest(site),
    ["manifest", site.orgId],
    { tags: [siteTag(site.orgId)], revalidate: PUBLISHED_REVALIDATE_S },
  )();
}

export function getPublishedPage(
  site: SiteContext,
  pageId: string,
): Promise<PublishedPage | null> {
  return unstable_cache(
    () => readPublishedPage(site, pageId),
    ["page", site.orgId, pageId],
    {
      // 10-42: org:<id>:addons too, so a Builder Pro lapse or restore re-projects tables.
      tags: [pageTag(site.orgId, pageId), addonsTag(site.orgId)],
      revalidate: PUBLISHED_REVALIDATE_S,
    },
  )();
}

export function getLiveSite(site: SiteContext): Promise<LiveSite> {
  return unstable_cache(
    async () => {
      const [settings, popups] = await Promise.all([
        readPublicSiteSettings(site),
        readPublicPopups(site),
      ]);
      return {
        banner: settings.banner,
        popups,
        nav: settings.nav,
        footer: settings.footer,
        // An entry cached before 07-26 (or a partial read) still renders: defaults.
        settings: settings.settings ?? { ...SITE_SETTINGS_DEFAULTS },
      };
    },
    ["live", site.orgId],
    { tags: [liveTag(site.orgId)], revalidate: LIVE_REVALIDATE_S },
  )();
}

/** The site's language for `<html lang>`; "en" when the live read fails (07-26 choice 5). */
export async function getSiteLanguage(site: SiteContext): Promise<string> {
  try {
    return (await getLiveSite(site)).settings.language;
  } catch {
    console.error("[site] language read failed");
    return SITE_SETTINGS_DEFAULTS.language;
  }
}

/**
 * The org's public site index (07-31; CONT-37, D277), or null when nothing is published.
 * A read error is logged and rethrown: /search shows its error state, the crawler routes
 * treat it as null.
 */
export async function getSiteIndex(
  site: SiteContext,
): Promise<SiteIndex | null> {
  try {
    return await unstable_cache(
      () => readSiteIndex(site),
      ["site-index", site.orgId],
      {
        tags: [siteTag(site.orgId), liveTag(site.orgId), addonsTag(site.orgId)],
        revalidate: PUBLISHED_REVALIDATE_S,
      },
    )();
  } catch (err) {
    console.error("[site] index read failed");
    throw err;
  }
}

/** The org's current logo asset id (07-25 choice 8); the URL is resolved per request. */
export function getSiteLogoId(site: SiteContext): Promise<string | null> {
  return unstable_cache(() => readPublicLogoId(site), ["logo", site.orgId], {
    tags: [liveTag(site.orgId)],
    revalidate: LIVE_REVALIDATE_S,
  })();
}

/** The org's stored theme (public projection), or null for the neutral preset. */
export function getTheme(site: SiteContext): Promise<PublicDesign | null> {
  return unstable_cache(() => readPublicDesign(site), ["theme", site.orgId], {
    tags: [themeTag(site.orgId)],
    revalidate: THEME_REVALIDATE_S,
  })();
}

/** Active add-on slugs and the seeded page ids of disabled add-ons (ADDON-05). */
export function getAddonSiteState(site: SiteContext): Promise<AddonSiteState> {
  return unstable_cache(
    () => readAddonSiteState(site),
    ["addons", site.orgId],
    { tags: [addonsTag(site.orgId)], revalidate: ADDON_REVALIDATE_S },
  )();
}

/** Published, not-held records of one add-on collection, public fields only (D253). */
export function getAddonRecords(
  site: SiteContext,
  slug: string,
  collection: string,
): Promise<AddonRecord[]> {
  return unstable_cache(
    () => readPublicAddonRecords(site, slug, collection),
    ["addon", site.orgId, slug, collection],
    {
      tags: [addonTag(site.orgId, slug), addonsTag(site.orgId)],
      revalidate: ADDON_REVALIDATE_S,
    },
  )();
}

/** The org's public business projection for hours, social and map blocks (07-07, D253). */
export function getPublicBusiness(
  site: SiteContext,
): Promise<PublicBusiness | null> {
  return unstable_cache(
    () => readPublicBusiness(site),
    ["business", site.orgId],
    { tags: [liveTag(site.orgId)], revalidate: LIVE_REVALIDATE_S },
  )();
}

/** The site's GA4 measurement id for the consent-gated loader (11-32; DASH-11). */
export function getSiteAnalytics(site: SiteContext): Promise<PublicAnalytics> {
  return unstable_cache(
    () => readPublicAnalytics(site),
    ["analytics", site.orgId],
    {
      tags: [siteTag(site.orgId), liveTag(site.orgId)],
      revalidate: LIVE_REVALIDATE_S,
    },
  )();
}

/** True when the org has a GA4 measurement id; a failed read is false (and nothing loads). */
async function hasGa4(site: SiteContext): Promise<boolean> {
  try {
    return Boolean((await readPublicAnalytics(site))?.ga4MeasurementId);
  } catch {
    console.error("[site] analytics read failed");
    return false;
  }
}

const CONSENT_MAX_PAGES = 200;

/**
 * What the whole site loads from other companies (CONT-34, D279; 07-14 choice 3): every
 * published page in the manifest (protected and hidden ones count: over-reporting only shows
 * a banner, the placeholder is the real gate) plus enabled pop-ups, plus GA4 when the org has
 * a measurement id (11-32, DASH-11: the loader waits for statistics consent). A failed page
 * read is skipped, never thrown.
 */
export function getConsentNeeds(site: SiteContext): Promise<ConsentNeeds> {
  return unstable_cache(
    async (): Promise<ConsentNeeds> => {
      const [manifest, analytics] = await Promise.all([
        readSiteManifest(site),
        hasGa4(site),
      ]);
      if (!manifest) return consentNeeds({ pages: [], popups: [], analytics });
      const ids = Object.values(manifest.pages ?? {})
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string" && id !== "")
        .slice(0, CONSENT_MAX_PAGES);
      const [pages, popups] = await Promise.all([
        Promise.all(
          ids.map(async (id) => {
            try {
              return (await getPublishedPage(site, id))?.sections ?? [];
            } catch {
              console.error("[site] consent page read failed");
              return [];
            }
          }),
        ),
        readPublicPopups(site),
      ]);
      // DASH-11 (11-32): GA4 id presence; GaLoader loads it only on "all".
      return consentNeeds({ pages, popups, analytics });
    },
    ["consent", site.orgId],
    {
      tags: [siteTag(site.orgId), liveTag(site.orgId)],
      revalidate: PUBLISHED_REVALIDATE_S,
    },
  )();
}

/**
 * 09-22 (AGR-08, D217; choice 2): one published site policy page, or null until the owner
 * acknowledged. Tags org:<id>:live + org:<id>:addons, 60 s: add-on installs refresh the
 * clauses (addons tag), the Settings › Legal publish invalidates the live tag, and the 60 s
 * window is the self-heal. The registry is a parameter (invariant 4); the key is the org and
 * the page only, since the registry is the one compiled registry.
 */
export function getPublishedSitePolicy(
  site: SiteContext,
  page: SitePolicyPage,
  registry: Parameters<typeof readPublishedSitePolicy>[1],
): Promise<PublishedSitePolicy | null> {
  return unstable_cache(
    () => readPublishedSitePolicy(site, registry, page),
    ["site-policy", site.orgId, page],
    {
      tags: [liveTag(site.orgId), addonsTag(site.orgId)],
      revalidate: LIVE_REVALIDATE_S,
    },
  )();
}
