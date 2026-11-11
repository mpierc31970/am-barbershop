// Pure table editing for the table block editor (07-21; D232, CONT-26, D-UI-P7-23; D120;
// T-07-21-03, T-07-21-04).
//
// Every function returns a fresh TableBlockContent (never mutates its input) and keeps each
// row the same width with `align` in step with the column count. Limits and copy come from
// @cds/core/content (TABLE_MAX_COLUMNS x TABLE_MAX_ROWS, TABLE_LIMIT_COPY); validateTableBlock
// stays the authority at Save block. Pasted and imported cells arrive as plain text
// (newTableCell), matching the P3 rule that outside pastes are flattened. CSV goes through the
// P5 engine: export applies the formula guard, import unguards losslessly.
//
// 10-41 (BILL-14, D233, D-UI-P10-24/25): the draft keeps the optional Builder Pro settings
// (`pro`) and cell icons; every grid edit keeps section rows, the highlight and widths on the
// same cells. Growth limits are a parameter (`TableLimits`): free 10 x 200 by default, Pro
// 20 x 1,000 when the builder knows the org has Builder Pro. assertTablePlan on the server
// stays the authority (T-10-41-01).
import {
  assertTablePlan,
  emptyTablePro,
  newTableCell,
  PRO_TABLE_HIGHLIGHT_LABEL_MAX,
  PRO_TABLE_ICONS,
  PRO_TABLE_LIMIT_COPY,
  PRO_TABLE_MAX_COLUMNS,
  PRO_TABLE_MAX_ROWS,
  PRO_TABLE_WIDTHS,
  TABLE_ALIGNS,
  TABLE_LIMIT_COPY,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TABLE_MOBILE_MODES,
  type TableAlign,
  type TableBlockContent,
  type TableCell,
  type TableColumnWidth,
  type TableIcon,
  type TableMobile,
  type TablePro,
} from "@cds/core/content";
import {
  parseCsv,
  serializeCsv,
  unguardFormula,
  type ImportPreview,
} from "@cds/core/csv";
import type { HubActionResult } from "../../hub/addon-types";

export type CellAt = { row: number; col: number };
export type TableResult = { content: TableBlockContent } | { error: string };

/** How far the grid may grow, and the copy shown past it. */
export type TableLimits = { rows: number; columns: number; copy: string };
export const FREE_TABLE_LIMITS: TableLimits = Object.freeze({
  rows: TABLE_MAX_ROWS,
  columns: TABLE_MAX_COLUMNS,
  copy: TABLE_LIMIT_COPY,
});
export const PRO_TABLE_LIMITS: TableLimits = Object.freeze({
  rows: PRO_TABLE_MAX_ROWS,
  columns: PRO_TABLE_MAX_COLUMNS,
  copy: PRO_TABLE_LIMIT_COPY,
});
/** The limits for an org with (true) or without Builder Pro. */
export function tableLimits(builderPro: boolean): TableLimits {
  return builderPro ? PRO_TABLE_LIMITS : FREE_TABLE_LIMITS;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function own(o: Record<string, unknown>, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

const isIndex = (v: unknown, size: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < size;

function draftCell(v: unknown): TableCell {
  if (typeof v === "string") return newTableCell(v);
  if (!isRecord(v)) return newTableCell();
  const text = own(v, "text");
  const link = own(v, "link");
  const icon = own(v, "icon");
  const cell: TableCell = {
    text: typeof text === "string" ? text : "",
    bold: own(v, "bold") === true,
    italic: own(v, "italic") === true,
    link: typeof link === "string" ? link : "",
  };
  if (
    typeof icon === "string" &&
    (PRO_TABLE_ICONS as readonly string[]).includes(icon)
  ) {
    cell.icon = icon as TableIcon;
  }
  return cell;
}

/** Lenient Pro settings for a `width` x `rowCount` grid; out-of-range parts are dropped. */
function draftPro(v: unknown, width: number, rowCount: number): TablePro {
  const pro = emptyTablePro();
  if (!isRecord(v)) return pro;
  pro.sticky = own(v, "sticky") === true;
  pro.sortable = own(v, "sortable") === true;
  pro.searchable = own(v, "searchable") === true;
  pro.paged = own(v, "paged") === true;
  const h = own(v, "highlight");
  if (isRecord(h)) {
    const column = own(h, "column");
    const label = own(h, "label");
    if (isIndex(column, width)) {
      pro.highlight = {
        column,
        label: typeof label === "string" ? label : "",
      };
    }
  }
  const widths = own(v, "widths");
  if (Array.isArray(widths) && widths.length === width) {
    pro.widths = widths.map((w) =>
      typeof w === "string" &&
      (PRO_TABLE_WIDTHS as readonly string[]).includes(w)
        ? (w as TableColumnWidth)
        : "auto",
    );
  }
  const sections = own(v, "section_rows");
  if (Array.isArray(sections)) {
    pro.section_rows = [
      ...new Set(
        sections.filter((r: unknown): r is number => isIndex(r, rowCount)),
      ),
    ].sort((a, b) => a - b);
  }
  return pro;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Lenient normaliser for a possibly malformed draft: never throws; at least 1 x 1. */
export function tableDraft(
  content: Record<string, unknown>,
): TableBlockContent {
  const raw = isRecord(content) ? content : {};
  const rawRows = own(raw, "rows");
  const list: unknown[] = Array.isArray(rawRows) ? rawRows : [];
  let rows = list.map((r) => (Array.isArray(r) ? r.map(draftCell) : []));
  let width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (rows.length === 0 || width === 0) {
    width = Math.max(width, 1);
    if (rows.length === 0) rows = [[]];
  }
  rows = rows.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push(newTableCell());
    return out;
  });
  const rawAlign = own(raw, "align");
  const alignList: unknown[] = Array.isArray(rawAlign) ? rawAlign : [];
  const align = Array.from({ length: width }, (_, i) => {
    const a = alignList[i];
    return typeof a === "string" &&
      (TABLE_ALIGNS as readonly string[]).includes(a)
      ? (a as TableAlign)
      : "left";
  });
  const heading = own(raw, "heading");
  const mobile = own(raw, "mobile");
  const rawPro = own(raw, "pro");
  const out: TableBlockContent = {
    heading: typeof heading === "string" ? heading : "",
    header_row: boolOr(own(raw, "header_row"), true),
    first_column_header: boolOr(own(raw, "first_column_header"), false),
    striped: boolOr(own(raw, "striped"), false),
    align,
    mobile:
      typeof mobile === "string" &&
      (TABLE_MOBILE_MODES as readonly string[]).includes(mobile)
        ? (mobile as TableMobile)
        : "scroll",
    rows,
  };
  // Only a table that already has Pro settings carries them (a P7 table stays exactly P7).
  if (rawPro !== undefined) out.pro = draftPro(rawPro, width, rows.length);
  return out;
}

const widthOf = (c: TableBlockContent): number => c.rows[0]?.length ?? 0;

function copyPro(p: TablePro): TablePro {
  return {
    ...p,
    highlight: p.highlight ? { ...p.highlight } : null,
    widths: p.widths.slice(),
    section_rows: p.section_rows.slice(),
  };
}

function copy(c: TableBlockContent): TableBlockContent {
  const next: TableBlockContent = {
    ...c,
    align: c.align.slice(),
    rows: c.rows.map((r) => r.map((cell) => ({ ...cell }))),
  };
  if (c.pro) next.pro = copyPro(c.pro);
  return next;
}

/** The table's Pro settings, created empty when it has none yet (on a copy). */
function proOn(next: TableBlockContent): TablePro {
  if (!next.pro) next.pro = emptyTablePro();
  return next.pro;
}

const clampIndex = (at: number, max: number) =>
  Math.max(0, Math.min(Number.isFinite(at) ? Math.trunc(at) : max, max));

/** Insert an empty row at `at` (0 = top). Unchanged at the row limit. */
export function insertRow(
  c: TableBlockContent,
  at: number,
  limits: TableLimits = FREE_TABLE_LIMITS,
): TableBlockContent {
  if (c.rows.length >= limits.rows) return c;
  const next = copy(c);
  const width = Math.max(1, widthOf(c));
  const row = Array.from({ length: width }, () => newTableCell());
  const i = clampIndex(at, c.rows.length);
  next.rows.splice(i, 0, row);
  if (next.align.length < width) {
    while (next.align.length < width) next.align.push("left");
  }
  if (next.pro) {
    next.pro.section_rows = next.pro.section_rows.map((r) =>
      r >= i ? r + 1 : r,
    );
  }
  return next;
}

/**
 * WR-C03: true when an edit to a paused (lapsed) Pro table would add Pro use compared with
 * the draft before it (a new section row, width, icon, highlight label or a bigger size),
 * the edits the server's plan check refuses at Save block. The editor refuses them in place
 * with PRO_TABLE_COPY and changes nothing. Structural edits that only move or drop Pro parts
 * pass, as on the server (WR-B01).
 */
export function pausedEditAddsPro(
  previous: TableBlockContent,
  next: TableBlockContent,
): boolean {
  try {
    assertTablePlan(next, { proEntitled: false, previous });
    return false;
  } catch {
    return true;
  }
}

/** Delete row `at`. Never drops the last row. */
export function deleteRow(c: TableBlockContent, at: number): TableBlockContent {
  if (c.rows.length <= 1 || at < 0 || at >= c.rows.length) return c;
  const next = copy(c);
  next.rows.splice(at, 1);
  if (next.pro) {
    next.pro.section_rows = next.pro.section_rows
      .filter((r) => r !== at)
      .map((r) => (r > at ? r - 1 : r));
  }
  return next;
}

/** Insert an empty column at `at` (0 = left), align "left". Unchanged at the column limit. */
export function insertColumn(
  c: TableBlockContent,
  at: number,
  limits: TableLimits = FREE_TABLE_LIMITS,
): TableBlockContent {
  const width = widthOf(c);
  if (width >= limits.columns) return c;
  const next = copy(c);
  const i = clampIndex(at, width);
  next.rows = next.rows.map((r) => {
    const out = r.slice();
    out.splice(i, 0, newTableCell());
    return out;
  });
  next.align.splice(i, 0, "left");
  if (next.pro) {
    if (next.pro.widths.length > 0) next.pro.widths.splice(i, 0, "auto");
    const h = next.pro.highlight;
    if (h && h.column >= i) h.column += 1;
  }
  return next;
}

/** Delete column `at`. Never drops the last column. */
export function deleteColumn(
  c: TableBlockContent,
  at: number,
): TableBlockContent {
  const width = widthOf(c);
  if (width <= 1 || at < 0 || at >= width) return c;
  const next = copy(c);
  next.rows = next.rows.map((r) => r.filter((_, i) => i !== at));
  next.align.splice(at, 1);
  if (next.pro) {
    if (next.pro.widths.length > 0) next.pro.widths.splice(at, 1);
    const h = next.pro.highlight;
    if (h && h.column === at) next.pro.highlight = null;
    else if (h && h.column > at) h.column -= 1;
  }
  return next;
}

/** Patch one cell (text is kept exactly as typed; other flags kept; no icon = no key). */
export function setCell(
  c: TableBlockContent,
  row: number,
  col: number,
  patch: Partial<TableCell>,
): TableBlockContent {
  const cell = c.rows[row]?.[col];
  if (!cell) return c;
  const next = copy(c);
  const out: TableCell = { ...cell, ...patch };
  if (!out.icon) delete out.icon;
  next.rows[row]![col] = out;
  return next;
}

/** Set one column's alignment. */
export function setAlign(
  c: TableBlockContent,
  col: number,
  align: TableAlign,
): TableBlockContent {
  if (col < 0 || col >= widthOf(c)) return c;
  const next = copy(c);
  next.align[col] = align;
  return next;
}

const flat = (text: string) => text.replace(/[\r\n]+/g, " ");

/**
 * Write a pasted grid from `at`, growing rows and columns to fit. Pasted cells are plain
 * text (flags reset). Past the limits: `{ error }`, nothing changes.
 */
export function pasteGrid(
  c: TableBlockContent,
  at: CellAt,
  grid: readonly (readonly string[])[],
  limits: TableLimits = FREE_TABLE_LIMITS,
): TableResult {
  const gridWidth = grid.reduce((w, r) => Math.max(w, r.length), 0);
  if (grid.length === 0 || gridWidth === 0) return { content: c };
  const row0 = Math.max(0, at.row);
  const col0 = Math.max(0, at.col);
  const rows = Math.max(c.rows.length, row0 + grid.length);
  const cols = Math.max(widthOf(c), col0 + gridWidth);
  if (rows > limits.rows || cols > limits.columns) {
    return { error: limits.copy };
  }
  const next = copy(c);
  while (next.rows.length < rows) next.rows.push([]);
  next.rows = next.rows.map((r) => {
    const out = r.slice();
    while (out.length < cols) out.push(newTableCell());
    return out;
  });
  while (next.align.length < cols) next.align.push("left");
  if (next.pro && next.pro.widths.length > 0) {
    while (next.pro.widths.length < cols) next.pro.widths.push("auto");
  }
  grid.forEach((line, r) => {
    line.forEach((text, k) => {
      next.rows[row0 + r]![col0 + k] = newTableCell(flat(text));
    });
  });
  return { content: next };
}

/** The table as CSV text (first row = header line; formula guard via serializeCsv). */
export function tableToCsv(c: TableBlockContent): string {
  const texts = c.rows.map((r) => r.map((cell) => cell.text));
  if (texts.length === 0) return serializeCsv([], []);
  return serializeCsv(texts[0]!, texts.slice(1));
}

export type TableCsvRows =
  | { ok: true; rows: string[][]; columns: number }
  | { ok: false; message: string };

/**
 * Every line of a CSV file as table rows (the first line included: the table becomes exactly
 * the file). A header-only file is a one-row table. Cells are unguarded and CR/LF collapse to
 * spaces. Past the limits (free: 10 columns or 200 lines): the limits' copy. Other parse
 * errors pass their own copy through.
 */
export function tableRowsFromCsv(
  text: string,
  limits: TableLimits = FREE_TABLE_LIMITS,
): TableCsvRows {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // A one-cell sentinel header makes every real line a data row, so a header-only file
  // parses and the first line is kept as row 1.
  const parsed = parseCsv(`x\r\n${body}`);
  if (!parsed.ok) {
    if (parsed.error.code === "too_many_rows") {
      return { ok: false, message: limits.copy };
    }
    if (parsed.error.code === "header_only") {
      return {
        ok: false,
        message:
          "This file is empty. Add a header row and your rows, then upload it again.",
      };
    }
    return { ok: false, message: parsed.error.message };
  }
  const lines = parsed.rows;
  const columns = lines.reduce((w, r) => Math.max(w, r.length), 0);
  if (lines.length > limits.rows || columns > limits.columns) {
    return { ok: false, message: limits.copy };
  }
  const rows = lines.map((r) => {
    const out = r.map((cell) => flat(unguardFormula(cell)));
    while (out.length < columns) out.push("");
    return out;
  });
  return { ok: true, rows, columns };
}

/**
 * Apply CSV rows to the table: rows and align replaced, options kept. Pro settings that
 * point at cells (section rows, the highlight, widths) are kept only where they still fit.
 */
export function applyCsvRows(
  c: TableBlockContent,
  rows: readonly (readonly string[])[],
  columns: number,
): TableBlockContent {
  const next: TableBlockContent = {
    ...c,
    align: Array.from({ length: columns }, (_, i) => c.align[i] ?? "left"),
    rows: rows.map((r) => r.map((t) => newTableCell(t))),
  };
  if (c.pro) next.pro = draftPro(c.pro, columns, rows.length);
  return next;
}

/**
 * The CsvImportDialog preview for a table import (replace, every row "new", no removals).
 * Columns are labelled from the first line ("Column N" when blank); the preview lists the
 * lines under it (or the single line of a one-row file).
 */
export async function tablePreviewFromCsv(
  text: string,
  limits: TableLimits = FREE_TABLE_LIMITS,
): Promise<HubActionResult<ImportPreview>> {
  const res = tableRowsFromCsv(text, limits);
  if (!res.ok)
    return { ok: false, code: "invalid_input", message: res.message };
  const { rows, columns } = res;
  const first = rows[0] ?? [];
  const cols = Array.from({ length: columns }, (_, i) => ({
    key: `c${i}`,
    label: (first[i] ?? "").trim() || `Column ${i + 1}`,
  }));
  const shown = rows.length > 1 ? rows.slice(1) : rows;
  const offset = rows.length > 1 ? 2 : 1;
  return {
    ok: true,
    data: {
      counts: {
        new: rows.length,
        updated: 0,
        unchanged: 0,
        duplicates: 0,
        errors: 0,
      },
      mode: "replace",
      ignored: [],
      columns: cols,
      rows: shown.map((r, i) => ({
        rowNumber: i + offset,
        status: "new",
        cells: Object.fromEntries(r.map((t, k) => [`c${k}`, t])),
        changed: [],
        messages: [],
      })),
      removals: [],
      changes: rows.length,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Builder Pro settings (10-41; D233, D-UI-P10-24). Each returns a fresh table.

export type TableProSwitch = "sticky" | "sortable" | "searchable" | "paged";

/** Patch the table-wide Pro switches (sticky, sortable, searchable, paged). */
export function setTablePro(
  c: TableBlockContent,
  patch: Partial<Pick<TablePro, TableProSwitch>>,
): TableBlockContent {
  const next = copy(c);
  const pro = proOn(next);
  for (const k of ["sticky", "sortable", "searchable", "paged"] as const) {
    const v = patch[k];
    if (typeof v === "boolean") pro[k] = v;
  }
  return next;
}

/** Set one cell's icon; "" removes it. */
export function setCellIcon(
  c: TableBlockContent,
  row: number,
  col: number,
  icon: TableIcon | "",
): TableBlockContent {
  return setCell(c, row, col, { icon: icon === "" ? undefined : icon });
}

/** Make row `row` a section heading, or turn it back into a normal row. */
export function toggleSectionRow(
  c: TableBlockContent,
  row: number,
): TableBlockContent {
  if (!isIndex(row, c.rows.length)) return c;
  const next = copy(c);
  const pro = proOn(next);
  pro.section_rows = pro.section_rows.includes(row)
    ? pro.section_rows.filter((r) => r !== row)
    : [...pro.section_rows, row].sort((a, b) => a - b);
  return next;
}

/** Set one column's width; all "auto" stores no widths at all. */
export function setColumnWidth(
  c: TableBlockContent,
  col: number,
  width: TableColumnWidth,
): TableBlockContent {
  const w = widthOf(c);
  if (!isIndex(col, w)) return c;
  const next = copy(c);
  const pro = proOn(next);
  const widths: TableColumnWidth[] =
    pro.widths.length === w
      ? pro.widths.slice()
      : Array.from({ length: w }, () => "auto");
  widths[col] = width;
  pro.widths = widths.every((x) => x === "auto") ? [] : widths;
  return next;
}

/** The highlighted column (null clears it) and its label (kept when only the column moves). */
export function setHighlight(
  c: TableBlockContent,
  column: number | null,
  label?: string,
): TableBlockContent {
  if (column !== null && !isIndex(column, widthOf(c))) return c;
  const next = copy(c);
  const pro = proOn(next);
  pro.highlight =
    column === null
      ? null
      : {
          column,
          label: (label ?? pro.highlight?.label ?? "").slice(
            0,
            PRO_TABLE_HIGHLIGHT_LABEL_MAX,
          ),
        };
  return next;
}
