// Site settings chokepoint: the announcement banner (CONT-12, CONT-31; D117, D123, D248,
// D253, D270; CONTEXT A3-Q4; invariant 1, TEN-03; T-03-13).
//
// One site_settings row per organization (unique index). saveBanner validates deny by
// default (validateBanner: safeHref link, UTC instants, end after start), screens the
// text and link (held saves it switched off; D248 never blocks), upserts the org's own
// row only, invalidates the live tag and pings once. The schedule is evaluated at render
// time (bannerState), never stored as an on/off flag (Pitfall 9).
// 07-29: upserts through chrome/write.ts so banner saves are snapshotted (CONT-36).
import { validateBanner, type BannerSettings } from "@cds/core/content";
import type { OrgContext } from "../context";
import { requirePermission, tenantRepo } from "../repository";
import { writeSiteSettingsPartIn } from "./chrome/write";
import type { ContentDeps } from "./ports";
import { afterLiveSave, screen } from "./screen";
import { rejectForeignOrg, run } from "./shared";

const COLLECTION = "site_settings";

/** The org's banner settings, or null when none were ever saved (or the row is malformed). */
export async function getBanner(
  ctx: OrgContext,
): Promise<BannerSettings | null> {
  const res = await tenantRepo(COLLECTION).list(ctx, { perPage: 1 });
  const row = res.items[0];
  if (!row || row.banner === null || row.banner === undefined) return null;
  try {
    return validateBanner(row.banner);
  } catch {
    return null;
  }
}

/** Save the banner. `held` = the scanner held it, so it was saved switched off. */
export async function saveBanner(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: unknown,
): Promise<{ banner: BannerSettings; held: boolean }> {
  requirePermission(ctx, "content", "write");
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    rejectForeignOrg(ctx, raw as Record<string, unknown>);
  }
  const v = validateBanner(raw);
  const outcome = await screen(
    ctx,
    deps,
    [v.message, v.link_text].filter((t) => t !== ""),
    v.link_url ? [v.link_url] : [],
  );
  const held = outcome.verdict === "held";
  const banner: BannerSettings = { ...v, enabled: held ? false : v.enabled };
  const id = await run(ctx, (pb) =>
    writeSiteSettingsPartIn(pb, ctx, "banner", banner),
  );
  await afterLiveSave(ctx, deps, outcome, { collection: COLLECTION, id });
  return { banner, held };
}
