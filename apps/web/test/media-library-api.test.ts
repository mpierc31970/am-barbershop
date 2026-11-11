// 07-17 Task 1: GET/POST /hub/api/media/library (choice 1; CONT-14, CONT-19, CONT-21;
// T-07-17-01..03, T-07-17-06). The session and the @cds/db readers/writers are mocked; the real
// USAGE_COPY builds the usage message.
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const HOST = "cds.needtobeedgy.com";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  listLibrary: vi.fn(),
  getLibraryItem: vi.fn(),
  describeMedia: vi.fn(),
  mediaUsage: vi.fn(),
  videoStates: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const { USAGE_COPY } = await import("@cds/db");
const route = await import("../app/(platform)/hub/api/media/library/route");

const GB = 1024 ** 3;

function usage(usedBytes: number, level: "ok" | "warn" | "full") {
  return {
    usedBytes,
    allowanceBytes: 2 * GB,
    ratio: usedBytes / (2 * GB),
    level,
    assets: 3,
    byKind: { image: 0, video: 0, audio: 0 },
    label: "1.2 GB of 2 GB used",
  };
}

function item(id: string, kind: "image" | "video" | "audio") {
  return {
    id,
    kind,
    rowKind: kind === "image" ? "library" : kind,
    name: `${id}.x`,
    alt: "",
    needsDescription: false,
    status: "ready",
    width: 0,
    height: 0,
    bytes: 1,
    durationS: 0,
    createdAt: "2026-10-01 10:00:00.000Z",
    thumbUrl: null,
    previewUrl: `/hub/media/${id}/web`,
    posterUrl: null,
  };
}

function page(items: ReturnType<typeof item>[]) {
  return {
    items,
    total: items.length,
    page: 1,
    perPage: 60,
    counts: { all: items.length, images: 0, videos: 0, audio: 0 },
    needsDescription: 0,
  };
}

const get = (query: string) =>
  route.GET(
    new Request(`https://${HOST}/hub/api/media/library${query}`, {
      headers: { host: HOST },
    }),
  );

function post(body: unknown, headers: Record<string, string> = {}) {
  return route.POST(
    new Request(`https://${HOST}/hub/api/media/library`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { host: HOST, "content-type": "application/json", ...headers },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  db.listLibrary.mockResolvedValue(page([]));
  db.mediaUsage.mockResolvedValue(usage(GB, "ok"));
  db.videoStates.mockResolvedValue({});
});

describe("GET list", () => {
  it("clamps every value and returns page + usage, no-store", async () => {
    const res = await get(
      "?filter=bogus&q=" + "x".repeat(150) + "&page=0&perPage=500&org=org2",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(db.listLibrary).toHaveBeenCalledWith(CTX, {
      filter: "all",
      q: "x".repeat(100),
      page: 1,
      perPage: 100,
    });
    const body = await res.json();
    expect(body.usage).toMatchObject({ level: "ok", message: "" });
  });

  it("passes a valid filter, search, page and perPage", async () => {
    await get("?filter=videos&q=%20tour%20&page=2&perPage=60");
    expect(db.listLibrary).toHaveBeenCalledWith(CTX, {
      filter: "videos",
      q: "tour",
      page: 2,
      perPage: 60,
    });
  });

  it("reports the org's allowance with packs (7 GB with one 5 GB pack; 10-43)", async () => {
    db.mediaUsage.mockResolvedValueOnce({
      ...usage(GB, "ok"),
      allowanceBytes: 7 * GB,
      ratio: 1 / 7,
      label: "1 GB of 7 GB used",
    });
    const body = await (await get("")).json();
    expect(body.usage).toMatchObject({
      allowanceBytes: 7 * GB,
      label: "1 GB of 7 GB used",
      canBuy: true,
      storageHref: "/hub/settings?tab=billing#storage",
    });
  });

  it("usage message is USAGE-80 at warn and USAGE-FULL at full", async () => {
    db.mediaUsage.mockResolvedValueOnce(usage(1.7 * GB, "warn"));
    let body = await (await get("")).json();
    expect(body.usage.message).toBe(USAGE_COPY.warn(1.7 * GB, 2 * GB));
    db.mediaUsage.mockResolvedValueOnce(usage(2 * GB, "full"));
    body = await (await get("")).json();
    expect(body.usage.message).toBe(USAGE_COPY.full(2 * GB));
  });

  it("video items carry their state from one videoStates call", async () => {
    db.listLibrary.mockResolvedValue(
      page([item("v1", "video"), item("i1", "image"), item("v2", "video")]),
    );
    db.videoStates.mockResolvedValue({ v1: "optimizing", v2: "ready" });
    const body = await (await get("")).json();
    expect(db.videoStates).toHaveBeenCalledTimes(1);
    expect(db.videoStates).toHaveBeenCalledWith(CTX, ["v1", "v2"]);
    expect(body.page.items[0].videoState).toBe("optimizing");
    expect(body.page.items[1].videoState).toBeUndefined();
    expect(body.page.items[2].videoState).toBe("ready");
  });

  it("signed out is 401", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await get("");
    expect(res.status).toBe(401);
    expect(db.listLibrary).not.toHaveBeenCalled();
  });

  it("Forbidden maps to 403 with no-store", async () => {
    db.listLibrary.mockRejectedValue(new Forbidden("no"));
    const res = await get("");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("GET ids and states", () => {
  it("ids: valid ids only (≤ 60), NotFound skipped", async () => {
    db.getLibraryItem.mockImplementation(async (_c: unknown, id: string) => {
      if (id === "gone") throw new NotFound();
      return item(id, "image");
    });
    const many = Array.from({ length: 70 }, (_, i) => `a${i}`).join(",");
    const res = await get(`?ids=a1,../x,gone,${many}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.getLibraryItem).toHaveBeenCalledTimes(60);
    expect(db.getLibraryItem).not.toHaveBeenCalledWith(CTX, "../x");
    expect(body.items.map((i: { id: string }) => i.id)).not.toContain("gone");
  });

  it("states: ≤ 200 ids through videoStates", async () => {
    db.videoStates.mockResolvedValue({ v1: "waiting" });
    const many = Array.from({ length: 250 }, (_, i) => `v${i}`).join(",");
    const res = await get(`?states=${many}`);
    expect(await res.json()).toEqual({ states: { v1: "waiting" } });
    expect(db.videoStates.mock.calls[0]![1]).toHaveLength(200);
  });

  it("states with no valid id answers {} without a read", async () => {
    const res = await get("?states=../x");
    expect(await res.json()).toEqual({ states: {} });
    expect(db.videoStates).not.toHaveBeenCalled();
  });
});

describe("POST describe", () => {
  it("reduces each entry to { id, alt } and returns the count", async () => {
    db.describeMedia.mockResolvedValue({ updated: 2 });
    const res = await post({
      describe: [
        { id: "a1", alt: "Loaves", organization: "org2" },
        { id: "a2", alt: "Rack" },
      ],
      org: "org2",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
    expect(db.describeMedia).toHaveBeenCalledWith(CTX, [
      { id: "a1", alt: "Loaves" },
      { id: "a2", alt: "Rack" },
    ]);
  });

  it("shape errors are 400 without a write", async () => {
    for (const body of [
      {},
      { describe: "x" },
      { describe: [{ id: "../x", alt: "a" }] },
      { describe: [{ id: "a1", alt: 5 }] },
      { describe: Array.from({ length: 201 }, () => ({ id: "a", alt: "b" })) },
      "not json",
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(db.describeMedia).not.toHaveBeenCalled();
  });

  it("InvalidInput is 400 with its copy; NotFound is 404", async () => {
    db.describeMedia.mockRejectedValueOnce(
      new InvalidInput("Add a description."),
    );
    const r1 = await post({ describe: [{ id: "a1", alt: " " }] });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: "Add a description." });
    db.describeMedia.mockRejectedValueOnce(new NotFound());
    expect((await post({ describe: [{ id: "a1", alt: "x" }] })).status).toBe(
      404,
    );
  });

  it("a cross-origin POST is 403; signed out is 401", async () => {
    const r = await post(
      { describe: [{ id: "a1", alt: "x" }] },
      { origin: "https://evil.example" },
    );
    expect(r.status).toBe(403);
    sess.getHubSession.mockResolvedValue(null);
    expect((await post({ describe: [] })).status).toBe(401);
    expect(db.describeMedia).not.toHaveBeenCalled();
  });

  it("a body over 64 KB is 413", async () => {
    const big = JSON.stringify({
      describe: [{ id: "a1", alt: "x".repeat(70 * 1024) }],
    });
    const res = await post(big);
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(db.describeMedia).not.toHaveBeenCalled();
  });
});
