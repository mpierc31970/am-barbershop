// UI-SPEC Voice: "$1,500" (no cents when whole), "$583.33", "$39/mo", "$390/yr".
import { describe, expect, it } from "vitest";
import { formatCents, formatMonthly, formatYearly } from "./index";

describe("money formatting", () => {
  it("drops cents when whole", () => {
    expect(formatCents(150000)).toBe("$1,500");
    expect(formatCents(0)).toBe("$0");
  });

  it("keeps cents when not whole", () => {
    expect(formatCents(58333)).toBe("$583.33");
    expect(formatCents(63233)).toBe("$632.33");
    expect(formatCents(1450)).toBe("$14.50");
  });

  it("formats monthly and yearly", () => {
    expect(formatMonthly(3900)).toBe("$39/mo");
    expect(formatYearly(39000)).toBe("$390/yr");
  });
});
