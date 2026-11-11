// 07-12: the media slice of the core block data loader (CONT-33, choice 16). Section media
// ids come from the registry's refsOf, pop-up media from live pop-ups' items; visitor pages
// resolve through resolvePublicMedia, the preview through resolveHubMedia; a resolver
// failure gives media {} and the page still renders.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  readPublicBusiness: vi.fn(),
  getBusinessProfile: vi.fn(),
  resolvePublicMedia: vi.fn(),
  resolveHubMedia: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const live = vi.hoisted(() => ({ getLiveSite: vi.fn() }));
vi.mock("../lib/site-cache", async (orig) => ({
  ...(await orig<typeof import("../lib/site-cache")>()),
  ...live,
}));

const { loadCoreBlockData, previewCoreBlockData, mediaIdsFor } =
  await import("../lib/core-block-data");

const SITE = { orgId: "o1", host: "shop.example.com" } as never;
const CTX = { orgId: "o1" } as never;
const IMG = "aaaaaaaaaaaaaa1";
const POP_IMG = "bbbbbbbbbbbbbb2";

function columnsWithImage(asset: string) {
  return {
    id: "s1",
    section_type: "columns",
    content: {
      columns: [{ items: [{ id: "i1", kind: "image", asset }] }],
    },
  } as never;
}

const POPUP = {
  id: "p1",
  content: { items: [{ id: "i2", kind: "image", asset: POP_IMG }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  live.getLiveSite.mockResolvedValue({ banner: null, popups: [] });
  db.resolvePublicMedia.mockImplementation(async (_s, ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        { id, kind: "image", src: `/_media/${id}/w960`, alt: "" },
      ]),
    ),
  );
  db.resolveHubMedia.mockImplementation(async (_c, ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        { id, kind: "image", src: `/hub/media/${id}/w960`, alt: "" },
      ]),
    ),
  );
});

describe("mediaIdsFor", () => {
  it("unions section refs and pop-up items", () => {
    expect(mediaIdsFor([columnsWithImage(IMG)], [POPUP])).toEqual([
      IMG,
      POP_IMG,
    ]);
  });

  it("ignores unknown types and malformed sections", () => {
    expect(
      mediaIdsFor([
        { id: "x", section_type: "nope", content: {} } as never,
        null as never,
        { id: "y" } as never,
      ]),
    ).toEqual([]);
  });
});

describe("loadCoreBlockData media (visitor)", () => {
  it("resolves section and live pop-up media through resolvePublicMedia", async () => {
    live.getLiveSite.mockResolvedValue({ banner: null, popups: [POPUP] });
    const out = await loadCoreBlockData(SITE, [columnsWithImage(IMG)], {
      pageId: "page1",
    });
    expect(db.resolvePublicMedia).toHaveBeenCalledWith(SITE, [IMG, POP_IMG], {
      pageId: "page1",
      protectedPage: false,
    });
    expect(Object.keys(out.media)).toEqual([IMG, POP_IMG]);
    expect(db.resolveHubMedia).not.toHaveBeenCalled();
  });

  it("passes protectedPage through (07-32)", async () => {
    await loadCoreBlockData(SITE, [columnsWithImage(IMG)], {
      pageId: "page1",
      protectedPage: true,
    });
    expect(db.resolvePublicMedia.mock.calls[0]![2]).toEqual({
      pageId: "page1",
      protectedPage: true,
    });
  });

  it("no ids: no resolver call", async () => {
    const out = await loadCoreBlockData(SITE, [
      { id: "s", section_type: "faq", content: {} } as never,
    ]);
    expect(out).toEqual({ media: {} });
    expect(db.resolvePublicMedia).not.toHaveBeenCalled();
  });

  it("a throwing resolver yields media {} and logs", async () => {
    db.resolvePublicMedia.mockRejectedValue(new Error("pb down"));
    const out = await loadCoreBlockData(SITE, [columnsWithImage(IMG)]);
    expect(out).toEqual({ media: {} });
    expect(console.error).toHaveBeenCalledWith(
      "[site] core block data failed",
      "media",
      expect.any(Error),
    );
  });

  it("a failed pop-up read still resolves section media", async () => {
    live.getLiveSite.mockRejectedValue(new Error("down"));
    const out = await loadCoreBlockData(SITE, [columnsWithImage(IMG)]);
    expect(Object.keys(out.media)).toEqual([IMG]);
  });
});

describe("previewCoreBlockData media", () => {
  it("resolves through resolveHubMedia", async () => {
    const out = await previewCoreBlockData(CTX, [columnsWithImage(IMG)]);
    expect(db.resolveHubMedia).toHaveBeenCalledWith(CTX, [IMG]);
    expect(out.media[IMG]!.src).toBe(`/hub/media/${IMG}/w960`);
    expect(db.resolvePublicMedia).not.toHaveBeenCalled();
  });

  it("a throwing resolver yields media {}", async () => {
    db.resolveHubMedia.mockRejectedValue(new Error("x"));
    expect(await previewCoreBlockData(CTX, [columnsWithImage(IMG)])).toEqual({
      media: {},
      editorPreview: true,
    });
  });
});
