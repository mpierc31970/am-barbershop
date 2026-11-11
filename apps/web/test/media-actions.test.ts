// 06-19 Task 1: setup photo actions (ONB-04, D280, D-UI-P6-31; T-06-93). The session and
// @cds/db are mocked; the real runAction maps refusals to copy. Also checks that the
// @cds/ui/hub upload copy matches the server's UPLOAD_COPY (the UI package can't import it).
import { Forbidden, InvalidInput } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = vi.hoisted(() => ({
  setMediaAlt: vi.fn(),
  removeMedia: vi.fn(),
  restoreMedia: vi.fn(),
  reorderMedia: vi.fn(),
  deleteMediaAsset: vi.fn(),
  retryVideo: vi.fn(),
  setVideoCover: vi.fn(),
}));
vi.mock("@cds/db", () => db);
const REGISTRY = vi.hoisted(() => ({ sentinel: "registry" }));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: REGISTRY }));

const {
  setMediaAltAction,
  removeMediaAction,
  restoreMediaAction,
  reorderMediaAction,
  deleteLibraryMediaAction,
  retryVideoAction,
  setVideoCoverAction,
} = await import("../app/actions/media");
const { nextInvalidator } = await import("../lib/invalidator");
const { revalidatePath } = await import("next/cache");

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  vi.mocked(revalidatePath).mockClear();
});

describe("media actions", () => {
  it("setMediaAltAction saves through the chokepoint with the session context", async () => {
    db.setMediaAlt.mockResolvedValue(undefined);
    const res = await setMediaAltAction("abc123", "Loaves cooling");
    expect(res).toEqual({ ok: true, data: null });
    expect(db.setMediaAlt).toHaveBeenCalledWith(
      CTX,
      "abc123",
      "Loaves cooling",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("an InvalidInput refusal returns its copy", async () => {
    db.setMediaAlt.mockRejectedValue(
      new InvalidInput("Keep the description under 250 characters."),
    );
    const res = await setMediaAltAction("abc123", "x".repeat(300));
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Keep the description under 250 characters.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a malformed id never reaches the chokepoint", async () => {
    const res = await removeMediaAction("../org2/x");
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.removeMedia).not.toHaveBeenCalled();
  });

  it("remove and restore call the chokepoint", async () => {
    db.removeMedia.mockResolvedValue({});
    db.restoreMedia.mockResolvedValue({});
    expect(await removeMediaAction("m1")).toEqual({ ok: true, data: null });
    expect(await restoreMediaAction("m1")).toEqual({ ok: true, data: null });
    // WR-C06: the invalidator reaches a logo's icon regeneration.
    expect(db.removeMedia).toHaveBeenCalledWith(CTX, "m1", {
      invalidator: nextInvalidator,
    });
    expect(db.restoreMedia).toHaveBeenCalledWith(CTX, "m1", {
      invalidator: nextInvalidator,
    });
  });

  it("removing or restoring the first mood board returns the recomputed proposal (06-21)", async () => {
    db.removeMedia.mockResolvedValue({ proposal: null });
    db.restoreMedia.mockResolvedValue({ proposal: { roles: {} } });
    expect(await removeMediaAction("m1")).toEqual({
      ok: true,
      data: { proposal: null },
    });
    expect(await restoreMediaAction("m1")).toEqual({
      ok: true,
      data: { proposal: { roles: {} } },
    });
  });

  it("an editor gets the Forbidden copy", async () => {
    db.removeMedia.mockRejectedValue(
      new Forbidden("Only the owner or an admin can do that."),
    );
    const res = await removeMediaAction("m1");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("reorder passes the kind and ids and returns the proposal", async () => {
    db.reorderMedia.mockResolvedValue({ proposal: { roles: {} } });
    const res = await reorderMediaAction("moodboard", ["b", "a"]);
    expect(res).toEqual({ ok: true, data: { proposal: { roles: {} } } });
    expect(db.reorderMedia).toHaveBeenCalledWith(CTX, "moodboard", ["b", "a"]);
  });

  it("reorder refuses another kind", async () => {
    const res = await reorderMediaAction("logo" as never, ["a"]);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.reorderMedia).not.toHaveBeenCalled();
  });

  it("signed out is refused", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await setMediaAltAction("m1", "x");
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
  });
});

describe("07-17 library actions", () => {
  it("deleteLibraryMediaAction passes the registry and invalidator and returns the outcome", async () => {
    db.deleteMediaAsset.mockResolvedValue({ outcome: "soft" });
    const res = await deleteLibraryMediaAction("abc123");
    expect(res).toEqual({ ok: true, data: { outcome: "soft" } });
    expect(db.deleteMediaAsset).toHaveBeenCalledWith(CTX, "abc123", {
      sections: REGISTRY,
      invalidator: nextInvalidator,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("a hard delete reports hard", async () => {
    db.deleteMediaAsset.mockResolvedValue({ outcome: "hard" });
    expect(await deleteLibraryMediaAction("m1")).toEqual({
      ok: true,
      data: { outcome: "hard" },
    });
  });

  it("bad ids never reach the chokepoint", async () => {
    for (const bad of ["../x", "", "a".repeat(40), 7 as never]) {
      expect(await deleteLibraryMediaAction(bad)).toMatchObject({
        ok: false,
        code: "invalid_input",
        message: "That photo isn't available any more. Refresh and try again.",
      });
      expect(await retryVideoAction(bad)).toMatchObject({ ok: false });
    }
    expect(db.deleteMediaAsset).not.toHaveBeenCalled();
    expect(db.retryVideo).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("retryVideoAction calls retryVideo; a used-up retry returns its copy", async () => {
    db.retryVideo.mockResolvedValue({ state: "waiting" });
    expect(await retryVideoAction("v1")).toEqual({ ok: true, data: null });
    expect(db.retryVideo).toHaveBeenCalledWith(CTX, "v1");
    db.retryVideo.mockRejectedValue(new InvalidInput("No retry left."));
    expect(await retryVideoAction("v1")).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "No retry left.",
    });
  });

  it("setVideoCoverAction takes an image id or null", async () => {
    db.setVideoCover.mockResolvedValue(undefined);
    expect(await setVideoCoverAction("v1", "i1")).toEqual({
      ok: true,
      data: null,
    });
    expect(db.setVideoCover).toHaveBeenCalledWith(CTX, "v1", "i1");
    expect(await setVideoCoverAction("v1", null)).toEqual({
      ok: true,
      data: null,
    });
    expect(db.setVideoCover).toHaveBeenLastCalledWith(CTX, "v1", null);
  });

  it("a non-null, non-string cover is refused", async () => {
    const res = await setVideoCoverAction("v1", { id: "x" } as never);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    const res2 = await setVideoCoverAction("v1", "../x");
    expect(res2).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.setVideoCover).not.toHaveBeenCalled();
  });

  it("a Forbidden refusal (Viewer) returns its copy", async () => {
    db.deleteMediaAsset.mockRejectedValue(new Forbidden("Not allowed."));
    expect(await deleteLibraryMediaAction("m1")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
});

describe("upload copy parity", () => {
  it("@cds/ui/hub UPL_COPY and MAX_UPLOAD_BYTES match @cds/db", async () => {
    const real = await vi.importActual<typeof import("@cds/db")>("@cds/db");
    const ui = await import("../../../packages/ui/src/hub/ImageUpload");
    expect(ui.MAX_UPLOAD_BYTES).toBe(real.MAX_UPLOAD_BYTES);
    expect(ui.UPL_COPY.type).toBe(real.UPLOAD_COPY.type);
    expect(ui.UPL_COPY.heic).toBe(real.UPLOAD_COPY.heic);
    expect(ui.UPL_COPY.failed).toBe(real.UPLOAD_COPY.failed);
    for (const bytes of [21 * 1024 * 1024, 34 * 1024 * 1024 - 5]) {
      expect(ui.UPL_COPY.tooBig(bytes)).toBe(real.UPLOAD_COPY.tooBig(bytes));
    }
    // A cold importActual of the whole @cds/db barrel can pass 5 s under full-suite load (07-33).
  }, 30_000);
});
