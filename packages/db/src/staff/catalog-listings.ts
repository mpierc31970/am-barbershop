// packages/db/src/staff/catalog-listings.ts (13-20): add-on catalog listings and the one merged
// catalog view (STAFF-07, D5, D264, P13-P7, P13-P21; T-13-20-01..04). Platform collection
// `addon_listings` (migration 1790000872). The manifest stays the default and the source of
// behaviour and training (invariant 4); a listing overrides only tagline, description,
// screenshots, availability and sort. A manifest's private visibility always wins. The caller
// passes the manifests (`ADDON_REGISTRY.list()` mapped in apps/web): @cds/db never imports
// @cds/addon-registry (P13-P7). Screenshots live in the PRIVATE platform ObjectStore at
// platform/catalog/<slug>/<id>.<ext> and are served by the app under CATALOG_MEDIA_PATH (the
// public CDN store only admits tenant media keys). The json field is object_key (Pitfall 15).
// Every write lands with its audit row in one batch.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { newRecordId } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import { platformCatalogKey, type CatalogScreenshotExt } from "../storage/keys";

const COLLECTION = "addon_listings";
const FEATURE = "catalog_listings";

export const CATALOG_TAGLINE_MAX = 120;
export const CATALOG_DESCRIPTION_MAX = 2000;
export const CATALOG_ALT_MAX = 200;
export const CATALOG_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_SCREENSHOTS_MAX = 6;
export const CATALOG_DEFAULT_SORT = 1000;
export const CATALOG_VIEW_CACHE_MS = 30_000;
/** Host-relative path the app serves screenshots from: /_catalog/<slug>/<id>.<ext>. */
export const CATALOG_MEDIA_PATH = "/_catalog";

export const CATALOG_AVAILABILITIES = [
  "available",
  "coming_soon",
  "hidden",
] as const;
export type CatalogAvailability = (typeof CATALOG_AVAILABILITIES)[number];
export type CatalogAudience = "public" | "staff";

/** One manifest as the caller maps it from ADDON_REGISTRY.list() (choice 1). */
export type CatalogManifestInput = {
  slug: string;
  name: string;
  summary: string;
  visibility: "public" | "private";
  path: "standard" | "studio" | "both";
  premium?: boolean;
};

export type CatalogScreenshot = {
  id: string;
  url: string;
  alt: string;
  w: number;
  h: number;
};

export type CatalogEntry = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  screenshots: CatalogScreenshot[];
  availability: CatalogAvailability;
  sort: number;
  /** availability === "available" and not private. */
  pickable: boolean;
  private: boolean;
  path: CatalogManifestInput["path"];
  premium: boolean;
};

/** Staff view row: the merged entry plus the raw overrides and who changed it last. */
export type StaffCatalogEntry = CatalogEntry & {
  /** Manifest summary: the default tagline and description ("Reset to default"). */
  summary: string;
  /** Stored overrides ("" = manifest default). */
  taglineOverride: string;
  descriptionOverride: string;
  hasListing: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type StaffListingInput = {
  slug: string;
  tagline: unknown;
  description: unknown;
  availability: unknown;
  /** Optional: a full reorder of the existing screenshots with their alt text. */
  screenshots?: { id: string; alt: unknown }[];
};

export type StaffScreenshotInput = {
  slug: string;
  bytes: Uint8Array;
  contentType?: string;
  alt: unknown;
};

export type CatalogStoreDeps = { store?: ObjectStore };

type StoredShot = {
  id: string;
  object_key: string;
  alt: string;
  w: number;
  h: number;
};

const ID_RE = /^[a-z0-9]{15}$/;

// ---------------------------------------------------------------------------------------
// In-process cache of every listing row (30 s), cleared on every write (choice 1).
// ---------------------------------------------------------------------------------------

let cache: { at: number; rows: RecordModel[] } | null = null;

export function resetCatalogViewCacheForTests(): void {
  cache = null;
}

async function loadRows(fresh = false): Promise<RecordModel[]> {
  const nowMs = Date.now();
  if (!fresh && cache && nowMs - cache.at < CATALOG_VIEW_CACHE_MS) {
    return cache.rows;
  }
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({ sort: "slug" }),
  );
  cache = { at: nowMs, rows };
  return rows;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isAvailability(v: unknown): v is CatalogAvailability {
  return (
    typeof v === "string" &&
    (CATALOG_AVAILABILITIES as readonly string[]).includes(v)
  );
}

function shotsOf(row: RecordModel | undefined): StoredShot[] {
  const raw: unknown = row?.screenshots;
  if (!Array.isArray(raw)) return [];
  const out: StoredShot[] = [];
  for (const s of raw as unknown[]) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.object_key !== "string") continue;
    out.push({
      id: o.id,
      object_key: o.object_key,
      alt: str(o.alt),
      w: typeof o.w === "number" ? o.w : 0,
      h: typeof o.h === "number" ? o.h : 0,
    });
  }
  return out;
}

function extOf(objectKey: string): string {
  const dot = objectKey.lastIndexOf(".");
  return dot === -1 ? "" : objectKey.slice(dot + 1);
}

/** /_catalog/<slug>/<id>.<ext>: host-relative, never the storage key. */
export function catalogScreenshotUrl(
  slug: string,
  id: string,
  ext: string,
): string {
  platformCatalogKey(slug, id, ext); // validation only
  return `${CATALOG_MEDIA_PATH}/${slug}/${id}.${ext}`;
}

function toShot(slug: string, s: StoredShot): CatalogScreenshot | null {
  try {
    return {
      id: s.id,
      url: catalogScreenshotUrl(slug, s.id, extOf(s.object_key)),
      alt: s.alt,
      w: s.w,
      h: s.h,
    };
  } catch {
    return null; // a stored entry that no longer validates is dropped, never rendered
  }
}

function validManifests(
  manifests: readonly CatalogManifestInput[],
): readonly CatalogManifestInput[] {
  if (!Array.isArray(manifests)) throw new InvalidInput("invalid manifests");
  return manifests;
}

function merge(
  m: CatalogManifestInput,
  row: RecordModel | undefined,
): StaffCatalogEntry {
  const taglineOverride = str(row?.tagline);
  const descriptionOverride = str(row?.description);
  const availability = isAvailability(row?.availability)
    ? row.availability
    : "available";
  const sort =
    typeof row?.sort === "number" && row.sort !== 0
      ? row.sort
      : CATALOG_DEFAULT_SORT;
  const isPrivate = m.visibility === "private";
  return {
    slug: m.slug,
    name: m.name,
    tagline: taglineOverride || m.summary,
    description: descriptionOverride || m.summary,
    screenshots: shotsOf(row)
      .map((s) => toShot(m.slug, s))
      .filter((s): s is CatalogScreenshot => s !== null),
    availability,
    sort,
    pickable: !isPrivate && availability === "available",
    private: isPrivate,
    path: m.path,
    premium: m.premium === true,
    summary: m.summary,
    taglineOverride,
    descriptionOverride,
    hasListing: row !== undefined,
    updatedAt: row ? str(row.updated) || null : null,
    updatedByName: null,
  };
}

function ordered<T extends { sort: number; name: string; slug: string }>(
  entries: T[],
): T[] {
  return entries.sort(
    (a, b) =>
      a.sort - b.sort ||
      a.name.localeCompare(b.name) ||
      a.slug.localeCompare(b.slug),
  );
}

function mergedAll(
  manifests: readonly CatalogManifestInput[],
  rows: RecordModel[],
): StaffCatalogEntry[] {
  const bySlug = new Map(rows.map((r) => [str(r.slug), r]));
  return ordered(manifests.map((m) => merge(m, bySlug.get(m.slug))));
}

function publicShape(e: StaffCatalogEntry): CatalogEntry {
  return {
    slug: e.slug,
    name: e.name,
    tagline: e.tagline,
    description: e.description,
    screenshots: e.screenshots,
    availability: e.availability,
    sort: e.sort,
    pickable: e.pickable,
    private: e.private,
    path: e.path,
    premium: e.premium,
  };
}

/**
 * The merged catalog (choice 1). `public` drops private add-ons (whatever the listing says)
 * and hidden listings; `coming_soon` stays with `pickable: false`. `staff` returns every
 * manifest. Sorted by sort, then name.
 */
export async function catalogView(
  manifests: readonly CatalogManifestInput[],
  opts: { audience: CatalogAudience },
): Promise<CatalogEntry[]> {
  const all = mergedAll(validManifests(manifests), await loadRows());
  const list =
    opts.audience === "staff"
      ? all
      : all.filter((e) => !e.private && e.availability !== "hidden");
  return list.map(publicShape);
}

/** The public catalog for /start, hub add-ons and quote (choice 3, 13-32). */
export function publicCatalogView(
  manifests: readonly CatalogManifestInput[],
): Promise<CatalogEntry[]> {
  return catalogView(manifests, { audience: "public" });
}

async function namesFor(
  pb: PocketBase,
  ids: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => ID_RE.test(id)))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const filter = wanted.map((_, i) => `id = {:u${i}}`).join(" || ");
  const params = Object.fromEntries(wanted.map((id, i) => [`u${i}`, id]));
  const users = await pb
    .collection("users")
    .getFullList({ filter: pb.filter(filter, params), fields: "id,name" });
  for (const u of users) out.set(u.id, str(u.name));
  return out;
}

/** Staff view of every manifest with its listing (any staff role). Always reads fresh. */
export async function staffListListings(
  ctx: PlatformContext,
  manifests: readonly CatalogManifestInput[],
): Promise<StaffCatalogEntry[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, FEATURE);
  const rows = await loadRows(true);
  const entries = mergedAll(validManifests(manifests), rows);
  const bySlug = new Map(rows.map((r) => [str(r.slug), r]));
  const names = await withSuperuser((pb) =>
    namesFor(
      pb,
      rows.map((r) => str(r.updated_by)),
    ),
  );
  for (const e of entries) {
    const by = str(bySlug.get(e.slug)?.updated_by);
    e.updatedByName = by ? (names.get(by) ?? null) : null;
  }
  return entries;
}

function manifestFor(
  manifests: readonly CatalogManifestInput[],
  slug: unknown,
): CatalogManifestInput {
  const m =
    typeof slug === "string"
      ? validManifests(manifests).find((x) => x.slug === slug)
      : undefined;
  if (!m) throw new NotFound("add-on not found");
  return m;
}

async function rowFor(
  pb: PocketBase,
  slug: string,
): Promise<RecordModel | undefined> {
  const rows = await pb
    .collection(COLLECTION)
    .getFullList({ filter: pb.filter("slug = {:slug}", { slug }) });
  return rows[0];
}

function text(v: unknown, max: number, what: string): string {
  if (v !== undefined && v !== null && typeof v !== "string") {
    throw new InvalidInput(`invalid ${what}`);
  }
  const t = str(v).replace(/\r\n/g, "\n").trim();
  if (t.length > max) {
    throw new InvalidInput(`Keep the ${what} under ${max} characters.`);
  }
  return t;
}

function altText(v: unknown): string {
  const t = text(v, CATALOG_ALT_MAX, "alt text").replace(/\s+/g, " ");
  if (t === "") throw new InvalidInput("Describe the screenshot (alt text).");
  return t;
}

/**
 * Saves one listing (choice 2): tagline, description ("" = manifest default), availability
 * and optionally the screenshot order + alt text. Upsert by slug; audited
 * `catalog.listing_saved` meta `{ slug, availability }`.
 */
export async function staffSaveListing(
  ctx: PlatformContext,
  input: StaffListingInput,
  manifests: readonly CatalogManifestInput[],
): Promise<StaffCatalogEntry> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, FEATURE);
  const m = manifestFor(manifests, input?.slug);
  const tagline = text(input.tagline, CATALOG_TAGLINE_MAX, "tagline");
  const description = text(
    input.description,
    CATALOG_DESCRIPTION_MAX,
    "description",
  );
  if (!isAvailability(input.availability)) {
    throw new InvalidInput("Pick Available, Coming soon or Hidden.");
  }
  const availability = input.availability;
  const saved = await withSuperuser(async (pb) => {
    const row = await rowFor(pb, m.slug);
    let shots = shotsOf(row);
    if (input.screenshots !== undefined) {
      if (!Array.isArray(input.screenshots)) {
        throw new InvalidInput("invalid screenshots");
      }
      const byId = new Map(shots.map((s) => [s.id, s]));
      const ids = input.screenshots.map((s) => s?.id);
      if (
        ids.length !== shots.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== "string" || !byId.has(id))
      ) {
        throw new InvalidInput(
          "The screenshots changed while you were editing. Reload and try again.",
        );
      }
      shots = input.screenshots.map((s) => ({
        ...byId.get(s.id)!,
        alt: altText(s.alt),
      }));
    }
    const id = row?.id ?? newRecordId();
    const body = {
      slug: m.slug,
      tagline,
      description,
      availability,
      screenshots: shots,
      updated_by: ctx.actor,
    };
    const batch = pb.createBatch();
    if (row) batch.collection(COLLECTION).update(id, body);
    else
      batch
        .collection(COLLECTION)
        .create({ id, ...body, sort: CATALOG_DEFAULT_SORT });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "catalog.listing_saved",
        organization: null,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { slug: m.slug, availability },
      }),
    );
    await batch.send();
    return pb.collection(COLLECTION).getOne(id);
  });
  cache = null;
  return merge(m, saved);
}

/**
 * Moves one add-on up or down the staff order (D-UI-P13-23): the whole list is renumbered
 * 10, 20, 30 … with the two neighbours swapped, so ties at the default sort resolve. Audited
 * `catalog.listing_moved`. At either end it is a no-op (no write, no audit).
 */
export async function staffMoveListing(
  ctx: PlatformContext,
  slug: string,
  direction: "up" | "down",
  manifests: readonly CatalogManifestInput[],
): Promise<StaffCatalogEntry[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, FEATURE);
  manifestFor(manifests, slug);
  if (direction !== "up" && direction !== "down") {
    throw new InvalidInput("invalid direction");
  }
  const result = await withSuperuser(async (pb) => {
    const rows = await pb.collection(COLLECTION).getFullList({ sort: "slug" });
    const entries = mergedAll(manifests, rows);
    const i = entries.findIndex((e) => e.slug === slug);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= entries.length) return { entries, rows, moved: false };
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
    const bySlug = new Map(rows.map((r) => [str(r.slug), r]));
    let targetId = bySlug.get(slug)?.id ?? "";
    const batch = pb.createBatch();
    entries.forEach((e, k) => {
      const sort = (k + 1) * 10;
      const row = bySlug.get(e.slug);
      if (row && row.sort === sort) return;
      if (row) {
        batch
          .collection(COLLECTION)
          .update(row.id, { sort, updated_by: ctx.actor });
      } else {
        const id = newRecordId();
        if (e.slug === slug) targetId = id;
        batch.collection(COLLECTION).create({
          id,
          slug: e.slug,
          availability: "available",
          screenshots: [],
          sort,
          updated_by: ctx.actor,
        });
      }
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "catalog.listing_moved",
        organization: null,
        targetCollection: COLLECTION,
        targetId,
        meta: { slug, direction, swappedWith: entries[i]!.slug },
      }),
    );
    await batch.send();
    return { entries, rows, moved: true };
  });
  cache = null;
  if (!result.moved) return result.entries;
  return staffListListings(ctx, manifests);
}

// ---------------------------------------------------------------------------------------
// Screenshots (T-13-20-01): type by magic bytes, never by name or declared type.
// ---------------------------------------------------------------------------------------

const MIME_BY_EXT: Record<CatalogScreenshotExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u32be(b: Uint8Array, o: number): number {
  return (
    ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
  );
}
function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}

function ascii(b: Uint8Array, o: number, n: number): string {
  return String.fromCharCode(...b.subarray(o, o + n));
}

function pngSize(b: Uint8Array): { w: number; h: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    return null;
  }
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) return { h: u16be(b, o + 5), w: u16be(b, o + 7) };
    o += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") {
    return null;
  }
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  return null;
}

/** Sniffs png / jpeg / webp from the bytes and reads the pixel size from the header. */
export function sniffCatalogImage(
  bytes: Uint8Array,
): { ext: CatalogScreenshotExt; w: number; h: number } | null {
  const png = pngSize(bytes);
  if (png) return { ext: "png", ...png };
  const jpg = jpegSize(bytes);
  if (jpg) return { ext: "jpg", ...jpg };
  const webp = webpSize(bytes);
  if (webp) return { ext: "webp", ...webp };
  return null;
}

const MAX_DIMENSION = 10_000;

/**
 * Adds one screenshot (choice 2): png/jpeg/webp by magic bytes, ≤ 2 MB, ≤ 6 per add-on,
 * alt text required, stored at platformCatalogKey(slug, id, ext). Audited
 * `catalog.screenshot_added`. The object is removed again if the row write fails.
 */
export async function staffAddScreenshot(
  ctx: PlatformContext,
  input: StaffScreenshotInput,
  manifests: readonly CatalogManifestInput[],
  deps: CatalogStoreDeps = {},
): Promise<CatalogScreenshot> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, FEATURE);
  const m = manifestFor(manifests, input?.slug);
  const alt = altText(input.alt);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new InvalidInput("Choose an image file.");
  }
  if (bytes.length > CATALOG_SCREENSHOT_MAX_BYTES) {
    throw new InvalidInput("Screenshots must be 2 MB or smaller.");
  }
  if (
    input.contentType !== undefined &&
    input.contentType !== "" &&
    !Object.values(MIME_BY_EXT).includes(input.contentType)
  ) {
    throw new InvalidInput("Screenshots must be PNG, JPEG or WebP images.");
  }
  const sniff = sniffCatalogImage(bytes);
  if (
    !sniff ||
    sniff.w < 1 ||
    sniff.h < 1 ||
    sniff.w > MAX_DIMENSION ||
    sniff.h > MAX_DIMENSION
  ) {
    throw new InvalidInput("Screenshots must be PNG, JPEG or WebP images.");
  }
  const store = deps.store ?? getObjectStore();
  const shot = await withSuperuser(async (pb) => {
    const row = await rowFor(pb, m.slug);
    const shots = shotsOf(row);
    if (shots.length >= CATALOG_SCREENSHOTS_MAX) {
      throw new InvalidInput(
        `An add-on can have up to ${CATALOG_SCREENSHOTS_MAX} screenshots.`,
      );
    }
    const shotId = newRecordId();
    const objectKey = platformCatalogKey(m.slug, shotId, sniff.ext);
    const stored: StoredShot = {
      id: shotId,
      object_key: objectKey,
      alt,
      w: sniff.w,
      h: sniff.h,
    };
    await store.put(objectKey, bytes, MIME_BY_EXT[sniff.ext]);
    const id = row?.id ?? newRecordId();
    try {
      const batch = pb.createBatch();
      if (row) {
        batch.collection(COLLECTION).update(id, {
          screenshots: [...shots, stored],
          updated_by: ctx.actor,
        });
      } else {
        batch.collection(COLLECTION).create({
          id,
          slug: m.slug,
          availability: "available",
          screenshots: [stored],
          sort: CATALOG_DEFAULT_SORT,
          updated_by: ctx.actor,
        });
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "catalog.screenshot_added",
          organization: null,
          targetCollection: COLLECTION,
          targetId: id,
          meta: { slug: m.slug, screenshot: shotId, w: sniff.w, h: sniff.h },
        }),
      );
      await batch.send();
    } catch (err) {
      await store.delete(objectKey).catch(() => undefined);
      throw err;
    }
    return stored;
  });
  cache = null;
  return toShot(m.slug, shot)!;
}

/**
 * Removes one screenshot (choice 2): the entry and its audit row first, then the object
 * (a failed delete is logged by class name and leaves only an orphan, never a broken image).
 */
export async function staffRemoveScreenshot(
  ctx: PlatformContext,
  input: { slug: string; id: string },
  manifests: readonly CatalogManifestInput[],
  deps: CatalogStoreDeps = {},
): Promise<{ removed: true }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, FEATURE);
  const m = manifestFor(manifests, input?.slug);
  const store = deps.store ?? getObjectStore();
  const objectKey = await withSuperuser(async (pb) => {
    const row = await rowFor(pb, m.slug);
    const shots = shotsOf(row);
    const shot = shots.find((s) => s.id === input.id);
    if (!row || !shot) throw new NotFound("screenshot not found");
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(row.id, {
      screenshots: shots.filter((s) => s.id !== shot.id),
      updated_by: ctx.actor,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "catalog.screenshot_removed",
        organization: null,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { slug: m.slug, screenshot: shot.id },
      }),
    );
    await batch.send();
    return shot.object_key;
  });
  cache = null;
  try {
    await store.delete(objectKey);
  } catch (err) {
    console.error(
      `[catalog] screenshot delete failed: ${err instanceof Error ? err.name : "Error"}`,
    );
  }
  return { removed: true };
}

/**
 * Bytes for the app route serving CATALOG_MEDIA_PATH (13-37): `file` is `<id>.<ext>` from the
 * URL. Any unsafe segment or extension is NotFound; a missing object is null.
 */
export async function readCatalogScreenshot(
  slug: string,
  file: string,
  deps: CatalogStoreDeps = {},
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const m = /^([a-z0-9]{15})\.(png|jpg|webp)$/.exec(
    typeof file === "string" ? file : "",
  );
  if (!m) throw new NotFound("screenshot not found");
  const ext = m[2] as CatalogScreenshotExt;
  let key: string;
  try {
    key = platformCatalogKey(slug, m[1]!, ext);
  } catch {
    throw new NotFound("screenshot not found");
  }
  const bytes = await (deps.store ?? getObjectStore()).get(key);
  return bytes ? { bytes, contentType: MIME_BY_EXT[ext] } : null;
}
