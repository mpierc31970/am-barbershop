// Studio Booking tiers (BILL-10, BILL-16, D179, D263; 10-11 choice 6). Pure.
// The one place a staff count maps to a tier. A Studio tenant has ONE Studio Booking
// subscription item, always keyed STUDIO_BOOKING_ITEM; moving between tiers swaps that item's
// price to another catalog row (studio path only, D176-D178), never adds a second item.

/** The single subscription item key for Studio Booking, whatever the tier. */
export const STUDIO_BOOKING_ITEM = "studio-booking";

export const STUDIO_BOOKING_TIER_KEYS = [
  "studio-booking-solo",
  "studio-booking-team",
  "studio-booking-large-team",
] as const;
export type StudioBookingTierKey = (typeof STUDIO_BOOKING_TIER_KEYS)[number];

/** 1 staff → solo ($49); 2-5 → team ($99); 6+ → large-team ($179). */
export function studioBookingTierKey(staffCount: number): StudioBookingTierKey {
  if (!Number.isSafeInteger(staffCount) || staffCount < 1) {
    throw new RangeError("staff count must be a whole number of 1 or more");
  }
  if (staffCount === 1) return "studio-booking-solo";
  if (staffCount <= 5) return "studio-booking-team";
  return "studio-booking-large-team";
}

export type StudioBookingTierChange = {
  item: typeof STUDIO_BOOKING_ITEM;
  fromKey: StudioBookingTierKey;
  toKey: StudioBookingTierKey;
  /** true when the price on the one item changes (a different tier row). */
  swap: boolean;
};

export function studioBookingTierChange(
  fromStaff: number,
  toStaff: number,
): StudioBookingTierChange {
  const fromKey = studioBookingTierKey(fromStaff);
  const toKey = studioBookingTierKey(toStaff);
  return { item: STUDIO_BOOKING_ITEM, fromKey, toKey, swap: fromKey !== toKey };
}
