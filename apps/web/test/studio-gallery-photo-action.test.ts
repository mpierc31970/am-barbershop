// galleryPhotoAction: Add to Gallery / Skip on /hub/alerts stay on the screen (no redirect),
// pass the decision through, and a failure (photo removed) becomes the note.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  decideGalleryPhoto: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  set: vi.fn(),
}));
vi.mock("@cds/db", () => ({ decideGalleryPhoto: h.decideGalleryPhoto }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.set }) }));
vi.mock("../lib/content", () => ({ contentDeps: () => ({ deps: true }) }));
vi.mock("../lib/action", () => ({
  runAction: async (fn: (s: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn({ ctx: { orgId: "org1" } }) };
    } catch (err) {
      return { ok: false, code: "invalid", message: (err as Error).message };
    }
  },
}));

const { galleryPhotoAction } = await import("../app/actions/studio");

function form(decision: string): FormData {
  const f = new FormData();
  f.set("seatId", "seat00000000001");
  f.set("mediaId", "media0000000001");
  f.set("decision", decision);
  return f;
}

describe("galleryPhotoAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["add", true, "ok:Added to the Gallery."],
    ["skip", false, "ok:Skipped."],
  ])("%s: decides in place with a note", async (d, add, note) => {
    await galleryPhotoAction(form(d));
    expect(h.decideGalleryPhoto).toHaveBeenCalledWith(
      { orgId: "org1" },
      "seat00000000001",
      "media0000000001",
      add,
      { deps: true },
    );
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.set.mock.calls[0]?.[1]).toBe(note);
    expect(h.revalidatePath).toHaveBeenCalledWith("/hub/alerts");
  });

  it("a removed photo answers with its note", async () => {
    h.decideGalleryPhoto.mockRejectedValueOnce(
      new Error("This photo was removed."),
    );
    await galleryPhotoAction(form("add"));
    expect(h.set.mock.calls[0]?.[1]).toBe("error:This photo was removed.");
  });
});
