// Table block (07-07; CONT-26, D232, D-UI-P7-23; T-07-07-02, T-07-07-04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  TABLE_LIMIT_COPY,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  defaultTableBlock,
  newTableCell,
  tableIsEmpty,
  tableSection,
  validateTableBlock,
} from "./table";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

const LINK_COPY =
  "Links must start with https://, http://, mailto: or tel:, or be a page path like /about.";

describe("table content", () => {
  it("default is 3x3 with a header row and validates", () => {
    const d = defaultTableBlock();
    expect(d.rows).toHaveLength(3);
    expect(d.rows.every((r) => r.length === 3)).toBe(true);
    expect(d.rows[0]!.map((c) => c.text)).toEqual([
      "Column 1",
      "Column 2",
      "Column 3",
    ]);
    expect(d.header_row).toBe(true);
    expect(d.first_column_header).toBe(false);
    expect(d.striped).toBe(false);
    expect(d.mobile).toBe("scroll");
    expect(d.align).toEqual(["left", "left", "left"]);
    expect(validateTableBlock(d)).toEqual(d);
    expect(tableIsEmpty(d)).toBe(false);
  });

  it("free limit copy stays 10 x 200; structure accepts up to the Pro ceiling (10-35)", () => {
    expect(TABLE_LIMIT_COPY).toBe(
      "Tables hold up to 10 columns and 200 rows. Split it into two tables.",
    );
    expect(TABLE_MAX_COLUMNS).toBe(10);
    expect(TABLE_MAX_ROWS).toBe(200);
    // 10-35: past 10 x 200 is a plan rule (assertTablePlan), not a structural refusal.
    const wide = [Array.from({ length: TABLE_MAX_COLUMNS + 1 }, () => "x")];
    expect(validateTableBlock({ rows: wide }).rows[0]).toHaveLength(11);
    const tall = Array.from({ length: TABLE_MAX_ROWS + 1 }, () => ["x"]);
    expect(validateTableBlock({ rows: tall }).rows).toHaveLength(201);
    const max = Array.from({ length: TABLE_MAX_ROWS }, () =>
      Array.from({ length: TABLE_MAX_COLUMNS }, () => "x"),
    );
    expect(validateTableBlock({ rows: max }).rows).toHaveLength(200);
  });

  it("pads ragged rows, converts strings, keeps HTML literal", () => {
    const v = validateTableBlock({
      rows: [["a", "<b>x</b>", "c"], ["d"], "nope", [5]],
    });
    expect(v.rows).toHaveLength(4);
    expect(v.rows.every((r) => r.length === 3)).toBe(true);
    expect(v.rows[0]![1]).toEqual({
      text: "<b>x</b>",
      bold: false,
      italic: false,
      link: "",
    });
    expect(v.rows[1]![2]).toEqual(newTableCell());
    expect(v.rows[2]).toEqual([newTableCell(), newTableCell(), newTableCell()]);
    expect(v.rows[3]![0]).toEqual(newTableCell());
  });

  it("reads object cells: text collapsed, flags strict, link safeHref", () => {
    const v = validateTableBlock({
      rows: [
        [
          {
            text: " a\r\nb ",
            bold: true,
            italic: "yes",
            link: "https://x.com",
            evil: 1,
          },
        ],
      ],
    });
    expect(v.rows[0]![0]).toEqual({
      text: "a b",
      bold: true,
      italic: false,
      link: "https://x.com/",
    });
    expect(
      msg(() =>
        validateTableBlock({ rows: [[{ text: "x", link: "javascript:x" }]] }),
      ),
    ).toBe(LINK_COPY);
    expect(() =>
      validateTableBlock({ rows: [[{ text: "x".repeat(501) }]] }),
    ).toThrow("Keep this under 500 characters.");
  });

  it("align trimmed/padded to width; mobile defaults scroll", () => {
    const v = validateTableBlock({
      rows: [["a", "b"]],
      align: ["right", "bogus", "center"],
      mobile: "cards",
    });
    expect(v.align).toEqual(["right", "left"]);
    expect(v.mobile).toBe("cards");
    expect(validateTableBlock({ mobile: "x" }).mobile).toBe("scroll");
    expect(validateTableBlock({ rows: "x" }).rows).toEqual([]);
  });

  it("tableIsEmpty only when every cell text is blank", () => {
    expect(tableIsEmpty(validateTableBlock({ rows: [["", ""]] }))).toBe(true);
    expect(tableIsEmpty(validateTableBlock({ rows: [] }))).toBe(true);
    expect(tableIsEmpty(validateTableBlock({ rows: [["", "a"]] }))).toBe(false);
  });

  it("refuses non-objects", () => {
    expect(msg(() => validateTableBlock(7))).toBe(
      "This block's content is malformed.",
    );
  });
});

describe("tableSection", () => {
  it("contract", () => {
    expect(tableSection.type).toBe("table");
    expect(tableSection.label).toBe("Table");
    expect(tableSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(tableSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(tableSection.refsOf({})).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    const v = validateTableBlock({
      heading: "H",
      rows: [
        ["a", { text: "b", link: "/about" }],
        ["", "c"],
      ],
    });
    expect(tableSection.textsOf(v)).toEqual(["H", "a", "b", "c"]);
    expect(tableSection.urlsOf(v)).toEqual(["/about"]);
    const copy = tableSection.mapRichText(v, () => "X") as typeof v;
    expect(copy).toEqual(v);
    expect(copy.rows[0]).not.toBe(v.rows[0]);
    expect(copy.rows[0]![0]).not.toBe(v.rows[0]![0]);
    for (const bad of [null, undefined, 5, "x", [], { rows: [5, [null]] }]) {
      expect(() => tableSection.textsOf(bad)).not.toThrow();
      expect(() => tableSection.urlsOf(bad)).not.toThrow();
      expect(() => tableSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});
