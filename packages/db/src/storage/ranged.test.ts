// Ranged reads on both object stores (07-09, CONT-19: video Range/206).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInput } from "@cds/core";
import { LocalDiskStore } from "./local-disk";
import { S3Store } from "./s3";

async function bytes(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

describe("LocalDiskStore ranged reads", () => {
  let dir: string;
  let store: LocalDiskStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cds-ranged-"));
    store = new LocalDiskStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("stats an object or returns null", async () => {
    await store.put("a/x.bin", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const st = await store.stat("a/x.bin");
    expect(st?.size).toBe(10);
    expect(st?.lastModified).toBeInstanceOf(Date);
    expect(await store.stat("a/missing.bin")).toBeNull();
    expect(await store.stat("a")).toBeNull(); // a directory is not an object
  });

  it("streams exactly the requested bytes, or the whole object", async () => {
    await store.put("a/x.bin", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const r = await store.readRange("a/x.bin", { start: 2, end: 5 });
    expect(r).not.toBeNull();
    expect(r!.size).toBe(10);
    expect([r!.start, r!.end]).toEqual([2, 5]);
    expect(await bytes(r!.stream)).toEqual([2, 3, 4, 5]);
    const all = await store.readRange("a/x.bin", null);
    expect(await bytes(all!.stream)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([all!.start, all!.end]).toEqual([0, 9]);
  });

  it("handles empty files, missing keys, bad ranges and bad keys", async () => {
    await store.put("a/empty.bin", new Uint8Array());
    const e = await store.readRange("a/empty.bin", null);
    expect(e!.size).toBe(0);
    expect([e!.start, e!.end]).toEqual([0, -1]);
    expect(await bytes(e!.stream)).toEqual([]);
    expect(await store.readRange("a/none.bin", null)).toBeNull();
    await store.put("a/x.bin", "0123456789");
    await expect(
      store.readRange("a/x.bin", { start: 5, end: 10 }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      store.readRange("a/x.bin", { start: 6, end: 5 }),
    ).rejects.toThrow(InvalidInput);
    await expect(store.readRange("../x", null)).rejects.toThrow(InvalidInput);
    await expect(store.stat("../x")).rejects.toThrow(InvalidInput);
  });
});

describe("S3Store ranged reads (mocked fetch)", () => {
  const cfg = {
    accessKeyId: "AKIDTEST",
    secretAccessKey: "supersecretvalue",
    region: "us-east-1",
    bucket: "cds-platform-media",
  };
  afterEach(() => vi.unstubAllGlobals());

  it("stat: signed HEAD, reads content-length and last-modified, 404 null", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "1000",
            "last-modified": "Mon, 05 Oct 2026 04:10:00 GMT",
          },
        });
      }),
    );
    const st = await new S3Store(cfg).stat(
      "dev/tenants/a/media/video/v/video.mp4",
    );
    expect(st?.size).toBe(1000);
    expect(st?.lastModified.toISOString()).toBe("2026-10-05T04:10:00.000Z");
    expect(calls[0]!.init.method).toBe("HEAD");
    expect(calls[0]!.url).toBe(
      "https://s3.us-east-1.wasabisys.com/cds-platform-media/dev/tenants/a/media/video/v/video.mp4",
    );
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await new S3Store(cfg).stat("x/y")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const err = await new S3Store(cfg).stat("x/y").catch((e) => e);
    expect(String(err.message)).toContain("403");
    expect(String(err.message)).not.toContain("supersecretvalue");
  });

  it("readRange: signed GET with a range header, 206 and content-range total", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(new Uint8Array([2, 3, 4, 5]), {
          status: 206,
          headers: { "content-range": "bytes 2-5/10", "content-length": "4" },
        });
      }),
    );
    const r = await new S3Store(cfg).readRange("x/y.mp4", { start: 2, end: 5 });
    const headers = new Headers(calls[0]!.init.headers);
    expect(calls[0]!.init.method).toBe("GET");
    expect(headers.get("range")).toBe("bytes=2-5");
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(r!.size).toBe(10);
    expect([r!.start, r!.end]).toEqual([2, 5]);
    expect(await bytes(r!.stream)).toEqual([2, 3, 4, 5]);
  });

  it("readRange: null range takes 200 with content-length", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-length": "3" },
        });
      }),
    );
    const r = await new S3Store(cfg).readRange("x/y.mp4", null);
    expect(new Headers(calls[0]!.headers).get("range")).toBeNull();
    expect(r!.size).toBe(3);
    expect([r!.start, r!.end]).toEqual([0, 2]);
    expect(await bytes(r!.stream)).toEqual([1, 2, 3]);
  });

  it("readRange: 404 null, wrong status throws with the status only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(await new S3Store(cfg).readRange("x/y", null)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("all", { status: 200 })),
    );
    const err = await new S3Store(cfg)
      .readRange("x/y", { start: 0, end: 1 })
      .catch((e) => e);
    expect(String(err.message)).toContain("200");
    expect(String(err.message)).not.toContain("AKIDTEST");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const err2 = await new S3Store(cfg).readRange("x/y", null).catch((e) => e);
    expect(String(err2.message)).toContain("500");
  });

  it("validates keys and ranges before any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(new S3Store(cfg).readRange("../x", null)).rejects.toThrow(
      InvalidInput,
    );
    await expect(new S3Store(cfg).stat("../x")).rejects.toThrow(InvalidInput);
    await expect(
      new S3Store(cfg).readRange("x/y", { start: 5, end: 2 }),
    ).rejects.toThrow(InvalidInput);
    expect(f).not.toHaveBeenCalled();
  });
});
