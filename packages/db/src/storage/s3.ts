// Wasabi (S3-compatible) ObjectStore (TEN-12, D171, D187; GO-LIVE "Wasabi" row). Path-style
// URLs, SigV4 via aws4fetch (pinned 1.0.20 after the T-02-SC legitimacy gate). Credentials
// come from env only and never appear in logs or error messages (T-02-26).
import { createHash } from "node:crypto";
import { open, stat as fileStat } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
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
import { InvalidInput } from "@cds/core";

export type S3Config = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  /** Defaults to https://s3.<region>.wasabisys.com */
  endpoint?: string;
  /** Test seam: the fetch used for every request (defaults to global fetch). */
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 30_000;
/** Multipart part size (11-40): S3 needs >= 5 MiB for every part but the last. */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
/** One part upload may take longer than a small request. */
const PART_TIMEOUT_MS = 120_000;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1]!) : undefined;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export class S3Store implements RangedObjectStore, WriteOnceObjectStore {
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: S3Config) {
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: cfg.region,
      retries: 0,
    });
    const endpoint = (
      cfg.endpoint ?? `https://s3.${cfg.region}.wasabisys.com`
    ).replace(/\/+$/, "");
    this.base = `${endpoint}/${encodeURIComponent(cfg.bucket)}`;
    this.fetchImpl = cfg.fetch ?? ((input, init) => fetch(input, init));
  }

  private async send(
    method: string,
    url: string,
    body?: Uint8Array,
    contentType?: string,
    extra?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...extra };
    if (contentType) headers["content-type"] = contentType;
    const signed = await this.client.sign(url, {
      method,
      headers,
      body: body as BodyInit | undefined,
    });
    return this.fetchImpl(url, {
      method,
      headers: signed.headers,
      body: body as BodyInit | undefined,
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  private fail(op: string, status: number): never {
    throw new Error(`object store ${op} failed: HTTP ${status}`);
  }

  async put(
    key: string,
    body: Uint8Array | string,
    contentType = "application/json",
  ): Promise<void> {
    assertValidKey(key);
    const res = await this.send(
      "PUT",
      `${this.base}/${encodeKey(key)}`,
      toBytes(body),
      contentType,
    );
    if (!res.ok) this.fail("put", res.status);
  }

  /**
   * Upload a local file (11-40, Pitfall 14). Up to one part: a plain PUT. Larger: S3
   * multipart (CreateMultipartUpload, UploadPart in MULTIPART_PART_BYTES parts read one at a
   * time, CompleteMultipartUpload), so memory stays at one part. Any failure aborts the upload
   * (no orphaned parts are billed) and rethrows.
   */
  async putFile(
    key: string,
    path: string,
    contentType = "application/octet-stream",
  ): Promise<void> {
    assertValidKey(key);
    const size = (await fileStat(path)).size;
    const fh = await open(path, "r");
    try {
      if (size <= MULTIPART_PART_BYTES) {
        const buf = new Uint8Array(size);
        await fh.read(buf, 0, size, 0);
        await this.put(key, buf, contentType);
        return;
      }
      const url = `${this.base}/${encodeKey(key)}`;
      const created = await this.send(
        "POST",
        `${url}?uploads=`,
        undefined,
        contentType,
      );
      if (!created.ok) this.fail("putFile", created.status);
      const uploadId = tag(await created.text(), "UploadId");
      if (!uploadId) this.fail("putFile", created.status);
      const q = (extra: string) =>
        `${url}?${extra}uploadId=${encodeURIComponent(uploadId)}`;
      try {
        const etags: string[] = [];
        const buf = new Uint8Array(MULTIPART_PART_BYTES);
        for (
          let offset = 0, n = 1;
          offset < size;
          offset += MULTIPART_PART_BYTES, n++
        ) {
          const len = Math.min(MULTIPART_PART_BYTES, size - offset);
          const { bytesRead } = await fh.read(buf, 0, len, offset);
          if (bytesRead !== len)
            throw new Error("object store putFile: short read");
          const res = await this.send(
            "PUT",
            q(`partNumber=${n}&`),
            buf.subarray(0, len),
            undefined,
            undefined,
            AbortSignal.timeout(PART_TIMEOUT_MS),
          );
          if (!res.ok) this.fail("putFile part", res.status);
          const etag = res.headers.get("etag");
          if (!etag) this.fail("putFile part", res.status);
          etags.push(etag);
        }
        const body = `<CompleteMultipartUpload>${etags
          .map(
            (e, i) =>
              `<Part><PartNumber>${i + 1}</PartNumber><ETag>${xmlEscape(e)}</ETag></Part>`,
          )
          .join("")}</CompleteMultipartUpload>`;
        const done = await this.send(
          "POST",
          q(""),
          new TextEncoder().encode(body),
          "application/xml",
          undefined,
          AbortSignal.timeout(PART_TIMEOUT_MS),
        );
        // S3 can answer 200 with an <Error> body when completion fails late.
        const text = done.ok ? await done.text() : "";
        if (!done.ok || text.includes("<Error>")) {
          this.fail("putFile complete", done.status);
        }
      } catch (err) {
        await this.send("DELETE", q(""))
          .then((r) => r.body?.cancel())
          .catch(() => undefined);
        throw err;
      }
    } finally {
      await fh.close();
    }
  }

  /**
   * Write-once create (AGR-04, RESEARCH Pattern 4). HEAD first, because Wasabi's support
   * for `If-None-Match: *` on PUT is unverified (RESEARCH A1); the conditional PUT then
   * closes the race where the provider honours it (412 -> "exists"). Production immutability
   * comes from the dedicated Object Lock bucket (GO-LIVE), not from this check alone.
   */
  async putIfAbsent(
    key: string,
    body: Uint8Array | string,
    contentType = "application/json",
  ): Promise<"created" | "exists"> {
    assertValidKey(key);
    const url = `${this.base}/${encodeKey(key)}`;
    const head = await this.send("HEAD", url);
    if (head.ok) return "exists";
    if (head.status !== 404) this.fail("putIfAbsent", head.status);
    const bytes = toBytes(body);
    // S3 rejects a PUT into an Object Lock bucket with default retention unless it carries
    // an integrity header (Content-MD5, or x-amz-checksum-* on newer AWS). Whether Wasabi
    // enforces it is unverified (HUMAN-CHECKS), so it is always sent (WR-A04).
    const res = await this.send("PUT", url, bytes, contentType, {
      "if-none-match": "*",
      "content-md5": createHash("md5").update(bytes).digest("base64"),
    });
    if (res.status === 412) return "exists";
    if (!res.ok) this.fail("putIfAbsent", res.status);
    return "created";
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertValidKey(key);
    const res = await this.send("GET", `${this.base}/${encodeKey(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) this.fail("get", res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async list(prefix: string): Promise<StoredObject[]> {
    assertValidPrefix(prefix);
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const params = new URLSearchParams({ "list-type": "2", prefix });
      if (token) params.set("continuation-token", token);
      const res = await this.send("GET", `${this.base}?${params.toString()}`);
      if (!res.ok) this.fail("list", res.status);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = tag(m[1]!, "Key");
        const modified = tag(m[1]!, "LastModified");
        if (key) {
          out.push({ key, lastModified: new Date(modified ?? 0) });
        }
      }
      token =
        tag(xml, "IsTruncated") === "true"
          ? tag(xml, "NextContinuationToken")
          : undefined;
    } while (token);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    const res = await this.send("DELETE", `${this.base}/${encodeKey(key)}`);
    if (!res.ok && res.status !== 404) this.fail("delete", res.status);
  }

  async stat(key: string): Promise<ObjectStat | null> {
    assertValidKey(key);
    const res = await this.send("HEAD", `${this.base}/${encodeKey(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) this.fail("stat", res.status);
    const size = Number(res.headers.get("content-length") ?? "");
    if (!Number.isSafeInteger(size) || size < 0) this.fail("stat", res.status);
    const modified = res.headers.get("last-modified");
    return { size, lastModified: new Date(modified ?? 0) };
  }

  async readRange(
    key: string,
    range: ByteRange | null,
  ): Promise<RangedRead | null> {
    assertValidKey(key);
    if (
      range !== null &&
      (!Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.start > range.end)
    ) {
      throw new InvalidInput("invalid byte range");
    }
    // AbortSignal.timeout would also cut the body mid-stream (a long video), so the 30 s
    // limit covers only the wait for response headers and is cleared once they arrive.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.send(
        "GET",
        `${this.base}/${encodeKey(key)}`,
        undefined,
        undefined,
        range ? { range: `bytes=${range.start}-${range.end}` } : undefined,
        ctrl.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null;
    const expected = range ? 206 : 200;
    if (res.status !== expected) {
      await res.body?.cancel().catch(() => undefined);
      this.fail("readRange", res.status);
    }
    let size = Number.NaN;
    const cr = res.headers.get("content-range");
    const total = cr ? /\/(\d+)$/.exec(cr) : null;
    if (total) size = Number(total[1]);
    else size = Number(res.headers.get("content-length") ?? "");
    if (!Number.isSafeInteger(size) || size < 0) {
      await res.body?.cancel().catch(() => undefined);
      this.fail("readRange", res.status);
    }
    const stream =
      res.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    return {
      stream,
      size,
      start: range ? range.start : 0,
      end: range ? range.end : size - 1,
    };
  }
}
