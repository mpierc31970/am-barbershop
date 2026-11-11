// Media delivery mode (07-10; D278, CONTEXT Area 1 Q3, CONT-20). When the CDN is down, public
// media falls back to short-lived presigned Wasabi links; after 72 h of outage video pauses
// (poster only) so origin egress stays bounded. With the app stand-in the mode is always
// "cdn": the app is the origin, so there is nothing to fall back from.
//
// The outage start lives in platform_meta under CDN_DOWN_SINCE_KEY (ISO; "" = no outage).
// 07-27's probe writes it; readers here decide the mode.
import { readPlatformMeta, writePlatformMeta } from "../../platform-meta";
import { assertSystemContext, type SystemContext } from "../../context";
import type {
  DeliveryAssetRef,
  MediaDelivery,
  MediaUrlOptions,
  PublicMediaVariant,
} from "../ports";
import { publicObjectKey } from "./bunny";
import {
  ORIGIN_LINK_TTL_S,
  originConfigFromEnv,
  presignOriginUrl,
} from "./origin";

export type DeliveryMode = "cdn" | "origin" | "origin-video-paused";

/** After this long on origin links, video pauses (D278). */
export const FALLBACK_VIDEO_CAP_MS = 72 * 3_600_000;

export const CDN_DOWN_SINCE_KEY = "media:cdn_down_since";

/**
 * While the mode is not "cdn", a rendered page must not be cached longer than this, or its
 * presigned links (1 h) expire inside cached HTML. 07-12 and 07-27 honor it.
 */
export const ORIGIN_PAGE_MAX_AGE_S = 1800;

/** Pure: no outage (or an unreadable timestamp) -> cdn; then origin until the 72 h cap. */
export function deliveryMode(
  now: Date,
  cdnDownSince: Date | null,
): DeliveryMode {
  if (!cdnDownSince || Number.isNaN(cdnDownSince.getTime())) return "cdn";
  const elapsed = now.getTime() - cdnDownSince.getTime();
  return elapsed >= FALLBACK_VIDEO_CAP_MS ? "origin-video-paused" : "origin";
}

export async function readCdnDownSince(
  read: (key: string) => Promise<string | null> = readPlatformMeta,
): Promise<Date | null> {
  const raw = await read(CDN_DOWN_SINCE_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 07-27's probe sets it on first failure (keep the earliest timestamp) and clears it (null)
 * on recovery. SystemContext only, so only a job can move the delivery mode. Internal: not
 * exported from the barrel.
 */
export async function writeCdnDownSince(
  ctx: SystemContext,
  at: Date | null,
  write: (
    ctx: SystemContext,
    key: string,
    value: string,
  ) => Promise<void> = writePlatformMeta,
): Promise<void> {
  assertSystemContext(ctx);
  await write(ctx, CDN_DOWN_SINCE_KEY, at ? at.toISOString() : "");
}

export async function currentDeliveryMode(
  delivery: MediaDelivery,
  now: Date = new Date(),
  read: () => Promise<Date | null> = () => readCdnDownSince(),
): Promise<DeliveryMode> {
  if (delivery.name !== "bunny") return "cdn";
  return deliveryMode(now, await read());
}

/**
 * The URL a renderer should use for a media variant. URL resolvers (07-12 core-block-data)
 * call this instead of `urlFor`. null = paused video: show the poster only.
 */
export async function resolveMediaUrl(args: {
  delivery: MediaDelivery;
  mode: DeliveryMode;
  asset: DeliveryAssetRef;
  variant: PublicMediaVariant;
  opts?: MediaUrlOptions;
  presign?: (key: string, ttlS: number) => Promise<string>;
}): Promise<string | null> {
  const { delivery, mode, asset, variant, opts } = args;
  // Protected media is app-served with its own token; app delivery has no CDN to lose.
  if (mode === "cdn" || opts?.protected || delivery.name !== "bunny") {
    return delivery.urlFor(asset, variant, opts);
  }
  if (mode === "origin-video-paused" && variant === "video.mp4") return null;
  const presign =
    args.presign ??
    ((key: string, ttl: number) =>
      presignOriginUrl(originConfigFromEnv(), key, ttl));
  return presign(publicObjectKey(asset, variant), ORIGIN_LINK_TTL_S);
}
