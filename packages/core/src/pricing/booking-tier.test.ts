// BILL-10, BILL-16, D263: Studio Booking tiers are one subscription item whose price swaps.
import { describe, expect, it } from "vitest";
import {
  STUDIO_BOOKING_ITEM,
  studioBookingTierChange,
  studioBookingTierKey,
} from "./index";

describe("studioBookingTierKey", () => {
  it("maps staff count to the tier row", () => {
    expect(studioBookingTierKey(1)).toBe("studio-booking-solo");
    expect(studioBookingTierKey(2)).toBe("studio-booking-team");
    expect(studioBookingTierKey(5)).toBe("studio-booking-team");
    expect(studioBookingTierKey(6)).toBe("studio-booking-large-team");
    expect(studioBookingTierKey(40)).toBe("studio-booking-large-team");
  });

  it("refuses 0, negatives and fractions", () => {
    for (const n of [0, -1, 2.5, Number.NaN]) {
      expect(() => studioBookingTierKey(n)).toThrow(RangeError);
    }
  });
});

describe("studioBookingTierChange", () => {
  it("crossing a tier swaps the price on the same item", () => {
    expect(studioBookingTierChange(1, 3)).toEqual({
      item: "studio-booking",
      fromKey: "studio-booking-solo",
      toKey: "studio-booking-team",
      swap: true,
    });
  });

  it("staying inside a tier is no swap", () => {
    expect(studioBookingTierChange(3, 5)).toEqual({
      item: "studio-booking",
      fromKey: "studio-booking-team",
      toKey: "studio-booking-team",
      swap: false,
    });
  });

  it("the item key is identical for every input (never a second item)", () => {
    const pairs: [number, number][] = [
      [1, 1],
      [1, 6],
      [6, 1],
      [5, 6],
      [40, 2],
    ];
    for (const [a, b] of pairs) {
      expect(studioBookingTierChange(a, b).item).toBe(STUDIO_BOOKING_ITEM);
    }
  });
});
