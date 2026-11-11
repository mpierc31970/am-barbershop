// Pure table editing (07-21; CONT-26, D120; T-07-21-03, T-07-21-04).
import {
  defaultTableBlock,
  newTableCell,
  TABLE_LIMIT_COPY,
  type TableBlockContent,
} from "@cds/core/content";
import { describe, expect, it } from "vitest";
import {
  assertTablePlan,
  PRO_TABLE_LIMIT_COPY,
  validateTableBlock,
} from "@cds/core/content";
import {
  applyCsvRows,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  pasteGrid,
  pausedEditAddsPro,
  PRO_TABLE_LIMITS,
  setCell,
  setCellIcon,
  setColumnWidth,
  setHighlight,
  setTablePro,
  tableDraft,
  tableLimits,
  tablePreviewFromCsv,
  tableRowsFromCsv,
  tableToCsv,
  toggleSectionRow,
} from "./table-logic";

const widths = (c: TableBlockContent) => c.rows.map((r) => r.length);

function grid(rows: number, cols: number): TableBlockContent {
  return {
    ...defaultTableBlock(),
    align: Array.from({ length: cols }, () => "left" as const),
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => newTableCell(`${r}-${c}`)),
    ),
  };
}

describe("tableDraft", () => {
  it("pads ragged rows, turns strings into cells and never throws", () => {
    const d = tableDraft({
      rows: [["a", { text: "b", bold: true }], ["c"]],
      align: ["right"],
    });
    expect(widths(d)).toEqual([2, 2]);
    expect(d.rows[0]![1]).toEqual({
      text: "b",
      bold: true,
      italic: false,
      link: "",
    });
    expect(d.align).toEqual(["right", "left"]);
    expect(widths(tableDraft({}))).toEqual([1]);
    expect(tableDraft({ rows: "nope" } as never).rows).toHaveLength(1);
  });
});

describe("row and column edits", () => {
  it("insertRow / insertColumn keep widths and align in step", () => {
    const c = defaultTableBlock();
    const r = insertRow(c, 1);
    expect(r.rows).toHaveLength(4);
    expect(widths(r)).toEqual([3, 3, 3, 3]);
    expect(r.rows[1]![0]!.text).toBe("");
    const k = insertColumn(c, 0);
    expect(widths(k)).toEqual([4, 4, 4]);
    expect(k.align).toEqual(["left", "left", "left", "left"]);
    expect(k.rows[0]![1]!.text).toBe("Column 1");
    expect(c.rows).toHaveLength(3); // input untouched
  });

  it("deleteRow / deleteColumn refuse the last row and column", () => {
    const one = grid(1, 1);
    expect(deleteRow(one, 0)).toBe(one);
    expect(deleteColumn(one, 0)).toBe(one);
    const c = grid(3, 3);
    c.align = ["left", "center", "right"];
    const d = deleteColumn(c, 1);
    expect(d.align).toEqual(["left", "right"]);
    expect(d.rows[0]!.map((x) => x.text)).toEqual(["0-0", "0-2"]);
    expect(deleteRow(c, 0).rows[0]![0]!.text).toBe("1-0");
  });

  it("insert refuses past the limits", () => {
    const wide = grid(2, 10);
    expect(insertColumn(wide, 0)).toBe(wide);
    const tall = grid(200, 1);
    expect(insertRow(tall, 0)).toBe(tall);
  });

  it("setCell keeps flags and trims nothing", () => {
    let c = setCell(defaultTableBlock(), 1, 1, { bold: true });
    c = setCell(c, 1, 1, { text: "  x  " });
    expect(c.rows[1]![1]).toEqual({
      text: "  x  ",
      bold: true,
      italic: false,
      link: "",
    });
  });
});

describe("pasteGrid", () => {
  it("grows the table to fit and writes plain cells", () => {
    const c = setCell(defaultTableBlock(), 1, 2, { bold: true });
    const g = Array.from({ length: 3 }, (_, r) =>
      Array.from({ length: 4 }, (_, k) => `p${r}${k}`),
    );
    const res = pasteGrid(c, { row: 1, col: 2 }, g);
    if (!("content" in res)) throw new Error("expected content");
    expect(res.content.rows).toHaveLength(4);
    expect(widths(res.content)).toEqual([6, 6, 6, 6]);
    expect(res.content.align).toHaveLength(6);
    expect(res.content.rows[1]![2]).toEqual(newTableCell("p00"));
    expect(res.content.rows[3]![5]!.text).toBe("p23");
    expect(res.content.rows[0]![0]!.text).toBe("Column 1");
  });

  it("collapses newlines inside a pasted cell", () => {
    const res = pasteGrid(defaultTableBlock(), { row: 0, col: 0 }, [
      ["a\nb", "c"],
    ]);
    if (!("content" in res)) throw new Error("expected content");
    expect(res.content.rows[0]![0]!.text).toBe("a b");
  });

  it("refuses a paste past 10 x 200 and leaves content untouched", () => {
    const c = defaultTableBlock();
    const wide = [Array.from({ length: 9 }, () => "x")];
    expect(pasteGrid(c, { row: 0, col: 2 }, wide)).toEqual({
      error: TABLE_LIMIT_COPY,
    });
    const tall = Array.from({ length: 200 }, () => ["x"]);
    expect(pasteGrid(c, { row: 1, col: 0 }, tall)).toEqual({
      error: TABLE_LIMIT_COPY,
    });
    expect(c).toEqual(defaultTableBlock());
  });
});

describe("CSV", () => {
  it("tableToCsv guards formulas; tableRowsFromCsv restores them", () => {
    const c = grid(2, 2);
    c.rows[1]![0] = newTableCell("=SUM(A1)");
    const csv = tableToCsv(c);
    expect(csv).toContain("'=SUM(A1)");
    const back = tableRowsFromCsv(csv);
    expect(back).toEqual({
      ok: true,
      columns: 2,
      rows: [
        ["0-0", "0-1"],
        ["=SUM(A1)", "1-1"],
      ],
    });
  });

  it("a header-only file is a one-row table; CR/LF in cells collapse", () => {
    expect(tableRowsFromCsv("A,B\r\n")).toEqual({
      ok: true,
      columns: 2,
      rows: [["A", "B"]],
    });
    const r = tableRowsFromCsv('A,B\n"x\ny",z\n');
    expect(r.ok && r.rows[1]).toEqual(["x y", "z"]);
  });

  it("refuses more than 10 columns or 200 lines with the limit copy", () => {
    const wide = `${Array.from({ length: 11 }, (_, i) => `c${i}`).join(",")}\n`;
    expect(tableRowsFromCsv(wide)).toEqual({
      ok: false,
      message: TABLE_LIMIT_COPY,
    });
    const tall = "a\n".repeat(201);
    expect(tableRowsFromCsv(tall)).toEqual({
      ok: false,
      message: TABLE_LIMIT_COPY,
    });
    expect(tableRowsFromCsv("a\n".repeat(2500))).toEqual({
      ok: false,
      message: TABLE_LIMIT_COPY,
    });
  });

  it("passes other parse errors through", () => {
    const r = tableRowsFromCsv("");
    expect(r.ok).toBe(false);
    const q = tableRowsFromCsv('a,"b\n');
    expect(q.ok === false && q.message).toContain("isn't a CSV");
  });

  it("tablePreviewFromCsv builds a replace preview", async () => {
    const res = await tablePreviewFromCsv(
      "Plan,,Price\nBasic,x,$20\nPlus,y,$35\n",
    );
    if (!res.ok) throw new Error(res.message);
    const p = res.data;
    expect(p.mode).toBe("replace");
    expect(p.columns.map((c) => c.label)).toEqual([
      "Plan",
      "Column 2",
      "Price",
    ]);
    expect(p.rows.every((r) => r.status === "new")).toBe(true);
    expect(p.rows[0]!.cells).toEqual({ c0: "Basic", c1: "x", c2: "$20" });
    expect(p.removals).toEqual([]);
    expect(p.changes).toBe(3);
    const bad = await tablePreviewFromCsv("a\n".repeat(300));
    expect(bad).toEqual({
      ok: false,
      code: "invalid_input",
      message: TABLE_LIMIT_COPY,
    });
  });
});

describe("pausedEditAddsPro (WR-C03)", () => {
  // A lapsed Pro table: a section row, an icon, a width and a highlight.
  function lapsed(): TableBlockContent {
    const t = setHighlight(
      setColumnWidth(toggleSectionRow(grid(5, 3), 2), 1, "wide"),
      1,
      "Best",
    );
    return setCellIcon(t, 3, 0, "yes");
  }

  it("moving or dropping Pro parts passes, as on the server", () => {
    const t = lapsed();
    for (const next of [
      insertRow(t, 1),
      deleteRow(t, 2),
      insertColumn(t, 0),
      deleteColumn(t, 1),
      setCellIcon(t, 3, 0, ""),
    ]) {
      expect(pausedEditAddsPro(t, next)).toBe(false);
    }
  });

  it("an edit that adds Pro use is caught (the server would refuse it at Save block)", () => {
    const t = lapsed();
    expect(pausedEditAddsPro(t, toggleSectionRow(t, 4))).toBe(true);
    expect(pausedEditAddsPro(t, setCellIcon(t, 1, 1, "no"))).toBe(true);
    expect(pausedEditAddsPro(t, setColumnWidth(t, 2, "narrow"))).toBe(true);
    expect(pausedEditAddsPro(t, setHighlight(t, 1, "New label"))).toBe(true);
    expect(pausedEditAddsPro(t, setTablePro(t, { sortable: true }))).toBe(true);
  });
});

describe("Builder Pro table helpers (10-41)", () => {
  it("tableDraft keeps pro and icons; a P7 table gets no pro key", () => {
    const p7 = tableDraft(grid(2, 2) as unknown as Record<string, unknown>);
    expect("pro" in p7).toBe(false);
    const raw = {
      ...grid(3, 2),
      pro: {
        sortable: true,
        highlight: { column: 1, label: "Best" },
        widths: ["wide", "auto"],
        section_rows: [2, 9, 1, 1],
      },
    };
    raw.rows[1]![0] = { ...raw.rows[1]![0]!, icon: "yes" };
    raw.rows[1]![1] = { ...raw.rows[1]![1]!, icon: "bogus" as "yes" };
    const d = tableDraft(raw as unknown as Record<string, unknown>);
    expect(d.pro?.sortable).toBe(true);
    expect(d.pro?.highlight).toEqual({ column: 1, label: "Best" });
    expect(d.pro?.widths).toEqual(["wide", "auto"]);
    expect(d.pro?.section_rows).toEqual([1, 2]);
    expect(d.rows[1]![0]!.icon).toBe("yes");
    expect("icon" in d.rows[1]![1]!).toBe(false);
  });

  it("setTablePro toggles the switches without mutating", () => {
    const c = grid(2, 2);
    const next = setTablePro(c, { sticky: true, paged: true });
    expect(next.pro?.sticky).toBe(true);
    expect(next.pro?.paged).toBe(true);
    expect(next.pro?.sortable).toBe(false);
    expect(c.pro).toBeUndefined();
    expect(setTablePro(next, { sticky: false }).pro?.sticky).toBe(false);
  });

  it("setCellIcon sets and clears a cell icon", () => {
    const withIcon = setCellIcon(grid(2, 2), 1, 1, "no");
    expect(withIcon.rows[1]![1]!.icon).toBe("no");
    const cleared = setCellIcon(withIcon, 1, 1, "");
    expect("icon" in cleared.rows[1]![1]!).toBe(false);
  });

  it("toggleSectionRow adds and removes a sorted row index", () => {
    const a = toggleSectionRow(toggleSectionRow(grid(5, 2), 3), 1);
    expect(a.pro?.section_rows).toEqual([1, 3]);
    expect(toggleSectionRow(a, 3).pro?.section_rows).toEqual([1]);
    expect(toggleSectionRow(a, 9)).toBe(a);
  });

  it("setColumnWidth stores one width per column, none when all auto", () => {
    const a = setColumnWidth(grid(2, 3), 1, "narrow");
    expect(a.pro?.widths).toEqual(["auto", "narrow", "auto"]);
    expect(setColumnWidth(a, 1, "auto").pro?.widths).toEqual([]);
  });

  it("setHighlight sets the column and label, keeps the label on move, clears", () => {
    const a = setHighlight(grid(2, 3), 2, "Most popular");
    expect(a.pro?.highlight).toEqual({ column: 2, label: "Most popular" });
    expect(setHighlight(a, 0).pro?.highlight).toEqual({
      column: 0,
      label: "Most popular",
    });
    expect(setHighlight(a, null).pro?.highlight).toBeNull();
    expect(setHighlight(a, 7)).toBe(a);
  });

  it("row and column edits keep Pro settings on the same cells", () => {
    let c = setHighlight(grid(4, 3), 1, "x");
    c = setColumnWidth(c, 2, "wide");
    c = toggleSectionRow(c, 2);
    const rowAbove = insertRow(c, 0);
    expect(rowAbove.pro?.section_rows).toEqual([3]);
    expect(deleteRow(c, 0).pro?.section_rows).toEqual([1]);
    expect(deleteRow(c, 2).pro?.section_rows).toEqual([]);
    const colLeft = insertColumn(c, 0);
    expect(colLeft.pro?.highlight?.column).toBe(2);
    expect(colLeft.pro?.widths).toEqual(["auto", "auto", "auto", "wide"]);
    expect(deleteColumn(c, 1).pro?.highlight).toBeNull();
    expect(deleteColumn(c, 0).pro?.highlight?.column).toBe(0);
    expect(deleteColumn(c, 0).pro?.widths).toEqual(["auto", "wide"]);
    // Every result still validates structurally.
    for (const t of [rowAbove, colLeft, deleteColumn(c, 1), deleteRow(c, 2)]) {
      expect(() => validateTableBlock(t)).not.toThrow();
    }
  });

  it("Pro limits grow to 20 x 1,000 with their own copy", () => {
    expect(tableLimits(false).columns).toBe(10);
    expect(tableLimits(true)).toBe(PRO_TABLE_LIMITS);
    const ten = grid(1, 10);
    expect(insertColumn(ten, 10)).toBe(ten);
    expect(insertColumn(ten, 10, PRO_TABLE_LIMITS).rows[0]).toHaveLength(11);
    const twenty = grid(1, 20);
    expect(insertColumn(twenty, 20, PRO_TABLE_LIMITS)).toBe(twenty);
    const wide = [Array.from({ length: 21 }, (_, i) => `c${i}`)];
    expect(
      pasteGrid(grid(1, 1), { row: 0, col: 0 }, wide, PRO_TABLE_LIMITS),
    ).toEqual({ error: PRO_TABLE_LIMIT_COPY });
    const csv = Array.from({ length: 300 }, (_, i) => `a${i},b`).join("\n");
    const res = tableRowsFromCsv(csv, PRO_TABLE_LIMITS);
    expect(res.ok && res.rows.length).toBe(300);
  });

  it("CSV replace keeps Pro settings that still fit", () => {
    let c = setHighlight(grid(4, 3), 2, "x");
    c = toggleSectionRow(c, 3);
    c = setTablePro(c, { sortable: true });
    const next = applyCsvRows(
      c,
      [
        ["a", "b"],
        ["c", "d"],
      ],
      2,
    );
    expect(next.pro?.highlight).toBeNull();
    expect(next.pro?.section_rows).toEqual([]);
    expect(next.pro?.sortable).toBe(true);
  });

  it("a lapsed text-only edit still passes the plan check", () => {
    const prev = setCellIcon(
      setTablePro(grid(3, 3), { sortable: true }),
      1,
      1,
      "yes",
    );
    const edited = setCell(prev, 2, 0, { text: "changed" });
    expect(() =>
      assertTablePlan(edited, { proEntitled: false, previous: prev }),
    ).not.toThrow();
    expect(() =>
      assertTablePlan(setTablePro(edited, { searchable: true }), {
        proEntitled: false,
        previous: prev,
      }),
    ).toThrow();
  });
});
