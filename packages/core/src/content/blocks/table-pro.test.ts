// Pro table (10-35; BILL-14, D232, D233, invariant 9; T-10-35-01..03).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { tableSection, validateTableBlock } from "./table";
import type { TableBlockContent } from "./table";
import {
  EMPTY_TABLE_PRO,
  PRO_TABLE_COPY,
  PRO_TABLE_LIMIT_COPY,
  PRO_TABLE_MAX_COLUMNS,
  PRO_TABLE_MAX_ROWS,
  PRO_TABLE_PAGE_SIZE,
  PRO_TABLE_SHAPE_COPY,
  assertTablePlan,
  tableForRender,
  tableUsesPro,
} from "./table-pro";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

function grid(rows: number, cols: number) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `${r}:${c}`),
  );
}

function free(): TableBlockContent {
  return validateTableBlock({ rows: grid(3, 3) });
}

function withPro(pro: Record<string, unknown>, rows: unknown[] = grid(3, 3)) {
  return validateTableBlock({ rows, pro });
}

describe("Pro table constants", () => {
  it("ceiling, paging and copy", () => {
    expect(PRO_TABLE_MAX_COLUMNS).toBe(20);
    expect(PRO_TABLE_MAX_ROWS).toBe(1000);
    expect(PRO_TABLE_PAGE_SIZE).toBe(25);
    expect(PRO_TABLE_COPY).toBe(
      "Bigger tables, sorting, search and icons are part of Builder Pro.",
    );
  });
});

describe("validateTableBlock with Pro settings", () => {
  it("accepts 20 x 1,000 and refuses 21 columns or 1,001 rows", () => {
    expect(validateTableBlock({ rows: grid(1000, 20) }).rows).toHaveLength(
      1000,
    );
    expect(msg(() => validateTableBlock({ rows: grid(1, 21) }))).toBe(
      PRO_TABLE_LIMIT_COPY,
    );
    expect(msg(() => validateTableBlock({ rows: grid(1001, 1) }))).toBe(
      PRO_TABLE_LIMIT_COPY,
    );
  });

  it("a P7 free table has no pro key and no icons", () => {
    const v = free();
    expect(v).not.toHaveProperty("pro");
    expect(v.rows[0]![0]).not.toHaveProperty("icon");
  });

  it("rebuilds pro deny-by-default; unknown keys dropped; flags strict", () => {
    const v = withPro({
      sticky: true,
      sortable: "yes",
      searchable: true,
      paged: true,
      evil: 1,
      highlight: { column: 2, label: "  Best value ", x: 1 },
      widths: ["wide", "bogus", "narrow"],
      section_rows: [2, 0, 2],
    });
    expect(v.pro).toEqual({
      sticky: true,
      sortable: false,
      searchable: true,
      paged: true,
      highlight: { column: 2, label: "Best value" },
      widths: ["wide", "auto", "narrow"],
      section_rows: [0, 2],
    });
    expect(withPro({}).pro).toEqual(EMPTY_TABLE_PRO);
  });

  it("refuses highlight, section rows or widths that don't fit the table", () => {
    for (const pro of [
      { highlight: { column: 3 } },
      { highlight: { column: -1 } },
      { highlight: { column: 1.5 } },
      { highlight: { column: "1" } },
      { section_rows: [3] },
      { section_rows: ["0"] },
      { widths: ["wide", "wide"] },
    ]) {
      expect(msg(() => withPro(pro))).toBe(PRO_TABLE_SHAPE_COPY);
    }
    expect(withPro({ highlight: null, widths: [] }).pro?.highlight).toBeNull();
  });

  it("icons outside the enum are dropped; valid icons kept", () => {
    const v = validateTableBlock({
      rows: [
        [
          { text: "", icon: "yes" },
          { text: "", icon: "dash" },
          { text: "", icon: "<svg>" },
        ],
      ],
    });
    expect(v.rows[0]![0]!.icon).toBe("yes");
    expect(v.rows[0]![1]!.icon).toBe("dash");
    expect(v.rows[0]![2]).not.toHaveProperty("icon");
  });

  it("mapRichText deep-copies pro", () => {
    const v = withPro({
      highlight: { column: 0, label: "x" },
      widths: ["wide", "auto", "auto"],
      section_rows: [1],
    });
    const copy = tableSection.mapRichText(v, (h) => h) as TableBlockContent;
    expect(copy).toEqual(v);
    expect(copy.pro).not.toBe(v.pro);
    expect(copy.pro!.highlight).not.toBe(v.pro!.highlight);
    expect(copy.pro!.widths).not.toBe(v.pro!.widths);
    expect(copy.pro!.section_rows).not.toBe(v.pro!.section_rows);
  });
});

describe("tableUsesPro", () => {
  it("false for a free table (and all-auto widths, empty pro)", () => {
    expect(tableUsesPro(free())).toBe(false);
    expect(tableUsesPro(validateTableBlock({ rows: grid(200, 10) }))).toBe(
      false,
    );
    expect(tableUsesPro(withPro({ widths: ["auto", "auto", "auto"] }))).toBe(
      false,
    );
  });

  it("true for any Pro setting, an icon, or a size past 10 x 200", () => {
    for (const pro of [
      { sticky: true },
      { sortable: true },
      { searchable: true },
      { paged: true },
      { highlight: { column: 0, label: "" } },
      { widths: ["wide", "auto", "auto"] },
      { section_rows: [1] },
    ]) {
      expect(tableUsesPro(withPro(pro))).toBe(true);
    }
    expect(
      tableUsesPro(validateTableBlock({ rows: [[{ text: "", icon: "no" }]] })),
    ).toBe(true);
    expect(tableUsesPro(validateTableBlock({ rows: grid(201, 1) }))).toBe(true);
    expect(tableUsesPro(validateTableBlock({ rows: grid(1, 11) }))).toBe(true);
  });
});

describe("assertTablePlan", () => {
  const noPro = (previous: TableBlockContent | null) => ({
    proEntitled: false,
    previous,
  });

  it("a free table always passes; Builder Pro passes anything", () => {
    expect(() => assertTablePlan(free(), noPro(null))).not.toThrow();
    expect(() => assertTablePlan(free(), noPro(free()))).not.toThrow();
    const big = withPro({ sortable: true }, grid(1000, 20));
    expect(() =>
      assertTablePlan(big, { proEntitled: true, previous: null }),
    ).not.toThrow();
  });

  it("adding sort without Builder Pro is refused", () => {
    expect(
      msg(() => assertTablePlan(withPro({ sortable: true }), noPro(free()))),
    ).toBe(PRO_TABLE_COPY);
    expect(
      msg(() => assertTablePlan(withPro({ sortable: true }), noPro(null))),
    ).toBe(PRO_TABLE_COPY);
  });

  it("existing sort kept unchanged with text edits passes (lapse retains)", () => {
    const before = withPro({ sortable: true });
    const rows = grid(3, 3);
    rows[1]![1] = "edited";
    const after = withPro({ sortable: true }, rows);
    expect(() => assertTablePlan(after, noPro(before))).not.toThrow();
    // Turning it off is always allowed.
    expect(() => assertTablePlan(free(), noPro(before))).not.toThrow();
    // But adding search on top is not.
    expect(
      msg(() =>
        assertTablePlan(
          withPro({ sortable: true, searchable: true }),
          noPro(before),
        ),
      ),
    ).toBe(PRO_TABLE_COPY);
  });

  it("growing past 200 rows or 10 columns is refused; an existing big table may shrink", () => {
    const at200 = validateTableBlock({ rows: grid(200, 3) });
    expect(
      msg(() =>
        assertTablePlan(
          validateTableBlock({ rows: grid(201, 3) }),
          noPro(at200),
        ),
      ),
    ).toBe(PRO_TABLE_COPY);
    expect(
      msg(() =>
        assertTablePlan(
          validateTableBlock({ rows: grid(3, 11) }),
          noPro(free()),
        ),
      ),
    ).toBe(PRO_TABLE_COPY);
    const big = validateTableBlock({ rows: grid(300, 12) });
    expect(() =>
      assertTablePlan(validateTableBlock({ rows: grid(300, 12) }), noPro(big)),
    ).not.toThrow();
    expect(() =>
      assertTablePlan(validateTableBlock({ rows: grid(250, 12) }), noPro(big)),
    ).not.toThrow();
    expect(
      msg(() =>
        assertTablePlan(
          validateTableBlock({ rows: grid(301, 12) }),
          noPro(big),
        ),
      ),
    ).toBe(PRO_TABLE_COPY);
  });

  it("highlight, widths, section rows and icons may not grow past the previous save", () => {
    const before = withPro({
      highlight: { column: 1, label: "Best" },
      widths: ["wide", "auto", "auto"],
      section_rows: [1],
    });
    const same = withPro({
      highlight: { column: 1, label: "Best" },
      widths: ["wide", "auto", "auto"],
      section_rows: [1],
    });
    expect(() => assertTablePlan(same, noPro(before))).not.toThrow();
    for (const pro of [
      {
        highlight: { column: 1, label: "Cheapest" },
        widths: ["wide", "auto", "auto"],
        section_rows: [1],
      },
      {
        highlight: { column: 1, label: "Best" },
        widths: ["narrow", "auto", "auto"],
        section_rows: [1],
      },
      {
        highlight: { column: 1, label: "Best" },
        widths: ["wide", "auto", "auto"],
        section_rows: [1, 2],
      },
    ]) {
      expect(msg(() => assertTablePlan(withPro(pro), noPro(before)))).toBe(
        PRO_TABLE_COPY,
      );
    }
    const iconBefore = validateTableBlock({
      rows: [[{ text: "a", icon: "yes" }, "b"]],
    });
    const iconEdited = validateTableBlock({
      rows: [[{ text: "a2", icon: "yes" }, "b"]],
    });
    const iconAdded = validateTableBlock({
      rows: [
        [
          { text: "a", icon: "yes" },
          { text: "b", icon: "no" },
        ],
      ],
    });
    expect(() => assertTablePlan(iconEdited, noPro(iconBefore))).not.toThrow();
    expect(msg(() => assertTablePlan(iconAdded, noPro(iconBefore)))).toBe(
      PRO_TABLE_COPY,
    );
  });
});

describe("assertTablePlan: lapsed owners can restructure (review WR-B01)", () => {
  const noPro = (previous: TableBlockContent | null) => ({
    proEntitled: false,
    previous,
  });
  function cells(rows: number, cols: number, icon: [number, number]) {
    return grid(rows, cols).map((row, r) =>
      row.map((text, c) =>
        r === icon[0] && c === icon[1] ? { text, icon: "yes" } : text,
      ),
    );
  }

  it("inserting a row above a section row and an icon passes", () => {
    const before = withPro(
      { section_rows: [2], highlight: { column: 1, label: "Best" } },
      cells(5, 3, [3, 1]),
    );
    // The builder shifts the section row and the icon down by one.
    const after = withPro(
      { section_rows: [3], highlight: { column: 1, label: "Best" } },
      cells(6, 3, [4, 1]),
    );
    expect(() => assertTablePlan(after, noPro(before))).not.toThrow();
  });

  it("deleting a column moves the highlight and splices widths; that passes", () => {
    const before = withPro(
      {
        highlight: { column: 2, label: "Best" },
        widths: ["auto", "narrow", "wide"],
      },
      grid(3, 3),
    );
    const after = withPro(
      { highlight: { column: 1, label: "Best" }, widths: ["auto", "wide"] },
      grid(3, 2),
    );
    expect(() => assertTablePlan(after, noPro(before))).not.toThrow();
  });

  it("still refuses a new section row, a new width or a new icon", () => {
    const before = withPro({ section_rows: [2] }, cells(5, 3, [3, 1]));
    for (const after of [
      withPro({ section_rows: [1, 3] }, cells(6, 3, [4, 1])),
      withPro(
        { section_rows: [2], widths: ["wide", "auto", "auto"] },
        cells(5, 3, [3, 1]),
      ),
      withPro(
        { section_rows: [2] },
        cells(5, 3, [3, 1]).map((row, r) =>
          r === 0 ? row.map((t) => ({ text: String(t), icon: "no" })) : row,
        ),
      ),
    ]) {
      expect(msg(() => assertTablePlan(after, noPro(before)))).toBe(
        PRO_TABLE_COPY,
      );
    }
  });
});

describe("tableForRender", () => {
  const pro = validateTableBlock({
    heading: "Plans",
    align: Array.from({ length: 12 }, () => "center"),
    rows: grid(250, 12).map((row, r) =>
      row.map((t, c) =>
        r === 0 && c === 0 ? { text: t, bold: true, icon: "yes" } : t,
      ),
    ),
    pro: {
      sticky: true,
      sortable: true,
      searchable: true,
      paged: true,
      highlight: { column: 11, label: "Best" },
      widths: Array.from({ length: 12 }, () => "wide"),
      section_rows: [5],
    },
  });

  it("Pro active: unchanged", () => {
    expect(tableForRender(pro, { proActive: true })).toBe(pro);
  });

  it("Pro inactive: free table, Pro presentation off, input untouched", () => {
    const snapshot = JSON.parse(JSON.stringify(pro));
    const r = tableForRender(pro, { proActive: false });
    expect(r.rows).toHaveLength(200);
    expect(r.rows.every((row) => row.length === 10)).toBe(true);
    expect(r.align).toHaveLength(10);
    expect(r.pro).toEqual(EMPTY_TABLE_PRO);
    expect(r.rows.flat().some((c) => "icon" in c)).toBe(false);
    expect(r.rows[0]![0]).toEqual({
      text: "0:0",
      bold: true,
      italic: false,
      link: "",
    });
    expect(r.heading).toBe("Plans");
    expect(tableUsesPro(r)).toBe(false);
    expect(pro).toEqual(snapshot);
    expect(pro.rows).toHaveLength(250);
  });
});
