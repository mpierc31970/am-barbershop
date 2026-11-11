// Object key layout (TEN-12, D171, D187). Everything tenant-owned sits under
// tenants/<org-id>/, platform DB backups under platform/db/. Anything but CDS_ENV=production
// writes under dev/ so a dev or test run can never touch production objects (T-02-27).
// Public media keys (07-09, CONT-33, D255): the public store only ever sees keys built here,
// and `assertPublicMediaKey` is the guard.
// site-part histories (07-29, D187): tenants/<org>/versions/site/<part>/
import { InvalidInput } from "@cds/core";
import type { PublicMediaKind, PublicMediaVariant } from "../media/ports";
import { assertValidKey, assertValidPrefix } from "./object-store";

const SEGMENT_RE = /^[a-z0-9_-]{1,64}$/;

function segment(value: string, what: string): string {
  if (typeof value !== "string" || !SEGMENT_RE.test(value)) {
    throw new InvalidInput(`invalid ${what}`);
  }
  return value;
}

function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

/**
 * Key prefix for CDS_ENV: unset or "dev" -> "dev/", "production" -> none. Any other value
 * (e.g. a typo like "prod") throws, so production data is never silently written under dev/
 * and dev data never lands in production keys (review IN-05).
 */
export function envPrefix(): string {
  const env = process.env.CDS_ENV;
  if (env === undefined || env === "" || env === "dev") return "dev/";
  if (env === "production") return "";
  throw new Error(
    `CDS_ENV must be "dev" or "production" (or unset for dev); got "${env}"`,
  );
}

export function tenantExportPrefix(orgId: string): string {
  return `${envPrefix()}tenants/${segment(orgId, "organization id")}/exports/`;
}

export function tenantExportKey(orgId: string, at: Date): string {
  return `${tenantExportPrefix(orgId)}${stamp(at)}.json`;
}

/** An Owner's "Download my data" zip (11-40, LIFE-04): tenants/<org>/exports/download-<ts>.zip. */
export function tenantDownloadKey(orgId: string, at: Date): string {
  return `${tenantExportPrefix(orgId)}download-${stamp(at)}.zip`;
}

/**
 * Signed agreements (09-02, AGR-04, AGR-05, D187): tenants/<org>/agreements/. Written only
 * through a WriteOnceObjectStore (`getAgreementStore().putIfAbsent`), never `put`.
 */
export function tenantAgreementPrefix(orgId: string): string {
  return `${envPrefix()}tenants/${segment(orgId, "organization id")}/agreements/`;
}

const AGREEMENT_EXTS = ["html", "json"] as const;

/** tenants/<org>/agreements/<signature-id>.<html|json>: the signed copy and its evidence. */
export function tenantAgreementKey(
  orgId: string,
  signatureId: string,
  ext: (typeof AGREEMENT_EXTS)[number],
): string {
  if (!(AGREEMENT_EXTS as readonly string[]).includes(ext)) {
    throw new InvalidInput("invalid agreement file extension");
  }
  return `${tenantAgreementPrefix(orgId)}${segment(signatureId, "signature id")}.${ext}`;
}

function tenantRoot(orgId: string): string {
  return `${envPrefix()}tenants/${segment(orgId, "organization id")}/`;
}

/** Page versions, written on publish (D184, D187, D254): tenants/<org>/versions/pages/<page>/. */
export function tenantVersionPrefix(orgId: string, pageId: string): string {
  return `${tenantRoot(orgId)}versions/pages/${segment(pageId, "page id")}/`;
}

export function tenantVersionKey(
  orgId: string,
  pageId: string,
  at: Date,
): string {
  return `${tenantVersionPrefix(orgId, pageId)}${stamp(at)}.json`;
}

/** The site parts with a history (07-29, CONT-36, D184). */
export const SITE_HISTORY_PARTS = [
  "nav",
  "footer",
  "banner",
  "settings",
] as const;
export type SiteHistoryPart = (typeof SITE_HISTORY_PARTS)[number];

/** One site part's versions (07-29, D187): tenants/<org>/versions/site/<part>/. */
export function tenantSitePartVersionPrefix(
  orgId: string,
  part: string,
): string {
  if (!(SITE_HISTORY_PARTS as readonly string[]).includes(part)) {
    throw new InvalidInput("invalid site part");
  }
  return `${tenantRoot(orgId)}versions/site/${segment(part, "site part")}/`;
}

export function tenantSitePartVersionKey(
  orgId: string,
  part: string,
  at: Date,
): string {
  return `${tenantSitePartVersionPrefix(orgId, part)}${stamp(at)}.json`;
}

/** The published JSON a visitor's page is served from (D187, D253). */
export function tenantPublishedPageKey(orgId: string, pageId: string): string {
  return `${tenantRoot(orgId)}published/pages/${segment(pageId, "page id")}.json`;
}

/** The published site manifest (page list, nav, banner, pop-ups) (D187, D253). */
export function tenantSiteManifestKey(orgId: string): string {
  return `${tenantRoot(orgId)}published/site.json`;
}

/**
 * The public site index (07-31, CONT-37, D277): sitemap.xml, robots.txt, llms.txt and
 * /search read only this file. Public fields only, excluded pages never written.
 */
export function tenantSiteIndexKey(orgId: string): string {
  return `${tenantRoot(orgId)}published/index.json`;
}

// DNS (14-13, DOM-05, D171, D187, P14-P24): the old zone's snapshot JSON and the zone file a
// handback gives the owner. Private store only.
const DNS_DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

/** tenants/<org>/dns/snapshots/ for one org's zone snapshots. */
export function tenantDnsSnapshotPrefix(orgId: string): string {
  return `${tenantRoot(orgId)}dns/snapshots/`;
}

/** tenants/<org>/dns/snapshots/<ISO>.json: one snapshot of the old zone (P14-P24). */
export function tenantDnsSnapshotKey(orgId: string, at: Date): string {
  return `${tenantDnsSnapshotPrefix(orgId)}${stamp(at)}.json`;
}

/** tenants/<org>/dns/handback/<domain>-<ISO>.txt: the BIND zone file handed back (LIFE-01). */
export function tenantDnsHandbackKey(
  orgId: string,
  domain: string,
  at: Date,
): string {
  if (typeof domain !== "string" || !DNS_DOMAIN_RE.test(domain)) {
    throw new InvalidInput("invalid domain");
  }
  return `${tenantRoot(orgId)}dns/handback/${domain}-${stamp(at)}.txt`;
}

/** One add-on's JSON backups (ADDON-14, D126, D187): tenants/<org>/backups/<add-on>/. */
export function tenantAddonBackupPrefix(orgId: string, addon: string): string {
  return `${tenantRoot(orgId)}backups/${segment(addon, "add-on")}/`;
}

export function tenantAddonBackupKey(
  orgId: string,
  addon: string,
  at: Date,
): string {
  return `${tenantAddonBackupPrefix(orgId, addon)}${stamp(at)}.json`;
}

const MAIL_TYPE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAIL_FILES = ["message.html", "message.txt", "headers.json"] as const;

function compactStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Dev copy of a logged-not-sent email (06-06, CONTEXT A5-Q3, PD-17):
 * `<env>mail/<yyyymmddThhmmssZ>-<type>/<file>`. Written only outside production.
 */
export function devMailKey(
  at: Date,
  type: string,
  file: (typeof MAIL_FILES)[number],
): string {
  if (
    typeof type !== "string" ||
    !MAIL_TYPE_RE.test(type) ||
    type.includes("..")
  ) {
    throw new InvalidInput("invalid email type");
  }
  if (!(MAIL_FILES as readonly string[]).includes(file)) {
    throw new InvalidInput("invalid mail file");
  }
  return `${envPrefix()}mail/${compactStamp(at)}-${type}/${file}`;
}

const MEDIA_VARIANTS = [
  "original.jpg",
  "original.png",
  "original.webp",
  "web.webp",
  "thumb.webp",
  // Private derivatives (07-12, resolution d): uploads write here; publish promotes them to
  // the public keys below.
  "w480.webp",
  "w960.webp",
  "w1600.webp",
  "video.mp4",
  "poster.jpg",
  "poster.webp",
  "captions.vtt",
  "audio.mp3",
  // kept video original until compression succeeds (07-13, D220)
  "original.mp4",
] as const;
export type MediaObjectName = (typeof MEDIA_VARIANTS)[number];

/** One uploaded image's variants (ONB-04, 06-13): tenants/<org>/media/<asset>/<variant>. */
export function tenantMediaKey(
  orgId: string,
  assetId: string,
  variant: MediaObjectName,
): string {
  if (!(MEDIA_VARIANTS as readonly string[]).includes(variant)) {
    throw new InvalidInput("invalid media variant");
  }
  return `${tenantRoot(orgId)}media/${segment(assetId, "asset id")}/${variant}`;
}

// Private derivatives (07-12, resolution d): uploads write here; publish promotes to the public
// keys below. The public `w2560` is the private `web.webp` and `thumb` is `thumb.webp`, so P6
// intake photos already fit. One segment fewer than a public key: never matches the guard.

/** The private object name holding a public variant's bytes. */
export function privateDerivativeName(
  variant: PublicMediaVariant,
): MediaObjectName {
  if (variant === "w2560") return "web.webp";
  if (variant === "thumb") return "thumb.webp";
  const name = /^w\d+$/.test(variant) ? `${variant}.webp` : variant;
  if (!(MEDIA_VARIANTS as readonly string[]).includes(name)) {
    throw new InvalidInput("invalid media variant");
  }
  return name as MediaObjectName;
}

/** tenants/<org>/media/<asset>/<private name> for one public variant (PRIVATE store only). */
export function tenantMediaDerivativeKey(
  orgId: string,
  assetId: string,
  variant: PublicMediaVariant,
): string {
  return tenantMediaKey(orgId, assetId, privateDerivativeName(variant));
}

export function platformDbPrefix(): string {
  return `${envPrefix()}platform/db/`;
}

// Catalog screenshots (13-20, STAFF-07, P13-P21): platform/catalog/<slug>/<id>.<ext> in the
// PRIVATE platform store (never the public CDN store, whose guard only admits tenant media).
// Served by the app; every segment goes through segment() (T-13-20-02).
export const CATALOG_SCREENSHOT_EXTS = ["png", "jpg", "webp"] as const;
export type CatalogScreenshotExt = (typeof CATALOG_SCREENSHOT_EXTS)[number];

/** platform/catalog/<slug>/ for one add-on's screenshots. */
export function platformCatalogPrefix(slug: string): string {
  return `${envPrefix()}platform/catalog/${segment(slug, "add-on")}/`;
}

/** platform/catalog/<slug>/<id>.<png|jpg|webp>; throws on any unsafe segment or extension. */
export function platformCatalogKey(
  slug: string,
  id: string,
  ext: string,
): string {
  if (!(CATALOG_SCREENSHOT_EXTS as readonly string[]).includes(ext)) {
    throw new InvalidInput("invalid screenshot extension");
  }
  return `${platformCatalogPrefix(slug)}${segment(id, "screenshot id")}.${ext}`;
}

// ---------------------------------------------------------------------------------------
// Public media keys (07-09, CONT-33, D255): the public store only ever sees keys built here,
// and `assertPublicMediaKey` is the guard. These live in a SEPARATE store/bucket from every
// key above (the CDN origin), so nothing private can be reached through the CDN.
//   tenants/<org>/media/{image,video,audio}/<asset-id>/<file>
//   tenants/<org>/media/site/{icon-32.png,icon-180.png,icon-512.png,share.png}
// ---------------------------------------------------------------------------------------

/** Pre-generated image widths; `?w=` snaps to the nearest one (D255). */
export const MEDIA_WIDTHS = [480, 960, 1600, 2560] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

export const PUBLIC_MEDIA_KINDS = [
  "image",
  "video",
  "audio",
] as const satisfies readonly PublicMediaKind[];

export const PUBLIC_MEDIA_VARIANTS = [
  "w480",
  "w960",
  "w1600",
  "w2560",
  "thumb",
  "video.mp4",
  "poster.jpg",
  "poster.webp",
  "captions.vtt",
  "audio.mp3",
] as const satisfies readonly PublicMediaVariant[];

// A variant added to the port without an entry above fails typecheck here.
type MissingVariants = Exclude<
  PublicMediaVariant,
  (typeof PUBLIC_MEDIA_VARIANTS)[number]
>;
const VARIANTS_EXHAUSTIVE: [MissingVariants] extends [never] ? true : never =
  true;
void VARIANTS_EXHAUSTIVE;

export const PUBLIC_VARIANTS_BY_KIND: Readonly<
  Record<PublicMediaKind, readonly PublicMediaVariant[]>
> = Object.freeze({
  image: Object.freeze(["w480", "w960", "w1600", "w2560", "thumb"] as const),
  video: Object.freeze([
    "video.mp4",
    "poster.jpg",
    "poster.webp",
    "thumb",
    "captions.vtt",
  ] as const),
  audio: Object.freeze(["audio.mp3"] as const),
});

export function isPublicMediaKind(v: unknown): v is PublicMediaKind {
  return (
    typeof v === "string" &&
    (PUBLIC_MEDIA_KINDS as readonly string[]).includes(v)
  );
}

export function isPublicMediaVariant(v: unknown): v is PublicMediaVariant {
  return (
    typeof v === "string" &&
    (PUBLIC_MEDIA_VARIANTS as readonly string[]).includes(v)
  );
}

export function publicVariantAllowed(kind: unknown, variant: unknown): boolean {
  return (
    isPublicMediaKind(kind) &&
    isPublicMediaVariant(variant) &&
    PUBLIC_VARIANTS_BY_KIND[kind].includes(variant)
  );
}

/** Object file name for a variant: `w*` and `thumb` are WebP, the rest keep their name. */
export function publicMediaObjectName(variant: PublicMediaVariant): string {
  if (!isPublicMediaVariant(variant)) {
    throw new InvalidInput("invalid media variant");
  }
  return variant === "thumb" || /^w\d+$/.test(variant)
    ? `${variant}.webp`
    : variant;
}

export function tenantPublicMediaPrefix(
  orgId: string,
  kind: PublicMediaKind,
  assetId: string,
): string {
  if (!isPublicMediaKind(kind)) throw new InvalidInput("invalid media kind");
  return `${tenantRoot(orgId)}media/${kind}/${segment(assetId, "asset id")}/`;
}

/** One public media object (PUBLIC store only): tenants/<org>/media/<kind>/<asset>/<file>. */
export function tenantPublicMediaKey(
  orgId: string,
  kind: PublicMediaKind,
  assetId: string,
  variant: PublicMediaVariant,
): string {
  if (!isPublicMediaKind(kind)) throw new InvalidInput("invalid media kind");
  if (!publicVariantAllowed(kind, variant)) {
    throw new InvalidInput("invalid media variant");
  }
  return `${tenantPublicMediaPrefix(orgId, kind, assetId)}${publicMediaObjectName(variant)}`;
}

export const SITE_ASSET_FILES = [
  "icon-32.png",
  "icon-180.png",
  "icon-512.png",
  "share.png",
  // 07-30: { v, source, generated_at } of the set above; written last, never served by /_site.
  "manifest.json",
] as const;
export type SiteAssetFile = (typeof SITE_ASSET_FILES)[number];

/** The favicon set and share image (written and served by 07-30): tenants/<org>/media/site/<file>. */
export function tenantPublicSiteAssetKey(
  orgId: string,
  file: SiteAssetFile,
): string {
  if (!(SITE_ASSET_FILES as readonly string[]).includes(file)) {
    throw new InvalidInput("invalid site asset");
  }
  return `${tenantRoot(orgId)}media/site/${file}`;
}

/** 07-30's names for the same allowlist and builder (site icons, share image, manifest). */
export const SITE_ASSET_NAMES = SITE_ASSET_FILES;

/** tenants/<org>/media/site/<name> (PUBLIC store); throws on a name outside the list. */
export function tenantSiteAssetKey(orgId: string, name: SiteAssetFile): string {
  return tenantPublicSiteAssetKey(orgId, name);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicKeyRe(): RegExp {
  const names = PUBLIC_MEDIA_VARIANTS.map((v) =>
    escapeRe(publicMediaObjectName(v)),
  ).join("|");
  const site = SITE_ASSET_FILES.map(escapeRe).join("|");
  return new RegExp(
    `^${escapeRe(envPrefix())}tenants/[a-z0-9_-]{1,64}/media/(?:(image|video|audio)/[a-z0-9_-]{1,64}/(${names})|site/(?:${site}))$`,
  );
}

/** True only for keys the two public builders can produce under the current CDS_ENV. */
export function isPublicMediaKey(key: string): boolean {
  try {
    assertPublicMediaKey(key);
    return true;
  } catch (err) {
    if (err instanceof InvalidInput) return false;
    throw err;
  }
}

/** The CONT-33 guard: throws unless `key` is a public media key (never versions/, exports/, ...). */
export function assertPublicMediaKey(key: string): void {
  assertValidKey(key);
  const m = publicKeyRe().exec(key);
  if (!m) throw new InvalidInput("not a public media key");
  const kind = m[1];
  const file = m[2];
  if (kind !== undefined) {
    const ok = PUBLIC_VARIANTS_BY_KIND[kind as PublicMediaKind].some(
      (v) => publicMediaObjectName(v) === file,
    );
    if (!ok) throw new InvalidInput("not a public media key");
  }
}

/** `list` prefixes on the public store must stay inside tenants/<org>/media/. */
export function assertPublicMediaPrefix(prefix: string): void {
  assertValidPrefix(prefix);
  const re = new RegExp(
    `^${escapeRe(envPrefix())}tenants/[a-z0-9_-]{1,64}/media/`,
  );
  if (!re.test(prefix)) throw new InvalidInput("not a public media prefix");
}

// ---------------------------------------------------------------------------------------
// Private form uploads (CONTEXT Area 3 Q3; Forms Pro ships the UI). PRIVATE store only, never
// the public store; every file passes the FileScanner (07-15) before it is written.
// ---------------------------------------------------------------------------------------

export const FORM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const FORM_UPLOAD_ORG_MAX_BYTES = 1024 ** 3;
const UPLOAD_EXT_RE = /^[a-z0-9]{1,8}$/;

export function tenantFormUploadPrefix(orgId: string): string {
  return `${tenantRoot(orgId)}forms/`;
}

/** tenants/<org>/forms/<form>/<submission>/<file>.<ext> in the private store. */
export function tenantFormUploadKey(
  orgId: string,
  formId: string,
  submissionId: string,
  fileId: string,
  ext: string,
): string {
  if (typeof ext !== "string" || !UPLOAD_EXT_RE.test(ext)) {
    throw new InvalidInput("invalid file extension");
  }
  return `${tenantFormUploadPrefix(orgId)}${segment(formId, "form id")}/${segment(submissionId, "submission id")}/${segment(fileId, "file id")}.${ext}`;
}

// ---------------------------------------------------------------------------------------
// Private support files (12-01; CONTEXT Area 2; P12-P1). PRIVATE store only, never the public
// store. Every segment goes through segment() and the extension through UPLOAD_EXT_RE, so a
// caller can never build a path outside tenants/<org>/support/ (T-12-01-04).
//   tenants/<org>/support/threads/<thread>/<message>/<file>.<ext>   ticket attachments
//   tenants/<org>/support/staging/<user>/<upload>.<ext>             uploaded, not yet sent
//   tenants/<org>/support/documents/<doc>.<ext>                     Documents from CDS
// ---------------------------------------------------------------------------------------

function uploadExt(ext: string): string {
  if (typeof ext !== "string" || !UPLOAD_EXT_RE.test(ext)) {
    throw new InvalidInput("invalid file extension");
  }
  return ext;
}

export function tenantSupportPrefix(orgId: string): string {
  return `${tenantRoot(orgId)}support/`;
}

/** tenants/<org>/support/threads/<thread>/<message>/<file>.<ext> in the private store. */
export function tenantSupportFileKey(
  orgId: string,
  threadId: string,
  messageId: string,
  fileId: string,
  ext: string,
): string {
  const e = uploadExt(ext);
  return `${tenantSupportPrefix(orgId)}threads/${segment(threadId, "thread id")}/${segment(messageId, "message id")}/${segment(fileId, "file id")}.${e}`;
}

/** tenants/<org>/support/staging/<user>/<upload>.<ext>: a file uploaded before Send. */
export function tenantSupportStagingKey(
  orgId: string,
  userId: string,
  uploadId: string,
  ext: string,
): string {
  const e = uploadExt(ext);
  return `${tenantSupportPrefix(orgId)}staging/${segment(userId, "user id")}/${segment(uploadId, "upload id")}.${e}`;
}

/** tenants/<org>/support/documents/<doc>.<ext>: a document CDS shared with the org. */
export function tenantCdsDocumentKey(
  orgId: string,
  docId: string,
  ext: string,
): string {
  const e = uploadExt(ext);
  return `${tenantSupportPrefix(orgId)}documents/${segment(docId, "document id")}.${e}`;
}
