// Pro table (10-35; BILL-14, D232, D233, D281, invariant 9; T-10-35-01..03).
//
// The table block's limits and its Builder Pro settings live here, so table.ts (the
// structural validator) and the plan check share one source without an import cycle:
// this file never imports table.ts at runtime.
//
// - Structure: validateTableBlock accepts up to PRO_TABLE_MAX_COLUMNS x PRO_TABLE_MAX_ROWS.
// - Plan: assertTablePlan refuses a save that newly uses any Pro part without Builder Pro.
//   A Pro part that is unchanged from the previous save passes, so a lapsed owner can still
//   edit text in a table that already had Pro content (invariant 9: disable, retain).
// - Render: tableForRender(..., { proActive: false }) shows the free table (first 10 columns,
//   first 200 rows, Pro presentation off) without touching stored content.
//
// Pure and Edge-safe: no Node built-ins, no html, no next/* imports.
import { InvalidInput } from "../../errors";
import type { TableBlockContent, TableCell } from "./table";
import { isRecord, oneOf, own, text } from "../validate-helpers";

/** Free table (D232). */
export const TABLE_MAX_COLUMNS = 10;
export const TABLE_MAX_ROWS = 200;

/** Builder Pro table (D233): the structural ceiling. */
export const PRO_TABLE_MAX_COLUMNS = 20;
export const PRO_TABLE_MAX_ROWS = 1000;
export const PRO_TABLE_PAGE_SIZE = 25;
export const PRO_TABLE_HIGHLIGHT_LABEL_MAX = 40;

export const PRO_TABLE_COPY =
  "Bigger tables, sorting, search and icons are part of Builder Pro.";
export const PRO_TABLE_LIMIT_COPY =
  "Tables hold up to 20 columns and 1,000 rows. Split it into two tables.";
export const PRO_TABLE_SHAPE_COPY =
  "This table's Pro settings don't match its rows and columns.";

export type TableIcon = "yes" | "no" | "dash";
export type TableColumnWidth = "auto" | "narrow" | "medium" | "wide";

export const PRO_TABLE_ICONS: readonly TableIcon[] = Object.freeze([
  "yes",
  "no",
  "dash",
]);
/** Text alternatives the renderer gives each icon. */
export const PRO_TABLE_ICON_LABELS: Readonly<Record<TableIcon, string>> =
  Object.freeze({ yes: "Yes", no: "No", dash: "Not included" });
export const PRO_TABLE_WIDTHS: readonly TableColumnWidth[] = Object.freeze([
  "auto",
  "narrow",
  "medium",
  "wide",
]);

export type TablePro = {
  /** Header row and first column stay in place while scrolling. */
  sticky: boolean;
  sortable: boolean;
  searchable: boolean;
  /** PRO_TABLE_PAGE_SIZE rows per page. */
  paged: boolean;
  highlight: { column: number; label: string } | null;
  /** [] (all auto) or one entry per column. */
  widths: TableColumnWidth[];
  /** Row indexes rendered as a full-width heading row; sorted, unique. */
  section_rows: number[];
};

export const EMPTY_TABLE_PRO: Readonly<TablePro> = Object.freeze({
  sticky: false,
  sortable: false,
  searchable: false,
  paged: false,
  highlight: null,
  widths: Object.freeze([]) as unknown as TableColumnWidth[],
  section_rows: Object.freeze([]) as unknown as number[],
});

export function emptyTablePro(): TablePro {
  return {
    sticky: false,
    sortable: false,
    searchable: false,
    paged: false,
    highlight: null,
    widths: [],
    section_rows: [],
  };
}

/** Cell icon: one of PRO_TABLE_ICONS, anything else is "" (no icon). */
export function tableCellIcon(value: unknown): TableIcon | "" {
  return oneOf(value, [...PRO_TABLE_ICONS, ""] as const, "");
}

function isIndex(v: unknown, size: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < size;
}

/**
 * Deny-by-default rebuild of `pro` for a table of `width` columns and `rowCount` rows.
 * Unknown keys are dropped; a highlight column or section row outside the table, or
 * widths of the wrong length, are refused.
 */
export function validateTablePro(
  value: unknown,
  width: number,
  rowCount: number,
): TablePro {
  if (!isRecord(value)) return emptyTablePro();
  const flag = (key: string) => own(value, key) === true;

  let highlight: TablePro["highlight"] = null;
  const rawHighlight = own(value, "highlight");
  if (isRecord(rawHighlight)) {
    const column = own(rawHighlight, "column");
    if (!isIndex(column, width)) throw new InvalidInput(PRO_TABLE_SHAPE_COPY);
    highlight = {
      column,
      label: text(rawHighlight, "label", PRO_TABLE_HIGHLIGHT_LABEL_MAX),
    };
  }

  let widths: TableColumnWidth[] = [];
  const rawWidths = own(value, "widths");
  if (Array.isArray(rawWidths) && rawWidths.length > 0) {
    if (rawWidths.length !== width) {
      throw new InvalidInput(PRO_TABLE_SHAPE_COPY);
    }
    widths = rawWidths.map((w) => oneOf(w, PRO_TABLE_WIDTHS, "auto"));
  }

  let section_rows: number[] = [];
  const rawSections = own(value, "section_rows");
  if (Array.isArray(rawSections)) {
    if (rawSections.length > rowCount) {
      throw new InvalidInput(PRO_TABLE_SHAPE_COPY);
    }
    for (const r of rawSections) {
      if (!isIndex(r, rowCount)) throw new InvalidInput(PRO_TABLE_SHAPE_COPY);
    }
    section_rows = [...new Set(rawSections as number[])].sort((a, b) => a - b);
  }

  return {
    sticky: flag("sticky"),
    sortable: flag("sortable"),
    searchable: flag("searchable"),
    paged: flag("paged"),
    highlight,
    widths,
    section_rows,
  };
}

// ---------------------------------------------------------------------------
// Plan check and render projection. Inputs are validated content, but every read is
// defensive so malformed stored content never throws here.

function rowsOf(content: TableBlockContent | null): TableCell[][] {
  return content && Array.isArray(content.rows) ? content.rows : [];
}

function widthOf(content: TableBlockContent | null): number {
  return rowsOf(content).reduce(
    (w, r) => Math.max(w, Array.isArray(r) ? r.length : 0),
    0,
  );
}

function proOf(content: TableBlockContent | null): TablePro {
  const p = content?.pro;
  return isRecord(p) ? (p as TablePro) : EMPTY_TABLE_PRO;
}

/** True when every value of `next` is matched by its own value in `previous` (multiset). */
function subMultiset(
  next: readonly string[],
  previous: readonly string[],
): boolean {
  const left = new Map<string, number>();
  for (const v of previous) left.set(v, (left.get(v) ?? 0) + 1);
  for (const v of next) {
    const n = left.get(v) ?? 0;
    if (n === 0) return false;
    left.set(v, n - 1);
  }
  return true;
}

function nonAutoWidths(widths: unknown): string[] {
  return Array.isArray(widths)
    ? widths.filter((w): w is string => typeof w === "string" && w !== "auto")
    : [];
}

function iconsOf(content: TableBlockContent): string[] {
  const out: string[] = [];
  for (const row of rowsOf(content)) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const icon = cell?.icon ?? "";
      if (icon !== "") out.push(icon);
    }
  }
  return out;
}

function widthsUsed(widths: unknown): boolean {
  return Array.isArray(widths) && widths.some((w) => w !== "auto");
}

/** The Pro parts this table uses, by name. */
function proParts(content: TableBlockContent): string[] {
  const parts: string[] = [];
  const rows = rowsOf(content);
  if (rows.length > TABLE_MAX_ROWS || widthOf(content) > TABLE_MAX_COLUMNS) {
    parts.push("size");
  }
  const pro = proOf(content);
  if (pro.sticky === true) parts.push("sticky");
  if (pro.sortable === true) parts.push("sortable");
  if (pro.searchable === true) parts.push("searchable");
  if (pro.paged === true) parts.push("paged");
  if (isRecord(pro.highlight)) parts.push("highlight");
  if (widthsUsed(pro.widths)) parts.push("widths");
  if (Array.isArray(pro.section_rows) && pro.section_rows.length > 0) {
    parts.push("section_rows");
  }
  if (rows.some((r) => Array.isArray(r) && r.some((c) => !!c?.icon))) {
    parts.push("icons");
  }
  return parts;
}

/** True when the table uses any Builder Pro setting, an icon, or exceeds 10 x 200. */
export function tableUsesPro(content: TableBlockContent): boolean {
  return proParts(content).length > 0;
}

/**
 * True when `part` of `next` adds nothing to `previous` (WR-B01). Compared by count and
 * value, never by position: the builder remaps section rows, widths, the highlight and icons
 * on every row or column insert or delete, so a lapsed owner can still restructure a table;
 * they just cannot add Pro use (a new section row, width, icon or a new highlight label).
 */
function partKept(
  part: string,
  next: TableBlockContent,
  previous: TableBlockContent | null,
): boolean {
  if (!previous) return false;
  const a = proOf(next);
  const b = proOf(previous);
  switch (part) {
    case "size":
      return (
        rowsOf(next).length <=
          Math.max(TABLE_MAX_ROWS, rowsOf(previous).length) &&
        widthOf(next) <= Math.max(TABLE_MAX_COLUMNS, widthOf(previous))
      );
    case "sticky":
    case "sortable":
    case "searchable":
    case "paged":
      return b[part] === true;
    case "highlight":
      // The column follows inserts and deletes; the label is the Pro text.
      return (
        isRecord(b.highlight) &&
        isRecord(a.highlight) &&
        b.highlight.label === a.highlight.label
      );
    case "widths":
      return subMultiset(nonAutoWidths(a.widths), nonAutoWidths(b.widths));
    case "section_rows":
      return (
        (Array.isArray(a.section_rows) ? a.section_rows.length : 0) <=
        (Array.isArray(b.section_rows) ? b.section_rows.length : 0)
      );
    case "icons":
      return subMultiset(iconsOf(next), iconsOf(previous));
    default:
      return false;
  }
}

/**
 * Plan check on save (D233, invariant 9). With Builder Pro anything the structure allows
 * passes. Without it, a save may not newly use a Pro part; a Pro part that adds nothing to
 * `previous` (same or fewer section rows, widths, icons; the same highlight label; a size no
 * bigger than before) is kept, wherever rows and columns moved (WR-B01). Throws
 * InvalidInput(PRO_TABLE_COPY).
 */
export function assertTablePlan(
  content: TableBlockContent,
  opts: { proEntitled: boolean; previous: TableBlockContent | null },
): void {
  if (opts.proEntitled) return;
  for (const part of proParts(content)) {
    if (!partKept(part, content, opts.previous)) {
      throw new InvalidInput(PRO_TABLE_COPY);
    }
  }
}

/**
 * What visitors see. Pro active: the content as stored. Pro inactive: a fresh free table
 * (first 10 columns, first 200 rows, icons cleared, Pro presentation off). The input is
 * never mutated, so paying again restores the full table.
 */
export function tableForRender(
  content: TableBlockContent,
  opts: { proActive: boolean },
): TableBlockContent {
  if (opts.proActive) return content;
  const rows = rowsOf(content)
    .slice(0, TABLE_MAX_ROWS)
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .slice(0, TABLE_MAX_COLUMNS)
        .map((cell) => ({
          text: typeof cell?.text === "string" ? cell.text : "",
          bold: cell?.bold === true,
          italic: cell?.italic === true,
          link: typeof cell?.link === "string" ? cell.link : "",
        })),
    );
  return {
    heading: content.heading,
    header_row: content.header_row,
    first_column_header: content.first_column_header,
    striped: content.striped,
    align: Array.isArray(content.align)
      ? content.align.slice(0, TABLE_MAX_COLUMNS)
      : [],
    mobile: content.mobile,
    rows,
    pro: emptyTablePro(),
  };
}
