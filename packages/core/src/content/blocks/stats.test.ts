// Stats block (07-06; CONT-27; T-07-06-03, -04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  STATS_LIMITS,
  STATS_VALUE,
  defaultStatsContent,
  statsSection,
  validateStatsContent,
} from "./stats";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("stats content", () => {
  it("default: 3 items, fresh ids, count_up, and validates", () => {
    const d = defaultStatsContent();
    expect(d.count_up).toBe(true);
    expect(d.items).toHaveLength(3);
    for (const i of d.items) {
      expect(i).toEqual({
        id: i.id,
        value: "0",
        prefix: "",
        suffix: "",
        label: "",
      });
    }
    expect(new Set(d.items.map((i) => i.id)).size).toBe(3);
    expect(defaultStatsContent().items[0]!.id).not.toBe(d.items[0]!.id);
    expect(validateStatsContent(d)).toEqual(d);
    expect(Object.isFrozen(STATS_LIMITS)).toBe(true);
  });

  it("accepts digit values and refuses others", () => {
    for (const value of ["250", "1,200", "4.9", "", "1200", "1,000,000"]) {
      expect(validateStatsContent({ items: [{ value }] }).items[0]!.value).toBe(
        value,
      );
    }
    for (const value of ["12abc", "1e9", "-5", "1,2", "4.999"]) {
      expect(msg(() => validateStatsContent({ items: [{ value }] }))).toBe(
        "Use digits for the number, like 250, 1,200 or 4.9.",
      );
    }
    expect(STATS_VALUE.test("250")).toBe(true);
  });

  it("refuses more than 6 items and caps prefix", () => {
    const over = Array.from({ length: 7 }, () => ({ value: "1" }));
    expect(msg(() => validateStatsContent({ items: over }))).toBe(
      "Stats hold up to 6 numbers.",
    );
    expect(() =>
      validateStatsContent({ items: [{ prefix: "$$$$$" }] }),
    ).toThrow("Keep this under 4 characters.");
  });

  it("drafts stay saveable: one item, empty labels", () => {
    expect(() =>
      validateStatsContent({ items: [{ value: "" }] }),
    ).not.toThrow();
  });
});

describe("statsSection", () => {
  it("contract", () => {
    expect(statsSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(statsSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(() =>
      statsSection.validate(statsSection.defaultContent(), "full"),
    ).not.toThrow();
    const c = validateStatsContent({
      heading: "By the numbers",
      items: [{ id: "a", value: "250", suffix: "+", label: "clients" }],
    });
    expect(statsSection.refsOf(c)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    expect(statsSection.textsOf(c)).toEqual([
      "By the numbers",
      "250",
      "+",
      "clients",
    ]);
    expect(statsSection.urlsOf(c)).toEqual([]);
    expect(statsSection.mapRichText(c, () => "X")).toEqual(c);
  });
});
