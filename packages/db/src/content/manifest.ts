// The published site manifest (D187, D188, D253): parse and read helpers shared by the
// publish chain (publish.ts), the page writers (pages.ts, CR-A01) and the visitor reads
// (site-context.ts). Internal: never exported from index.ts.
import type { SiteManifest } from "@cds/core/content";
import { tenantSiteManifestKey, type ObjectStore } from "../storage";

export async function readJson(
  store: ObjectStore,
  key: string,
): Promise<unknown> {
  const bytes = await store.get(key);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function emptyManifest(now: Date): SiteManifest {
  return {
    version: 1,
    pages: {},
    redirects: {},
    updated_at: now.toISOString(),
  };
}

/** A stored manifest, rebuilt field by field (a malformed file starts fresh). */
export function parseManifest(raw: unknown, now: Date): SiteManifest {
  const out = emptyManifest(now);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.updated_at === "string") out.updated_at = r.updated_at;
  const pages = r.pages;
  if (typeof pages === "object" && pages !== null && !Array.isArray(pages)) {
    for (const [slug, v] of Object.entries(pages as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const e = v as Record<string, unknown>;
      if (typeof e.id !== "string") continue;
      out.pages[slug] = {
        id: e.id,
        title: typeof e.title === "string" ? e.title : "",
        published_at: typeof e.published_at === "string" ? e.published_at : "",
        protected: e.protected === true,
      };
    }
  }
  const redirects = r.redirects;
  if (
    typeof redirects === "object" &&
    redirects !== null &&
    !Array.isArray(redirects)
  ) {
    for (const [from, to] of Object.entries(
      redirects as Record<string, unknown>,
    )) {
      if (typeof to === "string") out.redirects[from] = to;
    }
  }
  return out;
}

/** The org's stored manifest (an empty one when nothing is published yet). */
export async function readManifest(
  store: ObjectStore,
  orgId: string,
  now: Date,
): Promise<SiteManifest> {
  return parseManifest(
    await readJson(store, tenantSiteManifestKey(orgId)),
    now,
  );
}

/**
 * The page id that serves `slug` on the live site, when it is not `pageId` (CR-A01). A
 * draft rename frees the DB slug while the old one is still live in the manifest, so the
 * DB unique index alone cannot tell whether a slug is free.
 */
export function liveHolderOf(
  manifest: SiteManifest,
  slug: string,
  pageId: string | undefined,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(manifest.pages, slug)) return null;
  const holder = manifest.pages[slug];
  return holder && holder.id !== pageId ? holder.id : null;
}
