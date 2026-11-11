// Page passwords (CONT-28, CONT-33; D235 #12, D255, D187, D-UI-P7-14; 07-32 choices 1, 2, 12;
// T-07-32-03, T-07-32-08).
// invariant 1: org from the context only; never return or log a hash, a password or a cookie.
//
// - The flag is the existing pages.password_protected; password_hash holds
//   `scrypt$16384$8$1$<salt b64url>$<hash b64url>` (16-byte random salt, 32-byte key);
//   password_version is bumped on every set or clear, so every gate cookie minted for the
//   old version stops matching. isProtected (project.ts) stays the one rule.
// - Live on save: the hash is computed outside the lock; under the one org lock the manifest
//   entry's `.protected` and the row are written together (a failed row commit puts the
//   previous manifest bytes back). has_unpublished_changes is never touched. The published
//   page JSON's page.password_protected may go stale; nothing reads it for access.
// - After the lock: invalidate site/page/live tags, promote the page's published media when
//   a password is cleared (best effort), demote the media public only because of this page
//   when one is set (WR-A09, best effort), and rebuild index.json (07-31) on every write.
// - Audit meta is `{ protected }` only; the hash and version are never exported (D187).
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { InvalidInput } from "@cds/core";
import type { SectionRegistry } from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../../context";
import { requirePermission } from "../../repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../../storage";
import {
  demoteMedia,
  mediaIdsForPromotion,
  promoteMedia,
} from "../../media/library/promote";
import type { MediaDelivery } from "../../media/ports";
import { assertPageRoom } from "../allowance";
import { readJson, readManifest } from "../manifest";
import { shareImageOf } from "../references";
import {
  NOT_FOUND_KIND,
  getScopedPage,
  toPageSummary,
  type PageSummary,
} from "../pages";
import { liveTag, pageTag, siteTag, type Invalidator } from "../ports";
import { isProtected } from "../project";
import { asInput, commit, run } from "../shared";
import { refreshSiteIndex } from "../site-index/build";

export const PAGE_PASSWORD_MIN = 6;
export const PAGE_PASSWORD_MAX = 128;
export const PAGE_PASSWORD_COPY = Object.freeze({
  short: "Use at least 6 characters.",
  long: "Use 128 characters or fewer.",
  notFoundPage: "The Page not found page can't have a password.",
});

const N = 16384;
const R = 8;
const P = 1;
const N_MAX = 131072;
const KEY_LEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const JSON_TYPE = "application/json";

function scryptAsync(
  pw: string,
  salt: Buffer,
  len: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, len, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Internal (gate.ts and tests only; never from the barrel). */
export async function hashPagePassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const HASH_RE =
  /^scrypt\$(\d{1,7})\$(\d{1,3})\$(\d{1,3})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{16,128})$/;

/** Internal: false on anything malformed or unexpected; never throws. */
export async function verifyPagePasswordHash(
  stored: unknown,
  pw: string,
): Promise<boolean> {
  try {
    if (typeof stored !== "string" || typeof pw !== "string" || pw === "") {
      return false;
    }
    const m = HASH_RE.exec(stored);
    if (!m) return false;
    const n = Number(m[1]);
    const r = Number(m[2]);
    const p = Number(m[3]);
    if (n < 2 || n > N_MAX || (n & (n - 1)) !== 0) return false;
    if (r !== R || p !== P) return false;
    const salt = Buffer.from(m[4]!, "base64url");
    const want = Buffer.from(m[5]!, "base64url");
    if (want.length !== KEY_LEN) return false;
    const got = await scryptAsync(pw, salt, KEY_LEN, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

function passwordOf(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new InvalidInput(PAGE_PASSWORD_COPY.short);
  if (v.length < PAGE_PASSWORD_MIN) {
    throw new InvalidInput(PAGE_PASSWORD_COPY.short);
  }
  if (v.length > PAGE_PASSWORD_MAX) {
    throw new InvalidInput(PAGE_PASSWORD_COPY.long);
  }
  return v;
}

/** Put the manifest back as it was before a failed row commit (copy of publish.ts's). */
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

/**
 * Media a published page made public (WR-A09): its published sections' media (with the
 * pop-ups they open and video covers) plus its published share image. [] when unreadable.
 */
async function publishedPageMedia(
  ctx: OrgContext,
  store: ObjectStore,
  pageId: string,
  deps: { sections: SectionRegistry },
): Promise<string[]> {
  const json = (await readJson(
    store,
    tenantPublishedPageKey(ctx.orgId, pageId),
  ).catch(() => null)) as { sections?: unknown; page?: unknown } | null;
  if (!json || typeof json !== "object") return [];
  const sections = Array.isArray(json.sections)
    ? (json.sections as { section_type: string; content: unknown }[])
    : [];
  const ids = await run(ctx, (pb) =>
    mediaIdsForPromotion(pb, ctx, sections, deps.sections),
  );
  const share =
    json.page && typeof json.page === "object"
      ? shareImageOf((json.page as Record<string, unknown>).seo)
      : "";
  if (share) ids.push(share);
  return ids;
}

export type SetPagePasswordDeps = {
  invalidator: Invalidator;
  sections: SectionRegistry;
  store?: ObjectStore;
  publicStore?: ObjectStore;
  delivery?: MediaDelivery;
  promote?: typeof promoteMedia;
  demote?: typeof demoteMedia;
  refreshIndex?: typeof refreshSiteIndex;
  now?: () => Date;
};

/**
 * Set (`{ password: "…" }`) or clear (`{ password: null }`) a page's password. Live at once
 * (D-UI-P7-14): the manifest entry and the row change together under the org lock.
 */
export async function setPagePassword(
  ctx: OrgContext,
  pageId: string,
  raw: { password: string | null },
  deps: SetPagePasswordDeps,
): Promise<PageSummary> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "password input");
  if (!Object.hasOwn(input, "password")) {
    throw new InvalidInput(PAGE_PASSWORD_COPY.short);
  }
  const password = passwordOf(input.password);
  const isSet = password !== null;
  // Hash before the lock: scrypt is the slow part.
  const hash = isSet ? await hashPagePassword(password) : "";
  const store = deps.store ?? getObjectStore();
  const now = deps.now ?? (() => new Date());

  const { row, published } = await run(ctx, async (pb: PocketBase) => {
    const page = await getScopedPage(pb, ctx, pageId);
    if (page.kind === NOT_FOUND_KIND) {
      throw new InvalidInput(PAGE_PASSWORD_COPY.notFoundPage);
    }
    // WR-B03 (D185): clearing the password makes a protected builder page count again, so it
    // needs a free page like createPage (same org lock, so the count and the write are one step).
    if (!isSet && page.kind === "builder" && isProtected(page)) {
      await assertPageRoom(pb, ctx);
    }
    const manifestKey = tenantSiteManifestKey(ctx.orgId);
    const manifest = await readManifest(store, ctx.orgId, now());
    const slug = Object.keys(manifest.pages).find(
      (s) => manifest.pages[s]?.id === page.id,
    );
    let prev: Uint8Array | null = null;
    let wroteManifest = false;
    if (slug !== undefined) {
      prev = await store.get(manifestKey);
      manifest.pages[slug] = { ...manifest.pages[slug]!, protected: isSet };
      await store.put(manifestKey, JSON.stringify(manifest), JSON_TYPE);
      wroteManifest = true;
    }
    try {
      await commit(
        pb,
        ctx,
        [
          {
            collection: "pages",
            op: "update",
            id: page.id,
            body: {
              password_hash: hash,
              password_protected: isSet,
              password_version: (Number(page.password_version) || 0) + 1,
            },
          },
        ],
        {
          action: "pages.password",
          targetCollection: "pages",
          targetId: page.id,
          meta: { protected: isSet },
        },
      );
    } catch (err) {
      if (wroteManifest) await restoreObject(store, manifestKey, prev);
      throw err;
    }
    return {
      row: await getScopedPage(pb, ctx, page.id),
      published: slug !== undefined,
    };
  });

  try {
    deps.invalidator.invalidate([
      siteTag(ctx.orgId),
      pageTag(ctx.orgId, row.id),
      liveTag(ctx.orgId),
    ]);
  } catch {
    // Cached renders expire on their own; the gate read itself is never cached.
  }

  // Clearing on a published page: its media can go public now (best effort, choice 12).
  if (!isSet && published) {
    try {
      const json = (await readJson(
        store,
        tenantPublishedPageKey(ctx.orgId, row.id),
      )) as { sections?: unknown } | null;
      const sections = Array.isArray(json?.sections)
        ? (json.sections as { section_type: string; content: unknown }[])
        : [];
      const ids = await run(ctx, (pb) =>
        mediaIdsForPromotion(pb, ctx, sections, deps.sections),
      );
      const seo = toPageSummary(row).seo;
      if (seo.share_image) ids.push(seo.share_image);
      if (ids.length > 0) {
        const { promoted } = await (deps.promote ?? promoteMedia)(ctx, ids, {
          store,
          ...(deps.publicStore ? { publicStore: deps.publicStore } : {}),
        });
        if (promoted.length > 0) {
          deps.invalidator.invalidate([
            pageTag(ctx.orgId, row.id),
            siteTag(ctx.orgId),
          ]);
        }
      }
    } catch (err) {
      console.error(
        "[pages] promote after unprotect failed",
        err instanceof Error ? err.name : "error",
      );
    }
  }

  // WR-A09: setting a password on a published page takes back the media that was public only
  // because of this page (best effort). Media another public, non-protected published page
  // or the site share image still uses stays public (choice 12).
  if (isSet && published) {
    try {
      const mine = new Set(await publishedPageMedia(ctx, store, row.id, deps));
      const own = toPageSummary(row).seo.share_image;
      if (own) mine.add(own);
      if (mine.size > 0) {
        const manifest = await readManifest(store, ctx.orgId, now());
        for (const entry of Object.values(manifest.pages)) {
          if (!entry || entry.id === row.id || entry.protected) continue;
          for (const id of await publishedPageMedia(
            ctx,
            store,
            entry.id,
            deps,
          )) {
            mine.delete(id);
          }
        }
        const site = await run(ctx, (pb) =>
          pb.collection("site_settings").getFullList({
            filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
            fields: "seo",
          }),
        );
        for (const s of site) mine.delete(shareImageOf(s.seo));
      }
      if (mine.size > 0) {
        const { demoted } = await (deps.demote ?? demoteMedia)(ctx, [...mine], {
          store,
          ...(deps.publicStore ? { publicStore: deps.publicStore } : {}),
          ...(deps.delivery ? { delivery: deps.delivery } : {}),
        });
        if (demoted.length > 0) {
          deps.invalidator.invalidate([
            pageTag(ctx.orgId, row.id),
            siteTag(ctx.orgId),
          ]);
        }
      }
    } catch (err) {
      console.error(
        "[pages] demote after protect failed",
        err instanceof Error ? err.name : "error",
      );
    }
  }

  // 07-31: the page leaves or rejoins search and the sitemap at once (never throws).
  await (deps.refreshIndex ?? refreshSiteIndex)(ctx.orgId, {
    sections: deps.sections,
    store,
    now,
  });
  // WR-C04: the site index cache (site tag) is dropped again only now that index.json is
  // rebuilt. The invalidation above runs before the rebuild, so a /search, sitemap.xml or
  // llms.txt request in between would refill it with the protected page's old text.
  try {
    deps.invalidator.invalidate([siteTag(ctx.orgId)]);
  } catch {
    // The site index cache expires on its own (300 s).
  }

  return toPageSummary(row);
}
