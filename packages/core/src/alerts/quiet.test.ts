import { describe, expect, it } from "vitest";
import {
  COLLAPSE_WINDOW_MS,
  DEFAULT_QUIET_HOURS,
  DIGEST_HOUR,
  collapseWindowOpen,
  digestDue,
  inQuietHours,
  quietEndsAt,
} from "./index";

const TZ = "America/Chicago";
// 2026-10-12 is CDT (UTC-5): local HH:MM = UTC - 5h.
const cdt = (hhmm: string, day = "2026-10-12") => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!, h! + 5, m!));
};

describe("inQuietHours", () => {
  it("uses the 21:00-07:00 default across midnight", () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({
      on: true,
      from: "21:00",
      until: "07:00",
    });
    expect(inQuietHours(cdt("22:30"), TZ, undefined)).toBe(true);
    expect(inQuietHours(cdt("06:59"), TZ, undefined)).toBe(true);
    expect(inQuietHours(cdt("07:00"), TZ, undefined)).toBe(false);
    expect(inQuietHours(cdt("20:59"), TZ, undefined)).toBe(false);
    expect(inQuietHours(cdt("21:00"), TZ, undefined)).toBe(true);
  });

  it("off is never quiet", () => {
    const q = { on: false, from: "21:00", until: "07:00" };
    expect(inQuietHours(cdt("23:00"), TZ, q)).toBe(false);
  });

  it("handles a window that does not cross midnight", () => {
    const q = { on: true, from: "13:00", until: "14:00" };
    expect(inQuietHours(cdt("12:59"), TZ, q)).toBe(false);
    expect(inQuietHours(cdt("13:00"), TZ, q)).toBe(true);
    expect(inQuietHours(cdt("13:59"), TZ, q)).toBe(true);
    expect(inQuietHours(cdt("14:00"), TZ, q)).toBe(false);
  });

  it("an empty window (from = until) is never quiet", () => {
    const q = { on: true, from: "07:00", until: "07:00" };
    expect(inQuietHours(cdt("07:00"), TZ, q)).toBe(false);
  });

  it("falls back to the default on malformed times", () => {
    const q = { on: true, from: "9pm", until: "25:00" };
    expect(inQuietHours(cdt("22:30"), TZ, q)).toBe(true);
    expect(inQuietHours(cdt("12:00"), TZ, q)).toBe(false);
  });

  it("uses business time, not UTC", () => {
    // 22:30 in Los Angeles (PDT, UTC-7) is 05:30Z next day.
    const t = new Date(Date.UTC(2026, 9, 13, 5, 30));
    expect(inQuietHours(t, "America/Los_Angeles", undefined)).toBe(true);
    expect(inQuietHours(t, "Asia/Tokyo", undefined)).toBe(false);
  });
});

describe("quietEndsAt", () => {
  it("23:00 ends at the next 07:00 local", () => {
    expect(quietEndsAt(cdt("23:00"), TZ, undefined).toISOString()).toBe(
      "2026-10-13T12:00:00.000Z",
    );
  });

  it("03:00 ends at 07:00 the same morning", () => {
    expect(quietEndsAt(cdt("03:00"), TZ, undefined).toISOString()).toBe(
      "2026-10-12T12:00:00.000Z",
    );
  });

  it("is now when not in quiet hours", () => {
    const now = cdt("12:00");
    expect(quietEndsAt(now, TZ, undefined).getTime()).toBe(now.getTime());
  });

  it("is correct on the fall-back night (2026-11-01, CDT -> CST)", () => {
    // 23:00 CDT on 31 Oct = 04:00Z; 07:00 CST on 1 Nov = 13:00Z.
    const now = new Date(Date.UTC(2026, 10, 1, 4, 0));
    expect(inQuietHours(now, TZ, undefined)).toBe(true);
    expect(quietEndsAt(now, TZ, undefined).toISOString()).toBe(
      "2026-11-01T13:00:00.000Z",
    );
  });

  it("is correct on the spring-forward night (2027-03-14, CST -> CDT)", () => {
    // 23:00 CST on 13 Mar = 05:00Z; 07:00 CDT on 14 Mar = 12:00Z.
    const now = new Date(Date.UTC(2027, 2, 14, 5, 0));
    expect(quietEndsAt(now, TZ, undefined).toISOString()).toBe(
      "2027-03-14T12:00:00.000Z",
    );
  });

  it("non-crossing window ends at its until", () => {
    const q = { on: true, from: "13:00", until: "14:00" };
    expect(quietEndsAt(cdt("13:30"), TZ, q).toISOString()).toBe(
      "2026-10-12T19:00:00.000Z",
    );
  });
});

describe("collapseWindowOpen", () => {
  const now = new Date("2026-10-12T15:00:00Z");
  it("is a 10-minute window", () => {
    expect(COLLAPSE_WINDOW_MS).toBe(600_000);
    expect(collapseWindowOpen(new Date(now.getTime() - 9 * 60_000), now)).toBe(
      true,
    );
    expect(collapseWindowOpen(new Date(now.getTime() - 11 * 60_000), now)).toBe(
      false,
    );
  });

  it("accepts ISO strings and treats missing or bad values as closed", () => {
    expect(collapseWindowOpen("2026-10-12T14:55:00Z", now)).toBe(true);
    expect(collapseWindowOpen(null, now)).toBe(false);
    expect(collapseWindowOpen(undefined, now)).toBe(false);
    expect(collapseWindowOpen("", now)).toBe(false);
    expect(collapseWindowOpen("not a date", now)).toBe(false);
  });

  it("a push in the future does not open the window", () => {
    expect(collapseWindowOpen(new Date(now.getTime() + 60_000), now)).toBe(
      false,
    );
  });
});

describe("digestDue", () => {
  it("is due from 07:00 business time, once per business day", () => {
    expect(DIGEST_HOUR).toBe(7);
    expect(digestDue(cdt("06:59"), TZ, "")).toBe(false);
    expect(digestDue(cdt("07:05"), TZ, "")).toBe(true);
    expect(digestDue(cdt("07:05"), TZ, "2026-10-11")).toBe(true);
    expect(digestDue(cdt("07:05"), TZ, "2026-10-12")).toBe(false);
    expect(digestDue(cdt("23:30"), TZ, null)).toBe(true);
  });

  it("uses the business-local day near midnight UTC", () => {
    // 20:00 CDT on 12 Oct = 01:00Z on 13 Oct; the business day is still the 12th.
    const t = new Date(Date.UTC(2026, 9, 13, 1, 0));
    expect(digestDue(t, TZ, "2026-10-12")).toBe(false);
  });
});
