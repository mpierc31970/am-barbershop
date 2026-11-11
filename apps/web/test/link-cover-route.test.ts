// 07-23 Task 1: POST /hub/api/media/link-cover (choice 1; CONT-34; T-07-23-01/02/03). The
// session and @cds/db captureLinkCover are mocked.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const HOST = "cds.needtobeedgy.com";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({ captureLinkCover: vi.fn() }));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const route = await import("../app/(platform)/hub/api/media/link-cover/route");

function post(
  body: unknown,
  opts: { origin?: string; raw?: string; length?: string } = {},
): Request {
  const text = opts.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = {
    host: HOST,
    "content-type": "application/json",
  };
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.length !== undefined) headers["content-length"] = opts.length;
  return new Request(`https://${HOST}/hub/api/media/link-cover`, {
    method: "POST",
    headers,
    body: text,
  });
}

const VALID = {
  provider: "youtube",
  provider_id: "dQw4w9WgXcQ",
  title: "Tour",
};

beforeEach(() => {
  vi.clearAllMocks();
  sess.getHubSession.mockResolvedValue({ ctx: CTX });
  db.captureLinkCover.mockResolvedValue({
    ok: true,
    asset: "a1",
    thumbUrl: "/hub/media/a1/thumb",
    reused: false,
  });
});

describe("POST /hub/api/media/link-cover", () => {
  it("refuses a cross-origin request", async () => {
    const res = await route.POST(
      post(VALID, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(db.captureLinkCover).not.toHaveBeenCalled();
  });

  it("signed out is 401", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await route.POST(post(VALID));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("a body over 2 KB is 413 (declared and real)", async () => {
    expect((await route.POST(post(VALID, { length: "4096" }))).status).toBe(
      413,
    );
    const big = { ...VALID, title: "x".repeat(3000) };
    const res = await route.POST(post(big));
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(db.captureLinkCover).not.toHaveBeenCalled();
  });

  it.each([
    ["not json", { raw: "{nope" }],
    ["an array", { raw: "[]" }],
    ["missing provider", { body: { provider_id: "x" } }],
    ["missing provider_id", { body: { provider: "youtube" } }],
    ["numeric provider_id", { body: { provider: "youtube", provider_id: 7 } }],
    ["bad provider", { body: { provider: "You Tube", provider_id: "x" } }],
    [
      "__proto__ provider",
      { body: { provider: "__proto__", provider_id: "x" } },
    ],
    [
      "long provider_id",
      { body: { provider: "youtube", provider_id: "x".repeat(201) } },
    ],
    ["long title", { body: { ...VALID, title: "t".repeat(501) } }],
    ["object title", { body: { ...VALID, title: { a: 1 } } }],
  ])("%s is 400", async (_name, c) => {
    const res = await route.POST(
      "raw" in c ? post(null, { raw: c.raw }) : post(c.body),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(db.captureLinkCover).not.toHaveBeenCalled();
  });

  it("a valid body returns the stored copy; only provider, id and title reach the db", async () => {
    const res = await route.POST(
      post({ ...VALID, organization: "orgB", store: "x", fetch: "y" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      asset: "a1",
      thumbUrl: "/hub/media/a1/thumb",
    });
    expect(db.captureLinkCover).toHaveBeenCalledTimes(1);
    const [ctx, input, deps] = db.captureLinkCover.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(input).toEqual({
      provider: "youtube",
      providerId: "dQw4w9WgXcQ",
      title: "Tour",
    });
    expect(deps).toBeUndefined();
  });

  it("a missing title is passed as blank", async () => {
    await route.POST(post({ provider: "vimeo", provider_id: "76979871" }));
    expect(db.captureLinkCover.mock.calls[0]![1]).toEqual({
      provider: "vimeo",
      providerId: "76979871",
      title: "",
    });
  });

  it("a refusal is 200 with asset null and the reason", async () => {
    db.captureLinkCover.mockResolvedValue({ ok: false, reason: "unavailable" });
    const res = await route.POST(post(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asset: null, reason: "unavailable" });
  });

  it("Forbidden is 403", async () => {
    db.captureLinkCover.mockRejectedValue(new Forbidden());
    const res = await route.POST(post(VALID));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("anything unexpected is a generic 500 without a stack", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.captureLinkCover.mockRejectedValue(new Error("secret detail"));
    const res = await route.POST(post(VALID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    spy.mockRestore();
  });
});
