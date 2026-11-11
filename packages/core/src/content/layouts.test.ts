// Ported from donor src/lib/section-layouts.test.ts (CONT-03, invariant 6), adapted to the
// registry-era signature clampLayout(allowed, layout), plus the D76 flip table.
import { describe, expect, it } from "vitest";
import type { RowLayout } from "./types";
import {
  ALL_LAYOUTS,
  COLUMN_COUNT,
  FLIP_PAIRS,
  FULL_WIDTH_ONLY,
  canFlip,
  clampLayout,
  columnCountFor,
  flipLayout,
  isRowLayout,
} from "./layouts";

const DONOR_LAYOUTS: RowLayout[] = [
  "full",
  "50-50",
  "25-75",
  "75-25",
  "40-60",
  "60-40",
  "30-70",
  "70-30",
  "33-33-33",
  "25-50-25",
  "25-25-25-25",
  "20-20-20-20-20",
];

describe("COLUMN_COUNT", () => {
  it("has an entry for every RowLayout", () => {
    for (const layout of DONOR_LAYOUTS) {
      expect(COLUMN_COUNT[layout]).toBeGreaterThan(0);
    }
  });

  it("derives the count from the layout name", () => {
    expect(COLUMN_COUNT["full"]).toBe(1);
    expect(COLUMN_COUNT["40-60"]).toBe(2);
    expect(COLUMN_COUNT["25-50-25"]).toBe(3);
    expect(COLUMN_COUNT["25-25-25-25"]).toBe(4);
    expect(COLUMN_COUNT["20-20-20-20-20"]).toBe(5);
  });

  it("matches the number of ratio parts in every layout id", () => {
    for (const layout of DONOR_LAYOUTS) {
      const parts = layout === "full" ? 1 : layout.split("-").length;
      expect(COLUMN_COUNT[layout]).toBe(parts);
    }
  });
});

describe("ALL_LAYOUTS", () => {
  it("is exactly the 12 donor layouts, in donor order", () => {
    expect([...ALL_LAYOUTS]).toEqual(DONOR_LAYOUTS);
  });

  it("puts full first so it is the clamp fallback", () => {
    expect(ALL_LAYOUTS[0]).toBe("full");
    expect([...FULL_WIDTH_ONLY]).toEqual(["full"]);
  });
});

describe("isRowLayout", () => {
  it("accepts the 12 layouts and rejects anything else, including inherited keys", () => {
    for (const layout of DONOR_LAYOUTS) expect(isRowLayout(layout)).toBe(true);
    expect(isRowLayout("bogus")).toBe(false);
    expect(isRowLayout("toString")).toBe(false);
    expect(isRowLayout("__proto__")).toBe(false);
    expect(isRowLayout(undefined)).toBe(false);
    expect(isRowLayout(2)).toBe(false);
  });
});

describe("columnCountFor", () => {
  it("returns the count for a known layout", () => {
    expect(columnCountFor("33-33-33")).toBe(3);
  });

  it("falls back to one column for an unknown value", () => {
    expect(columnCountFor("nonsense" as RowLayout)).toBe(1);
    expect(columnCountFor("toString" as RowLayout)).toBe(1);
  });
});

describe("clampLayout", () => {
  it("passes an allowed layout through unchanged", () => {
    expect(clampLayout(ALL_LAYOUTS, "25-50-25")).toBe("25-50-25");
    expect(clampLayout(ALL_LAYOUTS, "25-75")).toBe("25-75");
  });

  it("clamps a predefined block to full whatever the row stores", () => {
    expect(clampLayout(FULL_WIDTH_ONLY, "25-25-25-25")).toBe("full");
    expect(clampLayout(["full"], "50-50")).toBe("full");
  });

  it("falls back when the stored layout is undefined", () => {
    expect(clampLayout(FULL_WIDTH_ONLY, undefined)).toBe("full");
  });

  it("falls back to allowed[0] when the stored layout is not a RowLayout at all", () => {
    expect(clampLayout(ALL_LAYOUTS, "bogus")).toBe(ALL_LAYOUTS[0]);
    expect(clampLayout(ALL_LAYOUTS, { toString: () => "50-50" })).toBe("full");
    expect(clampLayout(["50-50", "25-75"], "full")).toBe("50-50");
  });

  it("falls back to full when the allowlist is empty", () => {
    expect(clampLayout([], "50-50")).toBe("full");
  });
});

describe("flip (D76, CONTEXT A4-Q2)", () => {
  const asymmetricTwo = ["25-75", "75-25", "40-60", "60-40", "30-70", "70-30"];

  it("can flip exactly the six asymmetric two-column layouts", () => {
    expect(Object.keys(FLIP_PAIRS).sort()).toEqual([...asymmetricTwo].sort());
    for (const layout of DONOR_LAYOUTS) {
      expect(canFlip(layout)).toBe(asymmetricTwo.includes(layout));
    }
  });

  it("swaps the widths", () => {
    expect(flipLayout("25-75")).toBe("75-25");
    expect(flipLayout("60-40")).toBe("40-60");
    expect(flipLayout("30-70")).toBe("70-30");
  });

  it("leaves every non-flippable layout unchanged", () => {
    for (const layout of DONOR_LAYOUTS.filter((l) => !canFlip(l))) {
      expect(flipLayout(layout)).toBe(layout);
    }
  });

  it("is an involution for all 12 layouts", () => {
    for (const layout of DONOR_LAYOUTS) {
      expect(flipLayout(flipLayout(layout))).toBe(layout);
    }
  });

  it("keeps the column count", () => {
    for (const layout of DONOR_LAYOUTS) {
      expect(columnCountFor(flipLayout(layout))).toBe(columnCountFor(layout));
    }
  });

  it("rejects inherited keys", () => {
    expect(canFlip("toString")).toBe(false);
  });
});
