// Stats number parse/format (07-21; CONT-27): the count-up's last frame equals the typed value.
import { describe, expect, it } from "vitest";
import { formatStatsNumber, statsNumberParts } from "./stats-number";

describe("statsNumberParts", () => {
  it("parses grouped, decimal and plain values", () => {
    expect(statsNumberParts("1,200")).toEqual({
      target: 1200,
      decimals: 0,
      grouped: true,
    });
    expect(statsNumberParts("4.9")).toEqual({
      target: 4.9,
      decimals: 1,
      grouped: false,
    });
    expect(statsNumberParts("250")).toEqual({
      target: 250,
      decimals: 0,
      grouped: false,
    });
  });

  it("refuses blank and non-numbers", () => {
    expect(statsNumberParts("")).toBeNull();
    expect(statsNumberParts("12abc")).toBeNull();
  });
});

describe("formatStatsNumber", () => {
  it("formats in-between values with the typed shape", () => {
    expect(formatStatsNumber(600, statsNumberParts("1,200")!)).toBe("600");
    expect(formatStatsNumber(1234.5, { decimals: 1, grouped: true })).toBe(
      "1,234.5",
    );
    expect(formatStatsNumber(0, statsNumberParts("4.9")!)).toBe("0.0");
  });

  it.each(["250", "1,200", "4.9", "12,345,678", "0.25"])(
    "round-trips %s exactly",
    (v) => {
      const p = statsNumberParts(v)!;
      expect(formatStatsNumber(p.target, p)).toBe(v);
    },
  );
});
