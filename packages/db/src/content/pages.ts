// Pages chokepoint (CONT-30, D254, D188; CONTEXT A1-Q3; invariant 1, TEN-03).
//
// pages is a writes:"custom" collection: tenantRepo gives reads only, and every write is
// here with its invariants:
//   - every writer: requirePermission(ctx, "content", "write"), organization never taken
//     from input (InvalidInput when present and different, T-03-20)
//   - page lookups are scoped `id = {:id} && organization = {:org}`: foreign = absent =
//     NotFound (Pitfall 7)
//   - slug rules: one lowercase segment (SLUG_RE, max 64), not reserved, unique per org
//     (checked under the per-org lock; the DB unique index is the backstop), and not still
//     live in the published manifest for another page (CR-A01: a draft rename frees the DB
//     slug while the old one keeps serving)
//   - saves never write versions and never touch previous_slugs: only publish does
//     (D254, D188). A save sets has_unpublished_changes.
//   - the home page keeps its slug: it serves "/"
//   - password_hash is never read or returned here (T-03-08)
import { CdsError, InvalidInput, NotFound } from "@cds/core";
import { safeImageUrl, type PageSeo } from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { newRecordId, requirePermission, tenantRepo } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import { assertPageRoom } from "./allowance";
import { liveHolderOf, readManifest } from "./manifest";
import { isProtected } from "./project";
import { SHARE_IMAGE_COPY, assertOwnShareImage } from "./seo/share-image";
import {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  run,
  scopedGet,
} from "./shared";

const COLLECTION = "pages";

export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  "api",
  "_next",
  "sitemap.xml",
  "robots.txt",
  "hub",
  "sign-in",
  // P7 system routes (07-02): CONT-28 /search and /llms.txt (07-31), /_media/<id>/<variant> (07-09).
  "search",
  "llms.txt",
  "_media",
  // 07-32 (CONT-28, choice 8): the 404 page's slug; the tenant route refuses it.
  "system-404",
  // P9 system routes (AGR-08, D217): tenant policy pages.
  "privacy",
  "terms",
  // Studio Booking public routes: the barber pages and online booking.
  "barbers",
  "book",
  // P11 bio short links (11-35; DASH-15, D199): the ten preset codes and /go/<code>. New
  // pages may not take them; an existing page keeps its slug (WR-A06: an unchanged slug is
  // never re-checked) and wins, so that account's link falls back to /go/<code> (Pitfall 19).
  "ig",
  "fb",
  "tt",
  "yt",
  "li",
  "pin",
  "x",
  "th",
  "yelp",
  "nd",
  "go",
]);
/** The one system 404 page per org (07-32 choice 8). Rendered only by not-found.tsx. */
export const NOT_FOUND_SLUG = "system-404";
export const NOT_FOUND_KIND = "system-404";
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 64;
export const HOME_SLUG = "home";
const TITLE_MAX = 120;
const META_TITLE_MAX = 120;
const META_DESCRIPTION_MAX = 300;

const SLUG_FORMAT_COPY =
  "Use lowercase letters, numbers and hyphens, like /our-story.";

/** Another page of this organization already uses the slug (UI-SPEC "Slug taken"). */
export class SlugTaken extends CdsError {
  override readonly code = "slug_taken";
}

/** The slug is used by the system (UI-SPEC "Slug reserved"). */
export class SlugReserved extends CdsError {
  override readonly code = "slug_reserved";
}

// Defined in @cds/core/content so client components can type props without @cds/db (10-18).
export type { PageSummary } from "@cds/core/content";
import type { PageSummary } from "@cds/core/content";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function seoOf(v: unknown): PageSeo {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const r = v as Record<string, unknown>;
  const out: PageSeo = {};
  if (typeof r.meta_title === "string") out.meta_title = r.meta_title;
  if (typeof r.meta_description === "string") {
    out.meta_description = r.meta_description;
  }
  if (typeof r.og_image === "string") out.og_image = r.og_image;
  if (typeof r.share_image === "string" && SHARE_ID_RE.test(r.share_image)) {
    out.share_image = r.share_image;
  }
  return out;
}

const SHARE_ID_RE = /^[a-z0-9]{15}$/;

export function toPageSummary(r: RecordModel): PageSummary {
  const status =
    r.status === "published" || r.status === "held" ? r.status : "draft";
  return {
    id: r.id,
    slug: str(r.slug),
    title: str(r.title),
    status,
    published_at:
      typeof r.published_at === "string" && r.published_at
        ? r.published_at
        : null,
    has_unpublished_changes: r.has_unpublished_changes === true,
    kind: r.kind === NOT_FOUND_KIND ? "system-404" : "builder",
    password_protected: isProtected(r),
    seo: seoOf(r.seo),
    previous_slugs: Array.isArray(r.previous_slugs)
      ? r.previous_slugs.filter(
          (s: unknown): s is string => typeof s === "string",
        )
      : [],
  };
}

// ---------------------------------------------------------------------------------------
// Validation

function slugOf(v: unknown): string {
  if (typeof v !== "string") throw new InvalidInput(SLUG_FORMAT_COPY);
  const s = v.trim().replace(/^\/+/, "");
  if (RESERVED_SLUGS.includes(s.toLowerCase())) {
    throw new SlugReserved(
      `/${s.toLowerCase()} is used by the system. Pick another address.`,
    );
  }
  if (s === "" || s.length > SLUG_MAX || !SLUG_RE.test(s)) {
    throw new InvalidInput(SLUG_FORMAT_COPY);
  }
  return s;
}

function titleOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") throw new InvalidInput("Give the page a title.");
  if (s.length > TITLE_MAX) {
    throw new InvalidInput(`Keep this under ${TITLE_MAX} characters.`);
  }
  return s;
}

function capped(r: Record<string, unknown>, key: string, max: number): string {
  const v = own(r, key);
  if (v === undefined || v === null) return "";
  if (typeof v !== "string")
    throw new InvalidInput("The SEO settings are malformed.");
  const s = v.trim();
  if (s.length > max)
    throw new InvalidInput(`Keep this under ${max} characters.`);
  return s;
}

function seoInput(v: unknown): PageSeo {
  const r = asInput(v, "seo");
  const out: PageSeo = {};
  const meta_title = capped(r, "meta_title", META_TITLE_MAX);
  const meta_description = capped(r, "meta_description", META_DESCRIPTION_MAX);
  const og_image = safeImageUrl(own(r, "og_image"));
  // 07-30 (choice 5): a library share image id; it and the pasted link clear each other.
  const rawShare = own(r, "share_image");
  let share_image = "";
  if (rawShare !== undefined && rawShare !== null && rawShare !== "") {
    if (typeof rawShare !== "string" || !SHARE_ID_RE.test(rawShare)) {
      throw new InvalidInput(SHARE_IMAGE_COPY);
    }
    share_image = rawShare;
  }
  if (meta_title) out.meta_title = meta_title;
  if (meta_description) out.meta_description = meta_description;
  if (share_image) out.share_image = share_image;
  else if (og_image) out.og_image = og_image;
  return out;
}

/**
 * Refuse a slug another row of this org has. Pages in the bin (deleted_at set) hold their
 * slug until the GC purges them (11-29, D275), so every row is read here.
 */
export async function assertSlugFree(
  pb: PocketBase,
  ctx: OrgContext,
  slug: string,
  exceptId?: string,
): Promise<void> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && slug = {:slug}", {
      org: ctx.orgId,
      slug,
    }),
    fields: "id",
  });
  const hit = res.items[0];
  if (hit && hit.id !== exceptId) {
    const suggestion = `${slug.slice(0, SLUG_MAX - 2).replace(/-+$/, "")}-2`;
    throw new SlugTaken(
      `Another page already uses /${slug}. Try /${suggestion}.`,
    );
  }
}

/** UI copy when a slug is still served by another page's published version (CR-A01). */
export function slugLiveCopy(slug: string): string {
  return `/${slug} is still live for another page. Publish that page first or pick another address.`;
}

/**
 * Refuse a slug the published manifest still serves for another existing page of this org
 * (CR-A01). Caller holds the per-org lock. A manifest entry whose page no longer exists is
 * stale and does not hold the slug.
 */
export async function assertSlugNotLive(
  pb: PocketBase,
  ctx: OrgContext,
  store: ObjectStore,
  slug: string,
  exceptId?: string,
): Promise<void> {
  const manifest = await readManifest(store, ctx.orgId, new Date());
  const holder = liveHolderOf(manifest, slug, exceptId);
  if (holder === null) return;
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id: holder,
      org: ctx.orgId,
    }),
    fields: "id",
  });
  if (res.items.length > 0) throw new SlugTaken(slugLiveCopy(slug));
}

// ---------------------------------------------------------------------------------------
// Internal helper shared with sections.ts

/** Page scoped to the org and not deleted (NotFound otherwise; 11-29 Pitfall 12). */
export async function getScopedPage(
  pb: PocketBase,
  ctx: OrgContext,
  pageId: unknown,
): Promise<RecordModel> {
  const row = await scopedGet(pb, ctx, COLLECTION, pageId);
  if (isInBin(row)) throw new NotFound();
  return row;
}

/** A page row in Recently deleted (11-29, D275). */
export function isInBin(r: RecordModel): boolean {
  return typeof r.deleted_at === "string" && r.deleted_at !== "";
}

/** The write that marks a page as edited since its last publish (CONT-30). */
export function markPageChanged(pageId: string) {
  return {
    collection: COLLECTION,
    op: "update" as const,
    id: pageId,
    body: { has_unpublished_changes: true },
  };
}

// ---------------------------------------------------------------------------------------
// Public API

/**
 * The org's pages: home first, then by title. Never the system 404 page (07-32 choice 10)
 * and never a page in Recently deleted (11-29): every picker reads this list.
 */
export async function listPages(ctx: OrgContext): Promise<PageSummary[]> {
  const res = await tenantRepo(COLLECTION).list(ctx, {
    perPage: 500,
    sort: "title",
    filter: "kind != {:kind} && deleted_at = ''",
    params: { kind: NOT_FOUND_KIND },
  });
  const pages = res.items.map(toPageSummary);
  return [
    ...pages.filter((p) => p.slug === HOME_SLUG),
    ...pages.filter((p) => p.slug !== HOME_SLUG),
  ];
}

export async function getPage(
  ctx: OrgContext,
  pageId: string,
): Promise<PageSummary> {
  const row = await tenantRepo(COLLECTION).get(ctx, pageId);
  // 11-29: a page in Recently deleted is not a page of the site until restored.
  if (isInBin(row)) throw new NotFound();
  return toPageSummary(row);
}

/** A new draft builder page. */
export async function createPage(
  ctx: OrgContext,
  raw: { title: string; slug: string },
  store?: ObjectStore,
): Promise<PageSummary> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "page input");
  rejectForeignOrg(ctx, input);
  const title = titleOf(own(input, "title"));
  const slug = slugOf(own(input, "slug"));
  const id = newRecordId();
  return run(ctx, async (pb) => {
    await assertSlugFree(pb, ctx, slug);
    await assertSlugNotLive(pb, ctx, store ?? getObjectStore(), slug);
    // DASH-08 (11-26): the allowance, under the same per-org lock as the create.
    await assertPageRoom(pb, ctx);
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "create",
          id,
          body: {
            organization: ctx.orgId,
            title,
            slug,
            seo: {},
            status: "draft",
            kind: "builder",
            has_unpublished_changes: true,
            previous_slugs: [],
            password_protected: false,
          },
        },
      ],
      {
        action: "pages.create",
        targetCollection: COLLECTION,
        targetId: id,
        meta: { slug },
      },
    );
    return toPageSummary(await getScopedPage(pb, ctx, id));
  });
}

/** Change a page's title, slug or SEO. Marks the page as having unpublished changes. */
export async function updatePage(
  ctx: OrgContext,
  pageId: string,
  raw: { title?: string; slug?: string; seo?: PageSeo },
  store?: ObjectStore,
): Promise<PageSummary> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "page input");
  rejectForeignOrg(ctx, input);
  const body: Record<string, unknown> = { has_unpublished_changes: true };
  if (own(input, "title") !== undefined) body.title = titleOf(input.title);
  const rawSlug = own(input, "slug");
  if (own(input, "seo") !== undefined) body.seo = seoInput(input.seo);
  return run(ctx, async (pb) => {
    const page = await getScopedPage(pb, ctx, pageId);
    // A page created before its slug became reserved (e.g. /privacy, /terms in P9) keeps
    // saving when a form re-posts the unchanged slug; only a change is validated (WR-A06).
    const unchanged =
      typeof rawSlug === "string" &&
      rawSlug.trim().replace(/^\/+/, "") === page.slug;
    const slug =
      rawSlug !== undefined && !unchanged ? slugOf(rawSlug) : undefined;
    const share = (body.seo as PageSeo | undefined)?.share_image;
    if (share) await assertOwnShareImage(pb, ctx.orgId, share);
    if (slug !== undefined && slug !== page.slug) {
      if (page.kind === NOT_FOUND_KIND) {
        throw new InvalidInput(
          "The Page not found page has no address to change.",
        );
      }
      if (page.slug === HOME_SLUG) {
        throw new InvalidInput(
          "The home page's address is always /. Rename its title instead.",
        );
      }
      await assertSlugFree(pb, ctx, slug, page.id);
      await assertSlugNotLive(
        pb,
        ctx,
        store ?? getObjectStore(),
        slug,
        page.id,
      );
      body.slug = slug;
    }
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "update", id: page.id, body }],
      {
        action: "pages.update",
        targetCollection: COLLECTION,
        targetId: page.id,
        meta: { fields: Object.keys(body) },
      },
    );
    return toPageSummary(await getScopedPage(pb, ctx, page.id));
  });
}
