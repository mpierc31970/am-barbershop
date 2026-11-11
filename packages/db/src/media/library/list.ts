// Media library reads and the bulk describe write (07-12; CONT-14, CONT-35, D280,
// D-UI-P7-5; invariant 1, T-07-12-01). Reads are content read (every org role); describeMedia
// is content write. Every query is bound to the context's org with pb.filter parameters,
// never string-built. Soft-deleted (deleted_at, D275) and P6-removed (removed_at) rows never
// appear in the list, the counts or the describe list; getLibraryItem still returns a
// soft-deleted row (flagged) so its drawer can open.
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { OrgContext } from "../../context";
import { commit, scopedGet, type Op } from "../../content/shared";
import { assertId } from "../../repository";
import { ALT_COPY, ALT_MAX } from "../assets";
import { ALT_REQUIRED_COPY, altSuggestionFromName } from "./alt";
import { runContentRead, runContentWrite } from "./run";

const COLLECTION = "media_assets";

export const LIBRARY_PAGE_SIZE = 48;
const PER_PAGE_MAX = 100;
const Q_MAX = 100;
const DESCRIBE_MAX = 200;
const DESCRIBE_LIST_DEFAULT = 100;

/** Every media_assets kind that is an image (P6 intake kinds + library). */
export const IMAGE_ROW_KINDS = Object.freeze([
  "logo",
  "hero",
  "gallery",
  "team",
  "moodboard",
  "library",
] as const);

export type LibraryFilter = "all" | "images" | "videos" | "audio";

export type LibraryItem = {
  id: string;
  kind: "image" | "video" | "audio";
  rowKind: string;
  name: string;
  alt: string;
  needsDescription: boolean;
  status: string;
  width: number;
  height: number;
  bytes: number;
  durationS: number;
  createdAt: string;
  thumbUrl: string | null;
  previewUrl: string;
  posterUrl: string | null;
  deleted?: boolean;
  /** 07-17: a video whose cover is a library photo (07-13 setVideoCover). */
  customCover?: boolean;
  /** 07-17: a video with a captions file (07-13 captions_path). */
  hasCaptions?: boolean;
};

export type LibraryCounts = {
  all: number;
  images: number;
  videos: number;
  audio: number;
};

export type LibraryPage = {
  items: LibraryItem[];
  total: number;
  page: number;
  perPage: number;
  counts: LibraryCounts;
  needsDescription: number;
};

export type DescribeItem = {
  id: string;
  name: string;
  thumbUrl: string;
  suggestion: string;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function itemKind(rowKind: string): LibraryItem["kind"] {
  if (rowKind === "video") return "video";
  if (rowKind === "audio") return "audio";
  return "image";
}

const hub = (id: string, variant: string) => `/hub/media/${id}/${variant}`;

export function toLibraryItem(row: RecordModel): LibraryItem {
  const rowKind = str(row.kind);
  const kind = itemKind(rowKind);
  const status = str(row.status) || "ready";
  const alt = str(row.alt);
  const width = num(row.width);
  const item: LibraryItem = {
    id: row.id,
    kind,
    rowKind,
    name: str(row.name),
    alt,
    needsDescription: kind === "image" && status === "ready" && alt === "",
    status,
    width,
    height: num(row.height),
    bytes: num(row.bytes),
    durationS: num(row.duration_s),
    createdAt: str(row.created),
    thumbUrl:
      kind === "image"
        ? hub(row.id, "thumb")
        : kind === "video"
          ? hub(row.id, "poster.webp")
          : null,
    previewUrl:
      kind === "image"
        ? hub(row.id, width > 960 ? "w960" : "web")
        : kind === "video"
          ? hub(row.id, "video.mp4")
          : hub(row.id, "audio.mp3"),
    posterUrl: kind === "video" ? hub(row.id, "poster.webp") : null,
  };
  if (str(row.deleted_at) !== "") item.deleted = true;
  if (kind === "video" && str(row.poster_asset) !== "") item.customCover = true;
  if (kind === "video" && str(row.captions_path) !== "")
    item.hasCaptions = true;
  return item;
}

type Bound = { expr: string; params: Record<string, unknown> };

/** A bound `kind = {:k0} || …` clause (never string-built from input). */
function kindsClause(kinds: readonly string[], prefix: string): Bound {
  const params: Record<string, unknown> = {};
  const parts = kinds.map((k, i) => {
    params[`${prefix}${i}`] = k;
    return `kind = {:${prefix}${i}}`;
  });
  return { expr: `(${parts.join(" || ")})`, params };
}

function filterClause(filter: LibraryFilter): Bound | null {
  if (filter === "images") return kindsClause(IMAGE_ROW_KINDS, "ik");
  if (filter === "videos") return { expr: "kind = 'video'", params: {} };
  if (filter === "audio") return { expr: "kind = 'audio'", params: {} };
  return null;
}

const VISIBLE = "organization = {:org} && deleted_at = '' && removed_at = ''";

function build(pb: PocketBase, ctx: OrgContext, extra: Bound[]): string {
  const params: Record<string, unknown> = { org: ctx.orgId };
  let expr = VISIBLE;
  for (const b of extra) {
    expr += ` && ${b.expr}`;
    Object.assign(params, b.params);
  }
  return pb.filter(expr, params);
}

async function count(
  pb: PocketBase,
  ctx: OrgContext,
  extra: Bound[],
): Promise<number> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: build(pb, ctx, extra),
    fields: "id",
    skipTotal: false,
  });
  return res.totalItems;
}

function needsDescriptionClause(): Bound[] {
  return [
    kindsClause(IMAGE_ROW_KINDS, "nk"),
    { expr: "status = 'ready' && alt = ''", params: {} },
  ];
}

function intIn(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function isFilter(v: unknown): v is LibraryFilter {
  return v === "all" || v === "images" || v === "videos" || v === "audio";
}

export async function listLibrary(
  ctx: OrgContext,
  opts: {
    filter?: LibraryFilter;
    q?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<LibraryPage> {
  const filter: LibraryFilter = isFilter(opts.filter) ? opts.filter : "all";
  const q =
    typeof opts.q === "string" ? opts.q.trim().slice(0, Q_MAX).trim() : "";
  const page = intIn(opts.page, 1, 100_000, 1);
  const perPage = intIn(opts.perPage, 1, PER_PAGE_MAX, LIBRARY_PAGE_SIZE);
  return runContentRead(ctx, async (pb) => {
    const extra: Bound[] = [];
    const f = filterClause(filter);
    if (f) extra.push(f);
    if (q !== "") {
      extra.push({ expr: "(name ~ {:q} || alt ~ {:q})", params: { q } });
    }
    const res = await pb.collection(COLLECTION).getList(page, perPage, {
      filter: build(pb, ctx, extra),
      sort: "-created,-id",
    });
    const [all, images, videos, audio, needsDescription] = await Promise.all([
      count(pb, ctx, []),
      count(pb, ctx, [filterClause("images")!]),
      count(pb, ctx, [filterClause("videos")!]),
      count(pb, ctx, [filterClause("audio")!]),
      count(pb, ctx, needsDescriptionClause()),
    ]);
    return {
      items: res.items.map(toLibraryItem),
      total: res.totalItems,
      page,
      perPage,
      counts: { all, images, videos, audio },
      needsDescription,
    };
  });
}

/** One own asset (a soft-deleted one too, flagged); a foreign id is NotFound. */
export async function getLibraryItem(
  ctx: OrgContext,
  id: string,
): Promise<LibraryItem> {
  return runContentRead(ctx, async (pb) =>
    toLibraryItem(await scopedGet(pb, ctx, COLLECTION, id)),
  );
}

/** Images still missing a description, oldest first (the D280 describe list). */
export async function listMediaNeedingDescription(
  ctx: OrgContext,
  opts: { limit?: number } = {},
): Promise<{ items: DescribeItem[]; total: number }> {
  const limit = intIn(opts.limit, 1, DESCRIBE_MAX, DESCRIBE_LIST_DEFAULT);
  return runContentRead(ctx, async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, limit, {
      filter: build(pb, ctx, needsDescriptionClause()),
      sort: "created,id",
      fields: "id,name",
    });
    return {
      items: res.items.map((r) => ({
        id: r.id,
        name: str(r.name),
        thumbUrl: hub(r.id, "thumb"),
        suggestion: altSuggestionFromName(str(r.name)),
      })),
      total: res.totalItems,
    };
  });
}

export async function countMediaNeedingDescription(
  ctx: OrgContext,
): Promise<number> {
  return runContentRead(ctx, (pb) => count(pb, ctx, needsDescriptionClause()));
}

/**
 * Save many descriptions at once (D280 bulk backfill). Every id must be an own, not deleted
 * image or nothing is written (NotFound); a blank description is refused; unchanged rows are
 * skipped. One batch, one `media_assets.describe` audit row.
 */
export async function describeMedia(
  ctx: OrgContext,
  entries: readonly { id: string; alt: string }[],
): Promise<{ updated: number }> {
  if (!Array.isArray(entries) || entries.length > DESCRIBE_MAX) {
    throw new InvalidInput(`Describe at most ${DESCRIBE_MAX} photos at once.`);
  }
  const wanted = new Map<string, string>();
  for (const e of entries as unknown[]) {
    if (typeof e !== "object" || e === null) {
      throw new InvalidInput(ALT_REQUIRED_COPY);
    }
    const { id, alt } = e as { id?: unknown; alt?: unknown };
    assertId(id);
    if (typeof alt !== "string" || alt.trim() === "") {
      throw new InvalidInput(ALT_REQUIRED_COPY);
    }
    const clean = alt.trim();
    if (clean.length > ALT_MAX) throw new InvalidInput(ALT_COPY);
    if (wanted.has(id)) throw new InvalidInput("Each photo can appear once.");
    wanted.set(id, clean);
  }
  if (wanted.size === 0) return { updated: 0 };

  return runContentWrite(ctx, async (pb) => {
    const ids = [...wanted.keys()];
    const rows: RecordModel[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const idParams: Record<string, unknown> = { org: ctx.orgId };
      const idExpr = chunk
        .map((id, j) => {
          idParams[`i${j}`] = id;
          return `id = {:i${j}}`;
        })
        .join(" || ");
      rows.push(
        ...(await pb.collection(COLLECTION).getFullList({
          filter: pb.filter(
            "organization = {:org} && deleted_at = '' && (" + idExpr + ")",
            idParams,
          ),
          fields: "id,kind,alt",
        })),
      );
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || itemKind(str(row.kind)) !== "image") throw new NotFound();
    }
    const ops: Op[] = [];
    for (const [id, alt] of wanted) {
      if (str(byId.get(id)!.alt) === alt) continue;
      ops.push({ collection: COLLECTION, op: "update", id, body: { alt } });
    }
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.describe`,
      targetCollection: COLLECTION,
      targetId: "",
      meta: { count: ops.length },
    });
    return { updated: ops.length };
  });
}
