// Draft preview (CONT-08; 03-UI-SPEC "Preview"; T-03-55). Renders the page's draft as it
// would publish (hidden blocks omitted, validated and sanitized by previewPage) for a
// signed-in member only, never indexed. The 44px strip sits outside [data-site] so the
// tenant theme never styles it; the draft renders inside SiteThemeScope with the org's real
// theme (THEME-02; 04-UI-SPEC "Theme in the hub"), server-rendered so there is no flash of
// the neutral preset. The theme is read with the session's OrgContext only (T-04-37).
// Add-on blocks render with live data (D253; 05-UI-SPEC "Builder integration"): the same
// renderer injection as the tenant route, over published, not-held records.
// Core data-bound blocks (hours, social, map) get coreData like the tenant route (07-07).
// 14-20 (DOM-07, D22): PreviewLinkButton beside Publish changes mints a signed 60-minute link
// that opens this page's draft on the org's preview address.
import { CdsError } from "@cds/core";
import { parseGalleryPages, type PublishedPage } from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import { ADDON_SITE_RENDERERS } from "@cds/addon-registry/site";
import { activeAddons, previewPage, readOrganizationDesign } from "@cds/db";
import { PageRenderer, SiteThemeScope } from "@cds/ui/site";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  isDrawnFor,
  previewAddonBlockData,
} from "../../../../../../../lib/addon-site";
import { previewCoreBlockData } from "../../../../../../../lib/core-block-data";
import { SECTION_REGISTRY } from "../../../../../../../lib/section-registry";
import { requireHubSession } from "../../../../../../../lib/session";
import { themeOrNeutral } from "../../../../../../../lib/theme-read";
import { PreviewLinkButton } from "./PreviewLinkButton";
import { PreviewPublishButton } from "./PreviewPublishButton";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Preview",
    robots: { index: false, follow: false },
  };
}

type Props = {
  params: Promise<{ pageId: string }>;
  // 07-22: gallery pages (?g<sectionId>=N) so pagination works in Preview.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PreviewPage({ params, searchParams }: Props) {
  const { ctx } = await requireHubSession();
  const { pageId } = await params;

  let draft: PublishedPage;
  let design: unknown;
  let active: string[];
  try {
    [draft, design, active] = await Promise.all([
      previewPage(ctx, pageId, SECTION_REGISTRY),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      activeAddons(ctx),
    ]);
  } catch (err) {
    if (
      err instanceof CdsError &&
      (err.code === "not_found" || err.code === "invalid_input")
    ) {
      notFound();
    }
    throw err;
  }

  const now = new Date();
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const [boundData, coreData] = await Promise.all([
    previewAddonBlockData(ctx, sections, active, now),
    previewCoreBlockData(ctx, sections),
  ]);
  const theme = resolveTheme(design);
  const editorHref = `/hub/website/pages/${encodeURIComponent(pageId)}`;
  return (
    <>
      <div className="sticky top-0 z-30 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-hub-ink px-4 py-1 font-hub text-sm text-hub-surface">
        <p>Preview · This is your draft, visitors can&apos;t see it</p>
        <div className="flex flex-wrap items-center gap-3">
          <PreviewLinkButton pageId={pageId} />
          <Link
            href={editorHref}
            className="rounded px-2 py-1 font-semibold text-hub-surface underline underline-offset-4 hover:no-underline"
          >
            Back to editor
          </Link>
          <PreviewPublishButton pageId={pageId} />
        </div>
      </div>
      <SiteThemeScope theme={theme} lang="en" className="min-h-screen">
        <PageRenderer
          page={draft}
          registry={SECTION_REGISTRY}
          now={now}
          renderers={ADDON_SITE_RENDERERS}
          boundData={boundData}
          isDrawn={isDrawnFor(active, boundData)}
          coreData={{
            ...coreData,
            galleryPages: parseGalleryPages(
              searchParams ? await searchParams : null,
            ),
          }}
        />
      </SiteThemeScope>
    </>
  );
}
