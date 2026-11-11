// 07-13: the video and captions hub routes (CONT-18, CONT-19; RESEARCH Pitfall 1). The real
// session module runs against mocked next/headers; @cds/db is the real package with the
// chunk and video functions mocked (the media-library-routes.test.ts pattern).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  startChunkedUpload: vi.fn(),
  appendChunk: vi.fn(),
  finishChunkedUpload: vi.fn(),
  abortChunkedUpload: vi.fn(),
  createVideoFromUpload: vi.fn(),
  uploadVideoCaptions: vi.fn(),
  removeVideoCaptions: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const {
  AllowanceExceeded,
  CHUNK_LIMITS,
  CHUNK_PART_BYTES,
  TranscoderUnavailable,
  UPLOAD_COPY,
  UploadRejected,
  USAGE_COPY,
  VIDEO_COPY,
  VTT_MAX_BYTES,
} = await import("@cds/db");
const { NotFound } = await import("@cds/core");
const video = await import("../app/(platform)/hub/api/media/video/route");
const captions = await import("../app/(platform)/hub/api/media/captions/route");
const { nextInvalidator } = await import("../lib/invalidator");

const CTX = { orgId: "org1", actor: "u1", role: "editor", grants: [] };
const HOST = "cds.needtobeedgy.com";
const UPLOAD_ID = "abcdefghij12345";
const ASSET = "vvvvvvvvvvvvvv1";
const MB = 1024 * 1024;

function req(
  path: string,
  method: string,
  query = "",
  body?: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://${HOST}/hub/api/media/${path}${query}`, {
    method,
    ...(body !== undefined ? { body } : {}),
    headers: { host: HOST, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "editor@palm.example",
    organizations: [{ id: "org1", name: "Palm", primaryHost: null }],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
});

describe("/hub/api/media/video", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(video.runtime).toBe("nodejs");
    expect(video.dynamic).toBe("force-dynamic");
  });

  it("POST starts a video upload", async () => {
    db.startChunkedUpload.mockResolvedValue({
      uploadId: UPLOAD_ID,
      partBytes: CHUNK_PART_BYTES,
      parts: 13,
    });
    const res = await video.POST(
      req(
        "video",
        "POST",
        "",
        JSON.stringify({ size: 100 * MB, filename: "tour.mp4" }),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId: UPLOAD_ID,
      partBytes: CHUNK_PART_BYTES,
      parts: 13,
    });
    expect(db.startChunkedUpload).toHaveBeenCalledWith(CTX, {
      purpose: "video",
      size: 100 * MB,
      filename: "tour.mp4",
    });
  });

  it("a 300 MB start is 413 with UPL-VIDEO-TOO-BIG", async () => {
    const copy = CHUNK_LIMITS.video.tooBig(300 * MB);
    db.startChunkedUpload.mockRejectedValue(
      new UploadRejected("too_big", copy),
    );
    const res = await video.POST(
      req("video", "POST", "", JSON.stringify({ size: 300 * MB })),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: copy, reason: "too_big" });
  });

  it("PUT refuses a declared part over 8 MiB before reading the body", async () => {
    const r = req("video", "PUT", `?upload=${UPLOAD_ID}&part=0`, "x", {
      "content-length": String(CHUNK_PART_BYTES + 64 * 1024),
    });
    const read = vi.fn();
    Object.defineProperty(r, "arrayBuffer", { value: read });
    const res = await video.PUT(r);
    expect(res.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(db.appendChunk).not.toHaveBeenCalled();
  });

  it("PUT with a non-digit part is 400; a valid part appends", async () => {
    const bad = await video.PUT(
      req("video", "PUT", `?upload=${UPLOAD_ID}&part=1a`, "x"),
    );
    expect(bad.status).toBe(400);
    db.appendChunk.mockResolvedValue({ received: 3, parts: 1 });
    const ok = await video.PUT(
      req(
        "video",
        "PUT",
        `?upload=${UPLOAD_ID}&part=0`,
        new Uint8Array([1, 2, 3]),
      ),
    );
    expect(ok.status).toBe(200);
    expect(db.appendChunk).toHaveBeenCalledWith(
      CTX,
      UPLOAD_ID,
      0,
      expect.any(Uint8Array),
    );
  });

  it("POST complete=1 creates the video and returns its state", async () => {
    const finished = { uploadId: UPLOAD_ID, purpose: "video", path: "/tmp/x" };
    db.finishChunkedUpload.mockResolvedValue(finished);
    db.createVideoFromUpload.mockResolvedValue({
      asset: { id: ASSET },
      state: "waiting",
    });
    const res = await video.POST(
      req("video", "POST", `?upload=${UPLOAD_ID}&complete=1`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asset: { id: ASSET },
      state: "waiting",
    });
    expect(db.createVideoFromUpload).toHaveBeenCalledWith(CTX, finished);
  });

  it("maps UPL-VIDEO-TYPE to 400, a missing ffmpeg to 503 and the allowance to 413", async () => {
    db.finishChunkedUpload.mockResolvedValue({ uploadId: UPLOAD_ID });
    const complete = () =>
      video.POST(req("video", "POST", `?upload=${UPLOAD_ID}&complete=1`));

    db.createVideoFromUpload.mockRejectedValueOnce(
      new UploadRejected("type", VIDEO_COPY.type),
    );
    let res = await complete();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: VIDEO_COPY.type,
      reason: "type",
    });

    db.createVideoFromUpload.mockRejectedValueOnce(new TranscoderUnavailable());
    res = await complete();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: UPLOAD_COPY.failed,
      reason: "unavailable",
    });

    db.createVideoFromUpload.mockRejectedValueOnce(
      new AllowanceExceeded(2 * 1024 ** 3),
    );
    res = await complete();
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: USAGE_COPY.full(2 * 1024 ** 3),
      reason: "allowance",
    });
  });

  it("DELETE stops the upload with 204", async () => {
    db.abortChunkedUpload.mockResolvedValue(undefined);
    const res = await video.DELETE(
      req("video", "DELETE", `?upload=${UPLOAD_ID}`),
    );
    expect(res.status).toBe(204);
    expect(db.abortChunkedUpload).toHaveBeenCalledWith(CTX, UPLOAD_ID);
  });

  it("refuses cross-origin (403) and signed-out (401) requests", async () => {
    const res = await video.POST(
      req("video", "POST", "", "{}", { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(db.startChunkedUpload).not.toHaveBeenCalled();
    state.jar.clear();
    for (const r of [
      await video.POST(req("video", "POST", "", "{}")),
      await video.PUT(req("video", "PUT", `?upload=${UPLOAD_ID}&part=0`, "x")),
      await video.DELETE(req("video", "DELETE", `?upload=${UPLOAD_ID}`)),
    ]) {
      expect(r.status).toBe(401);
    }
  });
});

describe("/hub/api/media/captions", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(captions.runtime).toBe("nodejs");
    expect(captions.dynamic).toBe("force-dynamic");
  });

  it("PUT stores captions with the Next invalidator", async () => {
    db.uploadVideoCaptions.mockResolvedValue({ captions: "captions.vtt" });
    const res = await captions.PUT(
      req(
        "captions",
        "PUT",
        `?asset=${ASSET}`,
        "WEBVTT\n\n00:00.000 --> 00:01.000\nHi",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ captions: "captions.vtt" });
    expect(db.uploadVideoCaptions).toHaveBeenCalledWith(
      CTX,
      ASSET,
      expect.any(Uint8Array),
      { invalidator: nextInvalidator },
    );
  });

  it("refuses a declared length over 512 KB + 4 KB before reading, with UPL-CAPTIONS", async () => {
    const r = req("captions", "PUT", `?asset=${ASSET}`, "x", {
      "content-length": String(VTT_MAX_BYTES + 8 * 1024),
    });
    const read = vi.fn();
    Object.defineProperty(r, "arrayBuffer", { value: read });
    const res = await captions.PUT(r);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(VIDEO_COPY.captions);
    expect(read).not.toHaveBeenCalled();
    expect(db.uploadVideoCaptions).not.toHaveBeenCalled();
  });

  it("invalid VTT is 400 UPL-CAPTIONS; a foreign or malformed id is 404", async () => {
    db.uploadVideoCaptions.mockRejectedValueOnce(
      new UploadRejected("type", VIDEO_COPY.captions),
    );
    let res = await captions.PUT(
      req("captions", "PUT", `?asset=${ASSET}`, "nope"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(VIDEO_COPY.captions);

    db.uploadVideoCaptions.mockRejectedValueOnce(new NotFound());
    res = await captions.PUT(req("captions", "PUT", `?asset=${ASSET}`, "x"));
    expect(res.status).toBe(404);

    res = await captions.PUT(req("captions", "PUT", `?asset=../etc`, "x"));
    expect(res.status).toBe(404);
  });

  it("DELETE removes captions with 204; foreign is 404", async () => {
    db.removeVideoCaptions.mockResolvedValueOnce(undefined);
    let res = await captions.DELETE(
      req("captions", "DELETE", `?asset=${ASSET}`),
    );
    expect(res.status).toBe(204);
    expect(db.removeVideoCaptions).toHaveBeenCalledWith(CTX, ASSET, {
      invalidator: nextInvalidator,
    });
    db.removeVideoCaptions.mockRejectedValueOnce(new NotFound());
    res = await captions.DELETE(req("captions", "DELETE", `?asset=${ASSET}`));
    expect(res.status).toBe(404);
  });

  it("refuses cross-origin (403) and signed-out (401) requests", async () => {
    const res = await captions.PUT(
      req("captions", "PUT", `?asset=${ASSET}`, "x", {
        origin: "https://evil.example",
      }),
    );
    expect(res.status).toBe(403);
    state.jar.clear();
    expect(
      (await captions.PUT(req("captions", "PUT", `?asset=${ASSET}`, "x")))
        .status,
    ).toBe(401);
    expect(
      (await captions.DELETE(req("captions", "DELETE", `?asset=${ASSET}`)))
        .status,
    ).toBe(401);
  });
});
