import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  bookingCancelToken,
  bookingTransition,
  CANCEL_CUTOFF_MS,
  clientCanCancel,
  isFlagged,
  OWNER_FLAG_HOURS,
  verifyCancelToken,
} from "./bookings";

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

describe("client self-cancel", () => {
  it("the token round-trips; tampered, foreign-shaped or junk tokens are refused", () => {
    const t = bookingCancelToken("abcdefghijklmno");
    expect(t).toMatch(/^v1\.abcdefghijklmno\.[A-Za-z0-9_-]{43}$/);
    expect(verifyCancelToken(t)).toBe("abcdefghijklmno");
    const other = bookingCancelToken("zzzzzzzzzzzzzzz");
    expect(verifyCancelToken(t.slice(0, 19) + other.slice(19))).toBeNull();
    expect(
      verifyCancelToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")),
    ).toBeNull();
    expect(verifyCancelToken("")).toBeNull();
    expect(verifyCancelToken(42)).toBeNull();
    expect(() => bookingCancelToken("../x")).toThrow();
  });

  it("requests and confirmed bookings, until 2 hours before; nothing else", () => {
    const start = Date.parse("2030-01-08T16:00:00Z");
    const before = (ms: number) => start - ms;
    expect(
      clientCanCancel("requested", start, before(CANCEL_CUTOFF_MS + 1)),
    ).toBe("ok");
    expect(clientCanCancel("confirmed", start, before(3 * 3_600_000))).toBe(
      "ok",
    );
    expect(clientCanCancel("confirmed", start, before(CANCEL_CUTOFF_MS))).toBe(
      "late",
    );
    expect(clientCanCancel("confirmed", start, start + 1)).toBe("late");
    for (const st of [
      "declined",
      "cancelled",
      "completed",
      "no_show",
    ] as const) {
      expect(clientCanCancel(st, start, before(86_400_000))).toBe("closed");
    }
  });
});

describe("owner flag (A&M)", () => {
  const start = Date.parse("2030-01-08T16:00:00.000Z");
  const h = 3_600_000;
  it("a request is flagged only inside OWNER_FLAG_HOURS of its start", () => {
    expect(
      isFlagged("requested", start, start - OWNER_FLAG_HOURS * h - 1),
    ).toBe(false);
    expect(isFlagged("requested", start, start - OWNER_FLAG_HOURS * h)).toBe(
      true,
    );
    expect(isFlagged("confirmed", start, start - h)).toBe(false);
  });
});
