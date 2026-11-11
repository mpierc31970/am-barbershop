// Site-level settings chokepoint (CONT-29; CONT-15 toggle; D237, D253; 07-26 choices 1, 2,
// 4; invariant 1, TEN-03; T-07-26-01, T-07-26-06, T-07-26-07).
//
// The `settings` part is { language, show_translate, show_search, allow_ai_crawlers },
// stored as site_settings.language, .settings and .seo.allow_ai_crawlers (other seo keys
// kept). saveSiteSettings takes any subset of the four keys: content write permission ->
// rejectForeignOrg -> validateSiteSettingsPatch (deny by default) -> one locked run
// (`run` = withOrgLock + superuser) that reads the stored group, merges the patch and writes
// through the lock-free writeSiteSettingsPartIn, so the Site settings tab and the
// Navigation tab's Search switch never clobber each other. Then invalidate + ping
// (afterLiveSave with a clean outcome).
//
// 07-30 (choices 5, 6): `share_image` (a library photo id) joins the part, stored at
// seo.share_image beside allow_ai_crawlers. It is checked in the org with the held `pb`
// (never a nested lock) and promoted after the lock (public by intent).
//
// Not screened (D248 does not apply): the part holds a validated language code and three
// booleans, no free text or URL, so nothing can be held. Audit happens through `commit`.
import {
  SITE_SETTINGS_DEFAULTS,
  mergeSiteSettings,
  resolveSiteSettings,
  validateSiteSettingsPatch,
  type SiteSettingsGroup,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../../context";
import { requirePermission, tenantRepo } from "../../repository";
import type { ContentDeps } from "../ports";
import { afterLiveSave } from "../screen";
import { rejectForeignOrg, run } from "../shared";
import { promoteMedia } from "../../media/library/promote";
import { assertOwnShareImage } from "../seo/share-image";
import { writeSiteSettingsPartIn } from "./write";

const COLLECTION = "site_settings";

/** The org's site settings; defaults when no row exists. */
export async function getSiteSettings(
  ctx: OrgContext,
): Promise<SiteSettingsGroup> {
  requirePermission(ctx, "content", "read");
  const res = await tenantRepo(COLLECTION).list(ctx, { perPage: 1 });
  const row = res.items[0];
  if (!row) return { ...SITE_SETTINGS_DEFAULTS };
  return groupOf(row);
}

function groupOf(row: Record<string, unknown>): SiteSettingsGroup {
  return resolveSiteSettings({
    language: row.language,
    settings: row.settings,
    seo: row.seo,
  });
}

async function storedGroup(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<SiteSettingsGroup> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    fields: "language,settings,seo",
  });
  const row = res.items[0];
  return row ? groupOf(row) : { ...SITE_SETTINGS_DEFAULTS };
}

/** Save any subset of the four settings; returns the merged group. */
export async function saveSiteSettings(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: unknown,
): Promise<{ settings: SiteSettingsGroup }> {
  requirePermission(ctx, "content", "write");
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    rejectForeignOrg(ctx, raw as Record<string, unknown>);
  }
  const patch = validateSiteSettingsPatch(raw);
  // run() holds withOrgLock(ctx.orgId) for the whole read-merge-write.
  const { settings, id } = await run(ctx, async (pb) => {
    const next = mergeSiteSettings(await storedGroup(pb, ctx), patch);
    if (patch.share_image) {
      await assertOwnShareImage(pb, ctx.orgId, patch.share_image);
    }
    const rowId = await writeSiteSettingsPartIn(pb, ctx, "settings", next);
    return { settings: next, id: rowId };
  });
  await afterLiveSave(
    ctx,
    deps,
    { verdict: "clean", reasons: [] },
    { collection: COLLECTION, id },
  );
  if (patch.share_image) {
    await promoteMedia(ctx, [patch.share_image]).catch(() => undefined);
  }
  return { settings };
}
