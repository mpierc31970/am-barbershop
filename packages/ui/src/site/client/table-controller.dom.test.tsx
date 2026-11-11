// @vitest-environment jsdom
// TableController island (10-42; BILL-14, D233; 10-UI-SPEC "Pro table" › Public table):
// sort (aria-sort, numbers by value, section rows stay with their group), search with a
// polite count, 25-row paging with the site Pagination; sorting or searching returns to
// page 1. Rendered through TableSection so the island drives the real server markup.
import {
  defaultTableBlock,
  emptyTablePro,
  newTableCell,
  type TableBlockContent,
  type TablePro,
} from "@cds/core/content";
import { afterEach, describe, expect, it } from "vitest";
import {
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { renderToStaticMarkup } from "react-dom/server";
import { TableSection } from "../blocks/TableSection";
import { PREMOUNT_FALLBACK_SCRIPT } from "../premount";
import { TABLE_CONTROLLER_COPY, tableNumber } from "./TableController";

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function table(rows: string[][], pro: Partial<TablePro>): TableBlockContent {
  return {
    ...defaultTableBlock(),
    heading: "Prices",
    header_row: true,
    rows: rows.map((r) => r.map((t) => newTableCell(t))),
    align: rows[0]!.map(() => "left" as const),
    pro: { ...emptyTablePro(), ...pro },
  };
}

async function show(c: TableBlockContent): Promise<HTMLElement> {
  mounted = mount(
    <TableSection
      layout="full"
      background="main"
      isH1Owner={false}
      isFirst={false}
      now={new Date("2026-10-01T12:00:00Z")}
      content={c}
    />,
  );
  await flush();
  return mounted.container;
}

/** First-cell text of each visible body row, in order. */
function visible(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("tbody tr"))
    .filter((tr) => !(tr as HTMLElement).hidden)
    .map((tr) => (tr.firstElementChild?.textContent ?? "").trim());
}

const sortButton = (root: HTMLElement, col: number) =>
  root.querySelector(`button[data-sort-button="${col}"]`);

describe("tableNumber", () => {
  it("reads prices, percentages and thousands; refuses text", () => {
    expect(tableNumber("$1,200")).toBe(1200);
    expect(tableNumber("12.5%")).toBe(12.5);
    expect(tableNumber("-3")).toBe(-3);
    expect(tableNumber("")).toBeNull();
    expect(tableNumber("12 visits")).toBeNull();
  });
});

describe("sort", () => {
  const ROWS = [
    ["Plan", "Price"],
    ["Plus", "100"],
    ["Basic", "20"],
    ["Ultra", "9"],
  ];

  it("marks the island ready and every sortable header aria-sort none", async () => {
    const root = await show(table(ROWS, { sortable: true }));
    expect(
      root.querySelector("[data-table-pro]")?.getAttribute("data-ready"),
    ).toBe("true");
    const ths = root.querySelectorAll("th[data-sort-col]");
    expect(ths.length).toBe(2);
    ths.forEach((th) => expect(th.getAttribute("aria-sort")).toBe("none"));
  });

  it("ascending then descending; numbers by value", async () => {
    const root = await show(table(ROWS, { sortable: true }));
    click(sortButton(root, 1));
    expect(visible(root)).toEqual(["Ultra", "Basic", "Plus"]);
    const th = root.querySelector('th[data-sort-col="1"]')!;
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(
      root.querySelector('th[data-sort-col="0"]')!.getAttribute("aria-sort"),
    ).toBe("none");
    click(sortButton(root, 1));
    expect(visible(root)).toEqual(["Plus", "Basic", "Ultra"]);
    expect(th.getAttribute("aria-sort")).toBe("descending");
  });

  it("text columns sort by locale compare", async () => {
    const root = await show(table(ROWS, { sortable: true }));
    click(sortButton(root, 0));
    expect(visible(root)).toEqual(["Basic", "Plus", "Ultra"]);
  });

  it("section rows stay with the rows under them", async () => {
    const rows = [
      ["Item", "Price"],
      ["Hair", ""],
      ["Cut", "40"],
      ["Colour", "90"],
      ["Nails", ""],
      ["Polish", "15"],
      ["Gel", "35"],
    ];
    const root = await show(
      table(rows, { sortable: true, section_rows: [1, 4] }),
    );
    click(sortButton(root, 1));
    click(sortButton(root, 1)); // descending
    expect(visible(root)).toEqual([
      "Hair",
      "Colour",
      "Cut",
      "Nails",
      "Gel",
      "Polish",
    ]);
  });
});

describe("cards mode (WR-C01)", () => {
  const ROWS = [
    ["Plan", "Price"],
    ["Plus", "$1,000"],
    ["Basic", "$200"],
    ["Free", ""],
  ];
  const cards = (pro: Partial<TablePro>) => ({
    ...table(ROWS, pro),
    mobile: "cards" as const,
  });

  it("numbers sort by value and empty cells last, ignoring the hidden labels", async () => {
    const root = await show(cards({ sortable: true }));
    // The mobile label is there (CSS hides it on desktop), but never read as cell text.
    expect(root.querySelector("[data-card-label]")?.textContent).toBe("Plan: ");
    click(sortButton(root, 1));
    expect(visible(root)).toEqual(["Plan: Basic", "Plan: Plus", "Plan: Free"]);
    click(sortButton(root, 1));
    expect(visible(root)).toEqual(["Plan: Plus", "Plan: Basic", "Plan: Free"]);
  });

  it("searching a header word does not match every row", async () => {
    const root = await show(cards({ searchable: true }));
    const input = root.querySelector("input[type=search]") as HTMLInputElement;
    typeInto(input, "price");
    await flush();
    expect(visible(root)).toEqual([]);
    typeInto(input, "basic");
    await flush();
    expect(visible(root)).toEqual(["Plan: Basic"]);
  });
});

describe("search", () => {
  const ROWS = [
    ["Name", "City"],
    ["Ana", "Austin"],
    ["Ben", "Boston"],
    ["Cara", "austin"],
  ];

  it("filters case-insensitively and announces the count politely; clearing restores", async () => {
    const root = await show(table(ROWS, { searchable: true }));
    const input = root.querySelector("input[type=search]") as HTMLInputElement;
    expect(input).not.toBeNull();
    const label = root.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe(TABLE_CONTROLLER_COPY.search);
    const status = root.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("3 of 3 rows");

    typeInto(input, "AUSTIN");
    await flush();
    expect(visible(root)).toEqual(["Ana", "Cara"]);
    expect(status.textContent).toBe("2 of 3 rows");

    typeInto(input, "zzz");
    await flush();
    expect(visible(root)).toEqual([]);
    expect(status.textContent).toBe(TABLE_CONTROLLER_COPY.none);

    typeInto(input, "");
    await flush();
    expect(visible(root)).toEqual(["Ana", "Ben", "Cara"]);
  });

  it("never injects HTML from cell text", async () => {
    const root = await show(
      table([["A"], ["<img src=x onerror=alert(1)>"]], { searchable: true }),
    );
    typeInto(root.querySelector("input[type=search]"), "img");
    await flush();
    expect(root.querySelector("img")).toBeNull();
    expect(visible(root)).toEqual(["<img src=x onerror=alert(1)>"]);
  });
});

describe("paging", () => {
  const many = (n: number): string[][] => [
    ["Name", "N"],
    ...Array.from({ length: n }, (_, i) => [`Row ${i + 1}`, `${i + 1}`]),
  ];

  it("shows 25 rows per page with the site Pagination", async () => {
    const root = await show(table(many(60), { paged: true, sortable: true }));
    expect(visible(root)).toHaveLength(25);
    expect(visible(root)[0]).toBe("Row 1");
    const nav = root.querySelector(
      `nav[aria-label="${TABLE_CONTROLLER_COPY.pages}"]`,
    );
    expect(nav).not.toBeNull();
    click(nav!.querySelector('a[aria-label="Page 3"]'));
    expect(visible(root)).toEqual([
      "Row 51",
      "Row 52",
      "Row 53",
      "Row 54",
      "Row 55",
      "Row 56",
      "Row 57",
      "Row 58",
      "Row 59",
      "Row 60",
    ]);
    expect(nav!.querySelector('[aria-current="page"]')?.textContent).toContain(
      "3",
    );
  });

  it("sorting returns to page 1", async () => {
    const root = await show(table(many(60), { paged: true, sortable: true }));
    click(root.querySelector('nav a[aria-label="Page 2"]'));
    expect(visible(root)[0]).toBe("Row 26");
    click(sortButton(root, 1));
    click(sortButton(root, 1)); // descending
    expect(visible(root)[0]).toBe("Row 60");
    expect(
      root.querySelector('nav [aria-current="page"]')?.textContent,
    ).toContain("1");
  });

  it("searching returns to page 1 and pages the matches", async () => {
    const root = await show(table(many(60), { paged: true, searchable: true }));
    click(root.querySelector('nav a[aria-label="Page 2"]'));
    typeInto(root.querySelector("input[type=search]"), "Row 5");
    await flush();
    // "Row 5" and "Row 50".."Row 59": 11 matches, one page, no pager.
    expect(visible(root)).toHaveLength(11);
    expect(visible(root)[0]).toBe("Row 5");
    expect(root.querySelector("nav")).toBeNull();
  });

  it("WR-C02: server HTML keeps the mounted layout (search space, page 1 rows, pager space)", () => {
    const PRE_HIDE =
      "[@media(scripting:enabled)]:group-data-[premount]/tbl:hidden";
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <TableSection
        layout="full"
        background="main"
        isH1Owner={false}
        isFirst={false}
        now={new Date("2026-10-01T12:00:00Z")}
        content={table(many(60), {
          paged: true,
          searchable: true,
          sortable: true,
        })}
      />,
    );
    const root = host.querySelector("[data-table-pro]")!;
    expect(root.hasAttribute("data-premount")).toBe(true);
    const search = root.querySelector("[data-search-standin]")!;
    expect(search.getAttribute("aria-hidden")).toBe("true");
    expect(search.hasAttribute("inert")).toBe(true);
    expect(search.className).toContain("invisible");
    expect(search.className).toContain(
      "hidden [@media(scripting:enabled)]:group-data-[premount]/tbl:flex",
    );
    expect(search.textContent).toContain("60 of 60 rows");
    // Rows 26..60 hide before mount where scripts run; no `hidden` attribute (no JS shows all).
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(
      rows.slice(0, 25).every((r) => !r.className.includes(PRE_HIDE)),
    ).toBe(true);
    expect(rows.slice(25).every((r) => r.className.includes(PRE_HIDE))).toBe(
      true,
    );
    expect(rows.every((r) => !r.hasAttribute("hidden"))).toBe(true);
    const pages = root.querySelector("[data-pages-standin]")!;
    expect(pages.className).toContain("invisible");
    expect(pages.querySelectorAll('a[aria-label^="Page"]').length).toBe(2);
    // Header text keeps the sort button's height.
    expect(root.querySelector("th[data-sort-col] > span")!.className).toContain(
      "min-h-11",
    );
    // The fallback brings the full table back if the island never mounts.
    expect(root.nextElementSibling?.tagName).toBe("SCRIPT");
    expect(root.nextElementSibling?.textContent).toBe(PREMOUNT_FALLBACK_SCRIPT);
  });

  it("WR-C02: mounted, the stand-ins, the hints and the fallback are gone", async () => {
    const root = await show(table(many(60), { paged: true, searchable: true }));
    const island = root.querySelector("[data-table-pro]")!;
    expect(island.hasAttribute("data-premount")).toBe(false);
    expect(island.querySelector("[data-search-standin]")).toBeNull();
    expect(island.querySelector("[data-pages-standin]")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
  });

  it("WR-C02: a sort-only table needs no fallback script", () => {
    const html = renderToStaticMarkup(
      <TableSection
        layout="full"
        background="main"
        isH1Owner={false}
        isFirst={false}
        now={new Date("2026-10-01T12:00:00Z")}
        content={table(many(30), { sortable: true })}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("group-data-[premount]/tbl:hidden");
  });

  it("no transitions (reduced motion needs nothing extra)", async () => {
    const root = await show(table(many(30), { paged: true }));
    expect(root.querySelector("[data-table-pro]")!.outerHTML).not.toMatch(
      /transition|animate-/,
    );
  });
});
