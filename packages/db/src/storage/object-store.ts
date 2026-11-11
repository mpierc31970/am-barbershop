// Object storage port (TEN-12, D171, D187). Snapshots, page versions, add-on backups and
// tenant exports are JSON objects here, never database rows. Two implementations: the
// LocalDiskStore stand-in (default, .storage/) and S3Store for Wasabi, selected only when
// WASABI_* is set (GO-LIVE "Wasabi" row).
import { InvalidInput } from "@cds/core";

export type StoredObject = { key: string; lastModified: Date };

export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ): Promise<void>;
  /** The object's bytes, or null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Every object whose key starts with `prefix`, sorted by key. */
  list(prefix: string): Promise<StoredObject[]>;
  /** Idempotent: deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Upload a file from local disk without reading it into memory (11-40, Pitfall 14): S3
   * multipart in parts, local disk a file copy. Optional so plain fakes keep compiling.
   */
  putFile?(key: string, path: string, contentType?: string): Promise<void>;
}

export type ObjectStat = { size: number; lastModified: Date };

/** Inclusive byte range, already resolved against the object size (07-09). */
export type ByteRange = { start: number; end: number };

export type RangedRead = {
  stream: ReadableStream<Uint8Array>;
  /** Total object size, not the range length. */
  size: number;
  start: number;
  end: number;
};

/**
 * An ObjectStore that can stat and stream byte ranges (07-09, CONT-19: video Range/206).
 * A sub-interface so plain ObjectStore fakes keep compiling. `readRange(key, null)` streams
 * the whole object; a range past the end is the caller's bug and throws InvalidInput.
 */
export interface RangedObjectStore extends ObjectStore {
  stat(key: string): Promise<ObjectStat | null>;
  readRange(key: string, range: ByteRange | null): Promise<RangedRead | null>;
}

/**
 * P9 (AGR-04): write-once create for signed agreements; never overwrites. A sub-interface
 * so plain ObjectStore fakes keep compiling. Resolves "created" when this call wrote the
 * object, "exists" when the key was already present (its bytes are left untouched).
 */
export interface WriteOnceObjectStore extends ObjectStore {
  putIfAbsent(
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ): Promise<"created" | "exists">;
}

const KEY_RE = /^[a-z0-9][a-z0-9._\-/]*$/i;

/** Rejects anything that could escape the bucket/root (T-02-25). */
export function assertValidKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 512 ||
    !KEY_RE.test(key) ||
    key.includes("..") ||
    key.includes("\\") ||
    key.startsWith("/") ||
    key.includes("//")
  ) {
    throw new InvalidInput("invalid object key");
  }
}

/** Prefixes may be empty or end in "/"; otherwise the key rules apply. */
export function assertValidPrefix(prefix: string): void {
  if (prefix === "") return;
  assertValidKey(prefix);
}

export function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}
