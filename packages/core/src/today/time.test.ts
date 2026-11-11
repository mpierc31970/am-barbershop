import { describe, expect, it } from "vitest";
import {
  businessDate,
  businessTimeZone,
  DEFAULT_TIME_ZONE,
  greetingFor,
  startOfBusinessDayUtc,
  weekBounds,
  zonedMinutes,
} from "./index";

const CHI = "America/Chicago";

describe("businessTimeZone", () => {
  it("falls back to America/Chicago", () => {
    expect(DEFAULT_TIME_ZONE).toBe(CHI);
    expect(businessTimeZone("Not/AZone")).toBe(CHI);
    expect(businessTimeZone("")).toBe(CHI);
    expect(businessTimeZone(undefined)).toBe(CHI);
    expect(businessTimeZone(null)).toBe(CHI);
    expect(businessTimeZone("Europe/London")).toBe("Europe/London");
  });
});

describe("businessDate", () => {
  it("uses the business zone on the DST day", () => {
    expect(businessDate(new Date("2026-03-08T07:30:00Z"), CHI)).toBe(
      "2026-03-08",
    );
    expect(businessDate(new Date("2026-03-08T04:30:00Z"), CHI)).toBe(
      "2026-03-07",
    );
  });

  it("differs from UTC late in the evening", () => {
    expect(businessDate(new Date("2026-10-12T03:00:00Z"), CHI)).toBe(
      "2026-10-11",
    );
  });
});

describe("weekBounds", () => {
  it("returns Monday-start weeks of 7 days across spring-forward", () => {
    const w = weekBounds(new Date("2026-03-09T15:00:00Z"), CHI);
    expect(w.current).toHaveLength(7);
    expect(w.previous).toHaveLength(7);
    expect(w.current[0]).toBe("2026-03-09");
    expect(w.current[6]).toBe("2026-03-15");
    expect(w.previous[0]).toBe("2026-03-02");
    expect(w.previous[6]).toBe("2026-03-08");
  });

  it("handles fall-back and a Sunday", () => {
    const w = weekBounds(new Date("2026-11-01T18:00:00Z"), CHI);
    expect(w.current[0]).toBe("2026-10-26");
    expect(w.current[6]).toBe("2026-11-01");
    expect(w.previous[0]).toBe("2026-10-19");
  });
});

describe("greetingFor", () => {
  it("greets by business time", () => {
    expect(greetingFor(new Date("2026-10-11T13:00:00Z"), CHI)).toBe(
      "Good morning",
    );
    expect(greetingFor(new Date("2026-10-11T18:00:00Z"), CHI)).toBe(
      "Good afternoon",
    );
    expect(greetingFor(new Date("2026-10-11T22:59:00Z"), CHI)).toBe(
      "Good afternoon",
    );
    expect(greetingFor(new Date("2026-10-11T23:00:00Z"), CHI)).toBe(
      "Good evening",
    );
    expect(greetingFor(new Date("2026-10-11T09:59:00Z"), CHI)).toBe(
      "Good evening",
    );
    expect(greetingFor(new Date("2026-10-11T10:00:00Z"), CHI)).toBe(
      "Good morning",
    );
  });
});

describe("zonedMinutes", () => {
  it("counts minutes since local midnight", () => {
    expect(zonedMinutes(new Date("2026-10-11T13:30:00Z"), CHI)).toBe(
      8 * 60 + 30,
    );
    expect(zonedMinutes(new Date("2026-10-11T05:00:00Z"), CHI)).toBe(0);
  });
});

describe("startOfBusinessDayUtc", () => {
  it("is local midnight in UTC, DST-aware", () => {
    expect(startOfBusinessDayUtc("2026-10-11", CHI).toISOString()).toBe(
      "2026-10-11T05:00:00.000Z",
    );
    expect(startOfBusinessDayUtc("2026-01-15", CHI).toISOString()).toBe(
      "2026-01-15T06:00:00.000Z",
    );
    expect(startOfBusinessDayUtc("2026-03-08", CHI).toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
    expect(startOfBusinessDayUtc("2026-03-09", CHI).toISOString()).toBe(
      "2026-03-09T05:00:00.000Z",
    );
  });
});
