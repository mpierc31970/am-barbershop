// 07-17 Task 1: the browser uploader (RESEARCH Pitfall 1; 07-12/07-13 chunk protocol). A fake
// XMLHttpRequest records every request; no request leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPL_COPY } from "../ImageUpload";
import { MEDIA_COPY, videoTooBigCopy } from "./copy";
import { checkMediaFile, uploadChunkedFile, uploadImageFile } from "./upload";
import { AbortError, NetworkError, sendXhr } from "./xhr";

type Handler = (x: FakeXHR) => void;

class FakeXHR {
  static all: FakeXHR[] = [];
  /** Decides each request's fate when it is sent. Default: 200 {}. */
  static handler: Handler = (x) => x.respond(200, {});
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = "";
  aborted = false;
  upload: {
    onprogress: ((e: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
    FakeXHR.all.push(this);
    const h = FakeXHR.handler;
    queueMicrotask(() => h(this));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent);
  }
  respond(status: number, body: unknown) {
    this.upload.onload?.();
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

const MB = 1024 * 1024;
const PART = 8 * MB;
const ID = "abcdefghij12345";

function file(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(Math.min(size, 64))], name, { type });
  Object.defineProperty(f, "size", { value: size });
  Object.defineProperty(f, "slice", {
    value: (from: number, to: number) => {
      const b = new Blob([new Uint8Array(1)]);
      Object.defineProperty(b, "size", { value: to - from });
      Object.defineProperty(b, "from", { value: from });
      return b;
    },
  });
  return f;
}

beforeEach(() => {
  FakeXHR.all = [];
  FakeXHR.handler = (x) => x.respond(200, {});
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkMediaFile", () => {
  it("accepts photos, MP4 and MP3 within their limits", () => {
    expect(checkMediaFile(file("a.jpg", "image/jpeg", MB))).toEqual({
      kind: "image",
    });
    expect(checkMediaFile(file("a.webp", "", MB))).toEqual({ kind: "image" });
    expect(checkMediaFile(file("t.mp4", "video/mp4", 200 * MB))).toEqual({
      kind: "video",
    });
    expect(checkMediaFile(file("s.mp3", "audio/mpeg", 40 * MB))).toEqual({
      kind: "audio",
    });
    expect(checkMediaFile(file("s.MP3", "", 4 * MB))).toEqual({
      kind: "audio",
    });
  });

  it("refuses files over their limit with the kind's copy", () => {
    expect(checkMediaFile(file("a.jpg", "image/jpeg", 34 * MB))).toEqual({
      error: UPL_COPY.tooBig(34 * MB),
    });
    expect(checkMediaFile(file("t.mp4", "video/mp4", 412 * MB))).toEqual({
      error: videoTooBigCopy(412 * MB),
    });
    expect(checkMediaFile(file("s.mp3", "audio/mpeg", 51 * MB))).toEqual({
      error: MEDIA_COPY.audio,
    });
  });

  it("refuses MOV, HEIC, other types and empty files", () => {
    expect(checkMediaFile(file("c.mov", "video/quicktime", MB))).toEqual({
      error: MEDIA_COPY.videoType,
    });
    expect(checkMediaFile(file("i.heic", "image/heic", MB))).toEqual({
      error: UPL_COPY.heic,
    });
    expect(checkMediaFile(file("d.pdf", "application/pdf", MB))).toEqual({
      error: UPL_COPY.type,
    });
    expect(checkMediaFile(file("a.jpg", "image/jpeg", 0))).toEqual({
      error: UPL_COPY.failed,
    });
  });
});

describe("sendXhr", () => {
  it("resolves status and parsed JSON; bad JSON is {}", async () => {
    FakeXHR.handler = (x) => {
      x.status = 200;
      x.responseText = "not json";
      x.onload?.();
    };
    await expect(sendXhr({ method: "GET", url: "/x" })).resolves.toEqual({
      status: 200,
      json: {},
    });
  });

  it("rejects AbortError on abort and NetworkError on a network failure", async () => {
    FakeXHR.handler = () => {};
    const ctl = new AbortController();
    const p = sendXhr({ method: "GET", url: "/x", signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(FakeXHR.all[0]!.aborted).toBe(true);
    FakeXHR.handler = (x) => x.fail();
    await expect(sendXhr({ method: "GET", url: "/y" })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

describe("uploadImageFile", () => {
  it("posts one multipart library photo and returns the asset id", async () => {
    const seen: number[] = [];
    FakeXHR.handler = (x) => {
      x.progress(50, 100);
      x.progress(100, 100);
      x.respond(200, { asset: { id: "m1" } });
    };
    const res = await uploadImageFile(file("IMG_1.jpg", "image/jpeg", MB), {
      onProgress: (f) => seen.push(f),
    });
    expect(res).toEqual({ ok: true, assetId: "m1" });
    const x = FakeXHR.all[0]!;
    expect(x.method).toBe("POST");
    expect(x.url).toBe("/hub/api/media");
    const body = x.body as FormData;
    expect(body.get("kind")).toBe("library");
    expect(body.get("alt")).toBe("");
    expect(body.get("filename")).toBe("IMG_1.jpg");
    expect(seen).toContain(0.5);
    expect(seen.at(-1)).toBe(1);
  });

  it("413 allowance shows the server sentence; 401 the session copy", async () => {
    FakeXHR.handler = (x) =>
      x.respond(413, { error: MEDIA_COPY.usageFull, reason: "allowance" });
    expect(await uploadImageFile(file("a.jpg", "image/jpeg", MB))).toEqual({
      ok: false,
      message: MEDIA_COPY.usageFull,
    });
    FakeXHR.handler = (x) => x.respond(401, { error: "signed_out" });
    expect(await uploadImageFile(file("a.jpg", "image/jpeg", MB))).toEqual({
      ok: false,
      message: MEDIA_COPY.signedOut,
    });
  });

  it("other failures show UPL-FAILED", async () => {
    FakeXHR.handler = (x) => x.respond(500, {});
    expect(await uploadImageFile(file("a.jpg", "image/jpeg", MB))).toEqual({
      ok: false,
      message: UPL_COPY.failed,
    });
    FakeXHR.handler = (x) => x.fail();
    expect(await uploadImageFile(file("a.jpg", "image/jpeg", MB))).toEqual({
      ok: false,
      message: UPL_COPY.failed,
    });
  });
});

/** A protocol-following server: start, parts, complete. `onPut` may override a part. */
function chunkServer(
  size: number,
  opts: { onPut?: (x: FakeXHR, part: number, tries: number) => boolean } = {},
) {
  const tries = new Map<number, number>();
  FakeXHR.handler = (x) => {
    const u = new URL(x.url, "https://h");
    if (x.method === "POST" && !u.searchParams.has("upload")) {
      x.respond(200, {
        uploadId: ID,
        partBytes: PART,
        parts: Math.ceil(size / PART),
      });
      return;
    }
    if (x.method === "PUT") {
      const n = Number(u.searchParams.get("part"));
      const t = (tries.get(n) ?? 0) + 1;
      tries.set(n, t);
      if (opts.onPut && opts.onPut(x, n, t)) return;
      const len = (x.body as Blob).size;
      x.progress(len / 2, len);
      x.progress(len, len);
      x.respond(200, { received: n + 1 });
      return;
    }
    if (x.method === "POST") {
      x.respond(200, { asset: { id: "v1" }, state: "waiting" });
      return;
    }
    x.respond(204, {});
  };
}

describe("uploadChunkedFile", () => {
  it("runs start, every part in ≤ 8 MiB slices, then complete", async () => {
    const size = 20 * MB + 5;
    chunkServer(size);
    const seen: number[] = [];
    const res = await uploadChunkedFile(
      file("Tour.mp4", "video/mp4", size),
      "video",
      {
        onProgress: (f) => seen.push(f),
      },
    );
    expect(res).toEqual({ ok: true, assetId: "v1", state: "waiting" });
    const [start, ...rest] = FakeXHR.all;
    expect(start!.method).toBe("POST");
    expect(start!.url).toBe("/hub/api/media/video");
    expect(JSON.parse(start!.body as string)).toEqual({
      size,
      filename: "Tour.mp4",
    });
    const puts = rest.filter((x) => x.method === "PUT");
    expect(puts.map((x) => x.url)).toEqual([
      `/hub/api/media/video?upload=${ID}&part=0`,
      `/hub/api/media/video?upload=${ID}&part=1`,
      `/hub/api/media/video?upload=${ID}&part=2`,
    ]);
    expect(puts.map((x) => (x.body as Blob).size)).toEqual([
      PART,
      PART,
      4 * MB + 5,
    ]);
    expect(puts.every((x) => (x.body as Blob).size <= PART)).toBe(true);
    expect(rest.at(-1)!.url).toBe(
      `/hub/api/media/video?upload=${ID}&complete=1`,
    );
    // Monotonic, and 1 only once the last part is in.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    }
    expect(seen.filter((f) => f === 1)).toHaveLength(1);
    expect(seen.at(-1)).toBe(1);
  });

  it("audio uses the audio URL", async () => {
    chunkServer(4 * MB);
    const res = await uploadChunkedFile(
      file("s.mp3", "audio/mpeg", 4 * MB),
      "audio",
    );
    expect(res.ok).toBe(true);
    expect(FakeXHR.all[0]!.url).toBe("/hub/api/media/audio");
  });

  it("a network error on a part retries that part once", async () => {
    const size = 20 * MB;
    chunkServer(size, {
      onPut: (x, n, t) => {
        if (n === 2 && t === 1) {
          x.fail();
          return true;
        }
        return false;
      },
    });
    const res = await uploadChunkedFile(
      file("t.mp4", "video/mp4", size),
      "video",
    );
    expect(res.ok).toBe(true);
    const puts = FakeXHR.all.filter((x) => x.method === "PUT");
    expect(
      puts.map((x) => new URL(x.url, "https://h").searchParams.get("part")),
    ).toEqual(["0", "1", "2", "2"]);
  });

  it("a second failure gives UPL-FAILED and sends DELETE", async () => {
    const size = 20 * MB;
    chunkServer(size, {
      onPut: (x, n) => {
        if (n === 1) {
          x.fail();
          return true;
        }
        return false;
      },
    });
    const res = await uploadChunkedFile(
      file("t.mp4", "video/mp4", size),
      "video",
    );
    expect(res).toEqual({ ok: false, message: UPL_COPY.failed });
    await Promise.resolve();
    const del = FakeXHR.all.find((x) => x.method === "DELETE");
    expect(del?.url).toBe(`/hub/api/media/video?upload=${ID}`);
  });

  it("Stop mid-part aborts the request and sends DELETE", async () => {
    const size = 20 * MB;
    const ctl = new AbortController();
    chunkServer(size, {
      onPut: (_x, n) => {
        if (n === 1) {
          queueMicrotask(() => ctl.abort());
          return true;
        }
        return false;
      },
    });
    const res = await uploadChunkedFile(
      file("t.mp4", "video/mp4", size),
      "video",
      {
        signal: ctl.signal,
      },
    );
    expect(res).toEqual({ ok: false, message: "", aborted: true });
    const part1 = FakeXHR.all.find((x) => x.url.endsWith("part=1"));
    expect(part1?.aborted).toBe(true);
    expect(FakeXHR.all.some((x) => x.method === "DELETE")).toBe(true);
    expect(FakeXHR.all.some((x) => x.url.endsWith("part=2"))).toBe(false);
  });

  it("a 503 from video start or complete shows UPL-FAILED", async () => {
    FakeXHR.handler = (x) =>
      x.respond(503, { error: "x", reason: "unavailable" });
    expect(
      await uploadChunkedFile(file("t.mp4", "video/mp4", MB), "video"),
    ).toEqual({ ok: false, message: UPL_COPY.failed });
    chunkServer(MB);
    const inner = FakeXHR.handler;
    FakeXHR.handler = (x) =>
      x.url.includes("complete=1")
        ? x.respond(503, { reason: "unavailable" })
        : inner(x);
    expect(
      await uploadChunkedFile(file("t.mp4", "video/mp4", MB), "video"),
    ).toEqual({ ok: false, message: UPL_COPY.failed });
  });

  it("a 413 allowance at start returns the sentence and sends no part", async () => {
    FakeXHR.handler = (x) =>
      x.respond(413, { error: MEDIA_COPY.usageFull, reason: "allowance" });
    expect(
      await uploadChunkedFile(file("t.mp4", "video/mp4", 30 * MB), "video"),
    ).toEqual({ ok: false, message: MEDIA_COPY.usageFull });
    expect(FakeXHR.all.some((x) => x.method === "PUT")).toBe(false);
  });
});
