// Tenant site shell (CONT-11, D117, D123; 03-UI-SPEC "Site rendering contract";
// RESEARCH Pitfall 9). Order (UI-SPEC "Site chrome (public)"): skip link -> banner ->
// SiteHeader -> page (<main id="content">) -> SiteFooter -> cookie banner.
// Header and footer (07-25; CONT-13, D249, D253) come from the 60 s live cache through
// loadSiteChrome; a thrown chrome load falls back to a host wordmark and a bottom-row footer,
// so the Report link (D249) is always there and chrome never 500s. Everything sits inside SiteThemeScope: [data-site] carries
// the --site-* tokens and data-theme=<hash8> scopes the org's theme <style> (THEME-02, D46,
// D-UI-P4-10). The theme comes from the 60 s theme cache and is resolved per render; an org
// with no design, an unusable one, or a failed theme read renders the neutral preset
// (hash 00000000).
// The banner record comes from the 60 s live cache; its schedule window is evaluated here
// per request with new Date(), never cached as on/off.
// Pop-ups are mounted by the page, not here: only the page knows its page id.
// Cookie banner (CONT-34, D279; 07-14 choice 3): consent needs are site-wide (any
// third-party frame on any published page or enabled pop-up), so the decision lives here.
// It is mounted as the last child only when the site needs consent; the `cds_consent` cookie
// is read server-side so a returning visitor sees no banner flash. A failed needs read means
// no banner, never a 500 (the placeholders still gate every frame).
// Site settings (07-26; CONT-29, D237, D-UI-P7-29): SiteThemeScope gets the site language
// (<html lang> itself is set in the root layout); the header gets the Search link
// (show_search -> "/search") and the Translate island in its utility slot (show_translate),
// on the normal and the fallback chrome alike.
// Policy pages (09-22; AGR-08, D217): the footer's Privacy · Terms links and the cookie
// banner's privacy link come from chrome.policyLinks (fallback chrome: none).
// Site icons (07-30; CONT-28, D235): generateMetadata links the generated favicon set from
// /_site/<file>?v= (32 and 512 rel=icon, 180 apple-touch-icon); none until it is generated.
// Site metrics (11-31; DASH-11, DASH-15): the cookieless Beacon island is mounted last on every
// non-preview host (preview hosts are in development, D170). It waits for idle and sends to
// /api/m, which counts only live orgs (DASH-32) and drops bots, so no consent gate is needed.
// GA4 (11-32; DASH-11, D196): when staff recorded a measurement id (analytics:set), the site
// needs consent (getConsentNeeds counts it) and GaLoader is mounted on non-preview hosts; it
// injects gtag only after the visitor's choice is "all". A failed id read loads nothing.
// Preview strip (14-19; DOM-09, D170, D-UI-P14-14..16): on a preview host only, PreviewStrip is
// the first element, before SiteThemeScope (outside [data-site], no theme tokens). Its variant
// comes from the `cds_pv` cookie: a valid, org-matched token -> draft on the page it names when
// the draft read succeeds (WR-D01: other pages render published, so normal); a cookie present but not
// valid (expired, tampered, other org) -> expired; none -> normal. Custom and redirect hosts
// render nothing new.
// Review mode (14-35 choice 4; DOM-10, D172, D-UI-P14-12, D-UI-P14-13; T-14-35-03): on a preview
// host with a `cds_rv` cookie that reviewContextForToken accepts (owner, not impersonating,
// this org, review stage), the hub-styled skip link comes first, then PreviewStrip
// variant="review" (page line from x-cds-tenant-path -> reviewPages index/title; the one-line
// status from `?rs=` read through the middleware's form-query header), then the themed root
// with a server-rendered bottom padding equal to the bar, then the fixed ReviewBar (only on a
// page in the review set). A phone session (token mode phone) gets Checked on my phone in the
// strip on the first page. The note page (/_site/review/note) draws its own platform chrome,
// so this layout renders nothing around it on a preview host. Custom and redirect hosts never
// read the cookie. Any failure renders the normal strip.
import {
  CONSENT_COOKIE,
  cookieText,
  parseConsentChoice,
  type ConsentNeeds,
  type SiteManifest,
} from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import { Banner, SiteFooter, SiteHeader, SiteThemeScope } from "@cds/ui/site";
import {
  Beacon,
  ConsentController,
  CookieChoicesLink,
  GaLoader,
  TranslateLink,
} from "@cds/ui/site/client";
import {
  platformUrl,
  reviewContextForToken,
  reviewPages,
  verifyReviewToken,
  type SiteContext,
} from "@cds/db";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import {
  getConsentNeeds,
  getLiveSite,
  getSiteAnalytics,
  getManifest,
  getTheme,
} from "../../../lib/site-cache";
import {
  fallbackChrome,
  loadSiteChrome,
  type SiteChrome,
} from "../../../lib/site-chrome";
import { getSiteIcons, siteAssetHref } from "../../../lib/seo-cache";
import { siteForRequest, siteForRoute } from "../../../lib/tenant";
import { previewStripVariantFor } from "../../../lib/preview-draft";
import { themeOrNeutral } from "../../../lib/theme-read";
import { FORM_QUERY_HEADER, formQueryParams } from "../../../lib/form-status";
import {
  PREVIEW_COOKIE,
  REVIEW_COOKIE,
  TENANT_PATH_HEADER,
} from "../../../lib/redirect-host";
import {
  REVIEW_NOTE_PATH,
  pageIndexForPath,
  reviewStatusLine,
  safeReviewPath,
} from "../../../lib/review-mode";
import {
  PreviewStrip,
  type PreviewStripVariant,
  type ReviewStripInfo,
} from "./_chrome/PreviewStrip";
import {
  REVIEW_BAR_PADDING,
  ReviewBar,
  type ReviewBarProps,
} from "./_chrome/ReviewBar";
import { AmIntro } from "./_chrome/AmIntro";
import "./am-barber.css";

type Props = { children: ReactNode; params: Promise<{ host: string }> };

/** A&M fork: the one site's key for its scoped CSS (am-barber.css) and first-visit intro. */
const AM_SITE = "am-barber";

const NO_CONSENT: ConsentNeeds = {
  needed: false,
  frames: [],
  analytics: false,
};

async function manifestOrNull(site: SiteContext): Promise<SiteManifest | null> {
  try {
    return (await getManifest(site)) ?? null;
  } catch {
    return null;
  }
}

async function consentNeedsOrNone(site: SiteContext): Promise<ConsentNeeds> {
  try {
    return (await getConsentNeeds(site)) ?? NO_CONSENT;
  } catch {
    console.error("[site] consent needs failed");
    return NO_CONSENT;
  }
}

async function ga4IdOrNull(site: SiteContext): Promise<string | null> {
  try {
    return (await getSiteAnalytics(site))?.ga4MeasurementId ?? null;
  } catch {
    console.error("[site] analytics read failed");
    return null;
  }
}

type ReviewState = { strip: ReviewStripInfo; bar: ReviewBarProps | null };

/**
 * 14-35 choice 4: review mode for this request, or null. The cheap MAC check runs first; only
 * a valid, org-matched token costs the membership re-check (reviewContextForToken) and the
 * page list. Any failure is null (the normal strip).
 */
async function reviewMode(
  site: SiteContext,
  token: string | undefined,
  path: string | null,
  query: Record<string, string> | null,
  now: Date,
): Promise<ReviewState | null> {
  if (!token) return null;
  const v = verifyReviewToken(token, now);
  if (v.status !== "valid" || v.orgId !== site.orgId) return null;
  try {
    const ctx = await reviewContextForToken(token, { now });
    if (!ctx || ctx.orgId !== site.orgId) return null;
    const pages = await reviewPages(ctx);
    const i = pageIndexForPath(pages, path);
    const page = i >= 0 ? pages[i]! : null;
    let backHref = "/";
    try {
      backHref = platformUrl("/hub/review");
    } catch {
      console.error("[site] review back link failed");
    }
    const href = (k: number) =>
      k >= 0 && k < pages.length
        ? (safeReviewPath(pages[k]!.path) ?? null)
        : null;
    return {
      strip: {
        page: page
          ? { index: i + 1, total: pages.length, title: page.title }
          : null,
        status: reviewStatusLine(query, pages),
        backHref,
        phoneCheckPageId:
          v.mode === "phone" && i === 0 && page ? page.id : null,
      },
      bar: page
        ? {
            page: { id: page.id, title: page.title, status: page.status },
            index: i + 1,
            total: pages.length,
            prevHref: href(i - 1),
            nextHref: href(i + 1),
          }
        : null,
    };
  } catch (err) {
    console.error(
      "[site] review mode failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

/** 07-30: favicon links from the generated set; {} when none or on any failure. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  try {
    const { host } = await params;
    const site = await siteForRoute(host);
    if (!site) return {};
    const icons = await getSiteIcons(site);
    const i32 = siteAssetHref(icons, "icon-32.png");
    const i512 = siteAssetHref(icons, "icon-512.png");
    const i180 = siteAssetHref(icons, "icon-180.png");
    if (!i32 || !i512 || !i180) return {};
    return {
      icons: {
        icon: [
          { url: i32, sizes: "32x32", type: "image/png" },
          { url: i512, sizes: "512x512", type: "image/png" },
        ],
        apple: [{ url: i180, sizes: "180x180", type: "image/png" }],
      },
    };
  } catch {
    return {};
  }
}

export default async function TenantLayout({ children, params }: Props) {
  const { host } = await params;
  const site = await siteForRequest(host);
  const reqHeaders = await headers();
  const tenantPath = reqHeaders.get(TENANT_PATH_HEADER);
  // 14-35 choice 3: the review note page draws its own platform chrome (no theme).
  if (site.hostKind === "preview" && tenantPath === REVIEW_NOTE_PATH) {
    return <>{children}</>;
  }
  const [live, design, needs, manifest, jar, ga4Id] = await Promise.all([
    getLiveSite(site),
    // A theme read failure renders the neutral preset, never a 500 (WR-04).
    themeOrNeutral(getTheme(site), "site"),
    consentNeedsOrNone(site),
    manifestOrNull(site),
    cookies(),
    ga4IdOrNull(site),
  ]);
  const now = new Date();
  let chrome: SiteChrome;
  try {
    chrome = await loadSiteChrome(site, { live, manifest, now });
  } catch {
    console.error("[site] chrome failed");
    chrome = fallbackChrome(site.host, now);
  }
  const theme = resolveTheme(design);
  const choice = parseConsentChoice(jar.get(CONSENT_COOKIE)?.value);
  // 09-22: /privacy is the system policy page now (a reserved slug); link it once published.
  const privacyHref = chrome.policyLinks.privacy ? "/privacy" : undefined;
  const review =
    site.hostKind === "preview"
      ? await reviewMode(
          site,
          jar.get(REVIEW_COOKIE)?.value,
          tenantPath,
          formQueryParams(reqHeaders.get(FORM_QUERY_HEADER)),
          now,
        )
      : null;
  // 14-19 choice 2, WR-D01: "draft" only when this page renders the link's draft (the
  // page's own rule, one shared draft read); any other page with a valid link reads normal.
  const draftVariant: PreviewStripVariant =
    site.hostKind === "preview" && !review
      ? await previewStripVariantFor({
          token: jar.get(PREVIEW_COOKIE)?.value,
          orgId: site.orgId,
          pathname: tenantPath,
          manifest,
          now,
        })
      : "normal";
  const skipLink = (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-[var(--site-radius-button)] focus:bg-site-surface focus:px-4 focus:py-3 focus:font-semibold focus:text-site-text focus:shadow-[var(--site-shadow-overlay)]"
    >
      Skip to content
    </a>
  );
  const strip = review ? (
    <PreviewStrip variant="review" review={review.strip} />
  ) : site.hostKind === "preview" ? (
    <PreviewStrip variant={draftVariant} />
  ) : null;
  return (
    <>
      {/* 14-35: in review mode the skip link precedes the strip (hub style, outside the theme). */}
      {review ? (
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-hub-surface focus:px-4 focus:py-3 focus:font-hub focus:font-semibold focus:text-hub-ink focus:shadow-lg"
        >
          Skip to content
        </a>
      ) : null}
      {strip}
      <SiteThemeScope
        site={AM_SITE}
        theme={theme}
        lang={live.settings.language}
        className={
          review?.bar ? `min-h-screen ${REVIEW_BAR_PADDING}` : "min-h-screen"
        }
      >
        {review ? null : skipLink}
        <Banner banner={live.banner} now={now} />
        <SiteHeader
          brand={chrome.header.brand}
          nav={chrome.header.nav}
          searchHref={live.settings.show_search ? "/search" : null}
          utilities={live.settings.show_translate ? <TranslateLink /> : null}
        />
        {children}
        <SiteFooter
          footer={chrome.footer}
          reportHref={chrome.reportHref}
          policyLinks={chrome.policyLinks}
          cookieChoices={needs.needed ? <CookieChoicesLink /> : null}
        />
        {needs.needed ? (
          <ConsentController
            text={cookieText(needs)}
            privacyHref={privacyHref}
            initialChoice={choice}
          />
        ) : null}
        {review ? null : <AmIntro />}
        {site.hostKind === "preview" ? null : <Beacon />}
        {site.hostKind !== "preview" && ga4Id ? (
          <GaLoader measurementId={ga4Id} />
        ) : null}
      </SiteThemeScope>
      {review?.bar ? <ReviewBar {...review.bar} /> : null}
    </>
  );
}
