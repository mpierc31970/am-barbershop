import { describe, expect, it } from "vitest";
import { advanceDue, daysLate } from "./leases";

describe("lease dates", () => {
  it("advances by the cadence; monthly keeps the day, clamped to the month's end", () => {
    expect(advanceDue("2026-11-11", "weekly")).toBe("2026-11-18");
    expect(advanceDue("2026-12-28", "biweekly")).toBe("2027-01-11");
    expect(advanceDue("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(advanceDue("2027-01-31", "monthly")).toBe("2027-02-28");
  });

  it("counts days late only for an active lease past its due date", () => {
    expect(daysLate("2026-11-08", "2026-11-11", true)).toBe(3);
    expect(daysLate("2026-11-11", "2026-11-11", true)).toBe(0);
    expect(daysLate("2026-11-08", "2026-11-11", false)).toBe(0);
  });
});
