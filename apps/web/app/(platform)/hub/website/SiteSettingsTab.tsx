// Website › Site settings tab (CONT-29; CONT-15 toggle; D311, D-UI-P7-3; 07-UI-SPEC "Site
// chrome editors" / "Site settings"; 07-26 choices 10-12). Owner 07-26; 07-29 adds History,
// 07-30 adds Sharing.
//
// Server-loads the settings group, theme, menu, pages and logo for the signed-in member (the
// org comes only from the session) in one Promise.all; a failure shows the BannerTab "We
// couldn't load this" alert. The cookie notice status line is read outside that try: the
// org's primary host -> its SiteContext -> getConsentNeeds -> consentStatusText. No primary
// host, an unresolvable (held) site or any failure shows the "couldn't check" line instead.
// 07-30 (choice 8): opening the tab refreshes the site icons (regenerated only when their
// inputs changed: org rename, older tenants) in its own try/catch; a failure shows no preview.
// 12-17 (COMM-11, D102; choice 4): the site settings group is the lock map's "header" part
// (language, translate, search, AI crawlers, share image; 12-08 PART_OF_FIELD), the same part
// as the Banner tab. EditorLockFrame shows the LockedPanel or the HeldChangesPanel and
// disables the form; saveSiteSettingsAction parks a locked save.
import {
  SITE_SETTINGS_COPY,
  consentStatusText,
  resolveNav,
  type NavSettings,
  type SiteSettingsGroup,
} from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import {
  getNav,
  getSiteSettings,
  listPages,
  readOrganizationDesign,
  readOwnSiteIcons,
  siteContextForHost,
  type SiteIcons,
  type PageSummary,
} from "@cds/db";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { ResolvedMedia } from "@cds/ui/site";
import Link from "next/link";
import { loadEditorLock } from "../../../../lib/editor-lock";
import { editorLockKey } from "../../../../lib/editor-lock-shared";
import { EditorLockFrame } from "./EditorLock";
import { requireHubSession } from "../../../../lib/session";
import { getConsentNeeds } from "../../../../lib/site-cache";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { chromePages, hubLogo } from "./NavigationTab";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { tabHref } from "./tabs";

async function cookieLine(primaryHost: string | null): Promise<string> {
  if (!primaryHost) return SITE_SETTINGS_COPY.consentUnknown;
  try {
    const site = await siteContextForHost(primaryHost);
    if (!site) return SITE_SETTINGS_COPY.consentUnknown;
    return consentStatusText(await getConsentNeeds(site));
  } catch {
    console.error("[hub] consent status failed");
    return SITE_SETTINGS_COPY.consentUnknown;
  }
}

// WR-C06: the render only reads; the mounted form regenerates (refreshSiteIconsAction).
async function iconsFor(
  ctx: Parameters<typeof readOwnSiteIcons>[0],
): Promise<SiteIcons | null> {
  try {
    return await readOwnSiteIcons(ctx);
  } catch {
    return null;
  }
}

export async function SiteSettingsTab(): Promise<React.JSX.Element> {
  const { ctx, org } = await requireHubSession();
  let settings: SiteSettingsGroup;
  let design: unknown;
  let nav: NavSettings | null;
  let pages: PageSummary[];
  let logo: ResolvedMedia | null;
  const lockRead = loadEditorLock(
    ctx,
    { kind: "part", key: "header" },
    { part: "settings" },
  );
  try {
    [settings, design, nav, pages, logo] = await Promise.all([
      getSiteSettings(ctx),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      getNav(ctx),
      listPages(ctx),
      hubLogo(ctx),
    ]);
  } catch (err) {
    console.error("[hub] site settings load failed", err);
    return (
      <InlineAlert
        tone="error"
        action={
          <Link
            href={tabHref("site")}
            className={buttonClasses("secondary", "sm")}
          >
            Try again
          </Link>
        }
      >
        We couldn&apos;t load this. Check your connection and try again.
      </InlineAlert>
    );
  }
  const pageMap = new Map(
    chromePages(pages).map((p) => [p.id, { path: p.path, title: p.title }]),
  );
  const lock = await lockRead;
  return (
    <EditorLockFrame
      key={editorLockKey(lock)}
      state={lock}
      target="header"
      panelId="header-lock"
    >
      <SiteSettingsForm
        initial={settings}
        theme={resolveTheme(design)}
        previewHeader={{
          brand: { name: org.name, logo },
          nav: resolveNav(nav, { pages: pageMap, held: false }),
        }}
        primaryHost={org.primaryHost}
        cookieLine={await cookieLine(org.primaryHost)}
        icons={await iconsFor(ctx)}
      />
    </EditorLockFrame>
  );
}
