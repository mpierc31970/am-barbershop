// C-WR-03: one add-on's read or blockData failure must not take down the tenant page (D156).
// Each owner is isolated: its blocks get no entry, isDrawnFor skips them, and every other
// owner's data still comes through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ getAddonRecords: vi.fn() }));
vi.mock("../lib/site-cache", () => reads);
vi.mock("../lib/addons", () => ({ addonDeps: () => ({}) }));
vi.mock("@cds/db", () => ({ addonRepo: vi.fn() }));

const server = vi.hoisted(() => ({
  good: {
    blockCollections: ["quotes"],
    blockData: vi.fn(),
  },
  bad: {
    blockCollections: ["items"],
    blockData: vi.fn(),
  },
}));
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: {
    ownerOf: (t: string) =>
      t === "good-block" ? "good" : t === "bad-block" ? "bad" : undefined,
  },
  ADDON_SERVER: server,
}));

const { loadAddonBlockData, isDrawnFor } = await import("../lib/addon-site");

const SITE = { orgId: "org1" } as never;
const NOW = new Date("2026-09-28T00:00:00Z");
const SECTIONS = [
  { id: "hero1", section_type: "hero", content: {} },
  { id: "g1", section_type: "good-block", content: {} },
  { id: "b1", section_type: "bad-block", content: {} },
];
const ACTIVE = ["good", "bad"];

let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  reads.getAddonRecords.mockImplementation(async (_s, slug: string) => [
    { id: `${slug}-r1` },
  ]);
  server.good.blockData.mockImplementation((refs: { id: string }[]) =>
    Object.fromEntries(refs.map((r) => [r.id, [{ text: "hi" }]])),
  );
  server.bad.blockData.mockImplementation((refs: { id: string }[]) =>
    Object.fromEntries(refs.map((r) => [r.id, [{ text: "x" }]])),
  );
});

describe("loadAddonBlockData isolates each add-on (C-WR-03)", () => {
  it("a failed read drops only that add-on's blocks", async () => {
    reads.getAddonRecords.mockImplementation(async (_s, slug: string) => {
      if (slug === "bad") throw new Error("pb down");
      return [{ id: "r1" }];
    });
    const data = await loadAddonBlockData(SITE, SECTIONS, ACTIVE, NOW);
    expect(Object.keys(data)).toEqual(["g1"]);
    const drawn = isDrawnFor(ACTIVE, data);
    expect(drawn(SECTIONS[0]!)).toBe(true);
    expect(drawn(SECTIONS[1]!)).toBe(true);
    expect(drawn(SECTIONS[2]!)).toBe(false);
    expect(err).toHaveBeenCalledWith(
      "[site] add-on block data failed",
      "bad",
      expect.any(Error),
    );
  });

  it("a throwing blockData drops only that add-on's blocks", async () => {
    server.bad.blockData.mockImplementation(() => {
      throw new TypeError("malformed record");
    });
    const data = await loadAddonBlockData(SITE, SECTIONS, ACTIVE, NOW);
    expect(Object.keys(data)).toEqual(["g1"]);
    expect(isDrawnFor(ACTIVE, data)(SECTIONS[2]!)).toBe(false);
  });

  it("a non-object blockData result is ignored", async () => {
    server.bad.blockData.mockReturnValue(null);
    const data = await loadAddonBlockData(SITE, SECTIONS, ACTIVE, NOW);
    expect(Object.keys(data)).toEqual(["g1"]);
  });

  it("with no failure every owner's data comes through", async () => {
    const data = await loadAddonBlockData(SITE, SECTIONS, ACTIVE, NOW);
    expect(Object.keys(data).sort()).toEqual(["b1", "g1"]);
    expect(err).not.toHaveBeenCalled();
  });
});
