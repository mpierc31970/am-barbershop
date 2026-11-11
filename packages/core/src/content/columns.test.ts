// Ported from donor src/lib/columns-content.test.ts, plus the CONT-05/06/07 operations
// on stored columns (D75-D77, CONTEXT A4-Q2/Q3, RESEARCH Pitfall 3).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  columnsSummary,
  moveColumn,
  moveItem,
  newColumn,
  newColumnItem,
  newColumnsBlockContent,
  newId,
  normalizeColumns,
  resolveColumns,
} from "./columns";
import { COLUMN_COUNT, columnCountFor, flipLayout } from "./layouts";
import { COLUMN_ITEM_KINDS } from "./types";
import type { ColumnItem, ColumnsContent, RowLayout } from "./types";

function textItem(id: string, html: string): ColumnItem {
  return { id, kind: "text", html };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function itemIds(content: ColumnsContent): string[] {
  return content.columns.flatMap((c) => c.items.map((i) => i.id));
}

const three = (): ColumnsContent => ({
  columns: [
    { id: "c1", items: [textItem("i1", "<p>1</p>")] },
    { id: "c2", items: [textItem("i2", "<p>2</p>")] },
    { id: "c3", items: [textItem("i3", "<p>3</p>")] },
  ],
});

describe("newId", () => {
  it("mints distinct UUIDs", () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(a);
  });
});

describe("newColumnItem", () => {
  it("builds a heading item defaulting to level 2", () => {
    const item = newColumnItem("heading");
    expect(item.kind).toBe("heading");
    expect(item).toMatchObject({ text: "", level: 2 });
    expect(item.id).toBeTruthy();
  });

  it("gives every item a distinct id", () => {
    expect(newColumnItem("text").id).not.toBe(newColumnItem("text").id);
  });

  it("builds each kind with its own empty shape", () => {
    expect(newColumnItem("text")).toMatchObject({ html: "" });
    expect(newColumnItem("list")).toMatchObject({ items: [] });
    expect(newColumnItem("image")).toMatchObject({ url: "", alt: "" });
    expect(newColumnItem("button")).toMatchObject({
      text: "",
      link: "",
      style: "primary",
      action: "link",
      popup_id: "",
    });
    expect(newColumnItem("spacer")).toMatchObject({ height: "md" });
    expect(newColumnItem("divider").kind).toBe("divider");
    expect(newColumnItem("countdown")).toMatchObject({
      target_at: "",
      zero_message: "",
    });
  });

  it("covers every declared kind", () => {
    for (const kind of COLUMN_ITEM_KINDS) {
      expect(newColumnItem(kind).kind).toBe(kind);
    }
  });
});

describe("newColumnsBlockContent", () => {
  it("draws the layout's column count with fresh ids per call", () => {
    const a = newColumnsBlockContent("33-33-33");
    const b = newColumnsBlockContent("33-33-33");
    expect(a.columns).toHaveLength(3);
    expect(a.columns[0]!.id).not.toBe(b.columns[0]!.id);
    expect(newColumnsBlockContent().columns).toHaveLength(1);
    expect(newColumn().items).toEqual([]);
  });
});

describe("resolveColumns", () => {
  it("returns one empty column for full when content is undefined", () => {
    const result = resolveColumns(undefined, "full");
    expect(result).toHaveLength(1);
    expect(result[0]!.items).toEqual([]);
  });

  it("pads with empty columns when the data has fewer than the layout", () => {
    const content: ColumnsContent = {
      columns: [{ id: "c1", items: [textItem("i1", "<p>a</p>")] }],
    };
    const result = resolveColumns(content, "33-33-33");
    expect(result).toHaveLength(3);
    expect(result[0]!.items).toHaveLength(1);
    expect(result[1]!.items).toEqual([]);
    expect(result[2]!.items).toEqual([]);
  });

  it("appends surplus columns onto the last one rather than dropping them", () => {
    const result = resolveColumns(three(), "50-50");
    expect(result).toHaveLength(2);
    expect(result[0]!.items.map((i) => i.id)).toEqual(["i1"]);
    expect(result[1]!.items.map((i) => i.id)).toEqual(["i2", "i3"]);
  });

  it("preserves order when collapsing several surplus columns", () => {
    const content: ColumnsContent = {
      columns: [...three().columns, { id: "c4", items: [textItem("i4", "4")] }],
    };
    const result = resolveColumns(content, "full");
    expect(result).toHaveLength(1);
    expect(result[0]!.items.map((i) => i.id)).toEqual(["i1", "i2", "i3", "i4"]);
  });

  it("treats a non-array columns value as empty", () => {
    const content = { columns: "nope" } as unknown as ColumnsContent;
    const result = resolveColumns(content, "50-50");
    expect(result).toHaveLength(2);
    expect(result[0]!.items).toEqual([]);
  });
});

describe("columnsSummary", () => {
  it("counts the columns the layout actually draws, not the stored ones", () => {
    expect(columnsSummary(three(), "full")).toBe("1 column, 3 items");
  });

  it("agrees with resolveColumns for every layout", () => {
    for (const layout of Object.keys(COLUMN_COUNT) as RowLayout[]) {
      const expected = resolveColumns(three(), layout).length;
      expect(columnsSummary(three(), layout)).toContain(
        `${expected} ${expected === 1 ? "column" : "columns"}`,
      );
    }
  });

  it("keeps every item when columns collapse, since surplus items merge", () => {
    expect(columnsSummary(three(), "50-50")).toBe("2 columns, 3 items");
  });

  it("counts padded empty columns when a layout widens past the stored count", () => {
    const two: ColumnsContent = {
      columns: [
        { id: "c1", items: [textItem("i1", "1")] },
        { id: "c2", items: [] },
      ],
    };
    expect(columnsSummary(two, "25-25-25-25")).toBe("4 columns, 1 item");
  });

  it("singularises both nouns independently", () => {
    const one: ColumnsContent = {
      columns: [{ id: "c1", items: [textItem("i1", "1")] }],
    };
    expect(columnsSummary(one, "full")).toBe("1 column, 1 item");
    expect(columnsSummary({ columns: [{ id: "c1", items: [] }] }, "full")).toBe(
      "1 column, 0 items",
    );
  });

  it("returns undefined for content that is not a columns block", () => {
    expect(columnsSummary(undefined, "full")).toBeUndefined();
    expect(columnsSummary({}, "full")).toBeUndefined();
    expect(columnsSummary({ heading: "Not columns" }, "full")).toBeUndefined();
    expect(columnsSummary({ columns: "nope" }, "full")).toBeUndefined();
  });
});

describe("normalizeColumns (CONT-07, D77)", () => {
  it("shrinks 3 stored columns to 2 for 50-50, merging the third into the second", () => {
    const out = normalizeColumns(three(), "50-50");
    expect(out.columns).toHaveLength(2);
    expect(out.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(out.columns[1]!.items.map((i) => i.id)).toEqual(["i2", "i3"]);
    expect(itemIds(out).sort()).toEqual(["i1", "i2", "i3"]);
  });

  it("pads 1 stored column to 3 with fresh, non-auto ids that differ per call", () => {
    const one: ColumnsContent = {
      columns: [{ id: "c1", items: [textItem("i1", "1")] }],
    };
    const a = normalizeColumns(one, "33-33-33");
    const b = normalizeColumns(one, "33-33-33");
    expect(a.columns).toHaveLength(3);
    for (const col of a.columns.slice(1)) {
      expect(col.id.startsWith("col-auto-")).toBe(false);
      expect(col.items).toEqual([]);
    }
    expect(a.columns[1]!.id).not.toBe(b.columns[1]!.id);
    expect(a.columns[0]!.id).toBe("c1");
  });

  it("re-mints duplicate and empty column ids", () => {
    const dup = {
      columns: [
        { id: "same", items: [] },
        { id: "same", items: [] },
        { id: "", items: [] },
      ],
    } as ColumnsContent;
    const out = normalizeColumns(dup, "33-33-33");
    const ids = out.columns.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("same");
    expect(ids).not.toContain("");
  });

  it("does not mutate a frozen input", () => {
    const input = deepFreeze(three());
    expect(() => normalizeColumns(input, "full")).not.toThrow();
    expect(input.columns).toHaveLength(3);
  });
});

describe("moveColumn (CONT-05, D75)", () => {
  it("moves the first column to the end", () => {
    const out = moveColumn(three(), 0, 2);
    expect(out.columns.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("moves content only: widths stay positional, so the layout is not an input", () => {
    const out = moveColumn(three(), 2, 0);
    expect(out.columns.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
    expect(Object.keys(out)).toEqual(["columns"]);
  });

  it("does not mutate a frozen input", () => {
    const input = deepFreeze(three());
    const out = moveColumn(input, 0, 1);
    expect(out.columns.map((c) => c.id)).toEqual(["c2", "c1", "c3"]);
    expect(input.columns.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("rejects out-of-range and non-integer indices", () => {
    expect(() => moveColumn(three(), -1, 0)).toThrow(InvalidInput);
    expect(() => moveColumn(three(), 0, 3)).toThrow(InvalidInput);
    expect(() => moveColumn(three(), 0.5, 1)).toThrow(InvalidInput);
  });

  it("reorder after shrink loses nothing", () => {
    const shrunk = normalizeColumns(three(), "50-50");
    const out = moveColumn(shrunk, 0, 1);
    expect(out.columns).toHaveLength(2);
    expect(itemIds(out).sort()).toEqual(["i1", "i2", "i3"]);
    expect(out.columns[0]!.items.map((i) => i.id)).toEqual(["i2", "i3"]);
  });
});

describe("moveItem", () => {
  it("moves an item across columns and preserves the multiset", () => {
    const out = moveItem(three(), {
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c3",
      toIndex: 0,
    });
    expect(out.columns[0]!.items).toEqual([]);
    expect(out.columns[2]!.items.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(itemIds(out).sort()).toEqual(["i1", "i2", "i3"]);
  });

  it("reorders within one column", () => {
    const content: ColumnsContent = {
      columns: [
        {
          id: "c1",
          items: [textItem("a", "a"), textItem("b", "b"), textItem("c", "c")],
        },
      ],
    };
    const out = moveItem(content, {
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c1",
      toIndex: 2,
    });
    expect(out.columns[0]!.items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("clamps the target index to the end of the target column", () => {
    const out = moveItem(three(), {
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c2",
      toIndex: 99,
    });
    expect(out.columns[1]!.items.map((i) => i.id)).toEqual(["i2", "i1"]);
  });

  it("rejects unknown columns and a missing source item", () => {
    expect(() =>
      moveItem(three(), {
        fromColumnId: "nope",
        fromIndex: 0,
        toColumnId: "c1",
        toIndex: 0,
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      moveItem(three(), {
        fromColumnId: "c1",
        fromIndex: 5,
        toColumnId: "c2",
        toIndex: 0,
      }),
    ).toThrow(InvalidInput);
  });

  it("does not mutate a frozen input", () => {
    const input = deepFreeze(three());
    moveItem(input, {
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c2",
      toIndex: 0,
    });
    expect(itemIds(input)).toEqual(["i1", "i2", "i3"]);
  });
});

describe("flip never touches content (CONT-06, D76)", () => {
  it("returns a layout with the same column count; content is not an argument", () => {
    const before = three();
    expect(columnCountFor(flipLayout("25-75"))).toBe(2);
    expect(before).toEqual(three());
  });
});
