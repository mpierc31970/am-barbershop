// Table block (owner 07-07; CONT-26, D232, D-UI-P7-23; T-07-07-02, T-07-07-04).
//
// Cells are structured { text, bold, italic, link }, never HTML: UI-SPEC D-UI-P7-23 formats
// whole cells, the html cleaner is Node-only (block files must stay Edge-safe) and its
// allow-list omits links. Structured cells carry zero html (D281); "<b>x</b>" in a cell is
// literal text. Links go through safeHref. 07-21 renders <strong>/<em>/<a> from the flags.
// Limits: the structural ceiling is the Pro table, 20 columns x 1,000 rows (10-35, D233),
// checked before any per-cell work. The free limit (10 x 200) is a plan rule, enforced by
// assertTablePlan in table-pro.ts, which also owns the optional `pro` settings and icons.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { InvalidInput } from "../../errors";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { safeHref } from "../validate";
import {
  asRecord,
  capped,
  isRecord,
  oneOf,
  own,
  text,
} from "../validate-helpers";
import {
  PRO_TABLE_LIMIT_COPY,
  PRO_TABLE_MAX_COLUMNS,
  PRO_TABLE_MAX_ROWS,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  tableCellIcon,
  validateTablePro,
  type TableIcon,
  type TablePro,
} from "./table-pro";

export { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS };

export type TableAlign = "left" | "center" | "right";
export type TableMobile = "scroll" | "cards";

export type TableCell = {
  text: string;
  bold: boolean;
  italic: boolean;
  /** "" or a safeHref-checked link. */
  link: string;
  /** Builder Pro (10-35): present only when set; rendered with a text alternative. */
  icon?: TableIcon;
};

export type TableBlockContent = {
  heading: string;
  header_row: boolean;
  first_column_header: boolean;
  striped: boolean;
  /** One entry per column. */
  align: TableAlign[];
  mobile: TableMobile;
  rows: TableCell[][];
  /** Builder Pro settings (10-35); absent on a P7 free table. */
  pro?: TablePro;
};

export const TABLE_HEADING_MAX = 120;
export const TABLE_CELL_MAX = 500;
export const TABLE_LIMIT_COPY =
  "Tables hold up to 10 columns and 200 rows. Split it into two tables.";
export const TABLE_ALIGNS: readonly TableAlign[] = Object.freeze([
  "left",
  "center",
  "right",
]);
export const TABLE_MOBILE_MODES: readonly TableMobile[] = Object.freeze([
  "scroll",
  "cards",
]);

export function newTableCell(text = ""): TableCell {
  return { text, bold: false, italic: false, link: "" };
}

function cellText(value: unknown): string {
  if (typeof value !== "string") return "";
  return capped(value.replace(/[\r\n]+/g, " ").trim(), TABLE_CELL_MAX);
}

function validateCell(value: unknown): TableCell {
  if (typeof value === "string") return newTableCell(cellText(value));
  if (!isRecord(value)) return newTableCell();
  const cell: TableCell = {
    text: cellText(own(value, "text")),
    bold: own(value, "bold") === true,
    italic: own(value, "italic") === true,
    link: safeHref(own(value, "link")),
  };
  const icon = tableCellIcon(own(value, "icon"));
  if (icon !== "") cell.icon = icon;
  return cell;
}

function bool(raw: Record<string, unknown>, key: string, fallback: boolean) {
  const v = own(raw, key);
  return typeof v === "boolean" ? v : fallback;
}

export function defaultTableBlock(): TableBlockContent {
  return {
    heading: "",
    header_row: true,
    first_column_header: false,
    striped: false,
    align: ["left", "left", "left"],
    mobile: "scroll",
    rows: [
      [
        newTableCell("Column 1"),
        newTableCell("Column 2"),
        newTableCell("Column 3"),
      ],
      [newTableCell(), newTableCell(), newTableCell()],
      [newTableCell(), newTableCell(), newTableCell()],
    ],
  };
}

export function validateTableBlock(value: unknown): TableBlockContent {
  const raw = asRecord(value);
  const rawRows = own(raw, "rows");
  const list: unknown[] = Array.isArray(rawRows) ? rawRows : [];
  if (list.length > PRO_TABLE_MAX_ROWS) {
    throw new InvalidInput(PRO_TABLE_LIMIT_COPY);
  }
  for (const row of list) {
    if (Array.isArray(row) && row.length > PRO_TABLE_MAX_COLUMNS) {
      throw new InvalidInput(PRO_TABLE_LIMIT_COPY);
    }
  }
  const parsed = list.map((row) =>
    Array.isArray(row) ? row.map(validateCell) : [],
  );
  const width = parsed.reduce((w, row) => Math.max(w, row.length), 0);
  const rows = parsed.map((row) => {
    const out = row.slice();
    while (out.length < width) out.push(newTableCell());
    return out;
  });
  const rawAlign = own(raw, "align");
  const alignList: unknown[] = Array.isArray(rawAlign) ? rawAlign : [];
  const align = Array.from({ length: width }, (_, i) =>
    oneOf(alignList[i], TABLE_ALIGNS, "left"),
  );
  const out: TableBlockContent = {
    heading: text(raw, "heading", TABLE_HEADING_MAX),
    header_row: bool(raw, "header_row", true),
    first_column_header: bool(raw, "first_column_header", false),
    striped: bool(raw, "striped", false),
    align,
    mobile: oneOf(own(raw, "mobile"), TABLE_MOBILE_MODES, "scroll"),
    rows,
  };
  const rawPro = own(raw, "pro");
  if (isRecord(rawPro)) out.pro = validateTablePro(rawPro, width, rows.length);
  return out;
}

/** True when every cell's text is "" (or there are no cells). */
export function tableIsEmpty(content: TableBlockContent): boolean {
  return cellsOf(content).every((c) => c.text === "");
}

/** Every well-formed cell of possibly malformed content. */
function cellsOf(content: unknown): TableCell[] {
  if (!isRecord(content) || !Array.isArray(content.rows)) return [];
  return content.rows
    .filter((r): r is unknown[] => Array.isArray(r))
    .flatMap((r) => r.filter(isRecord) as unknown as TableCell[]);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const tableSection: SectionTypeDefinition = {
  type: "table",
  label: "Table",
  description: "Rows and columns, pasted from a spreadsheet",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultTableBlock(),
  validate: (raw) => validateTableBlock(raw),
  // No html exists in a table; return a deep fresh copy.
  mapRichText: (content) => {
    if (!isRecord(content)) return content;
    const c = content as Record<string, unknown>;
    const pro = c.pro;
    return {
      ...c,
      ...(isRecord(pro)
        ? {
            pro: {
              ...pro,
              highlight: isRecord(pro.highlight)
                ? { ...pro.highlight }
                : pro.highlight,
              widths: Array.isArray(pro.widths)
                ? [...(pro.widths as unknown[])]
                : pro.widths,
              section_rows: Array.isArray(pro.section_rows)
                ? [...(pro.section_rows as unknown[])]
                : pro.section_rows,
            },
          }
        : {}),
      align: Array.isArray(c.align) ? [...(c.align as unknown[])] : c.align,
      rows: Array.isArray(c.rows)
        ? (c.rows as unknown[]).map((r) =>
            Array.isArray(r)
              ? r.map((cell: unknown) => (isRecord(cell) ? { ...cell } : cell))
              : r,
          )
        : c.rows,
    };
  },
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? str(content.heading) : "",
      ...cellsOf(content).map((c) => str(c.text)),
    ]),
  urlsOf: (content) => nonEmpty(cellsOf(content).map((c) => str(c.link))),
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
