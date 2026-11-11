// The one draft -> publish state machine, page versions and restore (CONT-30, CONT-31;
// D184, D187, D188, D248, D253, D254; CONTEXT A1-Q1/Q2/Q4; RESEARCH Patterns 4-5;
// invariant 1; T-03-32..T-03-38).
//
// publishPage runs, under the per-org lock (T-03-34), in this order:
//   1. load the page (scoped, NotFound for a foreign id) and every draft row; project the
//      visible rows (validate + normalize + sanitize again, project.ts)
//   2. scan title, SEO and every block's texts/urls. "held" stops here: pages.status =
//      "held", a flag, nothing written to the store. "unsure" publishes and flags; a
//      scanner that throws publishes and flags "error" (D248: never blocks)
//   3. version JSON { page, sections } through toSnapshot (deny by default, no
//      password_hash), pruned to the newest 10 (D184) only once the publish has landed
//      (WR-A07). Versions are written ONLY here and by restore (which publishes), never by
//      a save (D254)
//   3b. version_refs (07-12, CONT-36, D275): the pop-up / form / media refs of every
//      retained version (the new one from its rows, older ones from the stored entries or,
//      for pre-P7 pages, their JSON), written in the step-5 pages batch
//   4. the published page JSON (config only) and the site manifest (read-modify-write);
//      a changed published slug adds a redirect old -> new (D188, served as 308)
//   5. one pages update: status, published_at, has_unpublished_changes=false,
//      previous_slugs (appended when the slug changed), in ONE PB batch with the
//      "page.publish" audit row (WR-A04). A failure before it commits puts the published
//      JSON and manifest back and drops the new version
//   6. invalidate [pageTag, siteTag]; ping the page URL on the primary host (best effort)
//   7. promote (07-12, CONT-33, resolution d): after the lock, for a public, non-protected
//      page, copy the media it uses (and its pop-ups' media) private -> public and set
//      public_at. A failure never fails the publish (the resolver tokenizes unpromoted
//      media) and the next publish retries; anything promoted re-invalidates the page
// restorePageVersion replaces the draft with a version's blocks and publishes. Restore clears
// deleted_at on what the version uses (07-28, D275): every form, pop-up and media file of its
// rows, the forms and media inside the pop-ups it opens and a video's cover, in the same
// batch as the restore. It is never refused because something was deleted; a gone id stays
// in the content (renders nothing; the builder shows the deleted state).
// Ports (scanner, pinger, invalidator) and the store are injected; @cds/db never imports
// next/* (RESEARCH anti-pattern).
import { InvalidInput, NotFound } from "@cds/core";
import {
  htmlToPlainText,
  unionRefs,
  type PublishedPage,
  type SectionRefs,
  type SectionRegistry,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
  tenantRepo,
} from "../repository";
import { fromSnapshotRecord, toSnapshot } from "../snapshot";
import {
  assertValidKey,
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantVersionKey,
  tenantVersionPrefix,
  type ObjectStore,
} from "../storage";
import { contentFlagBody, recordContentFlag } from "./flags";
import { withOrgLock } from "./lock";
import { liveHolderOf, readJson, readManifest } from "./manifest";
import {
  HOME_SLUG,
  isInBin,
  SlugTaken,
  slugLiveCopy,
  toPageSummary,
} from "./pages";
import { promoteMedia, mediaIdsForPromotion } from "../media/library/promote";
import { liveTag, pageTag, siteTag, type ContentDeps } from "./ports";
import { draftRows, projectPublishedPage, projectSection } from "./project";
import { pingAndRecord } from "./indexing-record";
import { screen } from "./screen";
import { refreshSiteIndex } from "./site-index/build";
import {
  pageShareRefs,
  popupRefs,
  rowsRefs,
  versionEntries,
  type OrgScope,
} from "./references";
import { assertOpsNotLocked, scopedGet } from "./shared";
import {
  SITE_VERSION_ID_RE,
  atOfVersionId,
  versionIdOf,
} from "./history/parts";
import { memberNames } from "./history/versions";
import { undeleteOps } from "./soft-delete";
import {
  buildVersionRefs,
  parseVersionRefs,
  VERSIONS_KEPT,
} from "./version-refs";

/** Page versions kept per page (D184); defined in version-refs.ts. */
export { VERSIONS_KEPT };

export type PublishDeps = ContentDeps & {
  store?: ObjectStore;
  /** The public media store promote copies into (07-12; default getPublicMediaStore()). */
  publicStore?: ObjectStore;
  now?: () => Date;
};

/** publishLocked's internal result: what to promote once the lock is released. */
type LockedPublish = { result: PublishResult; promoteIds: string[] };

export type PublishResult =
  | {
      status: "published";
      published_at: string;
      flagged: boolean;
      versionKey: string;
      /** The version's id (its file stamp): the only handle that crosses to a browser. */
      versionId: string;
    }
  | { status: "held"; reasons: string[] };

/** Who published a page version (DASH-07, D254). */
export type PageVersionAuthor =
  | { kind: "member"; name: string }
  | { kind: "former" }
  | { kind: "support" }
  | { kind: "assembly" }
  | { kind: "earlier" };

/** One kept page version. The id is the file stamp; keys never leave the server. */
export type PageVersion = {
  id: string;
  at: string;
  who: PageVersionAuthor;
  current: boolean;
};

/** The `by` envelope of a version (11-25 choice 1); null before authorship existed. */
type VersionBy = { actor: string; staff: boolean; job: string | null };

function parseBy(raw: unknown): VersionBy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const by = (raw as Record<string, unknown>).by;
  if (typeof by !== "object" || by === null) return null;
  const b = by as Record<string, unknown>;
  if (typeof b.actor !== "string" || typeof b.staff !== "boolean") return null;
  return {
    actor: b.actor,
    staff: b.staff,
    job: typeof b.job === "string" && b.job !== "" ? b.job : null,
  };
}

const JSON_TYPE = "application/json";

const STAMP_RE = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

function assertRegistry(registry: SectionRegistry | undefined): void {
  if (!registry || typeof registry.get !== "function") {
    throw new Error("publish needs the composed section registry");
  }
}

/** The ISO instant encoded in a version key, or null for a foreign-shaped key. */
function stampOf(key: string): string | null {
  const m = STAMP_RE.exec(key);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

/** Scanner inputs: title, SEO, and every visible block's texts (plain) and urls. */
function scanInputs(
  published: PublishedPage,
  registry: SectionRegistry,
): { texts: string[]; urls: string[] } {
  const texts: string[] = [published.page.title];
  const urls: string[] = [];
  const seo = published.page.seo;
  if (seo.meta_title) texts.push(seo.meta_title);
  if (seo.meta_description) texts.push(seo.meta_description);
  if (seo.og_image) urls.push(seo.og_image);
  for (const s of published.sections) {
    const def = registry.get(s.section_type);
    if (!def) continue;
    for (const t of def.textsOf(s.content)) {
      if (typeof t === "string" && t !== "") {
        texts.push(t.includes("<") ? htmlToPlainText(t) : t);
      }
    }
    for (const u of def.urlsOf(s.content)) {
      if (typeof u === "string" && u !== "") urls.push(u);
    }
  }
  return { texts, urls };
}

/** A version key newer than every existing one (two publishes in one ms stay distinct). */
function nextVersionKey(
  orgId: string,
  pageId: string,
  at: Date,
  existing: readonly string[],
): string {
  const taken = new Set(existing);
  const last =
    existing.length > 0 ? stampOf(existing[existing.length - 1]!) : null;
  let ms = at.getTime();
  if (last !== null) ms = Math.max(ms, Date.parse(last) + 1);
  let key = tenantVersionKey(orgId, pageId, new Date(ms));
  while (taken.has(key)) {
    ms += 1;
    key = tenantVersionKey(orgId, pageId, new Date(ms));
  }
  return key;
}

async function primaryHost(
  pb: PocketBase,
  orgId: string,
): Promise<string | null> {
  const res = await pb.collection("org_hosts").getList(1, 1, {
    filter: pb.filter("organization = {:org} && primary = true", {
      org: orgId,
    }),
    fields: "hostname",
  });
  const h = res.items[0]?.hostname;
  return typeof h === "string" && h !== "" ? h : null;
}

/**
 * The whole chain under the per-org lock (T-03-34: the manifest is read-modify-write), on
 * the superuser client, with PB errors mapped. Callers already checked content:write.
 */
function locked<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  return withOrgLock(ctx.orgId, () => withSuperuser(fn)).catch(
    (err: unknown) => {
      if (err instanceof ClientResponseError) mapError(err);
      throw err;
    },
  );
}

/** Put an object back as it was before a failed publish: its old bytes, or absent. */
async function restoreObject(
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

/** Throws SlugTaken while another existing page of this org is live on `slug` (CR-A01). */
async function assertSlugNotLiveElsewhere(
  pb: PocketBase,
  ctx: OrgContext,
  manifest: Awaited<ReturnType<typeof readManifest>>,
  slug: string,
  pageId: string,
): Promise<void> {
  const holder = liveHolderOf(manifest, slug, pageId);
  if (holder === null) return;
  const live = await pb.collection("pages").getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id: holder,
      org: ctx.orgId,
    }),
    fields: "id",
  });
  if (live.items.length > 0) throw new SlugTaken(slugLiveCopy(slug));
}

/** The chain itself. Caller holds the per-org lock and content:write. */
async function publishLocked(
  pb: PocketBase,
  ctx: OrgContext,
  pageId: string,
  deps: PublishDeps,
): Promise<LockedPublish> {
  const store = deps.store ?? getObjectStore();
  const now = (deps.now ?? (() => new Date()))();

  // 1. load + project (validate, normalize, sanitize). A page in Recently deleted is not
  // publishable (11-29): it would re-enter the manifest.
  const page = await scopedGet(pb, ctx, "pages", pageId);
  if (isInBin(page)) throw new NotFound();
  // 12-REVIEW CR-A03: a member cannot publish a page a service window has paused.
  await assertOpsNotLocked(pb, ctx, [
    { collection: "pages", op: "update", id: page.id },
  ]);
  const rows = await draftRows(pb, ctx, page.id);
  const published = projectPublishedPage(page, rows, deps.sections, now);

  // The manifest is keyed by the published slug. A draft rename frees the DB slug while the
  // old one is still live, so another page must not take it over here (CR-A01): that would
  // silently drop the live page from the site. Checked before anything is written.
  const manifestKey = tenantSiteManifestKey(ctx.orgId);
  const manifest = await readManifest(store, ctx.orgId, now);
  const slug = published.page.slug;
  await assertSlugNotLiveElsewhere(pb, ctx, manifest, slug, page.id);

  // 2. scan (D248)
  const { texts, urls } = scanInputs(published, deps.sections);
  const outcome = await screen(ctx, deps, texts, urls);
  if (outcome.verdict === "held") {
    // The status change and its audit row commit together (WR-A04, invariant 10).
    const held = pb.createBatch();
    held.collection("pages").update(page.id, { status: "held" });
    held.collection("audit_log").create(
      auditBody(ctx, {
        action: "page.publish_held",
        targetCollection: "pages",
        targetId: page.id,
      }),
    );
    await held.send();
    await recordContentFlag(ctx, {
      targetCollection: "pages",
      targetId: page.id,
      verdict: "held",
      reasons: outcome.reasons,
    });
    // 07-31: rebuild index.json, a held page leaves the index (CONT-37)
    await refreshSiteIndex(ctx.orgId, { ...deps, store, now: () => now });
    return {
      result: { status: "held", reasons: outcome.reasons },
      promoteIds: [],
    };
  }
  // An "unsure" or "error" flag commits in the publish batch below, so a publish that
  // fails leaves no flag for staff to chase (IN-R06).
  const flag =
    outcome.verdict === "clean"
      ? null
      : contentFlagBody(ctx, {
          targetCollection: "pages",
          targetId: page.id,
          verdict: outcome.verdict,
          reasons: outcome.reasons,
        });
  const flagged = flag !== null;

  // 3. version JSON (deny by default through toSnapshot). Pruning to the newest 10 waits
  // until the publish has landed (WR-A07): a failed publish must not cost a real version.
  const prefix = tenantVersionPrefix(ctx.orgId, page.id);
  const existing = (await store.list(prefix)).map((o) => o.key).sort();
  const versionKey = nextVersionKey(ctx.orgId, page.id, now, existing);
  const version = {
    version: 1,
    // Who published (DASH-07, D254; T-11-25-02). A system job names no member.
    by: {
      actor: ctx.systemJob ? "" : ctx.actor,
      staff: Boolean(ctx.impersonator),
      job: ctx.systemJob ? "assembly" : null,
    },
    page: toSnapshot("pages", page),
    sections: rows.map((r) => toSnapshot("page_sections", r)),
  };
  // What the live site served before, so a failed publish can put it back (WR-A04).
  const pageKey = tenantPublishedPageKey(ctx.orgId, page.id);
  const prevPageJson = await store.get(pageKey);
  const prevManifest = await store.get(manifestKey);
  // 3b. version_refs of the versions kept after this publish (choice 11).
  const keptNames = [...existing, versionKey]
    .sort()
    .slice(-VERSIONS_KEPT)
    .map((k) => k.slice(prefix.length));
  const newName = versionKey.slice(prefix.length);
  const { entries } = await versionEntries(
    store,
    ctx.orgId,
    page.id,
    keptNames.filter((n) => n !== newName),
    parseVersionRefs(page.version_refs),
    deps.sections,
  );
  // WR-A05: the version also holds the share image it is published with.
  entries[newName] = unionRefs([
    rowsRefs(rows, deps.sections),
    pageShareRefs(page),
  ]);
  const nextRefs = buildVersionRefs(entries);
  await store.put(versionKey, JSON.stringify(version), JSON_TYPE);

  let slugChanged = false;
  try {
    // 4. published page JSON + manifest
    await store.put(pageKey, JSON.stringify(published), JSON_TYPE);
    let oldSlug: string | null = null;
    for (const [s, entry] of Object.entries(manifest.pages)) {
      if (entry.id === page.id) {
        oldSlug = s;
        delete manifest.pages[s];
      }
    }
    manifest.pages[slug] = {
      id: page.id,
      title: published.page.title,
      published_at: published.published_at,
      protected: published.page.password_protected,
    };
    // The slug is live again: it no longer redirects anywhere.
    delete manifest.redirects[slug];
    slugChanged = oldSlug !== null && oldSlug !== slug;
    if (slugChanged) {
      manifest.redirects[oldSlug!] = slug;
      // Older names of this page follow it to the new slug (no chains).
      for (const [from, to] of Object.entries(manifest.redirects)) {
        if (to === oldSlug) manifest.redirects[from] = slug;
      }
    }
    manifest.updated_at = now.toISOString();
    await store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);

    // 5. one pages update
    const summary = toPageSummary(page);
    const body: Record<string, unknown> = {
      status: "published",
      published_at: published.published_at,
      has_unpublished_changes: false,
      version_refs: nextRefs,
    };
    if (slugChanged && !summary.previous_slugs.includes(oldSlug!)) {
      body.previous_slugs = [...summary.previous_slugs, oldSlug!];
    }
    // 5b. the pages update and its page.publish audit row are one PB batch, so no publish
    // (impersonated or not) lands without its audit row (WR-A04, invariant 10).
    const batch = pb.createBatch();
    batch.collection("pages").update(page.id, body);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "page.publish",
        targetCollection: "pages",
        targetId: page.id,
        meta: { slug, version: versionKey.slice(prefix.length), flagged },
      }),
    );
    if (flag) batch.collection("content_flags").create(flag);
    await batch.send();
  } catch (err) {
    // Nothing committed in the DB: put the live site back as it was (WR-A04) and keep a
    // version that was never published out of the history (WR-A07). Best effort.
    await restoreObject(store, pageKey, prevPageJson);
    await restoreObject(store, manifestKey, prevManifest);
    await store.delete(versionKey).catch(() => undefined);
    throw err;
  }

  // Prune to the newest 10 only now (best effort: extra versions are harmless).
  const all = [...existing, versionKey].sort();
  for (const old of all.slice(0, Math.max(0, all.length - VERSIONS_KEPT))) {
    await store.delete(old).catch(() => undefined);
  }

  // 07-31: rebuild index.json (own lock key, never throws; CONT-37, D277)
  await refreshSiteIndex(ctx.orgId, { ...deps, store, now: () => now });

  // 6. invalidate + ping (best effort: the publish and its audit row have committed)
  try {
    deps.invalidator.invalidate([
      pageTag(ctx.orgId, page.id),
      siteTag(ctx.orgId),
    ]);
  } catch {
    // Cached renders expire on their own (300 s); a failed invalidation is not an error.
  }
  try {
    const host = await primaryHost(pb, ctx.orgId);
    if (host) {
      const path = slug === HOME_SLUG ? "" : slug;
      // 13-19 (STAFF-17): the per-org result goes to org_indexing (recordPing).
      await pingAndRecord(ctx.orgId, [`https://${host}/${path}`], {
        ...(deps.pinger ? { pinger: deps.pinger } : {}),
        now,
      });
    }
  } catch {
    // The page is already published; a failed ping is not an error.
  }

  // 7. what to promote after the lock: only a public, non-protected page (resolution d).
  let promoteIds: string[] = [];
  if (!published.page.password_protected) {
    try {
      promoteIds = await mediaIdsForPromotion(
        pb,
        ctx,
        published.sections,
        deps.sections,
      );
    } catch {
      console.error("[media] promote lookup failed", page.id);
    }
    // 07-30 (choice 6): the page's share image is public with the page (non-protected only).
    if (published.page.seo?.share_image)
      promoteIds.push(published.page.seo.share_image);
  }

  return {
    result: {
      status: "published",
      published_at: published.published_at,
      flagged,
      versionKey,
      versionId: versionIdOf(versionKey) ?? "",
    },
    promoteIds,
  };
}

/** Step 7, outside the lock: promote, never failing the publish (choice 9). */
async function promoteAfterPublish(
  ctx: OrgContext,
  pageId: string,
  promoteIds: readonly string[],
  deps: PublishDeps,
): Promise<void> {
  if (promoteIds.length === 0) return;
  try {
    const { promoted } = await promoteMedia(ctx, promoteIds, {
      ...(deps.store ? { store: deps.store } : {}),
      ...(deps.publicStore ? { publicStore: deps.publicStore } : {}),
    });
    if (promoted.length > 0) {
      deps.invalidator.invalidate([
        pageTag(ctx.orgId, pageId),
        siteTag(ctx.orgId),
      ]);
    }
  } catch (err) {
    console.error(
      "[media] promote failed",
      pageId,
      err instanceof Error ? err.name : "error",
    );
  }
}

/**
 * Everything a restored version uses (07-28): its rows' refs, plus the forms and media inside
 * the org's pop-ups it opens, plus the covers (poster_asset) of the org's videos it uses.
 */
async function restoredRefs(
  pb: PocketBase,
  scope: OrgScope,
  rows: readonly unknown[],
  registry: SectionRegistry,
): Promise<SectionRefs> {
  const refs = rowsRefs(rows, registry);
  const extra: SectionRefs[] = [];
  const among = async (collection: string, ids: string[], fields: string) => {
    const out: RecordModel[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const params: Record<string, string> = { org: scope.orgId };
      const ors = ids.slice(i, i + 50).map((id, j) => {
        params[`i${j}`] = id;
        return "id = {:i" + j + "}";
      });
      out.push(
        ...(await pb.collection(collection).getFullList({
          filter: pb.filter(
            "organization = {:org} && (" + ors.join(" || ") + ")",
            params,
          ),
          fields,
        })),
      );
    }
    return out;
  };
  for (const p of await among("popups", refs.popups, "id,content")) {
    extra.push(popupRefs(p.content));
  }
  const withPopups = unionRefs([refs, ...extra]);
  const covers = (
    await among("media_assets", withPopups.media, "id,poster_asset")
  )
    .map((m) => (typeof m.poster_asset === "string" ? m.poster_asset : ""))
    .filter((id) => id !== "");
  return unionRefs([withPopups, { popups: [], forms: [], media: covers }]);
}

// ---------------------------------------------------------------------------------------
// Public API

/** Publish a page's draft (CONT-30). */
export async function publishPage(
  ctx: OrgContext,
  pageId: string,
  deps: PublishDeps,
): Promise<PublishResult> {
  requirePermission(ctx, "content", "write");
  assertId(pageId);
  assertRegistry(deps?.sections);
  const { result, promoteIds } = await locked(ctx, (pb) =>
    publishLocked(pb, ctx, pageId, deps),
  );
  await promoteAfterPublish(ctx, pageId, promoteIds, deps);
  return result;
}

/**
 * The page's versions, newest first (at most 10), with who published each and which one is
 * live (DASH-07). `current` is the version whose stamp matches pages.published_at, else the
 * newest. Content read: Viewers see the history (they cannot restore).
 */
export async function listPageVersions(
  ctx: OrgContext,
  pageId: string,
  store?: ObjectStore,
): Promise<PageVersion[]> {
  requirePermission(ctx, "content", "read");
  assertId(pageId);
  // Scoped lookup: a foreign or absent page is NotFound before any key is built.
  const page = await tenantRepo("pages").get(ctx, pageId);
  const s = store ?? getObjectStore();
  const keys = (await s.list(tenantVersionPrefix(ctx.orgId, pageId)))
    .map((o) => o.key)
    .filter((k) => versionIdOf(k) !== null)
    .sort()
    .reverse()
    .slice(0, VERSIONS_KEPT);
  const entries: { id: string; at: string; by: VersionBy | null }[] = [];
  for (const key of keys) {
    const id = versionIdOf(key)!;
    entries.push({
      id,
      at: atOfVersionId(id),
      by: parseBy(await readJson(s, key).catch(() => null)),
    });
  }
  const actors = [
    ...new Set(
      entries.flatMap((e) =>
        e.by && !e.by.staff && !e.by.job && e.by.actor !== ""
          ? [e.by.actor]
          : [],
      ),
    ),
  ];
  const names =
    actors.length > 0
      ? await withSuperuser((pb) => memberNames(pb, ctx.orgId, actors))
      : new Map<string, string>();
  const publishedRaw = (page as { published_at?: unknown }).published_at;
  const publishedMs =
    typeof publishedRaw === "string" && publishedRaw !== ""
      ? Date.parse(publishedRaw.replace(" ", "T"))
      : Number.NaN;
  let currentIndex = entries.findIndex((e) => Date.parse(e.at) === publishedMs);
  if (currentIndex < 0 && entries.length > 0) currentIndex = 0;
  return entries.map((e, i) => {
    let who: PageVersionAuthor;
    if (e.by === null) who = { kind: "earlier" };
    else if (e.by.job) who = { kind: "assembly" };
    else if (e.by.staff) who = { kind: "support" };
    else if (names.has(e.by.actor)) {
      who = { kind: "member", name: names.get(e.by.actor)! };
    } else who = { kind: "former" };
    return { id: e.id, at: e.at, who, current: i === currentIndex };
  });
}

/**
 * The storage key of a version for the caller's own org + page (T-03-35, T-11-25-01). The
 * browser sends a version id; server callers may still pass the full key they got from a
 * publish. Either way the key is rebuilt under the caller's prefix and the stamp checked.
 */
function versionKeyFor(
  ctx: OrgContext,
  pageId: string,
  version: unknown,
): string {
  if (typeof version !== "string" || version === "") throw new NotFound();
  const prefix = tenantVersionPrefix(ctx.orgId, pageId);
  let id = version;
  if (version.includes("/")) {
    if (!version.startsWith(prefix)) throw new NotFound();
    const name = version.slice(prefix.length);
    if (name.includes("/") || !name.endsWith(".json")) throw new NotFound();
    id = name.slice(0, -".json".length);
  }
  if (!SITE_VERSION_ID_RE.test(id)) throw new NotFound();
  const key = `${prefix}${id}.json`;
  if (stampOf(key) === null || versionIdOf(key) !== id) throw new NotFound();
  try {
    assertValidKey(key);
  } catch {
    throw new NotFound();
  }
  return key;
}

/**
 * Replace the draft with a version's blocks and publish, so the restore is itself a new
 * version (D184, DASH-07). `version` is a version id (or, server side, a key); the key is
 * rebuilt under the caller's own org + page prefix (T-03-35, T-11-25-01).
 */
export async function restorePageVersion(
  ctx: OrgContext,
  pageId: string,
  version: string,
  deps: PublishDeps,
): Promise<PublishResult> {
  requirePermission(ctx, "content", "write");
  assertId(pageId);
  assertRegistry(deps?.sections);
  const prefix = tenantVersionPrefix(ctx.orgId, pageId);
  const versionKey = versionKeyFor(ctx, pageId, version);
  const store = deps.store ?? getObjectStore();
  const { result, promoteIds, undeletedAny } = await locked(ctx, async (pb) => {
    const page = await scopedGet(pb, ctx, "pages", pageId);
    if (isInBin(page)) throw new NotFound();
    const raw = await readJson(store, versionKey);
    if (typeof raw !== "object" || raw === null) throw new NotFound();
    const sections = (raw as Record<string, unknown>).sections;
    if (!Array.isArray(sections)) {
      throw new InvalidInput("This version is malformed.");
    }
    const restored = sections.map((s) => {
      const snap = fromSnapshotRecord("page_sections", s);
      // Fresh id, forced org and page; the row passes the registry pipeline again.
      const id = newRecordId();
      const probe = {
        id,
        section_type: snap.section_type,
        row_layout: snap.row_layout,
        content: snap.content,
        settings: snap.settings,
      } as unknown as RecordModel;
      const projected = projectSection(probe, deps.sections);
      return {
        id,
        organization: ctx.orgId,
        page: page.id,
        page_slug: page.slug,
        section_type: projected.section_type,
        row_layout: projected.row_layout,
        content: projected.content,
        settings: projected.settings,
        sort_order:
          typeof snap.sort_order === "number" &&
          Number.isFinite(snap.sort_order)
            ? snap.sort_order
            : 0,
        is_published: snap.is_published !== false,
      };
    });
    // What the version uses, cleared of deleted_at in the restore batch (07-28, D275).
    const undelete = await undeleteOps(
      pb,
      ctx,
      await restoredRefs(pb, ctx, restored, deps.sections),
    );
    const current = await draftRows(pb, ctx, page.id);
    if (current.length + restored.length + undelete.length + 2 > 1000) {
      throw new InvalidInput("This version is too large to restore.");
    }
    // The publish that follows refuses a slug another page holds live. Check it before the
    // draft is replaced, so that refusal leaves the draft as it was (IN-R07). The sections
    // were projected above, so a malformed version is refused before any write too.
    await assertSlugNotLiveElsewhere(
      pb,
      ctx,
      await readManifest(store, ctx.orgId, (deps.now ?? (() => new Date()))()),
      toPageSummary(page).slug,
      page.id,
    );
    // 12-REVIEW CR-A03: the page, and every pop-up, form and file the restore brings back,
    // must be free of an active service window for a member (D102).
    await assertOpsNotLocked(pb, ctx, [
      { collection: "pages", op: "update", id: page.id },
      ...undelete,
    ]);
    const batch = pb.createBatch();
    for (const r of current) batch.collection("page_sections").delete(r.id);
    for (const r of restored) batch.collection("page_sections").create(r);
    batch
      .collection("pages")
      .update(page.id, { has_unpublished_changes: true });
    const undeleted = { popups: 0, forms: 0, media: 0 };
    for (const op of undelete) {
      if (op.op !== "update") continue;
      batch.collection(op.collection).update(op.id, op.body);
      if (op.collection === "popups") undeleted.popups += 1;
      else if (op.collection === "forms") undeleted.forms += 1;
      else undeleted.media += 1;
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "page.restore",
        targetCollection: "pages",
        targetId: page.id,
        meta: { version: versionKey.slice(prefix.length), undeleted },
      }),
    );
    await batch.send();
    const published = await publishLocked(pb, ctx, page.id, deps);
    return { ...published, undeletedAny: undelete.length > 0 };
  });
  if (undeletedAny) {
    // Pop-ups and forms are live data: their cached reads change with deleted_at.
    try {
      deps.invalidator.invalidate([liveTag(ctx.orgId)]);
    } catch {
      // Cached reads expire on their own.
    }
  }
  await promoteAfterPublish(ctx, pageId, promoteIds, deps);
  return result;
}
