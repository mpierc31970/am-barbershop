// bookingStatusAction: from /hub/alerts it stays on the screen (no redirect) so the same
// response re-renders the card with the new status and the note; elsewhere it goes back
// to the bookings screen.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setBookingStatus: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  set: vi.fn(),
}));
vi.mock("@cds/db", () => ({ setBookingStatus: h.setBookingStatus }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.set }) }));
vi.mock("../lib/action", () => ({
  runAction: async (fn: (s: unknown) => Promise<unknown>) => ({
    ok: true,
    data: await fn({ ctx: { orgId: "org1" } }),
  }),
}));

const { bookingStatusAction } = await import("../app/actions/studio");

function form(status: string, back?: string): FormData {
  const f = new FormData();
  f.set("bookingId", "wxt5rhe68lf61g7");
  f.set("status", status);
  if (back) f.set("back", back);
  return f;
}

describe("bookingStatusAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["confirmed", "ok:Approved. The client was emailed."],
    ["declined", "ok:Declined. The client was emailed."],
  ])(
    "on Alerts, %s: no redirect, note set, Alerts revalidated",
    async (status, note) => {
      await bookingStatusAction(form(status, "/hub/alerts"));
      expect(h.setBookingStatus).toHaveBeenCalledWith(
        { orgId: "org1" },
        "wxt5rhe68lf61g7",
        status,
      );
      expect(h.redirect).not.toHaveBeenCalled();
      expect(h.set.mock.calls[0]?.[1]).toBe(note);
      expect(h.revalidatePath).toHaveBeenCalledWith("/hub/alerts");
    },
  );

  it("anywhere else: back to the bookings screen", async () => {
    await expect(bookingStatusAction(form("confirmed"))).rejects.toThrow(
      "redirect:/hub/studio-booking/bookings",
    );
  });
});
