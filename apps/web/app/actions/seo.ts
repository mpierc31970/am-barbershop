"use server";
// SEO & sharing actions from the page builder drawer and Website › Site settings (07-30;
// CONT-14, CONT-28; T-07-30-04). Public POST endpoints: arguments are untrusted. The tenant
// comes only from the session via runAction. Only meta_title, meta_description, og_image,
// share_image and slug are copied (Object.hasOwn): `organization` and unknown keys never reach
// @cds/db, which validates and checks the share image belongs to the org. The drawer sends
// only the keys it changed; they are merged over the page's current SEO here (a share image
// and a pasted link clear each other), because updatePage stores the SEO group whole.
import type { PageSeo } from "@cds/core/content";
import {
  getPage,
  refreshSiteIcons,
  updatePage,
  type PageSummary,
  type SiteIcons,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { nextInvalidator } from "../../lib/invalidator";

const SEO_KEYS = [
  "meta_title",
  "meta_description",
  "og_image",
  "share_image",
] as const;

export type SeoInput = PageSeo & { slug?: string };

/** The allowlisted copy of an untrusted SEO input (exported for tests). */
export async function pickSeoInput(
  input: unknown,
): Promise<{ slug?: string; seo: PageSeo }> {
  const seo: Record<string, unknown> = {};
  let slug: string | undefined;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const r = input as Record<string, unknown>;
    for (const k of SEO_KEYS) if (Object.hasOwn(r, k)) seo[k] = r[k];
    if (Object.hasOwn(r, "slug") && typeof r.slug === "string") slug = r.slug;
  }
  return slug === undefined
    ? { seo: seo as PageSeo }
    : { slug, seo: seo as PageSeo };
}

export async function saveSeoAction(
  pageId: string,
  input: SeoInput,
): Promise<ActionResult<{ page: PageSummary }>> {
  const id = typeof pageId === "string" ? pageId : "";
  const { slug, seo } = await pickSeoInput(input);
  return runAction(async (s) => {
    const current = await getPage(s.ctx, id);
    const merged: Record<string, unknown> = { ...current.seo, ...seo };
    if (typeof seo.share_image === "string" && seo.share_image !== "") {
      delete merged.og_image;
    }
    if (typeof seo.og_image === "string" && seo.og_image !== "") {
      delete merged.share_image;
    }
    const page = await updatePage(s.ctx, id, {
      ...(slug !== undefined ? { slug } : {}),
      seo: merged as PageSeo,
    });
    // A changed page may change the share image source; regenerate icons best effort.
    void refreshSiteIcons(s.ctx, { invalidator: nextInvalidator }).catch(
      () => undefined,
    );
    return { page };
  });
}

/**
 * Regenerate the caller's site icons when their inputs changed (07-30 choice 8: run when
 * Site settings opens, from the mounted form, never from the render: WR-C06). A write drops
 * the tenant's cached icon set (liveTag). Never surfaces an error; icons null on a failure.
 */
export async function refreshSiteIconsAction(): Promise<
  ActionResult<{ ok: true; icons: SiteIcons | null }>
> {
  return runAction(async (s) => {
    let icons: SiteIcons | null = null;
    try {
      icons = await refreshSiteIcons(s.ctx, { invalidator: nextInvalidator });
    } catch {
      // Best effort (07-30 choice 8).
    }
    return { ok: true as const, icons };
  });
}
