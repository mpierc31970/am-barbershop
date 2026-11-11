// The one visitor media read (07-09, CONT-19, CONT-20, CONT-33, D255; invariant 1). A
// SiteContext only: the row is read bound to the site's org, and the object key is built from
// the row (organization, kind, id) plus an allowlisted variant, never from the URL. Every
// refusal is NotFound (choice 5): unknown id, foreign org, not ready, disallowed variant,
// missing / bad / expired token, missing object. Soft-deleted rows still serve (choice 9).
// Private fallback (07-12, resolution d): a TOKENIZED request whose public object does not
// exist (not promoted yet, or a protected page) is served from the private derivative
// (tenantMediaDerivativeKey). An untokenized request never reads the private store.
import { NotFound } from "@cds/core";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { getCollectionSpec, projectPublic } from "../../registry";
import {
  assertSiteContext,
  type SiteContext,
} from "../../content/site-context";
import { getPublicMediaStore, getRangedObjectStore } from "../../storage";
import {
  MEDIA_WIDTHS,
  isPublicMediaVariant,
  publicVariantAllowed,
  tenantMediaDerivativeKey,
  tenantPublicMediaKey,
} from "../../storage/keys";
import type { ByteRange, RangedObjectStore } from "../../storage/object-store";
import type { PublicMediaKind, PublicMediaVariant } from "../ports";
import { variantWidth } from "./app-delivery";
import { publicMediaMime } from "./range";
import { verifyMediaToken } from "./token";

const ID_RE = /^[a-z0-9]{15}$/;
const IMAGE_ROW_KINDS = new Set([
  "logo",
  "hero",
  "gallery",
  "team",
  "moodboard",
  "library",
]);

/** The public kind for a media_assets row kind, or null when it has no public form. */
export function publicKindForRow(kind: unknown): PublicMediaKind | null {
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (typeof kind === "string" && IMAGE_ROW_KINDS.has(kind)) return "image";
  return null;
}

export type PublicMediaRequest = {
  id: string;
  variant: string;
  w?: string | null;
  e?: string | null;
  t?: string | null;
};

export type PublicMediaObject = {
  mime: string;
  size: number;
  /** True when served on a token: private cache headers, noindex. */
  tokenized: boolean;
  read(range: ByteRange | null): Promise<ReadableStream<Uint8Array>>;
};

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v !== "";
}

export async function openPublicMediaObject(
  site: SiteContext,
  req: PublicMediaRequest,
  deps: {
    store?: RangedObjectStore;
    privateStore?: RangedObjectStore;
    now?: () => number;
  } = {},
): Promise<PublicMediaObject> {
  assertSiteContext(site);
  const { id, variant } = req;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  if (!isPublicMediaVariant(variant)) throw new NotFound();

  let row: RecordModel;
  try {
    row = await withSuperuser((pb) =>
      pb.collection("media_assets").getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id,
          org: site.orgId,
        }),
      ),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
  const pub = projectPublic(getCollectionSpec("media_assets"), row);
  if (pub.status !== "ready") throw new NotFound();
  const kind = publicKindForRow(pub.kind);
  if (kind === null || !publicVariantAllowed(kind, variant)) {
    throw new NotFound();
  }
  if (variant === "captions.vtt" && pub.captions_path !== "captions.vtt") {
    throw new NotFound();
  }

  // Choice 8: a present token is always checked; without one the asset must be public.
  let tokenized = false;
  if (present(req.e) || present(req.t)) {
    const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
    const ok = verifyMediaToken(
      { orgId: site.orgId, assetId: id, variant },
      req.e ?? null,
      req.t ?? null,
      nowSec,
    );
    if (!ok) throw new NotFound();
    tokenized = true;
  } else if (typeof pub.public_at !== "string" || pub.public_at === "") {
    throw new NotFound();
  }

  // Choice 6: ?w= is canonical only (image w* variants, a listed width below the path's).
  let chosen: PublicMediaVariant = variant;
  if (req.w !== undefined && req.w !== null) {
    const own = variantWidth(variant);
    const w = /^\d{1,5}$/.test(req.w) ? Number(req.w) : NaN;
    if (
      kind !== "image" ||
      own === null ||
      !(MEDIA_WIDTHS as readonly number[]).includes(w) ||
      !(w < own)
    ) {
      throw new NotFound();
    }
    chosen = `w${w}` as PublicMediaVariant;
  }

  const store = deps.store ?? getPublicMediaStore();
  let key = tenantPublicMediaKey(site.orgId, kind, id, chosen);
  let st = await store.stat(key);
  if (!st && chosen !== variant) {
    key = tenantPublicMediaKey(site.orgId, kind, id, variant);
    st = await store.stat(key);
  }
  let served: RangedObjectStore = store;
  if (!st && tokenized) {
    // The `w` choice is ignored on the private path: the path variant is served.
    const priv = deps.privateStore ?? getRangedObjectStore();
    key = tenantMediaDerivativeKey(site.orgId, id, variant);
    st = await priv.stat(key);
    served = priv;
  }
  if (!st) throw new NotFound();
  const servedKey = key;
  const servedStore = served;

  return {
    mime: publicMediaMime(variant),
    size: st.size,
    tokenized,
    async read(range) {
      const r = await servedStore.readRange(servedKey, range);
      if (!r) throw new NotFound();
      return r.stream;
    },
  };
}
