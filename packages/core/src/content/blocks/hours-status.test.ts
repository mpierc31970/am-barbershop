// Hours status helpers (07-24; CONT-27, D257; UI-SPEC copy row 645).
import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "../../intake/snapshot";
import {
  formatClock,
  hoursRows,
  openStatus,
  timeZoneLabel,
} from "./hours-status";

const TZ = "America/Chicago";
const closed = { open: false, ranges: [] };
const nineFive = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };

function weekdays(over: Partial<WeeklyHours> = {}): WeeklyHours {
  return {
    mon: nineFive,
    tue: nineFive,
    wed: nineFive,
    thu: nineFive,
    fri: nineFive,
    sat: closed,
    sun: closed,
    ...over,
  };
}

// Wednesday 7 Oct 2026. Chicago is UTC-5 (CDT) then.
const at = (iso: string) => new Date(iso);
const WED_10 = at("2026-10-07T15:00:00Z");

describe("formatClock", () => {
  it("formats 12-hour am/pm", () => {
    expect(formatClock("09:00")).toBe("9:00 am");
    expect(formatClock("12:00")).toBe("12:00 pm");
    expect(formatClock("00:15")).toBe("12:15 am");
    expect(formatClock("17:30")).toBe("5:30 pm");
  });
  it("invalid input is blank", () => {
    expect(formatClock("9am")).toBe("");
    expect(formatClock("25:00")).toBe("");
  });
});

describe("hoursRows", () => {
  it("seven rows Monday first with joined ranges and Closed", () => {
    const rows = hoursRows(
      weekdays({
        tue: {
          open: true,
          ranges: [
            { start: "13:00", end: "17:00" },
            { start: "09:00", end: "12:00" },
          ],
        },
      }),
      TZ,
      WED_10,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(rows[0]).toEqual({
      day: "mon",
      label: "Monday",
      text: "9:00 am to 5:00 pm",
      closed: false,
      today: false,
    });
    expect(rows[1]!.text).toBe("9:00 am to 12:00 pm, 1:00 pm to 5:00 pm");
    expect(rows[5]).toMatchObject({ text: "Closed", closed: true });
    expect(rows.filter((r) => r.today).map((r) => r.day)).toEqual(["wed"]);
  });

  it("today follows the business zone, not UTC", () => {
    // Monday 03:00 UTC is still Sunday evening in Chicago.
    const rows = hoursRows(weekdays(), TZ, at("2026-10-05T03:00:00Z"));
    expect(rows.find((r) => r.today)?.day).toBe("sun");
  });

  it("null hours: seven closed rows; an invalid zone marks no today", () => {
    const rows = hoursRows(null, TZ, WED_10);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.closed && r.text === "Closed")).toBe(true);
    expect(
      hoursRows(weekdays(), "Not/AZone", WED_10).some((r) => r.today),
    ).toBe(false);
  });
});

describe("openStatus", () => {
  it("inside a range is open with the closing time", () => {
    expect(openStatus(weekdays(), TZ, WED_10)).toEqual({
      open: true,
      label: "Open now · Closes at 5:00 pm",
    });
  });

  it("before the first range opens today", () => {
    expect(openStatus(weekdays(), TZ, at("2026-10-07T12:00:00Z"))).toEqual({
      open: false,
      label: "Closed now · Opens at 9:00 am",
    });
  });

  it("after closing on Friday opens Monday", () => {
    expect(openStatus(weekdays(), TZ, at("2026-10-09T23:30:00Z"))).toEqual({
      open: false,
      label: "Closed now · Opens Monday at 9:00 am",
    });
  });

  it("after closing midweek names tomorrow by weekday", () => {
    expect(openStatus(weekdays(), TZ, at("2026-10-07T22:01:00Z"))?.label).toBe(
      "Closed now · Opens Thursday at 9:00 am",
    );
  });

  it("a lunch gap opens at the next range", () => {
    const hours = weekdays({
      wed: {
        open: true,
        ranges: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      },
    });
    expect(openStatus(hours, TZ, at("2026-10-07T17:30:00Z"))?.label).toBe(
      "Closed now · Opens at 1:00 pm",
    );
  });

  it("all closed, null hours or an invalid zone is null (never throws)", () => {
    const shut = weekdays({
      mon: closed,
      tue: closed,
      wed: closed,
      thu: closed,
      fri: closed,
    });
    expect(openStatus(shut, TZ, WED_10)).toBeNull();
    expect(openStatus(null, TZ, WED_10)).toBeNull();
    expect(openStatus(weekdays(), "Not/AZone", WED_10)).toBeNull();
    expect(openStatus(weekdays(), "", WED_10)).toBeNull();
    expect(openStatus(weekdays(), TZ, new Date(NaN))).toBeNull();
  });
});

describe("timeZoneLabel", () => {
  it("names the zone generically", () => {
    expect(timeZoneLabel("America/Chicago")).toBe("Central Time");
  });
  it("invalid or blank is empty", () => {
    expect(timeZoneLabel("Not/AZone")).toBe("");
    expect(timeZoneLabel("")).toBe("");
  });
});
