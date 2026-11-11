// Hub media objects (07-12 choice 15; CONT-19, CONT-33; invariant 1, T-07-12-01). The hub
// (owner previews, the library drawer, builder preview) reads the PRIVATE derivatives of the
// caller's own assets: w480 / w960 / w1600 / w2560 (= web.webp), video.mp4, posters,
// captions.vtt and audio.mp3. P6's original | web | thumb stay on readMediaVariant. Content
// read; another org's id is NotFound; soft-deleted assets still read (D275). An image width
// not stored yet (a P6 photo before its first publish backfill) falls back to web.webp.
import { NotFound } from "@cds/core";
import type { OrgContext } from "../../context";
import { scopedGet } from "../../content/shared";
import { assertId } from "../../repository";
import { getRangedObjectStore } from "../../storage";
import {
  PUBLIC_VARIANTS_BY_KIND,
  tenantMediaDerivativeKey,
} from "../../storage/keys";
import type { ByteRange, RangedObjectStore } from "../../storage/object-store";
import type { PublicMediaVariant } from "../ports";
import { publicMediaMime } from "../store/range";
import { publicKindForRow } from "../store/serve";
import { runContentRead } from "./run";

export const HUB_MEDIA_VARIANTS = Object.freeze([
  "w480",
  "w960",
  "w1600",
  "w2560",
  "video.mp4",
  "poster.jpg",
  "poster.webp",
  "captions.vtt",
  "audio.mp3",
] as const);
export type HubMediaVariant = (typeof HUB_MEDIA_VARIANTS)[number];

export function isHubMediaVariant(v: unknown): v is HubMediaVariant {
  return (
    typeof v === "string" &&
    (HUB_MEDIA_VARIANTS as readonly string[]).includes(v)
  );
}

export type HubMediaObject = {
  mime: string;
  size: number;
  read(range: ByteRange | null): Promise<ReadableStream<Uint8Array>>;
};

export async function openHubMediaObject(
  ctx: OrgContext,
  id: string,
  variant: string,
  deps: { store?: RangedObjectStore } = {},
): Promise<HubMediaObject> {
  if (!isHubMediaVariant(variant)) throw new NotFound();
  assertId(id);
  const row = await runContentRead(ctx, (pb) =>
    scopedGet(pb, ctx, "media_assets", id),
  );
  const kind = publicKindForRow(row.kind);
  if (
    kind === null ||
    !(PUBLIC_VARIANTS_BY_KIND[kind] as readonly string[]).includes(variant)
  ) {
    throw new NotFound();
  }
  if (variant === "captions.vtt" && row.captions_path !== "captions.vtt") {
    throw new NotFound();
  }
  const store = deps.store ?? getRangedObjectStore();
  let key = tenantMediaDerivativeKey(ctx.orgId, row.id, variant);
  let st = await store.stat(key);
  if (!st && kind === "image" && variant !== "w2560") {
    key = tenantMediaDerivativeKey(ctx.orgId, row.id, "w2560");
    st = await store.stat(key);
  }
  if (!st) throw new NotFound();
  const servedKey = key;
  return {
    mime: publicMediaMime(variant as PublicMediaVariant),
    size: st.size,
    async read(range) {
      const r = await store.readRange(servedKey, range);
      if (!r) throw new NotFound();
      return r.stream;
    },
  };
}
