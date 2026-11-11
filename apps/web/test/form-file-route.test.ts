// 10-38 Task 2: GET /hub/api/forms/files/<id> (BILL-14, D234; T-10-38-04, T-10-38-05). The real
// session module runs against mocked next/headers; @cds/db is real except the session reads and
// readFormFile. Every refusal is the same 404; a success is a no-store attachment with nosniff.
import { Forbidden, NotFound } from "@cds/core";
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
  agreementStatus: vi.fn(),
  readFormFile: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const route = await import("../app/(platform)/hub/api/forms/files/[id]/route");

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const HOST = "cds.needtobeedgy.com";

function get(id: string) {
  return route.GET(new Request(`https://${HOST}/hub/api/forms/files/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [{ id: "org1", name: "Palm", primaryHost: null }],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
  db.agreementStatus.mockResolvedValue({ state: "current" });
});

describe("GET /hub/api/forms/files/<id>", () => {
  it("is a force-dynamic nodejs route", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("streams the file as a private, no-store attachment with nosniff", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    db.readFormFile.mockResolvedValue({
      name: "Café menu.pdf",
      type: "application/pdf",
      size: bytes.byteLength,
      stream: stream(bytes),
    });
    const res = await get("file0000000001");
    expect(res.status).toBe(200);
    expect(db.readFormFile).toHaveBeenCalledWith(CTX, "file0000000001");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe("7");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd.startsWith("attachment;")).toBe(true);
    expect(cd).toContain('filename="Caf_ menu.pdf"');
    expect(cd).toContain("filename*=UTF-8''Caf%C3%A9%20menu.pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("a quote or newline in the name never breaks the header", async () => {
    db.readFormFile.mockResolvedValue({
      name: 'a";b\\c.pdf',
      type: "application/pdf",
      size: 1,
      stream: stream(new Uint8Array([1])),
    });
    const cd = (await get("file0000000001")).headers.get("content-disposition");
    expect(cd).toContain('filename="a__b_c.pdf"');
  });

  it("signed out: 404 and nothing is read", async () => {
    state.jar.clear();
    const res = await get("file0000000001");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(db.readFormFile).not.toHaveBeenCalled();
  });

  it("another org's file or an unknown id: 404", async () => {
    db.readFormFile.mockRejectedValue(new NotFound());
    expect((await get("file0000000001")).status).toBe(404);
  });

  it("a member without inbox access: 404, not 403", async () => {
    db.readFormFile.mockRejectedValue(new Forbidden());
    expect((await get("file0000000001")).status).toBe(404);
  });

  it("an unexpected failure is 500 and logs only the code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readFormFile.mockRejectedValue(new Error("disk"));
    expect((await get("file0000000001")).status).toBe(500);
    expect(spy).toHaveBeenCalledWith("[forms] file download failed", "unknown");
    spy.mockRestore();
  });
});
