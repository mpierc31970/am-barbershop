// Pro table markup (10-42; BILL-14, D233; 10-UI-SPEC "Pro table" › Public table): sticky,
// icons with text alternatives, highlight + label, section rows, widths, and the island
// wrapper with its data attributes only when sort / search / paging is on. A free table
// (and a lapsed one, projected by tableForRender) renders the P7 markup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defaultTableBlock,
  emptyTablePro,
  newTableCell,
  tableForRender,
  type TableBlockContent,
  type TableCell,
  type TablePro,
} from "@cds/core/content";
import { TableSection } from "./TableSection";

const base = {
  layout: "full" as const,
  background: "main" as const,
  isH1Owner: false,
  isFirst: false,
  now: new Date("2026-10-01T12:00:00.000Z"),
};

const cells = (rows: string[][]): TableCell[][] =>
  rows.map((r) => r.map((t) => newTableCell(t)));

const ROWS = [
  ["Plan", "Basic", "Pro"],
  ["Visits", "4", "8"],
  ["Extras", "", ""],
  ["Support", "", ""],
];

function content(
  pro: Partial<TablePro> | null,
  mutate?: (rows: TableCell[][]) => void,
): TableBlockContent {
  const rows = cells(ROWS);
  mutate?.(rows);
  return {
    ...defaultTableBlock(),
    heading: "Compare plans",
    header_row: true,
    first_column_header: true,
    rows,
    align: ["left", "left", "left"],
    ...(pro ? { pro: { ...emptyTablePro(), ...pro } } : {}),
  };
}

const render = (c: TableBlockContent, background = base.background) =>
  renderToStaticMarkup(
    <TableSection {...base} background={background} content={c} />,
  );

describe("free table markup is unchanged", () => {
  it("no pro and an empty pro render the same markup, with no Pro hooks", () => {
    const plain = render(content(null));
    expect(render(content({}))).toBe(plain);
    expect(plain).not.toContain("data-table-pro");
    expect(plain).not.toContain("sticky");
    expect(plain).not.toContain("colgroup");
    expect(plain).not.toContain("data-sort");
  });

  it("a lapsed Pro table (tableForRender, proActive false) renders like a free table", () => {
    const pro = content(
      {
        sticky: true,
        sortable: true,
        highlight: { column: 2, label: "Most popular" },
        section_rows: [2],
      },
      (rows) => {
        rows[3]![1]!.icon = "yes";
      },
    );
    const lapsed = render(tableForRender(pro, { proActive: false }));
    expect(lapsed).not.toContain("data-table-pro");
    expect(lapsed).not.toContain("Most popular");
    expect(lapsed).not.toContain("colgroup");
    expect(lapsed).not.toContain("<svg");
  });
});

describe("Pro presentation", () => {
  it("sticky header and first column inside the focusable region", () => {
    const out = render(content({ sticky: true }));
    expect(out).toMatch(
      /role="region" tabindex="0"[^>]*class="max-h-\[70vh\] overflow-auto"/,
    );
    expect(out).toMatch(/<th scope="col"[^>]*sticky top-0/);
    expect(out).toMatch(/<th scope="row"[^>]*sticky left-0/);
    expect(out).toContain("shadow-[inset_0_-1px_0_var(--site-border)]");
    // Band surface paints sticky cells (main band = surface).
    expect(out).toMatch(/sticky top-0 z-20 bg-site-surface /);
  });

  it("sticky first column is off below 768px in cards mode", () => {
    const out = render({ ...content({ sticky: true }), mobile: "cards" });
    expect(out).toContain("max-md:static");
  });

  it("icons render an svg and a visually hidden text alternative", () => {
    const out = render(
      content({}, (rows) => {
        rows[3]![1]!.icon = "yes";
        rows[3]![2]!.icon = "no";
        rows[2]![2]!.icon = "dash";
      }),
    );
    expect(out.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBe(3);
    expect(out).toContain('<span class="sr-only">Yes</span>');
    expect(out).toContain('<span class="sr-only">No</span>');
    expect(out).toContain('<span class="sr-only">Not included</span>');
  });

  it("an icon cell keeps its text after the icon", () => {
    const out = render(
      content({}, (rows) => {
        rows[1]![1]!.icon = "yes";
      }),
    );
    expect(out).toMatch(/<span class="sr-only">Yes<\/span>4/);
  });

  it("highlighted column: tinted cells with primary rules and a label chip in the header name", () => {
    const out = render(
      content({ highlight: { column: 2, label: "Most popular" } }),
    );
    const tinted = out.match(/border-x-2 border-site-primary/g) ?? [];
    expect(tinted.length).toBe(4); // header + 3 body rows
    expect(out).toMatch(
      /<th scope="col"[^>]*>.*?Pro.*?<span class="sr-only">, <\/span>Most popular/,
    );
    expect(out).toContain("bg-site-primary");
    expect(out).toContain("text-site-primary-contrast");
  });

  it("section rows render th scope=colgroup spanning every column", () => {
    const out = render(content({ section_rows: [2] }));
    expect(out).toContain('<th scope="colgroup" colSpan="3"');
    expect(out).toMatch(
      /data-section-row=""[^>]*><th scope="colgroup"[^>]*>Extras<\/th>/,
    );
    // The section row is not a data row.
    expect(out).not.toMatch(/<th scope="row"[^>]*>Extras/);
  });

  it("column widths go on <col> and as cell minimums", () => {
    const out = render(content({ widths: ["auto", "narrow", "wide"] }));
    expect(out).toContain(
      '<colgroup><col/><col style="width:96px"/><col style="width:320px"/></colgroup>',
    );
    expect(out).toContain("min-width:320px");
  });

  it("all-auto widths render no colgroup", () => {
    const out = render(content({ widths: ["auto", "auto", "auto"] }));
    expect(out).not.toContain("colgroup");
  });
});

describe("island hooks", () => {
  it("only highlight / sticky: no island, no data-table-pro", () => {
    const out = render(
      content({ sticky: true, highlight: { column: 1, label: "" } }),
    );
    expect(out).not.toContain("data-table-pro");
  });

  it("sort renders hidden header buttons and data attributes; plain text shows without JS", () => {
    const out = render(content({ sortable: true }));
    expect(out).toContain('data-table-pro=""');
    expect(out).toContain('data-sortable="true"');
    expect(out).not.toContain("data-searchable");
    expect(out).not.toContain("data-paged");
    expect(out).not.toContain("data-ready");
    expect(out.match(/data-sort-col="/g)?.length).toBe(3);
    expect(out.match(/<button type="button" data-sort-button="/g)?.length).toBe(
      3,
    );
    expect(out).toMatch(/data-sort-button="0" class="hidden /);
    expect(out).toContain("group-data-[ready=true]/tbl:inline-flex");
  });

  it("sort needs a header row", () => {
    const out = render({ ...content({ sortable: true }), header_row: false });
    expect(out).not.toContain("data-sort-button");
    expect(out).not.toContain("data-table-pro");
  });

  it("search and paging: no search box or pager before the island mounts (no-JS full table)", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`Row ${i}`, `${i}`, ""]);
    const c: TableBlockContent = {
      ...content({ searchable: true, paged: true }),
      rows: cells([["Name", "N", "X"], ...rows]),
    };
    const out = render(c);
    expect(out).toContain('data-searchable="true"');
    expect(out).toContain('data-paged="true"');
    // No live search box or pager: only WR-C02's inert, aria-hidden space-keepers, which
    // are display:none without scripting.
    expect(out).not.toContain("<label");
    expect(out).not.toMatch(/<input[^>]*id=/);
    expect(out).toMatch(/data-search-standin=""/);
    expect(out).toMatch(/<div aria-hidden="true" inert="" data-search-standin/);
    expect(out).toMatch(/<div aria-hidden="true" inert="" data-pages-standin/);
    // Every row is in the HTML.
    expect(out).toContain("Row 39");
  });
});
