// ObjectStore factory (TEN-12, D171, D187). Wasabi when the WASABI_* credentials are set
// (GO-LIVE "Wasabi" row); otherwise the local-disk stand-in under .storage/ at the repo root,
// or CDS_STORAGE_DIR. Misconfiguration fails loudly instead of silently falling back (WR-07):
//   - any WASABI_* set but not all of ACCESS_KEY_ID / SECRET_ACCESS_KEY / REGION -> throw
//   - Wasabi selected with CDS_ENV unset -> throw (it would decide dev/ vs production keys)
//
// Public media store (07-09, CONT-19, CONT-20, CONT-33, D255): a SECOND store, the CDN origin.
// Local disk under .storage-public/ (or CDS_PUBLIC_STORAGE_DIR) until WASABI_MEDIA_BUCKET is
// set, then its own Wasabi bucket. A partial config, the private bucket, the private folder,
// or production Wasabi without a media bucket throws. The returned store is guarded: every
// key must pass assertPublicMediaKey, so nothing private can ever be written or read there.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LocalDiskStore } from "./local-disk";
import {
  assertPublicMediaKey,
  assertPublicMediaPrefix,
  envPrefix,
} from "./keys";
import { S3Store } from "./s3";
import type {
  ObjectStore,
  RangedObjectStore,
  StoredObject,
  WriteOnceObjectStore,
} from "./object-store";

export type {
  ObjectStore,
  StoredObject,
  RangedObjectStore,
  WriteOnceObjectStore,
  ObjectStat,
  ByteRange,
  RangedRead,
} from "./object-store";
export { assertValidKey } from "./object-store";
export type {
  MediaObjectName,
  MediaWidth,
  SiteAssetFile,
  SiteHistoryPart,
} from "./keys";
export {
  MEDIA_WIDTHS,
  PUBLIC_MEDIA_KINDS,
  PUBLIC_MEDIA_VARIANTS,
  PUBLIC_VARIANTS_BY_KIND,
  SITE_ASSET_FILES,
  FORM_UPLOAD_MAX_BYTES,
  FORM_UPLOAD_ORG_MAX_BYTES,
  isPublicMediaKind,
  isPublicMediaVariant,
  isPublicMediaKey,
  publicVariantAllowed,
  publicMediaObjectName,
  tenantPublicMediaKey,
  tenantPublicMediaPrefix,
  tenantPublicSiteAssetKey,
  tenantSiteAssetKey,
  SITE_ASSET_NAMES,
  assertPublicMediaKey,
  assertPublicMediaPrefix,
  tenantFormUploadKey,
  tenantFormUploadPrefix,
  tenantSupportPrefix,
  tenantSupportFileKey,
  tenantSupportStagingKey,
  tenantCdsDocumentKey,
  SITE_HISTORY_PARTS,
  tenantSitePartVersionPrefix,
  tenantSitePartVersionKey,
} from "./keys";
export {
  devMailKey,
  tenantMediaKey,
  tenantMediaDerivativeKey,
  privateDerivativeName,
  envPrefix,
  platformDbPrefix,
  tenantAddonBackupKey,
  tenantAddonBackupPrefix,
  tenantExportKey,
  tenantExportPrefix,
  tenantDownloadKey,
  tenantAgreementKey,
  tenantAgreementPrefix,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantSiteIndexKey,
  tenantVersionKey,
  tenantVersionPrefix,
  tenantDnsSnapshotKey,
  tenantDnsSnapshotPrefix,
  tenantDnsHandbackKey,
} from "./keys";

/** Walks up from cwd to the monorepo root (the dir holding packages/db), else cwd. */
function repoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "packages", "db", "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const WASABI_REQUIRED = [
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
] as const;

type StoreChoice =
  { kind: "wasabi"; bucket: string } | { kind: "local"; dir: string };

/** Decide the store from env, throwing on a partial or ambiguous config (WR-07). */
function chooseStore(): StoreChoice {
  const env = process.env;
  envPrefix(); // throws on an unknown CDS_ENV before any store is used (IN-05)
  const anyWasabi = Object.keys(env).some(
    (k) => k.startsWith("WASABI_") && env[k],
  );
  if (anyWasabi) {
    const missing = WASABI_REQUIRED.filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `Wasabi is partly configured: set ${missing.join(", ")} (or unset every WASABI_* to use local disk)`,
      );
    }
    if (!env.CDS_ENV) {
      throw new Error(
        "CDS_ENV must be set when Wasabi is configured (dev or production)",
      );
    }
    return { kind: "wasabi", bucket: env.WASABI_BUCKET || "cds-platform" };
  }
  return { kind: "local", dir: privateLocalDir() };
}

function privateLocalDir(): string {
  return process.env.CDS_STORAGE_DIR ?? join(repoRoot(), ".storage");
}

function privateBucket(): string {
  return process.env.WASABI_BUCKET || "cds-platform";
}

export function getObjectStore(): ObjectStore {
  return getRangedObjectStore();
}

/** The private store with ranged reads (07-12: hub media and the tokenized fallback). */
export function getRangedObjectStore(): RangedObjectStore {
  const choice = chooseStore();
  if (choice.kind === "wasabi") {
    return new S3Store({
      accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
      secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
      region: process.env.WASABI_REGION!,
      bucket: choice.bucket,
    });
  }
  return new LocalDiskStore(choice.dir);
}

/**
 * The signed-agreements store (09-02, AGR-04, AGR-05, CONTEXT A2-Q3): write-once only.
 * Until WASABI_AGREEMENTS_BUCKET is set it is the private store (local disk or the private
 * Wasabi bucket). Production: a dedicated bucket created with versioning + Object Lock
 * (compliance, 7 years); Object Lock cannot be enabled on a prefix or an existing bucket
 * (RESEARCH Pitfall 1). Listed in GO-LIVE. A partial config, a bucket equal to the private
 * WASABI_BUCKET, or production Wasabi without WASABI_AGREEMENTS_BUCKET throws (WR-A03). With
 * the bucket set, reads fall back to the private bucket for copies written before it.
 */
export function getAgreementStore(): WriteOnceObjectStore {
  const env = process.env;
  envPrefix(); // unknown CDS_ENV throws first (IN-05)
  const bucket = env.WASABI_AGREEMENTS_BUCKET;
  if (!bucket) {
    const choice = chooseStore();
    // Production Wasabi must not silently write 7-year evidence to the mutable private
    // bucket (no Object Lock; WR-A03). Dev and the local-disk stand-in keep the fallback.
    if (choice.kind === "wasabi" && env.CDS_ENV === "production") {
      throw new Error(
        "set WASABI_AGREEMENTS_BUCKET: production signed agreements need their own Object Lock bucket, not the private WASABI_BUCKET (AGR-05)",
      );
    }
    return choice.kind === "wasabi"
      ? new S3Store({
          accessKeyId: env.WASABI_ACCESS_KEY_ID!,
          secretAccessKey: env.WASABI_SECRET_ACCESS_KEY!,
          region: env.WASABI_REGION!,
          bucket: choice.bucket,
        })
      : new LocalDiskStore(choice.dir);
  }
  const missing = WASABI_REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Wasabi agreements store is partly configured: set ${missing.join(", ")} (or unset WASABI_AGREEMENTS_BUCKET to use the private store)`,
    );
  }
  if (!env.CDS_ENV) {
    throw new Error(
      "CDS_ENV must be set when Wasabi is configured (dev or production)",
    );
  }
  if (bucket === privateBucket() || bucket === env.WASABI_MEDIA_BUCKET) {
    throw new Error(
      "WASABI_AGREEMENTS_BUCKET must be its own bucket (Object Lock), not WASABI_BUCKET or WASABI_MEDIA_BUCKET",
    );
  }
  const locked = new S3Store({
    accessKeyId: env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: env.WASABI_SECRET_ACCESS_KEY!,
    region: env.WASABI_REGION!,
    bucket,
  });
  const legacy = new S3Store({
    accessKeyId: env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: env.WASABI_SECRET_ACCESS_KEY!,
    region: env.WASABI_REGION!,
    bucket: privateBucket(),
  });
  return new AgreementStoreWithLegacyReads(locked, legacy);
}

/**
 * The dedicated agreements bucket, with read-through to the private bucket for copies
 * written before WASABI_AGREEMENTS_BUCKET was set (dev used the private bucket; WR-A03).
 * Writes go to the locked bucket only; a delete (retention, past retain_until) clears both,
 * so a legacy copy is never orphaned. Verify still hash-checks whatever is read.
 */
class AgreementStoreWithLegacyReads implements WriteOnceObjectStore {
  private readonly locked: WriteOnceObjectStore;
  private readonly legacy: ObjectStore;

  constructor(locked: WriteOnceObjectStore, legacy: ObjectStore) {
    this.locked = locked;
    this.legacy = legacy;
  }

  put(
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ): Promise<void> {
    return this.locked.put(key, body, contentType);
  }

  putIfAbsent(
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ): Promise<"created" | "exists"> {
    return this.locked.putIfAbsent(key, body, contentType);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return (await this.locked.get(key)) ?? (await this.legacy.get(key));
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const seen = new Map<string, StoredObject>();
    for (const o of await this.legacy.list(prefix)) seen.set(o.key, o);
    for (const o of await this.locked.list(prefix)) seen.set(o.key, o);
    return [...seen.values()].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
  }

  async delete(key: string): Promise<void> {
    await this.locked.delete(key);
    await this.legacy.delete(key);
  }
}

/** One line naming the store and key prefix in use, never a secret (for CLI logs, WR-07). */
export function describeObjectStore(): string {
  const choice = chooseStore();
  const prefix = envPrefix() || "(none: production)";
  return choice.kind === "wasabi"
    ? `wasabi bucket ${choice.bucket} (${process.env.WASABI_REGION}), prefix ${prefix}`
    : `local disk ${choice.dir}, prefix ${prefix}`;
}

/** Decide the public media store (D255): its own bucket or its own folder, never shared. */
function choosePublicStore(): StoreChoice {
  const env = process.env;
  envPrefix(); // unknown CDS_ENV throws first (IN-05)
  const bucket = env.WASABI_MEDIA_BUCKET;
  if (bucket) {
    const missing = WASABI_REQUIRED.filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `Wasabi public media is partly configured: set ${missing.join(", ")} (or unset WASABI_MEDIA_BUCKET to use local disk)`,
      );
    }
    if (!env.CDS_ENV) {
      throw new Error(
        "CDS_ENV must be set when Wasabi is configured (dev or production)",
      );
    }
    if (bucket === privateBucket()) {
      throw new Error(
        "WASABI_MEDIA_BUCKET must be its own bucket, not the private WASABI_BUCKET (D255)",
      );
    }
    return { kind: "wasabi", bucket };
  }
  const allCreds = WASABI_REQUIRED.every((k) => env[k]);
  if (allCreds && env.CDS_ENV === "production") {
    throw new Error(
      "set WASABI_MEDIA_BUCKET: production public media cannot live on the app's local disk",
    );
  }
  const dir = env.CDS_PUBLIC_STORAGE_DIR ?? join(repoRoot(), ".storage-public");
  if (resolve(dir) === resolve(privateLocalDir())) {
    throw new Error(
      "CDS_PUBLIC_STORAGE_DIR must differ from the private storage folder (D255)",
    );
  }
  return { kind: "local", dir };
}

/** Wraps a store so every key and prefix must be public media (CONT-33, choice 3). */
function guardPublicStore(inner: RangedObjectStore): RangedObjectStore {
  return {
    async put(key, body, contentType) {
      assertPublicMediaKey(key);
      return inner.put(key, body, contentType);
    },
    async get(key) {
      assertPublicMediaKey(key);
      return inner.get(key);
    },
    async stat(key) {
      assertPublicMediaKey(key);
      return inner.stat(key);
    },
    async readRange(key, range) {
      assertPublicMediaKey(key);
      return inner.readRange(key, range);
    },
    async delete(key) {
      assertPublicMediaKey(key);
      return inner.delete(key);
    },
    async list(prefix) {
      assertPublicMediaPrefix(prefix);
      return inner.list(prefix);
    },
  };
}

/** The public media store (CDN origin). Refuses every key that is not public media. */
export function getPublicMediaStore(): RangedObjectStore {
  const choice = choosePublicStore();
  const inner: RangedObjectStore =
    choice.kind === "wasabi"
      ? new S3Store({
          accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
          secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
          region: process.env.WASABI_REGION!,
          bucket: choice.bucket,
        })
      : new LocalDiskStore(choice.dir);
  return guardPublicStore(inner);
}

/** One line naming the public media store and prefix, never a secret. */
export function describePublicMediaStore(): string {
  const choice = choosePublicStore();
  const prefix = envPrefix() || "(none: production)";
  return choice.kind === "wasabi"
    ? `public media: wasabi bucket ${choice.bucket} (${process.env.WASABI_REGION}), prefix ${prefix}`
    : `public media: local disk ${choice.dir}, prefix ${prefix}`;
}
