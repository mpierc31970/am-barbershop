import { emptyWeeklyHours } from "@cds/core/intake";
import { describe, expect, it } from "vitest";
import { addDays, openSlots, utcToZoned, zonedToUtc } from "./slots";

const TZ = "America/Chicago";
const hours = emptyWeeklyHours();
hours.wed = { open: true, ranges: [{ start: "09:00", end: "12:00" }] };
// Wed 2026-11-11, 6:00 am Chicago (CST, UTC-6) = 12:00 UTC.
const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("openSlots", () => {
  it("converts wall clock to UTC across DST", () => {
    expect(new Date(zonedToUtc("2026-11-11", "09:00", TZ)).toISOString()).toBe(
      "2026-11-11T15:00:00.000Z",
    );
    expect(new Date(zonedToUtc("2026-07-01", "09:00", TZ)).toISOString()).toBe(
      "2026-07-01T14:00:00.000Z",
    );
    expect(utcToZoned(Date.parse("2026-11-11T15:00:00Z"), TZ)).toEqual({
      date: "2026-11-11",
      time: "09:00",
    });
  });

  it("steps through the working range and keeps the service inside it", () => {
    const s = openSlots({
      date: "2026-11-11",
      hours,
      timeOff: [],
      busy: [],
      durationMin: 45,
      tz: TZ,
      now: NOW,
    });
    expect(s[0]?.time).toBe("09:00");
    expect(s.at(-1)?.time).toBe("11:15");
    expect(s).toHaveLength(10);
  });

  it("skips busy ranges, time off, closed days, the lead time and the past", () => {
    const busy = [
      {
        start: zonedToUtc("2026-11-11", "10:00", TZ),
        end: zonedToUtc("2026-11-11", "10:30", TZ),
      },
    ];
    const s = openSlots({
      date: "2026-11-11",
      hours,
      timeOff: [],
      busy,
      durationMin: 30,
      tz: TZ,
      now: NOW,
    });
    expect(s.map((x) => x.time)).not.toContain("10:00");
    expect(s.map((x) => x.time)).not.toContain("09:45");
    expect(s.map((x) => x.time)).toContain("10:30");
    const off = [{ start: "2026-11-10", end: "2026-11-12" }];
    expect(
      openSlots({
        date: "2026-11-11",
        hours,
        timeOff: off,
        busy: [],
        durationMin: 30,
        tz: TZ,
        now: NOW,
      }),
    ).toEqual([]);
    expect(
      openSlots({
        date: "2026-11-12",
        hours,
        timeOff: [],
        busy: [],
        durationMin: 30,
        tz: TZ,
        now: NOW,
      }),
    ).toEqual([]);
    const late = Date.parse("2026-11-11T16:30:00Z"); // 10:30 local: earliest 11:30
    expect(
      openSlots({
        date: "2026-11-11",
        hours,
        timeOff: [],
        busy: [],
        durationMin: 30,
        tz: TZ,
        now: late,
      }).map((x) => x.time),
    ).toEqual(["11:30"]);
    expect(
      openSlots({
        date: "2026-11-04",
        hours,
        timeOff: [],
        busy: [],
        durationMin: 30,
        tz: TZ,
        now: NOW,
      }),
    ).toEqual([]);
    expect(
      openSlots({
        date: addDays("2026-11-11", 35),
        hours,
        timeOff: [],
        busy: [],
        durationMin: 30,
        tz: TZ,
        now: NOW,
      }),
    ).toEqual([]);
  });
});
