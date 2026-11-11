// Site menu chokepoint (CONT-13; D117 / invariant 6, D248, D253; CONTEXT Area 5 row 1;
// 07-25 choices 1-3, 13; invariant 1, TEN-03; T-07-25-01..05).
//
// saveNav copies saveBanner's shape: content write permission -> rejectForeignOrg ->
// validateNav (deny by default) -> every page/pop-up target owned by the org -> screen the
// labels and web addresses (D248 never blocks; held saves with held: true, so visitors see
// page links only) -> the one site_settings upsert (writeSiteSettingsPart) -> flag,
// invalidate the live tag and ping (afterLiveSave). addPageToNav appends through the same
// path, so screening and invalidation stay in one place.
import { InvalidInput, NotFound } from "@cds/core";
import {
  appendPageLink,
  navRefs,
  parseNavTarget,
  removePageLinks,
  validateNav,
  type NavSettings,
} from "@cds/core/content";
import { addonPageInfo } from "../../addons/entitlements";
import { withSuperuser } from "../../client";
import type { OrgContext } from "../../context";
import { newRecordId, requirePermission, tenantRepo } from "../../repository";
import type { ContentDeps } from "../ports";
import { afterLiveSave, screen } from "../screen";
import { NOT_FOUND_KIND } from "../pages";
import { rejectForeignOrg, run, scopedGet } from "../shared";
import { assertNavRefsOwned } from "./refs";
import { writeSiteSettingsPart, writeSiteSettingsPartIn } from "./write";

const COLLECTION = "site_settings";

/** The org's menu, or null when none was ever saved (or the stored value is malformed). */
export async function getNav(ctx: OrgContext): Promise<NavSettings | null> {
  const res = await tenantRepo(COLLECTION).list(ctx, { perPage: 1 });
  const row = res.items[0];
  if (!row || row.nav === null || row.nav === undefined) return null;
  try {
    return validateNav(row.nav);
  } catch {
    return null;
  }
}

function navTexts(nav: NavSettings): { texts: string[]; urls: string[] } {
  const texts: string[] = [];
  const urls: string[] = [];
  const visit = (label: string, target: string) => {
    texts.push(label);
    if (parseNavTarget(target)?.kind === "url") urls.push(target);
  };
  for (const item of nav.items) {
    visit(item.label, item.target);
    for (const c of item.children) visit(c.label, c.target);
  }
  if (nav.cta) texts.push(nav.cta.label);
  return { texts: texts.filter((t) => t !== ""), urls };
}

/** Save the menu. `held` = the scanner held it (visitors see page links only until a clean save). */
export async function saveNav(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: unknown,
): Promise<{ nav: NavSettings; held: boolean }> {
  requirePermission(ctx, "content", "write");
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    rejectForeignOrg(ctx, raw as Record<string, unknown>);
  }
  const v = validateNav(raw);
  await assertNavRefsOwned(ctx, navRefs(v));
  const { texts, urls } = navTexts(v);
  const outcome = await screen(ctx, deps, texts, urls);
  const held = outcome.verdict === "held";
  const nav: NavSettings = { ...v, held };
  const id = await writeSiteSettingsPart(ctx, "nav", nav);
  await afterLiveSave(ctx, deps, outcome, { collection: COLLECTION, id });
  return { nav, held };
}

export type AddToNavResult = { added: boolean; reason?: "exists" | "full" };

/** Append one of the org's pages to the menu (Add page checkbox, 07-32 Page settings). */
export async function addPageToNav(
  ctx: OrgContext,
  deps: ContentDeps,
  pageId: string,
): Promise<AddToNavResult> {
  requirePermission(ctx, "content", "write");
  const page = await withSuperuser((pb) => scopedGet(pb, ctx, "pages", pageId));
  // 11-29: a page in Recently deleted can't be added to the menu.
  if (typeof page.deleted_at === "string" && page.deleted_at !== "") {
    throw new NotFound();
  }
  if (page.kind === NOT_FOUND_KIND) {
    throw new InvalidInput("The Page not found page can't go in the menu.");
  }
  const current = await getNav(ctx);
  const res = appendPageLink(current, {
    pageId: page.id,
    title: typeof page.title === "string" ? page.title : "",
    id: newRecordId(),
  });
  if (!res.added) return { added: false, reason: res.reason };
  await saveNav(ctx, deps, res.nav);
  return { added: true };
}

export type RemoveFromNavResult = { removed: number };

/**
 * Remove every menu link to one of the org's pages (07-32 choice 13; Page settings "Show this
 * page in the site menu" unchecked). Top-level links and dropdown children go; the menu
 * button is untouched. One org lock; the write goes through writeSiteSettingsPartIn with the
 * held client, so the nav history (07-29) snapshots it. Removal only shrinks the menu, so it
 * adds no text to screen; a held menu stays held.
 */
export async function removePageFromNav(
  ctx: OrgContext,
  deps: ContentDeps,
  pageId: string,
): Promise<RemoveFromNavResult> {
  requirePermission(ctx, "content", "write");
  const out = await run(ctx, async (pb) => {
    const page = await scopedGet(pb, ctx, "pages", pageId);
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    });
    const row = res.items[0];
    if (!row || row.nav === null || row.nav === undefined) {
      return { removed: 0, id: null };
    }
    let current: NavSettings;
    try {
      current = validateNav(row.nav);
    } catch {
      return { removed: 0, id: null };
    }
    const next = removePageLinks(current, page.id);
    if (next.removed === 0) return { removed: 0, id: null };
    const id = await writeSiteSettingsPartIn(pb, ctx, "nav", next.nav);
    return { removed: next.removed, id };
  });
  if (out.id !== null) {
    await afterLiveSave(
      ctx,
      deps,
      { verdict: "clean", reasons: [] },
      { collection: COLLECTION, id: out.id },
    );
  }
  return { removed: out.removed };
}

/**
 * Add an add-on's seeded page to the menu (P5 page line, CONTEXT Area 5 row 1). The page id
 * comes from the install record server-side, never from the browser.
 */
export async function addAddonPageToNav(
  ctx: OrgContext,
  deps: ContentDeps,
  slug: string,
): Promise<AddToNavResult> {
  requirePermission(ctx, "content", "write");
  const info = await addonPageInfo(ctx, slug);
  if (!info || "deleted" in info) throw new NotFound();
  return addPageToNav(ctx, deps, info.id);
}
