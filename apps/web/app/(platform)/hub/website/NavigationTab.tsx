// Website › Navigation tab (CONT-13; D311, D253; 07-UI-SPEC "Site chrome editors" /
// "Navigation"; owner 07-25, 07-29 adds History, 07-26 adds the Search switch).
// Server-loads the org's menu, pages, pop-ups, theme, name, logo and the Search switch
// (site settings part, 07-26) in one Promise.all for
// the signed-in member (the org comes only from the session) and hands them to the client
// NavigationForm. A load failure shows the BannerTab "We couldn't load this" alert.
// 12-17 (COMM-11, D102): the menus part. EditorLockFrame shows the LockedPanel or the
// HeldChangesPanel and disables the form; saveNavAction parks a locked save.
import type { NavSettings, PopupRecord } from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import {
  getNav,
  getSiteSettings,
  listMedia,
  listPages,
  listPopups,
  readOrganizationDesign,
  resolveHubMedia,
  type PageSummary,
} from "@cds/db";
import type { ChromePageOption } from "@cds/ui/builder";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { ResolvedMedia } from "@cds/ui/site";
import Link from "next/link";
import { loadEditorLock } from "../../../../lib/editor-lock";
import { editorLockKey } from "../../../../lib/editor-lock-shared";
import { EditorLockFrame } from "./EditorLock";
import { requireHubSession } from "../../../../lib/session";
import { themeOrNeutral } from "../../../../lib/theme-read";
import { NavigationForm } from "./NavigationForm";
import { tabHref } from "./tabs";

/** Pages as editor options: home is "/", every other slug "/<slug>". */
export function chromePages(pages: readonly PageSummary[]): ChromePageOption[] {
  return pages.map((p) => ({
    id: p.id,
    title: p.title || p.slug,
    path: p.slug === "home" ? "/" : `/${encodeURIComponent(p.slug)}`,
    published: p.status === "published" && Boolean(p.published_at),
  }));
}

/** The org's current logo for the hub preview (private hub route); null on any failure. */
export async function hubLogo(
  ctx: Parameters<typeof listMedia>[0],
): Promise<ResolvedMedia | null> {
  try {
    const logos = await listMedia(ctx, "logo");
    const id = logos[0]?.id;
    if (!id) return null;
    const media = await resolveHubMedia(ctx, [id]);
    const m = Object.hasOwn(media, id) ? media[id] : undefined;
    return m && m.kind === "image" && m.src !== "" ? m : null;
  } catch {
    return null;
  }
}

export function ChromeLoadError({ tab }: { tab: "navigation" | "footer" }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link href={tabHref(tab)} className={buttonClasses("secondary", "sm")}>
          Try again
        </Link>
      }
    >
      We couldn&apos;t load this. Check your connection and try again.
    </InlineAlert>
  );
}

export async function NavigationTab(): Promise<React.JSX.Element> {
  const { ctx, org } = await requireHubSession();
  let nav: NavSettings | null;
  let pages: PageSummary[];
  let popups: PopupRecord[];
  let design: unknown;
  let logo: ResolvedMedia | null;
  let showSearch: boolean;
  const lockRead = loadEditorLock(ctx, { kind: "part", key: "menus" });
  try {
    let settings: { show_search: boolean };
    [nav, pages, popups, design, logo, settings] = await Promise.all([
      getNav(ctx),
      listPages(ctx),
      listPopups(ctx),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      hubLogo(ctx),
      getSiteSettings(ctx),
    ]);
    showSearch = settings.show_search;
  } catch (err) {
    console.error("[hub] navigation load failed", err);
    return <ChromeLoadError tab="navigation" />;
  }
  const lock = await lockRead;
  return (
    <EditorLockFrame
      key={editorLockKey(lock)}
      state={lock}
      target="menu"
      panelId="menus-lock"
    >
      <NavigationForm
        initial={nav}
        pages={chromePages(pages)}
        popups={popups.map((p) => ({ id: p.id, name: p.name }))}
        theme={resolveTheme(design)}
        brand={{ name: org.name, logo }}
        showSearch={showSearch}
      />
    </EditorLockFrame>
  );
}
