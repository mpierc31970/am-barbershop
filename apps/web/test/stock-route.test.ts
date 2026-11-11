// 07-30 Task 2: /hub/api/media/stock (choices 9, 10; CONT-28, D-UI-P7-11; T-07-30-06..08).
// The session and the @cds/db stock source / permission check are mocked; the real limiter runs.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const HOST = "cds.needtobeedgy.com";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

const fake = vi.hoisted(() => ({
  search: vi.fn(),
  registerUse: vi.fn(),
}));
const db = vi.hoisted(() => ({
  getStockPhotoSource: vi.fn(),
  requirePermission: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const { resetStockLimitsForTests } = await import("@cds/db");
const route = await import("../app/(platform)/hub/api/media/stock/route");

function get(query = ""): Request {
  return new Request(`https://${HOST}/hub/api/media/stock${query}`, {
    headers: { host: HOST },
  });
}

function post(body: unknown, origin?: string): Request {
  const headers: Record<string, string> = {
    host: HOST,
    "content-type": "application/json",
  };
  if (origin) headers.origin = origin;
  return new Request(`https://${HOST}/hub/api/media/stock`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStockLimitsForTests();
  sess.getHubSession.mockResolvedValue({ ctx: CTX });
  db.requirePermission.mockImplementation(() => undefined);
  db.getStockPhotoSource.mockReturnValue({ name: "unsplash", ...fake });
  fake.search.mockResolvedValue({ photos: [{ id: "p1" }], hasMore: true });
  fake.registerUse.mockResolvedValue(undefined);
});

describe("GET /hub/api/media/stock", () => {
  it("signed out is 401", async () => {
    sess.getHubSession.mockResolvedValue(null);
    expect((await route.GET(get())).status).toBe(401);
  });

  it("no q -> availability", async () => {
    const res = await route.GET(get());
    expect(await res.json()).toEqual({ available: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    db.getStockPhotoSource.mockReturnValue(null);
    expect(await (await route.GET(get())).json()).toEqual({ available: false });
    expect((await route.GET(get("?q=bakery"))).status).toBe(404);
  });

  it("searches with a trimmed, capped query and a clamped page", async () => {
    const res = await route.GET(
      get(`?q=${encodeURIComponent("  bakery  ")}&page=2`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photos: [{ id: "p1" }], hasMore: true });
    expect(fake.search).toHaveBeenCalledWith("bakery", 2);
    await route.GET(get(`?q=${"x".repeat(300)}&page=999`));
    expect(fake.search).toHaveBeenLastCalledWith("x".repeat(100), 50);
    await route.GET(get("?q=a&page=-3"));
    expect(fake.search).toHaveBeenLastCalledWith("a", 1);
  });

  it("the 61st search in an hour is 429 with friendly copy", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await route.GET(get("?q=a"))).status).toBe(200);
    }
    const res = await route.GET(get("?q=a"));
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/Try again/);
  });

  it("a member without content write is 403", async () => {
    db.requirePermission.mockImplementation(() => {
      throw new Forbidden();
    });
    expect((await route.GET(get("?q=a"))).status).toBe(403);
    expect(fake.search).not.toHaveBeenCalled();
  });

  it("an upstream failure is 502 without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.search.mockRejectedValue(new Error("secret upstream body"));
    const res = await route.GET(get("?q=a"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("POST /hub/api/media/stock", () => {
  it("registers a use for a valid id", async () => {
    const res = await route.POST(post({ use: { id: "abc_123" } }));
    expect(res.status).toBe(200);
    expect(fake.registerUse).toHaveBeenCalledWith("abc_123");
  });

  it("refuses bad ids, cross-origin posts and no source", async () => {
    expect((await route.POST(post({ use: { id: "../x" } }))).status).toBe(400);
    expect(
      (await route.POST(post({ use: { id: "https://evil" } }))).status,
    ).toBe(400);
    expect(
      (await route.POST(post({ use: { id: "abc" } }, "https://evil.example")))
        .status,
    ).toBe(403);
    db.getStockPhotoSource.mockReturnValue(null);
    expect((await route.POST(post({ use: { id: "abc" } }))).status).toBe(404);
    expect(fake.registerUse).not.toHaveBeenCalled();
  });
});
