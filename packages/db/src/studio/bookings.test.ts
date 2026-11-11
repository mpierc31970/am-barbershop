import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, bookingTransition } from "./bookings";

describe("bookingTransition", () => {
  it("a request is only approved or declined", () => {
    expect(bookingTransition("requested", "confirmed")).toBe(true);
    expect(bookingTransition("requested", "declined")).toBe(true);
    for (const to of ["completed", "no_show", "cancelled"] as const) {
      expect(bookingTransition("requested", to)).toBe(false);
    }
  });

  it("a confirmed booking is done, a no-show or cancelled; never back to a request", () => {
    for (const to of ["completed", "no_show", "cancelled"] as const) {
      expect(bookingTransition("confirmed", to)).toBe(true);
    }
    expect(bookingTransition("confirmed", "requested")).toBe(false);
    expect(bookingTransition("confirmed", "declined")).toBe(false);
  });

  it("a finished booking never changes again", () => {
    for (const from of [
      "declined",
      "cancelled",
      "completed",
      "no_show",
    ] as const) {
      for (const to of BOOKING_STATUSES) {
        expect(bookingTransition(from, to)).toBe(false);
      }
    }
  });
});
