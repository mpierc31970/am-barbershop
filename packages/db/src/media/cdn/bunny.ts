// Bunny CDN delivery (07-10; CONT-20, D226, D255; CONTEXT Area 1 Q2/Q3 and resolution d).
// The second implementation of the MediaDelivery port (ports.ts). Stand-in first: the app
// serves media itself (`appDelivery`, 07-09) until Bunny is configured; the swap is config
// only (`CDS_MEDIA_CDN=bunny`, selector in 07-12). Nothing here is called live in P7: tests
// mock every fetch. Credentials come from env only and never appear in errors or logs
// (T-02-26 precedent): config errors name variables, purge errors carry an HTTP status.
//
// Protected media (resolution d) never gets a pull-zone URL: `urlFor(..., { protected })`
// delegates to the app route (07-09's HMAC token) or throws. The HS256 token signer is built
// and vector-tested so a later token-auth zone needs no new code.
import { createHmac } from "node:crypto";
import { InvalidInput } from "@cds/core";
import {
  assertPublicMediaKey,
  isPublicMediaKind,
  publicVariantAllowed,
  tenantPublicMediaKey,
} from "../../storage/keys";
import type {
  DeliveryAssetRef,
  MediaDelivery,
  MediaUrlOptions,
  PublicMediaVariant,
} from "../ports";

export const BUNNY_ENV_VARS = Object.freeze([
  "BUNNY_PULL_ZONE_HOST",
  "BUNNY_TOKEN_KEY",
  "BUNNY_API_KEY",
] as const);

/**
 * Optimizer `format` value (locked CONTEXT A1 Q2). Bunny may negotiate WebP/AVIF from
 * `Accept` alone; verified at account setup (HUMAN-CHECKS 07-10 a). Change it here only.
 */
export const BUNNY_OPTIMIZER_FORMAT = "auto";

export type BunnyConfig = {
  pullZoneHost: string;
  tokenKey: string;
  apiKey: string;
};

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_WIDTH = 2560;
const PURGE_TIMEOUT_MS = 10_000;

/**
 * Shape check for purge / presign input: only `tenants/<org>/media/<kind>/<id>/<file>`
 * (optionally under dev/). `assertPublicMediaKey` then applies the env prefix and the
 * per-kind file allowlist (07-09 owns the layout).
 */
export const PUBLIC_MEDIA_KEY_RE =
  /^(?:dev\/)?tenants\/[a-z0-9_-]{1,64}\/media\/(?:image|video|audio)\/[a-z0-9_-]{1,64}\/[a-z0-9_-]{1,32}(?:\.[a-z0-9]{1,8})?$/;

function configFrom(env: Env): BunnyConfig {
  const missing = BUNNY_ENV_VARS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      "Bunny delivery is not configured: set " + missing.join(", "),
    );
  }
  const pullZoneHost = env.BUNNY_PULL_ZONE_HOST!;
  if (!HOST_RE.test(pullZoneHost)) {
    throw new Error(
      "Bunny delivery is not configured: set BUNNY_PULL_ZONE_HOST to a bare hostname",
    );
  }
  return {
    pullZoneHost,
    tokenKey: env.BUNNY_TOKEN_KEY!,
    apiKey: env.BUNNY_API_KEY!,
  };
}

/**
 * The public object key for an asset variant. 07-09's `tenantPublicMediaKey` owns the
 * layout (`<env>tenants/<org>/media/<kind>/<id>/<file>`, `w*`/`thumb` stored as `.webp`),
 * so the pull zone (origin = the public media bucket) reads the same object the app serves.
 */
export function publicObjectKey(
  asset: DeliveryAssetRef,
  variant: PublicMediaVariant,
): string {
  if (!isPublicMediaKind(asset?.kind)) {
    throw new InvalidInput("invalid media kind");
  }
  if (!publicVariantAllowed(asset.kind, variant)) {
    throw new InvalidInput("invalid media variant");
  }
  return tenantPublicMediaKey(asset.orgId, asset.kind, asset.id, variant);
}

function optimizerQuery(
  asset: DeliveryAssetRef,
  variant: PublicMediaVariant,
  width: number | undefined,
): string {
  if (asset.kind !== "image") return "";
  if (variant !== "thumb" && !/^w\d+$/.test(variant)) return "";
  const parts: string[] = [];
  if (typeof width === "number" && Number.isFinite(width)) {
    const w = Math.round(width);
    if (w >= 1 && w <= MAX_WIDTH) parts.push(`width=${w}`);
  }
  parts.push(`format=${BUNNY_OPTIMIZER_FORMAT}`);
  return "?" + parts.join("&");
}

function plainUrl(
  cfg: BunnyConfig,
  asset: DeliveryAssetRef,
  variant: PublicMediaVariant,
  width?: number,
): string {
  // Key segments are URL-safe by construction (segment regex + fixed file names).
  return `https://${cfg.pullZoneHost}/${publicObjectKey(asset, variant)}${optimizerQuery(asset, variant, width)}`;
}

function assertPurgeKey(key: string): void {
  if (typeof key !== "string" || !PUBLIC_MEDIA_KEY_RE.test(key)) {
    throw new InvalidInput("not a public media key");
  }
  assertPublicMediaKey(key);
}

export function createBunnyDelivery(
  opts: {
    env?: Env;
    fetch?: typeof fetch;
    privateDelivery?: MediaDelivery;
  } = {},
): MediaDelivery {
  let cached: BunnyConfig | null = null;
  // Resolved lazily (WR-07 precedent): a missing var throws at first use, never at import.
  const cfg = (): BunnyConfig =>
    (cached ??= configFrom(opts.env ?? process.env));

  return {
    name: "bunny",

    urlFor(asset, variant, urlOpts?: MediaUrlOptions): string {
      if (urlOpts?.protected) {
        if (!opts.privateDelivery) {
          throw new InvalidInput(
            "protected media is served by the app route, not the pull zone",
          );
        }
        return opts.privateDelivery.urlFor(asset, variant, urlOpts);
      }
      return plainUrl(cfg(), asset, variant, urlOpts?.width);
    },

    async purge(keys: readonly string[]): Promise<void> {
      if (keys.length === 0) return;
      const c = cfg();
      const unique = [...new Set(keys)];
      for (const key of unique) assertPurgeKey(key);
      const doFetch = opts.fetch ?? fetch;
      for (const key of unique) {
        // WR-A06: a trailing wildcard clears every cached query variant of the object
        // (Bunny optimizer ?width=&format=), not just the bare URL.
        const res = await doFetch(
          "https://api.bunny.net/purge?url=" +
            encodeURIComponent(`https://${c.pullZoneHost}/${key}*`) +
            "&async=true",
          {
            method: "POST",
            headers: { AccessKey: c.apiKey },
            signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
          },
        );
        if (!res.ok) throw new Error("Bunny purge failed: HTTP " + res.status);
      }
    },

    /**
     * Null until the Bunny statistics API is wired with the account (CONTEXT Deferred,
     * D221). The "Move it to YouTube" prompt stays inactive while this is null.
     */
    async deliveryBytes(): Promise<number | null> {
      return null;
    },
  } satisfies MediaDelivery;
}

/**
 * Port of the official Bunny token signer (BunnyWay/BunnyCDN.TokenAuthentication,
 * nodejs/token.js; HS256 format only). Signing data uses raw values, the URL encoded ones.
 */
export function bunnySign(
  url: string,
  key: string,
  expires: number,
  pathAllowed = "",
): string {
  const u = new URL(url);
  const params: Record<string, string> = Object.fromEntries(u.searchParams);
  if (pathAllowed) params.token_path = pathAllowed;
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const signingData = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  const urlData = sorted
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const h = createHmac("sha256", key);
  h.update(pathAllowed || u.pathname);
  h.update(String(expires));
  h.update(signingData);
  const token =
    "HS256-" +
    h
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${u.protocol}//${u.host}${u.pathname}?token=${token}${urlData ? `&${urlData}` : ""}&expires=${expires}`;
}

/**
 * A token-signed pull-zone URL, for a future token-auth zone (resolution d). P7 never calls
 * it at runtime.
 */
export function bunnySignedUrlFor(opts: {
  env?: Env;
  asset: DeliveryAssetRef;
  variant: PublicMediaVariant;
  width?: number;
  expires: number;
}): string {
  const c = configFrom(opts.env ?? process.env);
  return bunnySign(
    plainUrl(c, opts.asset, opts.variant, opts.width),
    c.tokenKey,
    opts.expires,
  );
}

/**
 * `crossorigin` for `<video>` / `<audio>`: captions served from the pull zone are
 * cross-origin and need CORS (Pitfall 16). 07-23 sets it when captions exist.
 */
export function mediaCrossOrigin(
  delivery: MediaDelivery,
): "anonymous" | undefined {
  return delivery.name === "bunny" ? "anonymous" : undefined;
}
