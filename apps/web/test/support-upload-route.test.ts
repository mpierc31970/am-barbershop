// 12-07 Task 3: POST /hub/api/support/upload (COMM-08; choice 9; RESEARCH Pattern 6, Pitfall 5;
// T-12-07-01, T-12-07-06). Same origin, a session with support:write (never impersonating),
// the 10 MB cap before and after the body, and the UI-SPEC copy per refusal. The type check,
// scan and limiter themselves run in stageSupportUpload (integration-tested in @cds/db); here
// the real @cds/db error classes stand in through the mock.
import { NotFound, RateLimited } from "@cds/core";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
}));

const db = vi.hoisted(() => ({ stageSupportUpload: vi.fn() }));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));
vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
  agreementBlocks: async () => false,
}));

const {
  SUPPORT_FILE_MAX_BYTES,
  SupportFileInfected,
  SupportFileRefused,
  SupportFileTooLarge,
} = await import("@cds/db");
const route = await import("../app/(platform)/hub/api/support/upload/route");

const HOST = "cds.needtobeedgy.com";

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: "orgaaaaaaaaaaa1",
    actor: "useraaaaaaaaaa1",
    role: "editor",
    grants: [],
    ip: "",
    ...over,
  };
}

function post(
  file: Blob | null,
  headers: Record<string, string> = {},
): Promise<Response> {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return route.POST(
    new Request(`https://${HOST}/hub/api/support/upload`, {
      method: "POST",
      body: fd,
      headers: { host: HOST, ...headers },
    }),
  );
}

const png = () =>
  new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    "shot.png",
    { type: "image/png" },
  );

beforeEach(() => {
  state.session = { ctx: ctx() };
  db.stageSupportUpload.mockReset();
  db.stageSupportUpload.mockResolvedValue({
    uploadId: "upaaaaaaaaaaaa1",
    name: "shot.png",
    size: 8,
    mime: "image/png",
    scan: "clean",
    token: "payload.sig",
  });
});

describe("POST /hub/api/support/upload", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("stages a file for an editor and returns the token, no-store", async () => {
    const res = await post(png(), { origin: `https://${HOST}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ token: "payload.sig" });
    const [, input] = db.stageSupportUpload.mock.calls[0]!;
    expect(input.name).toBe("shot.png");
    expect(input.bytes).toBeInstanceOf(Uint8Array);
  });

  it("refuses a cross-origin POST with 403", async () => {
    const res = await post(png(), { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(db.stageSupportUpload).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    state.session = null;
    expect((await post(png())).status).toBe(401);
  });

  it("403 IMPERSONATING-SUPPORT for impersonating staff, before the body is read", async () => {
    state.session = { ctx: ctx({ role: "owner", impersonator: "staff1" }) };
    const res = await post(png());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      SUPPORT_UI_COPY.IMPERSONATING_SUPPORT,
    );
    expect(db.stageSupportUpload).not.toHaveBeenCalled();
  });

  it("403 for a viewer (support read only)", async () => {
    state.session = { ctx: ctx({ role: "viewer" }) };
    const res = await post(png());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(SUPPORT_UI_COPY.VIEWER_READONLY);
  });

  it("413 FILE-TOO-BIG from Content-Length and from the real size", async () => {
    const declared = await post(png(), {
      "content-length": String(SUPPORT_FILE_MAX_BYTES + 200 * 1024),
    });
    expect(declared.status).toBe(413);
    const big = new File(
      [new Uint8Array(SUPPORT_FILE_MAX_BYTES + 1)],
      "huge.png",
    );
    const res = await post(big);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(
      SUPPORT_UI_COPY.FILE_TOO_BIG("huge.png"),
    );
    db.stageSupportUpload.mockRejectedValueOnce(new SupportFileTooLarge("x"));
    expect((await post(png())).status).toBe(413);
  });

  it("WR-C03: 413 for a chunked body with no Content-Length, without reading it whole", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const limit = SUPPORT_FILE_MAX_BYTES * 4;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= limit) return c.close();
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const req = new Request(`https://${HOST}/hub/api/support/upload`, {
      method: "POST",
      body,
      headers: {
        host: HOST,
        "content-type": "multipart/form-data; boundary=x",
      },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await route.POST(req);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(limit);
    expect(db.stageSupportUpload).not.toHaveBeenCalled();
  });

  it("415 FILE-TYPE when the type is refused", async () => {
    db.stageSupportUpload.mockRejectedValueOnce(new SupportFileRefused("x"));
    const res = await post(png());
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe(
      SUPPORT_UI_COPY.FILE_TYPE("shot.png"),
    );
  });

  it("422 FILE-REFUSED when the scanner refuses it, not the type advice (IN-B01)", async () => {
    db.stageSupportUpload.mockRejectedValueOnce(new SupportFileInfected("x"));
    const res = await post(png());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe(SUPPORT_UI_COPY.FILE_REFUSED("shot.png"));
    expect(body.error).not.toBe(SUPPORT_UI_COPY.FILE_TYPE("shot.png"));
  });

  it("429 RATE-UPLOADS when the org is over its daily uploads", async () => {
    db.stageSupportUpload.mockRejectedValueOnce(new RateLimited("x"));
    const res = await post(png());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(SUPPORT_UI_COPY.RATE_UPLOADS);
  });

  it("maps not_found to 404 and agreement_required to the gate, without logging (IN-B02)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.stageSupportUpload.mockRejectedValueOnce(new NotFound("x"));
    let res = await post(png());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(
      SUPPORT_UI_COPY.FILE_FAILED("shot.png"),
    );
    db.stageSupportUpload.mockRejectedValueOnce(
      Object.assign(new Error("gate"), { code: "agreement_required" }),
    );
    res = await post(png());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("agreement_required");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("500 FILE-FAILED on anything else, logging the class name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.stageSupportUpload.mockRejectedValueOnce(
      new Error("tenants/org/support/staging/secret"),
    );
    const res = await post(png());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      SUPPORT_UI_COPY.FILE_FAILED("shot.png"),
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("tenants/");
    spy.mockRestore();
  });
});
