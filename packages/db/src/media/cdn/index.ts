// @cds/db P7 area barrel: Bunny CDN delivery, fallback mode and usage (owner 07-10; CONT-19,
// CONT-20). Named exports only; never export a PocketBase client, a context minter or an
// internal writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// Internal by design (jobs inside @cds/db import them by path): writeCdnDownSince,
// presignOriginUrl, originConfigFromEnv, publicObjectKey, PUBLIC_MEDIA_KEY_RE,
// mediaAllowancesFor, summarise.
export {
  BUNNY_ENV_VARS,
  BUNNY_OPTIMIZER_FORMAT,
  bunnySign,
  bunnySignedUrlFor,
  createBunnyDelivery,
  mediaCrossOrigin,
  type BunnyConfig,
} from "./bunny";
export {
  CDN_DOWN_SINCE_KEY,
  FALLBACK_VIDEO_CAP_MS,
  ORIGIN_PAGE_MAX_AGE_S,
  currentDeliveryMode,
  deliveryMode,
  readCdnDownSince,
  resolveMediaUrl,
  type DeliveryMode,
} from "./mode";
export { ORIGIN_LINK_TTL_S } from "./origin";
// mediaAllowancesFor takes the superuser client: internal (alerts / staff report reach it via
// mediaUsageByOrg), never exported (invariant 1, 10-33).
export { mediaAllowance } from "./allowance";
export {
  AllowanceExceeded,
  MEDIA_ALLOWANCE_BYTES,
  USAGE_COPY,
  USAGE_WARN_RATIO,
  assertAllowance,
  checkAllowance,
  formatGb,
  mediaUsage,
  mediaUsageByOrg,
  usageLabel,
  usageLevel,
  type MediaUsage,
  type UsageLevel,
} from "./usage";
