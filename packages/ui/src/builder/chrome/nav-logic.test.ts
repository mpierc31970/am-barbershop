// 07-25 Task 3: menu editor transforms (choice 11).
import { NAV_COPY, validateNav, type NavItem } from "@cds/core/content";
import { describe, expect, it } from "vitest";
import {
  NAV_NEST_PARENT_COPY,
  buildNav,
  checkRows,
  flattenNav,
  indent,
  moveRow,
  moveStep,
  outdent,
  removeRow,
  restoreRows,
  type NavRow,
} from "./nav-logic";

const link = (id: string) => ({
  id,
  label: id.toUpperCase(),
  target: "https://x.test/",
  new_tab: false,
});
const item = (id: string, children: string[] = []): NavItem => ({
  ...link(id),
  children: children.map(link),
});

const ids = (rows: NavRow[]) => rows.map((r) => `${r.depth}${r.id}`);
const ok = (r: { rows: NavRow[] } | { error: string }) => {
  if ("error" in r) throw new Error(r.error);
  return r.rows;
};
const valid = (rows: NavRow[]) =>
  validateNav({ items: buildNav(rows), cta: null });

describe("flatten / build", () => {
  it("round-trips and lifts an orphan child to the top level", () => {
    const items = [item("a", ["b", "c"]), item("d")];
    const rows = flattenNav(items);
    expect(ids(rows)).toEqual(["0a", "1b", "1c", "0d"]);
    expect(buildNav(rows)).toEqual(items);
    expect(buildNav([{ id: "x", depth: 1, link: link("x") }])).toEqual([
      item("x"),
    ]);
  });
});

describe("moveStep", () => {
  const rows = flattenNav([item("a", ["b", "c"]), item("d")]);

  it("moves top-level blocks with their children", () => {
    expect(ids(moveStep(rows, 3, -1)!)).toEqual(["0d", "0a", "1b", "1c"]);
    expect(ids(moveStep(rows, 0, 1)!)).toEqual(["0d", "0a", "1b", "1c"]);
    expect(moveStep(rows, 0, -1)).toBeNull();
    expect(moveStep(rows, 3, 1)).toBeNull();
  });

  it("moves children among their siblings only", () => {
    expect(ids(moveStep(rows, 2, -1)!)).toEqual(["0a", "1c", "1b", "0d"]);
    expect(moveStep(rows, 1, -1)).toBeNull();
    expect(moveStep(rows, 2, 1)).toBeNull();
  });

  it("Move down then Move up restores the order", () => {
    const down = moveStep(rows, 0, 1)!;
    expect(moveStep(down, 1, -1)).toEqual(rows);
  });
});

describe("indent / outdent", () => {
  it("puts a row under the previous top-level row and back out", () => {
    const rows = flattenNav([item("a", ["b"]), item("c"), item("d")]);
    const under = ok(indent(rows, 2));
    expect(ids(under)).toEqual(["0a", "1b", "1c", "0d"]);
    valid(under);
    const out = ok(outdent(under, 2));
    expect(ids(out)).toEqual(["0a", "1b", "0c", "0d"]);
    expect(
      ok(
        outdent(
          ok(indent(flattenNav([item("a"), item("b"), item("c")]), 1)),
          1,
        ),
      ).map((r) => r.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("refuses a row with children and a full dropdown", () => {
    const rows = flattenNav([item("a"), item("b", ["c"])]);
    expect(indent(rows, 1)).toEqual({ error: NAV_NEST_PARENT_COPY });
    const full = flattenNav([
      item("p", ["1", "2", "3", "4", "5", "6", "7", "8"]),
      item("x"),
    ]);
    expect(indent(full, 9)).toEqual({ error: NAV_COPY.childLimit });
  });

  it("refuses moving out when the top level is full", () => {
    const rows = flattenNav([
      item("a", ["z"]),
      ...["b", "c", "d", "e", "f", "g", "h"].map((x) => item(x)),
    ]);
    expect(outdent(rows, 1)).toEqual({ error: NAV_COPY.limit });
  });
});

describe("removeRow / restoreRows", () => {
  it("removes a parent with its children and restores them", () => {
    const rows = flattenNav([item("a", ["b"]), item("c")]);
    const { rows: left, removed } = removeRow(rows, 0);
    expect(ids(left)).toEqual(["0c"]);
    expect(restoreRows(left, removed, 0)).toEqual(rows);
  });

  it("never restores a top-level block inside another dropdown (WR-E01)", () => {
    const rows = flattenNav([item("a"), item("b", ["b1", "b2"])]);
    const { removed } = removeRow(rows, 0);
    // Meanwhile the list changed so index 2 now sits inside B's dropdown.
    const now = flattenNav([item("x"), item("b", ["b1", "b2"])]);
    expect(ids(restoreRows(now, removed, 3))).toEqual([
      "0x",
      "0b",
      "1b1",
      "1b2",
      "0a",
    ]);
  });

  it("an Undo that would overfill the menu fails the limit check (WR-E01)", () => {
    const full = flattenNav(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => item(x)),
    );
    const { rows: left, removed } = removeRow(full, 0);
    const refilled = [...left, ...flattenNav([item("z")])];
    expect(checkRows(restoreRows(refilled, removed, 0))).toEqual({
      error: NAV_COPY.limit,
    });
  });
});

describe("moveRow (drag)", () => {
  const rows = flattenNav([item("a"), item("b"), item("c")]);

  it("reorders and nests by horizontal intent", () => {
    expect(ids(ok(moveRow(rows, 2, 0, null)))).toEqual(["0c", "0a", "0b"]);
    expect(ids(ok(moveRow(rows, 2, 1, 1)))).toEqual(["0a", "1c", "0b"]);
    expect(ids(ok(moveRow(rows, 1, 1, 1)))).toEqual(["0a", "1b", "0c"]);
    const nested = flattenNav([item("a", ["b"]), item("c")]);
    expect(ids(ok(moveRow(nested, 1, 1, 0)))).toEqual(["0a", "0b", "0c"]);
  });

  it("a top-level drop inside a dropdown lands after it (WR-E02)", () => {
    const rows = flattenNav([item("a"), item("b", ["b1", "b2"])]);
    // Drag A onto b1: B keeps both its links.
    const r = ok(moveRow(rows, 0, 2, null));
    expect(ids(r)).toEqual(["0b", "1b1", "1b2", "0a"]);
    expect(buildNav(r)[0]!.children.map((c) => c.id)).toEqual(["b1", "b2"]);
    // A block with children too.
    const nested = flattenNav([item("a", ["a1"]), item("b", ["b1", "b2"])]);
    expect(ids(ok(moveRow(nested, 0, 3, null)))).toEqual([
      "0b",
      "1b1",
      "1b2",
      "0a",
      "1a1",
    ]);
  });

  it("never nests a row that has children, and keeps results valid", () => {
    const nested = flattenNav([item("a"), item("b", ["c"])]);
    expect(moveRow(nested, 1, 1, 1)).toEqual({ error: NAV_NEST_PARENT_COPY });
    const r = ok(moveRow(nested, 0, 2, null));
    expect(ids(r)).toEqual(["0b", "1c", "0a"]);
    valid(r);
  });
});
