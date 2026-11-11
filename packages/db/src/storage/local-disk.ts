// Local-disk ObjectStore: the default stand-in until Wasabi credentials exist (TEN-12, D171;
// GO-LIVE "Wasabi" row). Keys map to files under a root directory (.storage/ by default).
// Writes are atomic (temp file + rename); every key is validated and the resolved path must
// stay inside the root (T-02-25).
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { InvalidInput } from "@cds/core";
import {
  assertValidKey,
  assertValidPrefix,
  toBytes,
  type ByteRange,
  type ObjectStat,
  type RangedObjectStore,
  type RangedRead,
  type WriteOnceObjectStore,
  type StoredObject,
} from "./object-store";

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "ENOENT" || err.code === "ENOTDIR")
  );
}

export class LocalDiskStore implements RangedObjectStore, WriteOnceObjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertValidKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) {
      throw new InvalidInput("invalid object key");
    }
    return full;
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(tmp, toBytes(body));
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /** Copies a local file in (11-40): temp copy + rename, so readers never see a partial file. */
  async putFile(key: string, path: string): Promise<void> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await copyFile(path, tmp);
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /**
   * Write-once create (AGR-04): the bytes go to a temp file, then a hard link claims the
   * final path atomically. EEXIST means another writer got there first -> "exists".
   */
  async putIfAbsent(
    key: string,
    body: Uint8Array | string,
  ): Promise<"created" | "exists"> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await writeFile(tmp, toBytes(body));
      await link(tmp, path);
      return "created";
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "EEXIST"
      ) {
        return "exists";
      }
      throw err;
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const path = this.pathFor(key);
    try {
      return new Uint8Array(await readFile(path));
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    assertValidPrefix(prefix);
    // Walk from the deepest directory the prefix names, then filter by the full prefix.
    const dirPart = prefix.includes("/")
      ? prefix.slice(0, prefix.lastIndexOf("/"))
      : "";
    const start = dirPart ? this.pathFor(dirPart) : this.root;
    const out: StoredObject[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !entry.name.includes(".tmp-")) {
          const key = relative(this.root, full).split(sep).join("/");
          if (key.startsWith(prefix)) {
            out.push({ key, lastModified: (await stat(full)).mtime });
          }
        }
      }
    };
    await walk(start);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async stat(key: string): Promise<ObjectStat | null> {
    const path = this.pathFor(key);
    try {
      const st = await stat(path);
      if (!st.isFile()) return null;
      return { size: st.size, lastModified: st.mtime };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async readRange(
    key: string,
    range: ByteRange | null,
  ): Promise<RangedRead | null> {
    const path = this.pathFor(key);
    const st = await this.stat(key);
    if (!st) return null;
    const { size } = st;
    if (range === null) {
      if (size === 0) {
        return {
          stream: new ReadableStream<Uint8Array>({
            start: (c) => c.close(),
          }),
          size,
          start: 0,
          end: -1,
        };
      }
      range = { start: 0, end: size - 1 };
    }
    const { start, end } = range;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      end >= size
    ) {
      throw new InvalidInput("invalid byte range");
    }
    const node = createReadStream(path, { start, end });
    const stream = Readable.toWeb(
      node,
    ) as unknown as ReadableStream<Uint8Array>;
    return { stream, size, start, end };
  }
}
