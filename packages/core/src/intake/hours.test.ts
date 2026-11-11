// ONB-13, D257, D-UI-P6-23, RESEARCH Pitfall 14: weekly hours and time zones.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  emptyWeeklyHours,
  validateHours,
  validateTimeZone,
  type WeeklyHours,
} from "./index";

function week(
  mon: WeeklyHours["mon"],
  rest: Partial<WeeklyHours> = {},
): WeeklyHours {
  return { ...emptyWeeklyHours(), mon, ...rest };
}

const thrown = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
};

describe("validateHours (ONB-13)", () => {
  it("accepts a split day", () => {
    const h = validateHours(
      week({
        open: true,
        ranges: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      }),
    );
    expect(h.mon.ranges).toHaveLength(2);
    expect(h.tue).toEqual({ open: false, ranges: [] });
  });

  it("rejects a closing time before the opening time", () => {
    expect(
      thrown(() =>
        validateHours(
          week({ open: true, ranges: [{ start: "17:00", end: "09:00" }] }),
        ),
      ),
    ).toBe(
      "Monday's closing time is before its opening time. Pick a later closing time.",
    );
  });

  it("rejects an equal start and end", () => {
    expect(() =>
      validateHours(
        week({ open: true, ranges: [{ start: "09:00", end: "09:00" }] }),
      ),
    ).toThrow(InvalidInput);
  });

  it("rejects overlapping ranges", () => {
    expect(
      thrown(() =>
        validateHours(
          week({
            open: true,
            ranges: [
              { start: "09:00", end: "13:00" },
              { start: "12:00", end: "17:00" },
            ],
          }),
        ),
      ),
    ).toBe("Monday's times overlap. Adjust one range.");
  });

  it("uses the right day name in messages", () => {
    const h = emptyWeeklyHours();
    h.sat = { open: true, ranges: [{ start: "12:00", end: "10:00" }] };
    expect(thrown(() => validateHours(h))).toMatch(/^Saturday's/);
  });

  it("rejects times off the 15-minute grid and malformed times", () => {
    for (const bad of ["09:10", "9:00", "24:00", "12:60", "noon"]) {
      expect(() =>
        validateHours(
          week({ open: true, ranges: [{ start: bad, end: "23:45" }] }),
        ),
      ).toThrow(InvalidInput);
    }
  });

  it("rejects more than 4 ranges in a day", () => {
    const ranges = ["08", "10", "12", "14", "16"].map((h) => ({
      start: `${h}:00`,
      end: `${h}:30`,
    }));
    expect(() => validateHours(week({ open: true, ranges }))).toThrow(
      InvalidInput,
    );
  });

  it("an open day needs at least one range", () => {
    expect(() => validateHours(week({ open: true, ranges: [] }))).toThrow(
      InvalidInput,
    );
  });

  it("a closed day ignores its ranges and stores []", () => {
    const h = validateHours(
      week({ open: false, ranges: [{ start: "17:00", end: "09:00" }] }),
    );
    expect(h.mon).toEqual({ open: false, ranges: [] });
  });

  it("sorts ranges and drops unknown keys", () => {
    const h = validateHours({
      ...week({
        open: true,
        ranges: [
          { start: "13:00", end: "17:00" },
          { start: "09:00", end: "12:00" },
        ],
      }),
      funday: { open: true, ranges: [] },
    });
    expect(h.mon.ranges.map((r) => r.start)).toEqual(["09:00", "13:00"]);
    expect(Object.keys(h)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]);
  });

  it("rejects a non-object", () => {
    expect(() => validateHours("9 to 5")).toThrow(InvalidInput);
    expect(() => validateHours(null)).toThrow(InvalidInput);
  });

  it("touching ranges do not overlap", () => {
    expect(() =>
      validateHours(
        week({
          open: true,
          ranges: [
            { start: "09:00", end: "12:00" },
            { start: "12:00", end: "17:00" },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe("validateTimeZone (Pitfall 14)", () => {
  it("accepts IANA names and aliases", () => {
    expect(validateTimeZone("America/Chicago")).toBe("America/Chicago");
    expect(validateTimeZone("Asia/Calcutta")).toBe("Asia/Calcutta");
    expect(validateTimeZone(" UTC ")).toBe("UTC");
  });

  it("rejects unknown zones and non-strings", () => {
    expect(() => validateTimeZone("Mars/Base")).toThrow(InvalidInput);
    expect(() => validateTimeZone("")).toThrow(InvalidInput);
    expect(() => validateTimeZone(5)).toThrow(InvalidInput);
  });
});
