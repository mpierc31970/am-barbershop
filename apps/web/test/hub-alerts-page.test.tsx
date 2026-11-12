// /hub/alerts: opening the screen marks the person's alerts read (the bell count clears),
// only when something is unread and the list loaded.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listBell: vi.fn(),
  listBookings: vi.fn(),
  listMissedBookings: vi.fn(async () => []),
  markAllRead: vi.fn(),
  statsTimeZone: vi.fn(),
}));
vi.mock("@cds/db", () => db);
vi.mock("../app/actions/studio", () => ({ bookingStatusAction: vi.fn() }));
vi.mock("../lib/needs-you", () => ({
  getNeedsYou: async () => ({ items: [], failed: [] }),
}));
vi.mock("../lib/studio", () => ({ readStudioNote: async () => null }));
const ctx = { orgId: "org1", actor: "u1", role: "renter", grants: [] };
vi.mock("../lib/session", () => ({
  requireHubSession: async () => ({ ctx }),
}));

const { default: AlertsPage } =
  await import("../app/(platform)/hub/alerts/page");

function row(read: boolean) {
  return {
    id: "a1",
    type: "studio-booking.new",
    level: "normal",
    title: "Booking request",
    href: "/hub/alerts",
    section: "addon:studio-booking",
    createdAt: "2030-01-07T12:00:00Z",
    read,
    cleared: false,
    sourceKey: "booking:x",
  };
}

describe("/hub/alerts marks read on view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.statsTimeZone.mockResolvedValue("America/Chicago");
    db.listBookings.mockResolvedValue({ tz: "America/Chicago", bookings: [] });
    db.markAllRead.mockResolvedValue({ marked: 1 });
  });

  it("an unread alert: marked read for this person (org + actor context)", async () => {
    db.listBell.mockResolvedValue([row(false)]);
    await AlertsPage();
    expect(db.markAllRead).toHaveBeenCalledWith(ctx);
  });

  it("nothing unread, or the list failed: no write", async () => {
    db.listBell.mockResolvedValue([row(true)]);
    await AlertsPage();
    db.listBell.mockRejectedValue(new Error("down"));
    await AlertsPage();
    expect(db.markAllRead).not.toHaveBeenCalled();
  });
});
