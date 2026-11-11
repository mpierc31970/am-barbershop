// Review 11 IN-C03: the Profile's alert types leave out paused add-ons (invariant 9), like the
// Needs-you providers do.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  activeAddons: vi.fn(),
  pausedAddons: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const spec = (slug: string, type: string) => ({
  type,
  level: "normal",
  label: type,
  example: type,
  feature: `addon:${slug}`,
  access: "read",
  section: `addon:${slug}`,
  defaultChannels: { email: true, push: true },
});

vi.mock("@cds/addon-registry", () => ({
  ADDON_REGISTRY: {
    list: () => [
      {
        slug: "studio-booking",
        alerts: [spec("studio-booking", "booking.new")],
      },
      { slug: "store", alerts: [spec("store", "store.order")] },
    ],
  },
}));

const { alertTypesFor } = await import("../lib/alert-types");

const OWNER = {
  orgId: "org1",
  actor: "u1",
  role: "owner",
  grants: ["studio-booking", "store"],
} as never;

beforeEach(() => {
  db.activeAddons.mockReset();
  db.pausedAddons.mockReset();
});

describe("alertTypesFor (IN-C03)", () => {
  it("lists active add-ons' types and leaves out a paused one", async () => {
    db.activeAddons.mockResolvedValue(["studio-booking", "store"]);
    db.pausedAddons.mockResolvedValue(["store"]);
    const types = (await alertTypesFor(OWNER)).map((t) => t.type);
    expect(types).toContain("booking.new");
    expect(types).not.toContain("store.order");
    expect(types).toContain("form.message");
  });

  it("an add-on read failure leaves the core types only", async () => {
    db.activeAddons.mockRejectedValue(new Error("down"));
    db.pausedAddons.mockResolvedValue([]);
    const types = (await alertTypesFor(OWNER)).map((t) => t.type);
    expect(types).not.toContain("booking.new");
    expect(types).toContain("form.message");
  });
});
