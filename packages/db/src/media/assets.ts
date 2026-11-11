// Media chokepoint (ONB-04, ONB-05; CONTEXT A4-Q1, A4-Q2; D47; invariant 1, TEN-03;
// T-06-63..66, T-06-68).
//
// One media_assets row per uploaded image; the bytes live in the ObjectStore under
// tenants/<org>/media/<asset>/{original.<ext>,web.webp,thumb.webp} (tenantMediaKey). Every
// function takes an OrgContext and scopes by it; nothing takes an org id. Reads are business
// read (Editor ok), writes business write (Owner / Admin).
//
// Limits (CONTEXT discretion): gallery 12, mood boards 3, team 50 active; logo and hero keep one
// active each, so a new upload replaces (the old row is soft-removed, restorable).
// Mood boards: the first active one (by sort_order) drives the palette. Its proposal
// (extractPalette -> proposeRoles, the same maths the browser runs) is stored in
// org_intake.moodboard_proposal only. The live theme is never written here (D47).
// Remove sets removed_at (the Undo window); the row and objects stay readable until purged.
// 07-12: every upload also writes the library widths (w480/w960/w1600 when narrower), records
// the file name and the stored footprint in bytes, and counts against the org's allowance
// (2 GB + packs, mediaAllowance; assertAllowance before decoding and again under the org lock). Soft-deleted
// rows (deleted_at, D275) are hidden from listMedia and the active-slot counts.
import { InvalidInput, NotFound } from "@cds/core";
import {
  extractPalette,
  proposeRoles,
  type MoodboardProposal,
} from "@cds/core/theme";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../context";
import { assertId, newRecordId, requirePermission } from "../repository";
import { getObjectStore, tenantMediaKey, type ObjectStore } from "../storage";
import {
  tenantMediaDerivativeKey,
  type MediaObjectName,
} from "../storage/keys";
import { assertAllowance } from "./cdn/usage";
import type { ImageModerator, Invalidator } from "../content/ports";
import { regenerateSiteIcons } from "../content/seo/site-icons";
import { cleanFileName } from "./library/alt";
import { moderateImage } from "./library/moderate";
import {
  commit,
  orgRow,
  runRead,
  runWrite,
  scopedGet,
  type Op,
} from "../intake/shared";
import {
  MAX_UPLOAD_BYTES,
  originalFile,
  palettePixelsOf,
  processImage,
  type LibraryWidthVariant,
  type ProcessedImage,
  type SizedImage,
  UPLOAD_COPY,
  UploadRejected,
} from "./pipeline";

const COLLECTION = "media_assets";

export const MEDIA_KINDS = [
  "logo",
  "hero",
  "gallery",
  "team",
  "moodboard",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_VARIANTS = ["original", "web", "thumb"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export const MEDIA_LIMITS: Record<MediaKind, number> = {
  gallery: 12,
  moodboard: 3,
  logo: 1,
  hero: 1,
  team: 50,
};
/** Kinds that keep one active image: a new upload replaces instead of refusing. */
const SINGLE: ReadonlySet<MediaKind> = new Set(["logo", "hero"]);
const LIMIT_NOUN: Record<MediaKind, string> = {
  gallery: "photos",
  moodboard: "mood boards",
  team: "team photos",
  logo: "logos",
  hero: "hero photos",
};
export const ALT_MAX = 250;
export const ALT_COPY = `Keep the description under ${ALT_MAX} characters.`;

export type MediaAsset = {
  id: string;
  kind: MediaKind;
  width: number;
  height: number;
  webWidth: number;
  webHeight: number;
  bytes: number;
  mime: string;
  alt: string;
  sortOrder: number;
  /** The private thumbnail route: /hub/media/<id>/thumb. */
  url: string;
};

export function isMediaKind(v: unknown): v is MediaKind {
  return (MEDIA_KINDS as readonly unknown[]).includes(v);
}

export function isMediaVariant(v: unknown): v is MediaVariant {
  return (MEDIA_VARIANTS as readonly unknown[]).includes(v);
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toAsset(row: RecordModel): MediaAsset {
  return {
    id: row.id,
    kind: row.kind as MediaKind,
    width: num(row.width),
    height: num(row.height),
    webWidth: num(row.web_width),
    webHeight: num(row.web_height),
    bytes: num(row.bytes),
    mime: str(row.mime),
    alt: str(row.alt),
    sortOrder: num(row.sort_order),
    url: `/hub/media/${row.id}/thumb`,
  };
}

export function cleanAlt(alt: unknown): string {
  if (alt === undefined || alt === null) return "";
  if (typeof alt !== "string") throw new InvalidInput(ALT_COPY);
  const t = alt.trim();
  if (t.length > ALT_MAX) throw new InvalidInput(ALT_COPY);
  return t;
}

function assertKind(kind: unknown): asserts kind is MediaKind {
  if (!isMediaKind(kind)) {
    throw new InvalidInput("That kind of photo isn't supported.");
  }
}

/** Active (not removed) rows of one kind, in display order. */
function activeOfKind(
  pb: PocketBase,
  ctx: OrgContext,
  kind: MediaKind,
): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter(
      "organization = {:org} && kind = {:kind} && removed_at = '' && deleted_at = ''",
      { org: ctx.orgId, kind },
    ),
    sort: "sort_order,created,id",
  });
}

async function nextSort(
  pb: PocketBase,
  ctx: OrgContext,
  kind: MediaKind,
): Promise<number> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = {:kind}", {
      org: ctx.orgId,
      kind,
    }),
    sort: "-sort_order",
    fields: "sort_order",
  });
  const top = res.items[0]?.sort_order;
  return typeof top === "number" ? top + 1 : 0;
}

function assertUnderLimit(kind: MediaKind, active: number): void {
  if (SINGLE.has(kind)) return;
  const max = MEDIA_LIMITS[kind];
  if (active >= max) {
    throw new UploadRejected("limit", UPLOAD_COPY.limit(max, LIMIT_NOUN[kind]));
  }
}

function objectNames(ext: string): Record<MediaVariant, MediaObjectName> {
  return {
    original: `original.${ext}` as MediaObjectName,
    web: "web.webp",
    thumb: "thumb.webp",
  };
}

function nowStamp(): string {
  return new Date().toISOString().replace("T", " ");
}

/** The proposal for one image's palette pixels (the same maths the browser runs). */
function proposalFor(px: SizedImage): MoodboardProposal {
  return proposeRoles(extractPalette(px));
}

/** Ops that store `proposal` on the org's org_intake row (creating it if signup has not). */
async function proposalOps(
  pb: PocketBase,
  ctx: OrgContext,
  proposal: MoodboardProposal | null,
): Promise<Op[]> {
  const row = await orgRow(pb, ctx, "org_intake");
  if (row) {
    return [
      {
        collection: "org_intake",
        op: "update",
        id: row.id,
        body: { moodboard_proposal: proposal },
      },
    ];
  }
  return [
    {
      collection: "org_intake",
      op: "create",
      id: newRecordId(),
      body: {
        organization: ctx.orgId,
        selections: {},
        moodboard_proposal: proposal,
      },
    },
  ];
}

/** Recompute the proposal from the first active mood board after `activeIds` (in order). */
async function refreshProposal(
  pb: PocketBase,
  ctx: OrgContext,
  first: RecordModel | undefined,
  store: ObjectStore,
): Promise<{ ops: Op[]; proposal: MoodboardProposal | null }> {
  if (!first) {
    return { ops: await proposalOps(pb, ctx, null), proposal: null };
  }
  const ext = str(first.original_ext) || "png";
  const bytes = await store.get(
    tenantMediaKey(ctx.orgId, first.id, objectNames(ext).original),
  );
  if (!bytes) throw new NotFound();
  const proposal = proposalFor(await palettePixelsOf(bytes));
  return { ops: await proposalOps(pb, ctx, proposal), proposal };
}

export type StoredImage = { keys: string[]; footprint: number };

/** Best-effort delete of written objects (no orphan objects after a failed upload). */
export async function removeKeys(
  store: ObjectStore,
  keys: readonly string[],
): Promise<void> {
  await Promise.all(keys.map((k) => store.delete(k).catch(() => undefined)));
}

/**
 * Write one processed image to the PRIVATE store: original, web, thumb and every library
 * width (07-12). Returns the keys and the footprint (sum of bytes written). On a failed put
 * every written key is deleted before the error is rethrown.
 */
export async function storeImageObjects(
  store: ObjectStore,
  orgId: string,
  assetId: string,
  img: ProcessedImage,
  ext: string,
  mime: string,
): Promise<StoredImage> {
  const names = objectNames(ext);
  const puts: [string, Uint8Array, string][] = [
    [tenantMediaKey(orgId, assetId, names.original), img.original, mime],
    [tenantMediaKey(orgId, assetId, names.web), img.web.data, "image/webp"],
    [tenantMediaKey(orgId, assetId, names.thumb), img.thumb.data, "image/webp"],
  ];
  for (const [variant, sized] of Object.entries(img.widths) as [
    LibraryWidthVariant,
    SizedImage | undefined,
  ][]) {
    if (!sized) continue;
    puts.push([
      tenantMediaDerivativeKey(orgId, assetId, variant),
      sized.data,
      "image/webp",
    ]);
  }
  const keys: string[] = [];
  let footprint = 0;
  try {
    for (const [key, data, type] of puts) {
      await store.put(key, data, type);
      keys.push(key);
      footprint += data.length;
    }
  } catch (err) {
    await removeKeys(store, keys);
    throw err;
  }
  return { keys, footprint };
}

/**
 * Upload one image: verify, orient, strip, resize (processImage), store the three variants,
 * then create the row. Returns the asset and, for the first mood board, its proposal.
 */
export async function uploadImage(
  ctx: OrgContext,
  bytes: Uint8Array,
  kind: MediaKind,
  opts: {
    alt?: string;
    filename?: string;
    store?: ObjectStore;
    /** WR-C06: passed to the icon regeneration of a logo upload. */
    invalidator?: Invalidator;
    /** 13-11 (STAFF-25): defaults to getImageModerator() (stand-in: skipped). */
    moderator?: ImageModerator;
    moderationTimeoutMs?: number;
  } = {},
): Promise<{ asset: MediaAsset; proposal?: MoodboardProposal }> {
  requirePermission(ctx, "business", "write");
  assertKind(kind);
  if (!(bytes instanceof Uint8Array)) {
    throw new UploadRejected("type", UPLOAD_COPY.type);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected("too_big", UPLOAD_COPY.tooBig(bytes.length));
  }
  const alt = cleanAlt(opts.alt);
  const store = opts.store ?? getObjectStore();

  // Refuse over-limit before the expensive decode; re-checked under the lock below.
  await runRead(ctx, async (pb) =>
    assertUnderLimit(kind, (await activeOfKind(pb, ctx, kind)).length),
  );
  // The org's allowance, 2 GB + packs (07-12 choice 6, 10-33): incoming bytes now, the real footprint under the lock.
  await assertAllowance(ctx, bytes.length);

  const img = await processImage(bytes);
  const { ext, mime } = originalFile(img.format);
  const id = newRecordId();

  // 13-11 (STAFF-23, STAFF-25): intake photos are public site content too. Moderated before
  // the lock; held -> status `held` (never served) and the current single photo is kept.
  const moderation = await moderateImage(
    ctx,
    { id, url: tenantMediaKey(ctx.orgId, id, "web.webp"), bytes: img.web.data },
    {
      ...(opts.moderator ? { moderator: opts.moderator } : {}),
      ...(opts.moderationTimeoutMs
        ? { timeoutMs: opts.moderationTimeoutMs }
        : {}),
    },
  );

  const result = await runWrite(ctx, async (pb) => {
    const active = await activeOfKind(pb, ctx, kind);
    assertUnderLimit(kind, active.length);

    let stored: StoredImage | null = null;
    let proposal: MoodboardProposal | undefined;
    try {
      stored = await storeImageObjects(store, ctx.orgId, id, img, ext, mime);
      const footprint = stored.footprint;
      await assertAllowance(ctx, footprint);

      const sortOrder = await nextSort(pb, ctx, kind);
      const body = {
        organization: ctx.orgId,
        kind,
        storage_dir: `tenants/${ctx.orgId}/media/${id}`,
        original_ext: ext,
        width: img.width,
        height: img.height,
        web_width: img.web.width,
        web_height: img.web.height,
        bytes: footprint,
        mime,
        alt,
        name: cleanFileName(opts.filename ?? ""),
        source: "intake",
        // 07-12: intake photos are ready at once (07-09 serves and resolves ready rows only).
        status: moderation.held ? "held" : "ready",
        sort_order: sortOrder,
      };
      const ops: Op[] = [{ collection: COLLECTION, op: "create", id, body }];
      if (moderation.flag) {
        ops.push({
          collection: "content_flags",
          op: "create",
          id: newRecordId(),
          body: moderation.flag,
        });
      }
      if (SINGLE.has(kind) && !moderation.held) {
        const at = nowStamp();
        for (const old of active) {
          ops.push({
            collection: COLLECTION,
            op: "update",
            id: old.id,
            body: { removed_at: at },
          });
        }
      }
      if (kind === "moodboard" && active.length === 0) {
        proposal = proposalFor(img.palettePixels);
        ops.push(...(await proposalOps(pb, ctx, proposal)));
      }
      await commit(pb, ctx, ops, {
        action: `${COLLECTION}.create`,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { kind, bytes: footprint },
      });
    } catch (err) {
      // No orphan objects: the row was never created.
      if (stored) await removeKeys(store, stored.keys);
      throw err;
    }
    const row = await pb.collection(COLLECTION).getOne(id);
    return proposal
      ? { asset: toAsset(row), proposal }
      : { asset: toAsset(row) };
  });
  // 07-30 (CONT-28): a new logo regenerates the favicon set and share image, outside the
  // write lock, best effort (never fails the upload).
  if (kind === "logo" && !moderation.held) {
    await regenerateSiteIcons(ctx.orgId, {
      force: true,
      store,
      ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
    }).catch(() => undefined);
  }
  return result;
}

/** One variant's bytes. Removed assets stay readable until purged (Undo). */
export async function readMediaVariant(
  ctx: OrgContext,
  id: string,
  variant: MediaVariant,
  opts: { store?: ObjectStore } = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!isMediaVariant(variant)) throw new NotFound();
  assertId(id);
  const row = await runRead(ctx, (pb) => scopedGet(pb, ctx, COLLECTION, id));
  const ext = str(row.original_ext);
  if (variant === "original" && !["jpg", "png", "webp"].includes(ext)) {
    throw new NotFound();
  }
  const store = opts.store ?? getObjectStore();
  const bytes = await store.get(
    tenantMediaKey(ctx.orgId, row.id, objectNames(ext || "png")[variant]),
  );
  if (!bytes) throw new NotFound();
  const mime =
    variant === "original"
      ? originalFile(ext === "jpg" ? "jpeg" : (ext as "png" | "webp")).mime
      : "image/webp";
  return { bytes, mime };
}

/** Active assets, optionally of one kind, in display order. */
export async function listMedia(
  ctx: OrgContext,
  kind?: MediaKind,
): Promise<MediaAsset[]> {
  if (kind !== undefined) assertKind(kind);
  return runRead(ctx, async (pb) => {
    const rows = kind
      ? await activeOfKind(pb, ctx, kind)
      : await pb.collection(COLLECTION).getFullList({
          // Intake kinds only: library, video and audio rows belong to media/library.
          filter: pb.filter(
            "organization = {:org} && removed_at = '' && deleted_at = '' && (" +
              MEDIA_KINDS.map((_, i) => `kind = {:k${i}}`).join(" || ") +
              ")",
            {
              org: ctx.orgId,
              ...Object.fromEntries(MEDIA_KINDS.map((k, i) => [`k${i}`, k])),
            },
          ),
          sort: "kind,sort_order,created,id",
        });
    return rows.map(toAsset);
  });
}

/** Set the photo description (alt text), max 250 characters. */
export async function setMediaAlt(
  ctx: OrgContext,
  id: string,
  alt: string,
): Promise<void> {
  const value = cleanAlt(alt);
  await runWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (str(row.alt) === value) return;
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "update",
          id: row.id,
          body: { alt: value },
        },
      ],
      {
        action: `${COLLECTION}.alt`,
        targetCollection: COLLECTION,
        targetId: row.id,
      },
    );
  });
}

/** Soft-remove (sets removed_at; Undo = restoreMedia). Idempotent. */
export async function removeMedia(
  ctx: OrgContext,
  id: string,
  opts: { store?: ObjectStore; invalidator?: Invalidator } = {},
): Promise<{ proposal?: MoodboardProposal | null }> {
  let wasLogo = false;
  const result = await runWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (str(row.removed_at) !== "") return {};
    wasLogo = row.kind === "logo";
    const kind = row.kind as MediaKind;
    const ops: Op[] = [
      {
        collection: COLLECTION,
        op: "update",
        id: row.id,
        body: { removed_at: nowStamp() },
      },
    ];
    let proposal: MoodboardProposal | null | undefined;
    if (kind === "moodboard") {
      const active = await activeOfKind(pb, ctx, kind);
      if (active[0]?.id === row.id) {
        const r = await refreshProposal(
          pb,
          ctx,
          active[1],
          opts.store ?? getObjectStore(),
        );
        ops.push(...r.ops);
        proposal = r.proposal;
      }
    }
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.remove`,
      targetCollection: COLLECTION,
      targetId: row.id,
    });
    return proposal === undefined ? {} : { proposal };
  });
  // 07-30: removing the logo switches the icons to the wordmark (best effort).
  if (wasLogo) {
    await regenerateSiteIcons(ctx.orgId, {
      force: true,
      store: opts.store,
      ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
    }).catch(() => undefined);
  }
  return result;
}

/** Undo a remove. Logo/hero: the restored one becomes the active one again. */
export async function restoreMedia(
  ctx: OrgContext,
  id: string,
  opts: { store?: ObjectStore; invalidator?: Invalidator } = {},
): Promise<{ proposal?: MoodboardProposal | null }> {
  let wasLogo = false;
  const result = await runWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (str(row.removed_at) === "") return {};
    wasLogo = row.kind === "logo";
    const kind = row.kind as MediaKind;
    const active = await activeOfKind(pb, ctx, kind);
    assertUnderLimit(kind, active.length);
    const ops: Op[] = [
      {
        collection: COLLECTION,
        op: "update",
        id: row.id,
        body: { removed_at: "" },
      },
    ];
    if (SINGLE.has(kind)) {
      const at = nowStamp();
      for (const other of active) {
        ops.push({
          collection: COLLECTION,
          op: "update",
          id: other.id,
          body: { removed_at: at },
        });
      }
    }
    let proposal: MoodboardProposal | null | undefined;
    if (kind === "moodboard") {
      const order = [...active, row].sort(
        (a, b) =>
          num(a.sort_order) - num(b.sort_order) ||
          str(a.created).localeCompare(str(b.created)) ||
          a.id.localeCompare(b.id),
      );
      if (order[0]?.id === row.id) {
        const r = await refreshProposal(
          pb,
          ctx,
          row,
          opts.store ?? getObjectStore(),
        );
        ops.push(...r.ops);
        proposal = r.proposal;
      }
    }
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.restore`,
      targetCollection: COLLECTION,
      targetId: row.id,
    });
    return proposal === undefined ? {} : { proposal };
  });
  // 07-30: a restored logo is the active one again; regenerate the icons (best effort).
  if (wasLogo) {
    await regenerateSiteIcons(ctx.orgId, {
      force: true,
      store: opts.store,
      ...(opts.invalidator ? { invalidator: opts.invalidator } : {}),
    }).catch(() => undefined);
  }
  return result;
}

const REORDER_MEDIA_COPY =
  "The photos changed while you were moving them. Refresh and try again.";

/**
 * Put the active gallery or mood boards in the given order. `ids` must be exactly the active
 * rows of that kind. A new first mood board recomputes the proposal.
 */
export async function reorderMedia(
  ctx: OrgContext,
  kind: "gallery" | "moodboard",
  ids: readonly string[],
  opts: { store?: ObjectStore } = {},
): Promise<{ proposal?: MoodboardProposal }> {
  if (kind !== "gallery" && kind !== "moodboard") {
    throw new InvalidInput(REORDER_MEDIA_COPY);
  }
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
    throw new InvalidInput(REORDER_MEDIA_COPY);
  }
  return runWrite(ctx, async (pb) => {
    const rows = await activeOfKind(pb, ctx, kind);
    const own = new Set(rows.map((r) => r.id));
    if (
      ids.length !== rows.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((i) => own.has(i))
    ) {
      throw new InvalidInput(REORDER_MEDIA_COPY);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ops: Op[] = [];
    ids.forEach((id, i) => {
      if (byId.get(id)?.sort_order !== i) {
        ops.push({
          collection: COLLECTION,
          op: "update",
          id,
          body: { sort_order: i },
        });
      }
    });
    let proposal: MoodboardProposal | undefined;
    if (kind === "moodboard" && ids.length > 0 && ids[0] !== rows[0]?.id) {
      const r = await refreshProposal(
        pb,
        ctx,
        byId.get(ids[0]!),
        opts.store ?? getObjectStore(),
      );
      ops.push(...r.ops);
      proposal = r.proposal ?? undefined;
    }
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.reorder`,
      targetCollection: COLLECTION,
      targetId: "",
      meta: { kind, count: ids.length },
    });
    return proposal ? { proposal } : {};
  });
}
