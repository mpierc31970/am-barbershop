// 11-40 choice 4: ObjectStore.putFile streams a local file into the store (Pitfall 14).
// S3/Wasabi: multipart (create, parts, complete; abort on failure). Local disk: file copy.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStore } from "./local-disk";
import { MULTIPART_PART_BYTES, S3Store } from "./s3";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cds-putfile-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Call = { method: string; url: string; bytes: number; body: string };

function fakeS3(opts: { failPart?: number } = {}) {
  const calls: Call[] = [];
  const fn = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const raw = init?.body as Uint8Array | undefined;
    const body = raw ? new TextDecoder().decode(raw.slice(0, 4096)) : "";
    calls.push({ method, url, bytes: raw?.length ?? 0, body });
    if (method === "POST" && url.includes("?uploads=")) {
      return new Response(
        "<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>",
        { status: 200 },
      );
    }
    const part = /partNumber=(\d+)/.exec(url);
    if (method === "PUT" && part) {
      if (Number(part[1]) === opts.failPart) {
        return new Response("", { status: 500 });
      }
      return new Response("", {
        status: 200,
        headers: { etag: `"etag-${part[1]}"` },
      });
    }
    if (method === "POST" && url.includes("uploadId=")) {
      return new Response("<CompleteMultipartUploadResult/>", { status: 200 });
    }
    if (method === "DELETE") return new Response("", { status: 204 });
    if (method === "PUT") return new Response("", { status: 200 });
    return new Response("", { status: 404 });
  };
  return { calls, fetch: fn as typeof fetch };
}

function store(f: typeof fetch): S3Store {
  return new S3Store({
    accessKeyId: "AKIAFAKE",
    secretAccessKey: "fake-secret",
    region: "us-east-1",
    bucket: "cds-test",
    endpoint: "https://s3.example.test",
    fetch: f,
  });
}

describe("S3Store.putFile", () => {
  it("does create, upload-part for each 8 MiB part, then complete", async () => {
    const path = join(dir, "big.zip");
    const size = MULTIPART_PART_BYTES * 2 + 1234;
    await writeFile(path, new Uint8Array(size).fill(7));
    const s3 = fakeS3();
    await store(s3.fetch).putFile(
      "dev/tenants/o/exports/download-x.zip",
      path,
      "application/zip",
    );
    const kinds = s3.calls.map((c) =>
      c.url.includes("?uploads=")
        ? "create"
        : /partNumber=/.test(c.url)
          ? `part${/partNumber=(\d+)/.exec(c.url)![1]}`
          : c.method === "POST"
            ? "complete"
            : c.method,
    );
    expect(kinds).toEqual(["create", "part1", "part2", "part3", "complete"]);
    expect(s3.calls.slice(1, 4).map((c) => c.bytes)).toEqual([
      MULTIPART_PART_BYTES,
      MULTIPART_PART_BYTES,
      1234,
    ]);
    for (const c of s3.calls.slice(1)) expect(c.url).toContain("uploadId=up-1");
    const complete = s3.calls[4]!.body;
    expect(complete).toContain(
      "<Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag></Part>",
    );
    expect(complete).toContain("<PartNumber>3</PartNumber>");
  });

  it("aborts the upload when a part fails, and rethrows", async () => {
    const path = join(dir, "big.zip");
    await writeFile(path, new Uint8Array(MULTIPART_PART_BYTES * 2 + 10));
    const s3 = fakeS3({ failPart: 2 });
    await expect(
      store(s3.fetch).putFile("dev/tenants/o/exports/download-x.zip", path),
    ).rejects.toThrow(/HTTP 500/);
    const last = s3.calls.at(-1)!;
    expect(last.method).toBe("DELETE");
    expect(last.url).toContain("uploadId=up-1");
    expect(
      s3.calls.some((c) => c.method === "POST" && !c.url.includes("uploads=")),
    ).toBe(false);
  });

  it("uses one plain PUT for a file up to one part", async () => {
    const path = join(dir, "small.zip");
    await writeFile(path, new Uint8Array(100).fill(1));
    const s3 = fakeS3();
    await store(s3.fetch).putFile("dev/tenants/o/exports/download-x.zip", path);
    expect(s3.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(s3.calls[0]!.bytes).toBe(100);
  });
});

describe("LocalDiskStore.putFile", () => {
  it("copies the file to the key", async () => {
    const root = join(dir, "root");
    const path = join(dir, "src.zip");
    await writeFile(path, "zipbytes");
    const local = new LocalDiskStore(root);
    await local.putFile("dev/tenants/o/exports/download-x.zip", path);
    expect(
      Buffer.from(
        (await local.get("dev/tenants/o/exports/download-x.zip"))!,
      ).toString(),
    ).toBe("zipbytes");
    expect(await readFile(path, "utf8")).toBe("zipbytes");
  });
});
