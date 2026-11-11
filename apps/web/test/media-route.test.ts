// 06-13 Task 3: the hub media routes (ONB-04; RESEARCH Pitfall 1; T-06-63, T-06-64, T-06-66).
// The real session module runs against mocked next/headers; @cds/db is the real @cds/db media exports
// (copy, limits, kind checks, UploadRejected) with uploadImage / readMediaVariant mocked.
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  headers: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () =>
    new Headers({ "x-forwarded-for": "203.0.113.9", ...state.headers }),
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  uploadImage: vi.fn(),
  readMediaVariant: vi.fn(),
  agreementStatus: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const { UploadRejected, MAX_UPLOAD_BYTES } = await import("@cds/db");
const upload = await import("../app/(platform)/hub/api/media/route");
const read = await import("../app/(platform)/hub/media/[id]/[variant]/route");

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const HOST = "cds.needtobeedgy.com";

function form(
  fields: Record<string, string | Blob>,
  headers: Record<string, string> = {},
): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`https://${HOST}/hub/api/media`, {
    method: "POST",
    body: fd,
    headers: { host: HOST, ...headers },
  });
}

const png = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "a.png", {
    type: "image/png",
  });

function get(id: string, variant: string) {
  return read.GET(new Request(`https://${HOST}/hub/media/${id}/${variant}`), {
    params: Promise.resolve({ id, variant }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.headers = {};
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [{ id: "org1", name: "Palm", primaryHost: null }],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
  db.agreementStatus.mockResolvedValue({ state: "current" });
});

describe("POST /hub/api/media", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(upload.runtime).toBe("nodejs");
    expect(upload.dynamic).toBe("force-dynamic");
    expect(read.runtime).toBe("nodejs");
    expect(read.dynamic).toBe("force-dynamic");
  });

  it("401 signed_out without a session", async () => {
    state.jar.clear();
    const res = await upload.POST(form({ kind: "hero", file: png() }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed_out" });
    expect(db.uploadImage).not.toHaveBeenCalled();
  });

  it("413 with the size in MB before the body is parsed", async () => {
    const req = form(
      { kind: "hero", file: png() },
      { "content-length": String(34 * 1024 * 1024 + 64 * 1024) },
    );
    const parse = vi.fn();
    Object.defineProperty(req, "formData", { value: parse });
    const res = await upload.POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(
      "This photo is 34 MB. The limit is 20 MB: export a smaller copy and try again.",
    );
    expect(parse).not.toHaveBeenCalled();
    expect(db.uploadImage).not.toHaveBeenCalled();
  });

  it("413 when the real file is over 20 MB (no or lying Content-Length)", async () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "b.jpg");
    const res = await upload.POST(form({ kind: "gallery", file: big }));
    expect(res.status).toBe(413);
    expect(db.uploadImage).not.toHaveBeenCalled();
  });

  it("200 with { asset, proposal } and passes ctx, bytes, kind and alt", async () => {
    const asset = { id: "m1", kind: "moodboard", url: "/hub/media/m1/thumb" };
    const proposal = { swatches: [], roles: {}, adjustments: [], pairs: [] };
    db.uploadImage.mockResolvedValue({ asset, proposal });
    const res = await upload.POST(
      form({ kind: "moodboard", file: png(), alt: "Warm tones" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ asset, proposal });
    const [ctx, bytes, kind, opts] = db.uploadImage.mock.calls[0]!;
    expect(ctx).toEqual(CTX);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect((bytes as Uint8Array).length).toBe(7);
    expect(kind).toBe("moodboard");
    // WR-C06: the invalidator reaches a logo's icon regeneration.
    expect(opts).toEqual({
      alt: "Warm tones",
      filename: "a.png",
      invalidator: expect.objectContaining({
        invalidate: expect.any(Function),
      }),
    });
  });

  it("400 for a kind outside the list, and for a missing file", async () => {
    const bad = await upload.POST(form({ kind: "banner", file: png() }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(
      "That kind of photo isn't supported.",
    );
    const none = await upload.POST(form({ kind: "hero" }));
    expect(none.status).toBe(400);
    expect(db.uploadImage).not.toHaveBeenCalled();
  });

  it("UploadRejected -> 400 with its copy (HEIC, limit)", async () => {
    db.uploadImage.mockRejectedValueOnce(
      new UploadRejected(
        "heic",
        "We couldn't read this iPhone photo. Save it as a JPEG and try again.",
      ),
    );
    const res = await upload.POST(form({ kind: "gallery", file: png() }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        "We couldn't read this iPhone photo. Save it as a JPEG and try again.",
      reason: "heic",
    });
  });

  it("Forbidden -> 403 and InvalidInput -> 400 with its message", async () => {
    db.uploadImage.mockRejectedValueOnce(new Forbidden());
    expect(
      (await upload.POST(form({ kind: "gallery", file: png() }))).status,
    ).toBe(403);
    db.uploadImage.mockRejectedValueOnce(new InvalidInput("Too long."));
    const res = await upload.POST(form({ kind: "gallery", file: png() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Too long.");
  });

  it("an unexpected error -> 500 with UPL-FAILED copy", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.uploadImage.mockRejectedValueOnce(new Error("disk full"));
    const res = await upload.POST(form({ kind: "gallery", file: png() }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      "The upload didn't finish. Check your connection and try again.",
    );
    spy.mockRestore();
  });

  it("refuses a cross-origin browser POST", async () => {
    const res = await upload.POST(
      form(
        { kind: "gallery", file: png() },
        { origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
    expect(db.uploadImage).not.toHaveBeenCalled();
    db.uploadImage.mockResolvedValue({ asset: {} });
    const same = await upload.POST(
      form({ kind: "gallery", file: png() }, { origin: `https://${HOST}` }),
    );
    expect(same.status).toBe(200);
  });
});

describe("GET /hub/media/[id]/[variant]", () => {
  it("200 with the variant's MIME, nosniff and private caching", async () => {
    db.readMediaVariant.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/webp",
    });
    const res = await get("m1", "thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(db.readMediaVariant).toHaveBeenCalledWith(CTX, "m1", "thumb");
  });

  it("404 for a variant outside original|web|thumb, without a read", async () => {
    expect((await get("m1", "raw")).status).toBe(404);
    expect(db.readMediaVariant).not.toHaveBeenCalled();
  });

  it("404 on NotFound (another org's id)", async () => {
    db.readMediaVariant.mockRejectedValue(new NotFound());
    expect((await get("m1", "web")).status).toBe(404);
  });

  it("401 without a session", async () => {
    state.jar.clear();
    expect((await get("m1", "thumb")).status).toBe(401);
    expect(db.readMediaVariant).not.toHaveBeenCalled();
  });
});

describe("re-acceptance gate on the media routes (review WR-C01)", () => {
  it("an outdated Owner gets 403 agreement_required on upload and read, with no write", async () => {
    state.headers = { "x-cds-path": "/hub/api/media" };
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    const res = await upload.POST(form({ kind: "hero", file: png() }));
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.code).toBe("agreement_required");
    expect(body.error).toContain(" ");
    expect(db.uploadImage).not.toHaveBeenCalled();
    state.headers = { "x-cds-path": "/hub/media/m1/thumb" };
    expect((await get("m1", "thumb")).status).toBe(403);
    expect(db.readMediaVariant).not.toHaveBeenCalled();
  });

  it("a current Owner, a non-owner and impersonating staff pass", async () => {
    db.uploadImage.mockResolvedValue({ asset: { id: "a1" }, proposal: null });
    expect(
      (await upload.POST(form({ kind: "hero", file: png() }))).status,
    ).toBe(200);
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "editor" });
    expect(
      (await upload.POST(form({ kind: "hero", file: png() }))).status,
    ).toBe(200);
    db.orgContextFromToken.mockResolvedValue({
      ...CTX,
      impersonator: "staff1",
    });
    expect(
      (await upload.POST(form({ kind: "hero", file: png() }))).status,
    ).toBe(200);
  });

  it("a failed status read lets the Owner through (the signing screen reports its own errors)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.agreementStatus.mockRejectedValue(new Error("down"));
    db.uploadImage.mockResolvedValue({ asset: { id: "a1" }, proposal: null });
    expect(
      (await upload.POST(form({ kind: "hero", file: png() }))).status,
    ).toBe(200);
    err.mockRestore();
  });
});

describe("next.config body limits (RESEARCH Pitfall 1)", () => {
  it("middleware buffers 22mb; server actions stay at 2mb", () => {
    expect(nextConfig.experimental?.middlewareClientMaxBodySize).toBe("22mb");
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("2mb");
  });
});
