// P11 reports/seo-health (11-18; D188, DASH-11): the SEO health score, computed on read
// from the org's PUBLISHED pages (manifest + published page JSON in the object store),
// never from drafts. Plain data: 11-33 caches it with the org's published tag.
//
// Page facts (choice 5):
// - title / description: the page title and its published SEO fields.
// - h1Count: the renderer draws exactly one H1: the first hero's heading when it has one,
//   else the page title (PageRenderer, D280). So 1 when either exists, else 0.
// - imagesWithoutAlt: image items, hero / text-image images and gallery / logo images whose
//   own alt is blank and whose library asset (when there is one) has no alt either.
// - brokenInternalLinks: same-site links ("/x") whose single path segment is neither a
//   published slug, a redirect, nor a system route. Multi-segment paths are not judged
//   (add-on and system routes live there). "/" needs a published Home.
// - sitemapOk: the manifest lists at least one page (the sitemap is built from it).
// Excluded from scoring: the system 404 page and password-protected pages (never indexed).
// Every read is bound to ctx.orgId (content read); the object keys derive from it.
import {
  seoHealth,
  type SeoHealth,
  type SeoPageInput,
} from "@cds/core/analytics";
import type { PublishedPage, SiteManifest } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import { readJson, readManifest } from "../content/manifest";
import { HOME_SLUG, NOT_FOUND_SLUG, RESERVED_SLUGS } from "../content/pages";
import { assertOrgContext, type OrgContext } from "../context";
import { mapped } from "../forms/shared";
import { requirePermission } from "../repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  type ObjectStore,
} from "../storage";

export type SeoHealthReport = SeoHealth & {
  /** Pages scored (published, indexable). */
  pages: number;
  /** The manifest's updated_at: "Checked {time} from your published pages." */
  checkedAt: string;
};

const SYSTEM_SEGMENTS: ReadonlySet<string> = new Set([
  ...RESERVED_SLUGS,
  "_site",
]);
const MEDIA_CHUNK = 100;
const MAX_WALK_DEPTH = 12;
const HREF_RE = /href\s*=\s*["']([^"']*)["']/gi;
const LINK_KEY_RE = /(^|_)(link|href)$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

type ImageRef = { alt: string; asset: string; url: string };

/** Walks a block's content once, collecting image references and link targets. */
function walk(
  value: unknown,
  images: ImageRef[],
  links: string[],
  depth = 0,
): void {
  if (depth > MAX_WALK_DEPTH) return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, images, links, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  if (value.kind === "image") {
    images.push({
      alt: str(value.alt),
      asset: str(value.asset),
      url: str(value.url),
    });
  }
  if ("image_url" in value || "image_asset" in value) {
    images.push({
      alt: str(value.image_alt),
      asset: str(value.image_asset),
      url: str(value.image_url),
    });
  }
  for (const listKey of ["images", "logos"]) {
    const list = value[listKey];
    if (!Array.isArray(list)) continue;
    for (const img of list) {
      if (!isRecord(img) || img.kind === "image") continue;
      images.push({
        alt: str(img.alt),
        asset: str(img.asset),
        url: str(img.url),
      });
    }
  }

  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "string") {
      if (LINK_KEY_RE.test(key)) links.push(v.trim());
      if (v.includes("href")) {
        for (const m of v.matchAll(HREF_RE)) links.push((m[1] ?? "").trim());
      }
    } else if (typeof v === "object" && v !== null) {
      walk(v, images, links, depth + 1);
    }
  }
}

/** A same-site link that leads nowhere on the published site. */
function isBrokenInternal(href: string, manifest: SiteManifest): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((s) => s !== "");
  const has = (slug: string) =>
    Object.prototype.hasOwnProperty.call(manifest.pages, slug) ||
    Object.prototype.hasOwnProperty.call(manifest.redirects, slug);
  if (segments.length === 0) return !has(HOME_SLUG);
  if (segments.length > 1) return false;
  let seg: string;
  try {
    seg = decodeURIComponent(segments[0]!).toLowerCase();
  } catch {
    return true;
  }
  if (SYSTEM_SEGMENTS.has(seg)) return false;
  return !has(seg);
}

function h1CountOf(page: PublishedPage): number {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const hero = sections.find((s) => isRecord(s) && s.section_type === "hero");
  const heroHeading =
    hero && isRecord(hero.content) ? str(hero.content.heading) : "";
  return heroHeading !== "" || str(page.page?.title) !== "" ? 1 : 0;
}

/** Library assets (of this org) that have no alt text. */
async function assetsWithoutAlt(
  pb: PocketBase,
  orgId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const clean = [...new Set(ids)].filter((id) => /^[a-z0-9]{1,64}$/.test(id));
  for (let i = 0; i < clean.length; i += MEDIA_CHUNK) {
    const chunk = clean.slice(i, i + MEDIA_CHUNK);
    const params: Record<string, string> = { org: orgId };
    const ors = chunk.map((id, j) => {
      params[`a${j}`] = id;
      return `id = {:a${j}}`;
    });
    // Placeholder names only; every value is bound (T-02-13).
    const expr = "organization = {:org} && (" + ors.join(" || ") + ")";
    const rows = await pb.collection("media_assets").getFullList({
      filter: pb.filter(expr, params),
      fields: "id,alt",
    });
    const found = new Set<string>();
    for (const r of rows) {
      found.add(r.id);
      if (str(r.alt) === "") out.add(r.id);
    }
    // An asset that is gone (or not this org's) renders the item's own alt or nothing.
    for (const id of chunk) if (!found.has(id)) out.add(id);
  }
  return out;
}

/** SEO health for the org's published site (D188). */
export async function seoHealthFor(
  ctx: OrgContext,
  opts: { store?: ObjectStore; now?: Date } = {},
): Promise<SeoHealthReport> {
  assertOrgContext(ctx);
  requirePermission(ctx, "content", "read");
  const store = opts.store ?? getObjectStore();
  const now = opts.now ?? new Date();
  const manifest = await readManifest(store, ctx.orgId, now);

  const entries = Object.entries(manifest.pages).filter(
    ([slug, e]) => slug !== NOT_FOUND_SLUG && !e.protected,
  );
  const loaded: {
    slug: string;
    page: PublishedPage;
    images: ImageRef[];
    links: string[];
  }[] = [];
  for (const [slug, e] of entries) {
    let raw: unknown = null;
    try {
      raw = await readJson(store, tenantPublishedPageKey(ctx.orgId, e.id));
    } catch {
      raw = null; // a malformed id in the manifest: skip the page, never throw
    }
    if (!isRecord(raw)) continue;
    const page = raw as unknown as PublishedPage;
    const images: ImageRef[] = [];
    const links: string[] = [];
    for (const s of Array.isArray(page.sections) ? page.sections : []) {
      if (isRecord(s)) walk(s.content, images, links);
    }
    loaded.push({ slug, page, images, links });
  }

  const assetIds = loaded.flatMap((p) =>
    p.images.filter((i) => i.alt === "" && i.asset !== "").map((i) => i.asset),
  );
  const noAlt =
    assetIds.length === 0
      ? new Set<string>()
      : await mapped(
          withSuperuser((pb) => assetsWithoutAlt(pb, ctx.orgId, assetIds)),
        );

  const inputs: SeoPageInput[] = loaded.map(({ slug, page, images, links }) => {
    const seo = isRecord(page.page?.seo) ? page.page.seo : {};
    return {
      id: str(page.page?.id) || (manifest.pages[slug]?.id ?? ""),
      title: str(page.page?.title) || str(manifest.pages[slug]?.title),
      slug: slug === HOME_SLUG ? "" : slug,
      metaTitle: str(seo.meta_title),
      metaDescription: str(seo.meta_description),
      h1Count: h1CountOf(page),
      imagesWithoutAlt: images.filter(
        (i) =>
          i.alt === "" && (i.asset !== "" ? noAlt.has(i.asset) : i.url !== ""),
      ).length,
      brokenInternalLinks: links.filter((l) => isBrokenInternal(l, manifest))
        .length,
    };
  });

  const health = seoHealth(inputs, {
    sitemapOk: Object.keys(manifest.pages).length > 0,
  });
  return { ...health, pages: inputs.length, checkedAt: manifest.updated_at };
}
