// 07-12: media library routes (CONT-19, CONT-27; RESEARCH Pitfall 1). The real session module
// runs against mocked next/headers; @cds/db is the real package with the library writers and
// readers mocked (the media-route.test.ts pattern).
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

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  uploadImage: vi.fn(),
  uploadLibraryImage: vi.fn(),
  uploadLibraryAudio: vi.fn(),
  startChunkedUpload: vi.fn(),
  appendChunk: vi.fn(),
  finishChunkedUpload: vi.fn(),
  abortChunkedUpload: vi.fn(),
  readMediaVariant: vi.fn(),
  openHubMediaObject: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const { AllowanceExceeded, USAGE_COPY, CHUNK_PART_BYTES } =
  await import("@cds/db");
const upload = await import("../app/(platform)/hub/api/media/route");
const audio = await import("../app/(platform)/hub/api/media/audio/route");

const CTX = { orgId: "org1", actor: "u1", role: "editor", grants: [] };
const HOST = "cds.needtobeedgy.com";
const UPLOAD_ID = "abcdefghij12345";

function form(fields: Record<string, string | Blob>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`https://${HOST}/hub/api/media`, {
    method: "POST",
    body: fd,
    headers: { host: HOST },
  });
}

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "IMG_1.png", {
    type: "image/png",
  });

function audioReq(
  method: string,
  query = "",
  body?: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://${HOST}/hub/api/media/audio${query}`, {
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

describe("POST /hub/api/media kind=library", () => {
  it("calls uploadLibraryImage with alt and filename", async () => {
    db.uploadLibraryImage.mockResolvedValue({
      asset: { id: "a1" },
      needsDescription: true,
    });
    const res = await upload.POST(form({ kind: "library", file: png() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asset: { id: "a1" },
      needsDescription: true,
    });
    expect(db.uploadLibraryImage).toHaveBeenCalledWith(
      CTX,
      expect.any(Uint8Array),
      { filename: "IMG_1.png" },
    );
    expect(db.uploadImage).not.toHaveBeenCalled();
  });

  it("intake kinds still call uploadImage", async () => {
    db.uploadImage.mockResolvedValue({ asset: { id: "a2" } });
    const res = await upload.POST(form({ kind: "hero", file: png() }));
    expect(res.status).toBe(200);
    expect(db.uploadImage).toHaveBeenCalled();
    expect(db.uploadLibraryImage).not.toHaveBeenCalled();
  });

  it("maps AllowanceExceeded to 413 with USAGE-FULL", async () => {
    db.uploadLibraryImage.mockRejectedValue(
      new AllowanceExceeded(2 * 1024 ** 3),
    );
    const res = await upload.POST(form({ kind: "library", file: png() }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: USAGE_COPY.full(2 * 1024 ** 3),
      reason: "allowance",
    });
  });
});

describe("/hub/api/media/audio", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(audio.runtime).toBe("nodejs");
    expect(audio.dynamic).toBe("force-dynamic");
  });

  it("POST starts an upload", async () => {
    db.startChunkedUpload.mockResolvedValue({
      uploadId: UPLOAD_ID,
      partBytes: CHUNK_PART_BYTES,
      parts: 3,
    });
    const res = await audio.POST(
      audioReq(
        "POST",
        "",
        JSON.stringify({ size: 20 * 1024 * 1024, filename: "song.mp3" }),
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId: UPLOAD_ID,
      partBytes: CHUNK_PART_BYTES,
      parts: 3,
    });
    expect(db.startChunkedUpload).toHaveBeenCalledWith(CTX, {
      purpose: "audio",
      size: 20 * 1024 * 1024,
      filename: "song.mp3",
    });
  });

  it("PUT refuses a declared part over 8 MiB before reading the body", async () => {
    const req = audioReq("PUT", `?upload=${UPLOAD_ID}&part=0`, "x", {
      "content-length": String(CHUNK_PART_BYTES + 64 * 1024),
    });
    const read = vi.fn();
    Object.defineProperty(req, "arrayBuffer", { value: read });
    const res = await audio.PUT(req);
    expect(res.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(db.appendChunk).not.toHaveBeenCalled();
  });

  it("PUT appends a part", async () => {
    db.appendChunk.mockResolvedValue({ received: 3, parts: 1 });
    const res = await audio.PUT(
      audioReq("PUT", `?upload=${UPLOAD_ID}&part=0`, new Uint8Array([1, 2, 3])),
    );
    expect(res.status).toBe(200);
    expect(db.appendChunk).toHaveBeenCalledWith(
      CTX,
      UPLOAD_ID,
      0,
      expect.any(Uint8Array),
    );
  });

  it("PUT without a valid upload id or part is 400", async () => {
    const res = await audio.PUT(audioReq("PUT", `?upload=../x&part=0`, "x"));
    expect(res.status).toBe(400);
    const res2 = await audio.PUT(
      audioReq("PUT", `?upload=${UPLOAD_ID}&part=-1`, "x"),
    );
    expect(res2.status).toBe(400);
  });

  it("POST complete=1 finishes and creates the asset", async () => {
    const finished = { uploadId: UPLOAD_ID, path: "/tmp/x" };
    db.finishChunkedUpload.mockResolvedValue(finished);
    db.uploadLibraryAudio.mockResolvedValue({ asset: { id: "au1" } });
    const res = await audio.POST(
      audioReq("POST", `?upload=${UPLOAD_ID}&complete=1`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asset: { id: "au1" } });
    expect(db.uploadLibraryAudio).toHaveBeenCalledWith(CTX, finished);
  });

  it("DELETE stops the upload with 204", async () => {
    db.abortChunkedUpload.mockResolvedValue(undefined);
    const res = await audio.DELETE(audioReq("DELETE", `?upload=${UPLOAD_ID}`));
    expect(res.status).toBe(204);
    expect(db.abortChunkedUpload).toHaveBeenCalledWith(CTX, UPLOAD_ID);
  });

  it("refuses a cross-origin request with 403", async () => {
    const res = await audio.POST(
      audioReq("POST", "", "{}", { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(db.startChunkedUpload).not.toHaveBeenCalled();
  });

  it("401 when signed out", async () => {
    state.jar.clear();
    for (const res of [
      await audio.POST(audioReq("POST", "", "{}")),
      await audio.PUT(audioReq("PUT", `?upload=${UPLOAD_ID}&part=0`, "x")),
      await audio.DELETE(audioReq("DELETE", `?upload=${UPLOAD_ID}`)),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe("GET /hub/media/<id>/<variant> (07-12 library variants)", () => {
  const hubRead = () =>
    import("../app/(platform)/hub/media/[id]/[variant]/route");
  const ID = "abcdefghij12345";

  function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
  }

  function hubGet(variant: string, headers: Record<string, string> = {}) {
    return hubRead().then((r) =>
      r.GET(
        new Request(`https://${HOST}/hub/media/${ID}/${variant}`, { headers }),
        { params: Promise.resolve({ id: ID, variant }) },
      ),
    );
  }

  it("audio.mp3 with a Range is 206 with Content-Range", async () => {
    const read = vi.fn(async () => streamOf(new Uint8Array(100)));
    db.openHubMediaObject.mockResolvedValue({
      mime: "audio/mpeg",
      size: 1000,
      read,
    });
    const res = await hubGet("audio.mp3", { range: "bytes=0-99" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(read).toHaveBeenCalledWith({ start: 0, end: 99 });
    expect(db.openHubMediaObject).toHaveBeenCalledWith(CTX, ID, "audio.mp3");
  });

  it("w960 is 200 image/webp, private 5 min, nosniff", async () => {
    db.openHubMediaObject.mockResolvedValue({
      mime: "image/webp",
      size: 3,
      read: async () => streamOf(new Uint8Array([1, 2, 3])),
    });
    const res = await hubGet("w960");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(db.readMediaVariant).not.toHaveBeenCalled();
  });

  it("an unsatisfiable Range is 416", async () => {
    db.openHubMediaObject.mockResolvedValue({
      mime: "audio/mpeg",
      size: 10,
      read: vi.fn(),
    });
    const res = await hubGet("audio.mp3", { range: "bytes=50-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("an unknown variant is 404 without a read", async () => {
    const res = await hubGet("original.exe");
    expect(res.status).toBe(404);
    expect(db.openHubMediaObject).not.toHaveBeenCalled();
    expect(db.readMediaVariant).not.toHaveBeenCalled();
  });

  it("a NotFound from the chokepoint is 404", async () => {
    const { NotFound } = await import("@cds/core");
    db.openHubMediaObject.mockRejectedValue(new NotFound());
    expect((await hubGet("w480")).status).toBe(404);
  });

  it("thumb still goes through readMediaVariant", async () => {
    db.readMediaVariant.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mime: "image/webp",
    });
    const res = await hubGet("thumb");
    expect(res.status).toBe(200);
    expect(db.readMediaVariant).toHaveBeenCalledWith(CTX, ID, "thumb");
    expect(db.openHubMediaObject).not.toHaveBeenCalled();
  });
});
