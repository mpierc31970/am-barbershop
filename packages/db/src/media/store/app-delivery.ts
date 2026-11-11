// App-served media delivery: the `CDS_MEDIA_CDN=app` (or unset) stand-in for the MediaDelivery
// port (07-09, CONT-20, D255, CONTEXT Area 1 Q2). The app serves /_media/<asset-id>/<variant>
// from the public media store; Bunny (07-10) implements the same port. The selector
// getMediaDelivery() belongs to 07-12. URLs are host-relative and never contain a storage key.
import { InvalidInput } from "@cds/core";
import type { MediaDelivery, PublicMediaVariant } from "../ports";
import {
  MEDIA_WIDTHS,
  isPublicMediaKind,
  publicVariantAllowed,
  tenantPublicMediaKey,
  type MediaWidth,
} from "../../storage/keys";
import {
  MEDIA_TOKEN_BUCKET_S,
  MEDIA_TOKEN_TTL_S,
  signMediaToken,
} from "./token";

/** The one URL path prefix for app-served media (choice 10). */
export const APP_MEDIA_PATH = "/_media";

/** The smallest pre-generated width that covers `n` (2560 caps it). */
export function nearestMediaWidth(n: number): MediaWidth {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new InvalidInput("invalid media width");
  }
  for (const w of MEDIA_WIDTHS) if (n <= w) return w;
  return MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1]!;
}

/** The pixel width a `w*` variant stands for, else null. */
export function variantWidth(variant: string): number | null {
  const m = /^w(\d+)$/.exec(variant);
  return m ? Number(m[1]) : null;
}

export function createAppDelivery(
  deps: { now?: () => number } = {},
): MediaDelivery {
  const now = deps.now ?? (() => Date.now());
  const delivery = {
    name: "app" as const,
    urlFor(asset, variant: PublicMediaVariant, opts = {}) {
      if (!isPublicMediaKind(asset.kind)) {
        throw new InvalidInput("invalid media kind");
      }
      if (!publicVariantAllowed(asset.kind, variant)) {
        throw new InvalidInput("invalid media variant");
      }
      // Validation only (org + asset id segment rules); the key never goes in the URL.
      tenantPublicMediaKey(asset.orgId, asset.kind, asset.id, variant);
      const params = new URLSearchParams();
      const own = variantWidth(variant);
      if (opts.width !== undefined && own !== null) {
        const w = nearestMediaWidth(opts.width);
        if (w < own) params.set("w", String(w));
      }
      if (opts.protected) {
        const nowSec = Math.floor(now() / 1000);
        const exp =
          Math.ceil((nowSec + MEDIA_TOKEN_TTL_S) / MEDIA_TOKEN_BUCKET_S) *
          MEDIA_TOKEN_BUCKET_S;
        params.set("e", String(exp));
        params.set(
          "t",
          signMediaToken({
            orgId: asset.orgId,
            assetId: asset.id,
            variant,
            exp,
          }),
        );
      }
      const q = params.toString();
      return `${APP_MEDIA_PATH}/${asset.id}/${variant}${q ? `?${q}` : ""}`;
    },
    // No CDN cache to clear: a deleted object 404s on the next request.
    async purge(): Promise<void> {},
    // D221/D278: no delivery metering without a CDN.
    async deliveryBytes() {
      return null;
    },
  } satisfies MediaDelivery;
  return delivery;
}

export const appDelivery: MediaDelivery = createAppDelivery();
