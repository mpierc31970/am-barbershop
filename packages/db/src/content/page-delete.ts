// Page delete and restore (11-29; DASH-06, DASH-08; D183, D187, D254, D275; RESEARCH
// Pattern 10; T-11-29-01..04).
//
// A page is soft-deleted: deleted_at / deleted_by / delete_redirect_to are set and the row,
// its draft sections, its kept versions and its published JSON stay, so Restore can bring it
// back for 30 days. The soft-delete GC (soft-delete-gc.ts) purges it after that.
//   - deletePage, under the per-org content lock (run()): refuses Home and system pages
//     (InvalidInput). The redirect target must be one of this org's live published pages
//     (in the manifest, row not deleted; T-11-29-01). Every manifest entry of the page goes;
//     each of its live slugs redirects to the target's slug, or has no redirect (404). The
//     row update and the `page.deleted` audit row are one PB batch; the manifest is put back
//     when the batch fails. Then the site index is rebuilt and the page, site and live tags
//     are invalidated (sitemap, search and llms.txt read the index).
//   - restoreDeletedPage: within 30 days; the allowance (assertPageRoom) and both slug
//     checks (DB and live) under the same lock; the manifest entry comes back from the kept
//     published JSON (no new version) and its redirect goes; `page.restored` audit row.
//   - pageDeleteCase: what the confirm dialog shows (links that point at the page, the
//     redirect options). listRecentlyDeleted: the bin, newest first.
// The slug stays held by the row until purge (assertSlugFree reads every row).
import { InvalidInput, NotFound } from "@cds/core";
import {
  parseNavTarget,
  validateFooter,
  validateNav,
  type SiteManifest,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { assertId, requirePermission } from "../repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../storage";
import { assertPageRoom } from "./allowance";
import { memberNames } from "./history/versions";
import { liveHolderOf, readJson, readManifest } from "./manifest";
import {
  assertSlugFree,
  HOME_SLUG,
  NOT_FOUND_KIND,
  SlugTaken,
  slugLiveCopy,
} from "./pages";
import { liveTag, pageTag, siteTag, type ContentDeps } from "./ports";
import { isProtected } from "./project";
import { assertOpsNotLocked, run, scopedGet } from "./shared";
import { refreshSiteIndex } from "./site-index/build";

/** Days a deleted page stays in Recently deleted before the GC purges it (D275). */
export const PAGE_BIN_DAYS = 30;
const DAY_MS = 86_400_000;
const JSON_TYPE = "application/json";

export type PageDeleteLink = {
  where: "menu" | "footer" | "button";
  label: string;
  /** Where the link sits: "Menu", "Menu › Services", "Menu button", "Footer" or a page title. */
  place: string;
};

export type PageDeleteCase = {
  page: { id: string; title: string; slug: string };
  deletable: boolean;
  reason?: "home" | "system";
  links: PageDeleteLink[];
  /** Live published pages the old address can send visitors to (Home first). */
  redirectOptions: { id: string; title: string }[];
};

export type DeletedPage = {
  id: string;
  title: string;
  slug: string;
  deletedAt: string;
  /** The member's name; "" when unknown (a former member, staff or a system job). */
  deletedBy: string;
};

export type PageDeleteDeps = Pick<ContentDeps, "invalidator"> &
  Partial<Pick<ContentDeps, "sections" | "addons">> & {
    store?: ObjectStore;
    now?: () => Date;
  };

export const PAGE_DELETE_COPY = Object.freeze({
  notDeletable: "Home and system pages can't be deleted.",
  redirectTarget: "Choose a published page of your site.",
});

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ");
}

function isDeleted(r: RecordModel): boolean {
  return str(r.deleted_at) !== "";
}

function reasonOf(r: RecordModel): "home" | "system" | undefined {
  if (r.kind === NOT_FOUND_KIND || (r.kind && r.kind !== "builder")) {
    return "system";
  }
  if (r.slug === HOME_SLUG) return "home";
  return undefined;
}

/** A page of the org that is not in the bin (NotFound otherwise, foreign ids included). */
async function livePage(
  pb: PocketBase,
  ctx: OrgContext,
  pageId: unknown,
): Promise<RecordModel> {
  const row = await scopedGet(pb, ctx, "pages", pageId);
  if (isDeleted(row)) throw new NotFound();
  return row;
}

/** The org's non-deleted page rows (id, title, slug, kind). */
async function liveRows(pb: PocketBase, orgId: string): Promise<RecordModel[]> {
  return pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org} && deleted_at = ''", {
      org: orgId,
    }),
    fields: "id,title,slug,kind",
  });
}

function liveSlugsOf(manifest: SiteManifest, pageId: string): string[] {
  return Object.entries(manifest.pages)
    .filter(([, e]) => e.id === pageId)
    .map(([s]) => s);
}

// ---------------------------------------------------------------------------------------
// Links that point at the page

const LINK_KEY = /(^|_)(link|href|url)$/;

function buttonLabel(obj: Record<string, unknown>, key: string): string {
  const prefix = key.replace(LINK_KEY, "");
  const names = prefix
    ? [`${prefix}_text`, `${prefix}_label`, "label", "text"]
    : ["label", "text", "button_text"];
  for (const k of names) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "" && !v.includes("<")) {
      return v.trim();
    }
  }
  return "";
}

function pointsAt(value: string, slugs: ReadonlySet<string>): boolean {
  const m = /^\/([^/?#]*)\/?(?:[?#].*)?$/.exec(value.trim());
  if (!m) return false;
  const slug = (m[1] ?? "").toLowerCase();
  return slugs.has(slug === "" ? HOME_SLUG : slug);
}

/** Every button/link label inside `content` whose site path points at one of `slugs`. */
function buttonsIn(
  content: unknown,
  slugs: ReadonlySet<string>,
  out: string[],
  depth = 0,
): void {
  if (depth > 12 || typeof content !== "object" || content === null) return;
  if (Array.isArray(content)) {
    for (const v of content) buttonsIn(v, slugs, out, depth + 1);
    return;
  }
  const obj = content as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      if (LINK_KEY.test(k) && pointsAt(v, slugs)) out.push(buttonLabel(obj, k));
    } else {
      buttonsIn(v, slugs, out, depth + 1);
    }
  }
}

async function chromeLinks(
  pb: PocketBase,
  orgId: string,
  pageId: string,
  title: string,
): Promise<PageDeleteLink[]> {
  const res = await pb.collection("site_settings").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "nav,footer",
  });
  const row = res.items[0];
  if (!row) return [];
  const out: PageDeleteLink[] = [];
  const hits = (target: string) => {
    const t = parseNavTarget(target);
    return t?.kind === "page" && t.id === pageId;
  };
  if (row.nav !== null && row.nav !== undefined) {
    try {
      const nav = validateNav(row.nav);
      for (const item of nav.items) {
        if (hits(item.target)) {
          out.push({
            where: "menu",
            label: item.label || title,
            place: "Menu",
          });
        }
        for (const c of item.children) {
          if (hits(c.target)) {
            out.push({
              where: "menu",
              label: c.label || title,
              place: item.label ? `Menu › ${item.label}` : "Menu",
            });
          }
        }
      }
      if (nav.cta && hits(nav.cta.target)) {
        out.push({ where: "menu", label: nav.cta.label, place: "Menu button" });
      }
    } catch {
      // A malformed menu shows nothing to the visitor; nothing to list.
    }
  }
  if (row.footer !== null && row.footer !== undefined) {
    try {
      const footer = validateFooter(row.footer);
      for (const l of footer.extra_links) {
        if (hits(l.target)) {
          out.push({
            where: "footer",
            label: l.label || title,
            place: "Footer",
          });
        }
      }
    } catch {
      // Same as the menu.
    }
  }
  return out;
}

async function buttonLinks(
  pb: PocketBase,
  orgId: string,
  pageId: string,
  slugs: ReadonlySet<string>,
  pages: readonly RecordModel[],
): Promise<PageDeleteLink[]> {
  const titles = new Map(pages.map((p) => [p.id, str(p.title)]));
  const rows = await pb.collection("page_sections").getFullList({
    filter: pb.filter("organization = {:org} && page != {:page}", {
      org: orgId,
      page: pageId,
    }),
    fields: "page,content",
    sort: "page,sort_order",
  });
  const out: PageDeleteLink[] = [];
  for (const r of rows) {
    const holder = titles.get(str(r.page));
    // Drafts of pages in the bin are not shown (they come back with their page).
    if (holder === undefined) continue;
    const labels: string[] = [];
    buttonsIn(r.content, slugs, labels);
    for (const label of labels) {
      out.push({ where: "button", label: label || "Button", place: holder });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Public API

/** What the delete dialog shows: deletable or not, links to the page, redirect options. */
export async function pageDeleteCase(
  ctx: OrgContext,
  pageId: string,
  deps: { store?: ObjectStore } = {},
): Promise<PageDeleteCase> {
  requirePermission(ctx, "content", "write");
  const store = deps.store ?? getObjectStore();
  return withSuperuser(async (pb) => {
    const row = await livePage(pb, ctx, pageId);
    const reason = reasonOf(row);
    const page = { id: row.id, title: str(row.title), slug: str(row.slug) };
    if (reason) {
      return { page, deletable: false, reason, links: [], redirectOptions: [] };
    }
    const manifest = await readManifest(store, ctx.orgId, new Date());
    const pages = await liveRows(pb, ctx.orgId);
    const slugs = new Set([page.slug, ...liveSlugsOf(manifest, row.id)]);
    const links = [
      ...(await chromeLinks(pb, ctx.orgId, row.id, page.title)),
      ...(await buttonLinks(pb, ctx.orgId, row.id, slugs, pages)),
    ];
    const live = new Map(pages.map((p) => [p.id, p]));
    const options: { id: string; title: string; home: boolean }[] = [];
    for (const [slug, e] of Object.entries(manifest.pages)) {
      const r = live.get(e.id);
      if (!r || r.id === row.id || r.kind === NOT_FOUND_KIND) continue;
      if (options.some((o) => o.id === r.id)) continue;
      options.push({ id: r.id, title: str(r.title), home: slug === HOME_SLUG });
    }
    options.sort((a, b) =>
      a.home !== b.home ? (a.home ? -1 : 1) : a.title.localeCompare(b.title),
    );
    return {
      page,
      deletable: true,
      links,
      redirectOptions: options.map(({ id, title }) => ({ id, title })),
    };
  });
}

function afterChange(
  orgId: string,
  pageId: string,
  deps: PageDeleteDeps,
  store: ObjectStore,
  now: Date,
): Promise<void> {
  return refreshSiteIndex(orgId, {
    ...(deps.sections ? { sections: deps.sections } : {}),
    ...(deps.addons ? { addons: deps.addons } : {}),
    store,
    now: () => now,
  }).then(() => {
    try {
      deps.invalidator.invalidate([
        pageTag(orgId, pageId),
        siteTag(orgId),
        liveTag(orgId),
      ]);
    } catch {
      // Cached renders expire on their own.
    }
  });
}

async function putBack(
  store: ObjectStore,
  key: string,
  prev: Uint8Array | null,
): Promise<void> {
  try {
    if (prev) await store.put(key, prev, JSON_TYPE);
    else await store.delete(key);
  } catch {
    // Best effort: the original error is the one the caller needs.
  }
}

/**
 * Delete a page (soft). `redirectTo` = a live published page id of this org (its address
 * gets a redirect from the deleted page's), or null (the old address 404s).
 */
export async function deletePage(
  ctx: OrgContext,
  pageId: string,
  opts: { redirectTo: string | null },
  deps: PageDeleteDeps,
): Promise<{ id: string; redirectTo: string | null }> {
  requirePermission(ctx, "content", "write");
  const store = deps.store ?? getObjectStore();
  const now = (deps.now ?? (() => new Date()))();
  const redirectTo = opts?.redirectTo ?? null;
  if (redirectTo !== null) {
    try {
      assertId(redirectTo);
    } catch {
      throw new InvalidInput(PAGE_DELETE_COPY.redirectTarget);
    }
  }
  const out = await run(ctx, async (pb) => {
    const row = await livePage(pb, ctx, pageId);
    if (reasonOf(row)) throw new InvalidInput(PAGE_DELETE_COPY.notDeletable);
    // 12-REVIEW CR-A03: a paused page cannot be deleted by a member (D102).
    await assertOpsNotLocked(pb, ctx, [
      { collection: "pages", op: "update", id: row.id },
    ]);

    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const manifest = await readManifest(store, ctx.orgId, now);
    let targetSlug: string | null = null;
    if (redirectTo !== null) {
      if (redirectTo === row.id) {
        throw new InvalidInput(PAGE_DELETE_COPY.redirectTarget);
      }
      const slug = liveSlugsOf(manifest, redirectTo)[0];
      const target = slug
        ? await pb
            .collection("pages")
            .getList(1, 1, {
              filter: pb.filter(
                "id = {:id} && organization = {:org} && deleted_at = ''",
                { id: redirectTo, org: ctx.orgId },
              ),
              fields: "id,kind",
            })
            .then((r) => r.items[0])
        : undefined;
      if (!slug || !target || target.kind === NOT_FOUND_KIND) {
        throw new InvalidInput(PAGE_DELETE_COPY.redirectTarget);
      }
      targetSlug = slug;
    }

    const liveSlugs = liveSlugsOf(manifest, row.id);
    const prevManifest =
      liveSlugs.length > 0 ? await store.get(manifestKey) : null;
    if (liveSlugs.length > 0) {
      for (const s of liveSlugs) {
        delete manifest.pages[s];
        if (targetSlug !== null) manifest.redirects[s] = targetSlug;
        else delete manifest.redirects[s];
      }
      // WR-B02: older redirects that pointed at this page follow it to the new target (one
      // hop, no chains), or go when there is none, so no kept address silently 404s.
      const gone = new Set(liveSlugs);
      for (const [from, to] of Object.entries(manifest.redirects)) {
        if (typeof to !== "string" || !gone.has(to)) continue;
        if (targetSlug !== null && targetSlug !== from) {
          manifest.redirects[from] = targetSlug;
        } else {
          delete manifest.redirects[from];
        }
      }
      manifest.updated_at = now.toISOString();
      await store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);
    }
    try {
      const batch = pb.createBatch();
      batch.collection("pages").update(row.id, {
        deleted_at: stamp(now),
        deleted_by: ctx.systemJob ? "" : ctx.actor,
        delete_redirect_to: redirectTo ?? "",
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "page.deleted",
          targetCollection: "pages",
          targetId: row.id,
          meta: {
            slug: str(row.slug),
            live: liveSlugs.length > 0,
            redirect_to: targetSlug,
          },
        }),
      );
      await batch.send();
    } catch (err) {
      if (liveSlugs.length > 0) await putBack(store, manifestKey, prevManifest);
      throw err;
    }
    return { id: row.id, redirectTo: targetSlug };
  });
  await afterChange(ctx.orgId, out.id, deps, store, now);
  return out;
}

type JsonPage = {
  slug: string;
  title: string;
  published_at: string;
};

function jsonPageOf(raw: unknown, pageId: string): JsonPage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const p = r.page as Record<string, unknown> | undefined;
  if (typeof p !== "object" || p === null || p.id !== pageId) return null;
  const slug = str(p.slug);
  if (slug === "") return null;
  return {
    slug,
    title: str(p.title),
    published_at: str(r.published_at),
  };
}

/** Bring a page back from Recently deleted (within 30 days). */
export async function restoreDeletedPage(
  ctx: OrgContext,
  pageId: string,
  deps: PageDeleteDeps,
): Promise<{ id: string; live: boolean }> {
  requirePermission(ctx, "content", "write");
  const store = deps.store ?? getObjectStore();
  const now = (deps.now ?? (() => new Date()))();
  const out = await run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, "pages", pageId);
    const deletedAt = Date.parse(str(row.deleted_at).replace(" ", "T"));
    if (
      !isDeleted(row) ||
      !Number.isFinite(deletedAt) ||
      now.getTime() - deletedAt > PAGE_BIN_DAYS * DAY_MS
    ) {
      throw new NotFound();
    }
    // 12-REVIEW CR-A03: a paused page cannot be restored by a member (D102).
    await assertOpsNotLocked(pb, ctx, [
      { collection: "pages", op: "update", id: row.id },
    ]);
    // DASH-08: a counted page needs room (protected and system pages never count).
    if (row.kind === "builder" && !isProtected(row)) {
      await assertPageRoom(pb, ctx);
    }
    await assertSlugFree(pb, ctx, str(row.slug), row.id);

    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const manifest = await readManifest(store, ctx.orgId, now);
    const ownSlugLive = liveHolderOf(manifest, str(row.slug), row.id);
    const json = jsonPageOf(
      await readJson(store, tenantPublishedPageKey(ctx.orgId, row.id)),
      row.id,
    );
    const slugs = new Set([str(row.slug), ...(json ? [json.slug] : [])]);
    for (const s of slugs) {
      if (s !== str(row.slug)) await assertSlugFree(pb, ctx, s, row.id);
      const holder =
        s === str(row.slug) ? ownSlugLive : liveHolderOf(manifest, s, row.id);
      if (holder === null) continue;
      const exists = await pb.collection("pages").getList(1, 1, {
        filter: pb.filter("id = {:id} && organization = {:org}", {
          id: holder,
          org: ctx.orgId,
        }),
        fields: "id",
      });
      if (exists.items.length > 0) throw new SlugTaken(slugLiveCopy(s));
    }

    const prevManifest = json ? await store.get(manifestKey) : null;
    if (json) {
      manifest.pages[json.slug] = {
        id: row.id,
        title: json.title,
        published_at: json.published_at,
        // IN-B02: the live row decides (the published JSON's flag may be stale).
        protected: isProtected(row),
      };
      delete manifest.redirects[json.slug];
      manifest.updated_at = now.toISOString();
      await store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);
    }
    try {
      const batch = pb.createBatch();
      batch.collection("pages").update(row.id, {
        deleted_at: "",
        deleted_by: "",
        delete_redirect_to: "",
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "page.restored",
          targetCollection: "pages",
          targetId: row.id,
          meta: { slug: str(row.slug), live: json !== null },
        }),
      );
      await batch.send();
    } catch (err) {
      if (json) await putBack(store, manifestKey, prevManifest);
      throw err;
    }
    return { id: row.id, live: json !== null };
  });
  await afterChange(ctx.orgId, out.id, deps, store, now);
  return out;
}

/** Recently deleted: pages deleted in the last 30 days, newest first. */
export async function listRecentlyDeleted(
  ctx: OrgContext,
  deps: { now?: () => Date } = {},
): Promise<DeletedPage[]> {
  requirePermission(ctx, "content", "read");
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = stamp(new Date(now.getTime() - PAGE_BIN_DAYS * DAY_MS));
  return withSuperuser(async (pb) => {
    const rows = await pb.collection("pages").getFullList({
      filter: pb.filter(
        "organization = {:org} && deleted_at != '' && deleted_at >= {:cutoff}",
        { org: ctx.orgId, cutoff },
      ),
      sort: "-deleted_at,id",
      fields: "id,title,slug,deleted_at,deleted_by",
    });
    const actors = [
      ...new Set(rows.map((r) => str(r.deleted_by)).filter((a) => a !== "")),
    ];
    const names = await memberNames(pb, ctx.orgId, actors);
    return rows.map((r) => ({
      id: r.id,
      title: str(r.title),
      slug: str(r.slug),
      deletedAt: str(r.deleted_at),
      deletedBy: names.get(str(r.deleted_by)) ?? "",
    }));
  });
}
