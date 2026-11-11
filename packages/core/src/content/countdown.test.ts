// Countdown state (CONT-10, D122, RESEARCH Pitfall 8).
import { describe, expect, it } from "vitest";
import {
  countdownAriaLabel,
  countdownState,
  formatShortUtc,
} from "./countdown";

const TARGET = "2026-10-12T14:00:00.000Z";

describe("countdownState", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    expect(countdownState(TARGET, new Date("2026-10-10T13:59:30Z"))).toEqual({
      done: false,
      days: 2,
      hours: 0,
      minutes: 0,
      seconds: 30,
    });
  });

  it("counts every unit", () => {
    expect(countdownState(TARGET, new Date("2026-10-11T10:57:55Z"))).toEqual({
      done: false,
      days: 1,
      hours: 3,
      minutes: 2,
      seconds: 5,
    });
  });

  it("is done exactly at the target", () => {
    expect(countdownState(TARGET, new Date(TARGET))).toEqual({ done: true });
  });

  it("is done after the target", () => {
    expect(countdownState(TARGET, new Date("2027-01-01T00:00:00Z"))).toEqual({
      done: true,
    });
  });

  it("is done for an unparseable target", () => {
    expect(countdownState("not-a-date", new Date(0))).toEqual({ done: true });
    expect(countdownState("", new Date(0))).toEqual({ done: true });
  });

  it("is done for an invalid now", () => {
    expect(countdownState(TARGET, new Date("nope"))).toEqual({ done: true });
  });

  it("floors a sub-second remainder so server and island agree", () => {
    expect(
      countdownState(TARGET, new Date("2026-10-12T13:59:59.400Z")),
    ).toEqual({ done: false, days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("countdownAriaLabel", () => {
  it("formats the target in UTC, deterministically", () => {
    expect(countdownAriaLabel("2026-10-12T09:00:00.000Z")).toBe(
      "Time left until 12 October 2026, 9:00 am",
    );
  });

  it("uses pm and two-digit minutes", () => {
    expect(countdownAriaLabel("2026-03-01T23:05:00.000Z")).toBe(
      "Time left until 1 March 2026, 11:05 pm",
    );
  });

  it("falls back to a plain label for a bad target", () => {
    expect(countdownAriaLabel("nope")).toBe("Countdown");
  });
});

describe("formatShortUtc", () => {
  it("formats day, short month and time", () => {
    expect(formatShortUtc("2026-10-12T09:00:00.000Z")).toBe("12 Oct, 9:00 am");
    expect(formatShortUtc("2026-10-19T23:59:00.000Z")).toBe("19 Oct, 11:59 pm");
  });

  it("renders midnight and noon as 12", () => {
    expect(formatShortUtc("2026-01-02T00:00:00Z")).toBe("2 Jan, 12:00 am");
    expect(formatShortUtc("2026-01-02T12:30:00Z")).toBe("2 Jan, 12:30 pm");
  });

  it("returns an empty string for a bad date", () => {
    expect(formatShortUtc("x")).toBe("");
  });
});
