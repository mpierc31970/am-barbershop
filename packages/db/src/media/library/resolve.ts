// Media URL resolvers (07-12; CONT-33, resolution d, choices 10 and 16; invariant 1). The
// one place visitor media URLs are built. URLs come only from MediaDelivery (never a raw
// storage key):
//   - a promoted asset (public_at set) on a public page -> resolveMediaUrl (CDN, origin
//     fallback link, or "" for a paused video: poster only)
//   - an unpromoted asset, or any asset on a password-protected page -> a 1 h tokenized app
//     URL; the /_media route serves it from the private store (07-09 serve.ts fallback)
// Resolved per request and never cached with page data (tokens are bucketed to 10 min; the
// tenant page cache stays <= 300 s, below ORIGIN_PAGE_MAX_AGE_S). The read path never
// writes or promotes. resolveHubMedia gives the same shape with private hub routes.
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import {
  assertSiteContext,
  type SiteContext,
} from "../../content/site-context";
import type { OrgContext } from "../../context";
import { getCollectionSpec, projectPublic } from "../../registry";
import { currentDeliveryMode, resolveMediaUrl } from "../cdn/mode";
import type {
  DeliveryAssetRef,
  MediaDelivery,
  PublicMediaKind,
  PublicMediaVariant,
} from "../ports";
import { publicKindForRow } from "../store/serve";
import { getMediaDelivery } from "./delivery";
import { runContentRead } from "./run";
import {
  imageWidthCandidates,
  largestCandidateUpTo,
  type WidthCandidate,
} from "./srcset";

/** Structurally the 07-05 `ResolvedMedia` (@cds/ui/site); @cds/db never imports ui. */
export type ResolvedMediaData = {
  id: string;
  kind: "image" | "video" | "audio";
  src: string;
  srcSet?: string;
  width?: number;
  height?: number;
  alt: string;
  poster?: string;
  captions?: string;
  mime?: string;
  deleted?: boolean;
};

export const MAX_MEDIA_PER_PAGE = 500;
const CHUNK = 50;
const ID_RE = /^[a-z0-9]{15}$/;

/** A public-projected media row plus the soft-delete flag (never storage_dir or name). */
export type PublicMediaRow = Record<string, unknown> & {
  id: string;
  deleted: boolean;
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function cleanIds(ids: readonly unknown[]): string[] {
  if (!Array.isArray(ids)) return [];
  const out = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && ID_RE.test(id)) out.add(id);
    if (out.size >= MAX_MEDIA_PER_PAGE) break;
  }
  return [...out];
}

function idClause(chunk: readonly string[]): {
  expr: string;
  params: Record<string, string>;
} {
  const params: Record<string, string> = {};
  const expr = chunk
    .map((id, i) => {
      params[`i${i}`] = id;
      return `id = {:i${i}}`;
    })
    .join(" || ");
  return { expr, params };
}

async function readRows(
  orgId: string,
  ids: readonly string[],
): Promise<RecordModel[]> {
  if (ids.length === 0) return [];
  return withSuperuser(async (pb) => {
    const rows: RecordModel[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { expr, params } = idClause(ids.slice(i, i + CHUNK));
      rows.push(
        ...(await pb.collection("media_assets").getFullList({
          filter: pb.filter(
            "organization = {:org} && status = 'ready' && (" + expr + ")",
            { ...params, org: orgId },
          ),
        })),
      );
    }
    return rows;
  });
}

function project(row: RecordModel): PublicMediaRow {
  const pub = projectPublic(getCollectionSpec("media_assets"), row);
  return { ...pub, id: row.id, deleted: str(row.deleted_at) !== "" };
}

/** The site's own ready media rows for `ids` (unknown, foreign and malformed ids dropped). */
export async function readPublicMedia(
  site: SiteContext,
  ids: readonly unknown[],
): Promise<PublicMediaRow[]> {
  assertSiteContext(site);
  return (await readRows(site.orgId, cleanIds(ids))).map(project);
}

type UrlFn = (
  row: PublicMediaRow,
  kind: PublicMediaKind,
  variant: PublicMediaVariant,
) => Promise<string | null>;

function candidatesOf(row: PublicMediaRow): ReadonlyArray<WidthCandidate> {
  return imageWidthCandidates(num(row.width), num(row.web_width));
}

async function build(
  rows: readonly PublicMediaRow[],
  wanted: ReadonlySet<string>,
  url: UrlFn,
): Promise<Record<string, ResolvedMediaData>> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Record<string, ResolvedMediaData> = {};
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    const kind = publicKindForRow(row.kind);
    if (kind === null) continue;
    const base = {
      id: row.id,
      alt: str(row.alt),
      ...(num(row.width) > 0 ? { width: num(row.width) } : {}),
      ...(num(row.height) > 0 ? { height: num(row.height) } : {}),
      ...(row.deleted ? { deleted: true } : {}),
    };
    if (kind === "image") {
      const cands = candidatesOf(row);
      const [srcVariant] = largestCandidateUpTo(cands);
      const parts: string[] = [];
      for (const [v, px] of cands) {
        const u = await url(row, kind, v);
        if (u && px > 0) parts.push(`${u} ${px}w`);
      }
      out[row.id] = {
        ...base,
        kind: "image",
        src: (await url(row, kind, srcVariant)) ?? "",
        ...(parts.length > 0 ? { srcSet: parts.join(", ") } : {}),
      };
    } else if (kind === "video") {
      let poster: string | null = null;
      const pid = str(row.poster_asset);
      const cover = pid ? byId.get(pid) : undefined;
      if (cover && publicKindForRow(cover.kind) === "image") {
        const [v] = largestCandidateUpTo(candidatesOf(cover), "w960");
        poster = await url(cover, "image", v);
      }
      poster ??= await url(row, kind, "poster.webp");
      const captions =
        row.captions_path === "captions.vtt"
          ? await url(row, kind, "captions.vtt")
          : null;
      out[row.id] = {
        ...base,
        kind: "video",
        src: (await url(row, kind, "video.mp4")) ?? "",
        ...(poster ? { poster } : {}),
        ...(captions ? { captions } : {}),
        mime: "video/mp4",
      };
    } else {
      out[row.id] = {
        ...base,
        kind: "audio",
        src: (await url(row, kind, "audio.mp3")) ?? "",
        mime: "audio/mpeg",
      };
    }
  }
  return out;
}

/** Poster rows of the videos in `rows` that were not requested themselves. */
function posterIds(rows: readonly PublicMediaRow[]): string[] {
  const have = new Set(rows.map((r) => r.id));
  const out: string[] = [];
  for (const r of rows) {
    const p = str(r.poster_asset);
    if (publicKindForRow(r.kind) === "video" && ID_RE.test(p) && !have.has(p)) {
      out.push(p);
    }
  }
  return out;
}

export async function resolvePublicMedia(
  site: SiteContext,
  ids: readonly unknown[],
  opts: {
    pageId?: string;
    protectedPage?: boolean;
    delivery?: MediaDelivery;
    now?: Date;
  } = {},
): Promise<Record<string, ResolvedMediaData>> {
  assertSiteContext(site);
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return {};
  const rows = (await readRows(site.orgId, wanted)).map(project);
  const extra = (await readRows(site.orgId, posterIds(rows))).map(project);
  const delivery = opts.delivery ?? getMediaDelivery();
  const mode = await currentDeliveryMode(delivery, opts.now ?? new Date());
  const pageId = opts.pageId ?? "site";
  const url: UrlFn = (row, kind, variant) => {
    const asset: DeliveryAssetRef = { id: row.id, orgId: site.orgId, kind };
    const promoted = str(row.public_at) !== "";
    const tokenized = opts.protectedPage === true || !promoted;
    return resolveMediaUrl({
      delivery,
      mode,
      asset,
      variant,
      ...(tokenized ? { opts: { protected: { pageId } } } : {}),
    });
  };
  return build([...rows, ...extra], new Set(wanted), url);
}

/** The same shape with private hub routes (builder preview, hub screens). Content read. */
export async function resolveHubMedia(
  ctx: OrgContext,
  ids: readonly unknown[],
): Promise<Record<string, ResolvedMediaData>> {
  const wanted = cleanIds(ids);
  return runContentRead(ctx, async () => {
    if (wanted.length === 0) return {};
    const rows = (await readRows(ctx.orgId, wanted)).map(project);
    const extra = (await readRows(ctx.orgId, posterIds(rows))).map(project);
    const url: UrlFn = async (row, _kind, variant) =>
      `/hub/media/${row.id}/${variant}`;
    return build([...rows, ...extra], new Set(wanted), url);
  });
}
