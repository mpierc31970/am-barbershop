// TableSection (07-21; CONT-26, CONT-35, D232, D-UI-P7-23; 07-UI-SPEC "Table"; T-07-21-01).
//
// A real <table> named by its heading (aria-labelledby). Header row -> <thead> with
// <th scope="col"> (600, 2px text bottom rule); first_column_header -> <th scope="row">;
// 1px border row rules; optional stripes (surface-raised on a main band, surface on an
// alternate band); per-column alignment; numeric cells tabular-nums. Cells are React text
// inside <strong>/<em> from the flags, so "<b>x</b>" prints literally; a link wraps the
// cell only when it passes the render-time siteHref guard. Phones:
// - "scroll": a focusable labelled region scrolling sideways, with a CSS-only scroll-shadow
//   edge fade (background-attachment: local, plan decision 5; no island, no CLS);
// - "cards": below 768px each row becomes a card of "Header: value" lines (visible header
//   labels), with explicit ARIA table roles so the display change keeps table semantics.
//   From 768px it is identical to scroll mode.
// The heading id derives from the heading text plus a hash of the table's text (no useId in
// a server component; SectionComponentProps carries no section id). An all-empty table
// renders nothing. The heading is an <h2>: only the Hero or the page title owns the page
// H1. --site-* roles only. Server component.
//
// Builder Pro (10-42; BILL-14, D233; 10-UI-SPEC "Pro table" › Public table). The content
// arrives already projected by the org's plan (tableForRender in @cds/db), so anything set
// in `pro` here is entitled. Each part renders only when set; a free table's markup is
// exactly the P7 markup:
//   - sticky: the region gets max-h 70vh and scrolls both ways; header cells stick to the
//     top and first-column cells to the left (off below 768px in cards mode), painted with
//     the band surface and a 1px border shadow on the stuck edge (CSS only, works without JS)
//   - icons: Check / X / Minus 20 (aria-hidden) + visually hidden "Yes" / "No" / "Not
//     included" before the cell text; colour is never the only signal
//   - highlight: tinted cells with a 2px primary rule left and right; the label is a chip
//     above the header text and part of the header's name ("Pro, Most popular")
//   - section rows: <th scope="colgroup" colspan="n"> heading the rows below
//   - widths: <colgroup> plus Narrow 96 / Medium 180 / Wide 320 px cell minimums
//   - sort / search / paging: the TableController island wraps the region. Sort buttons are
//     server-rendered in each header but shown only once the island is ready (CSS group
//     variant), so without JS headers are plain text and every row shows.
import {
  PRO_TABLE_ICON_LABELS,
  PRO_TABLE_PAGE_SIZE,
  tableIsEmpty,
  type TableAlign,
  type TableBlockContent,
  type TableCell,
  type TableColumnWidth,
  type TableIcon,
  type TablePro,
} from "@cds/core/content";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Minus,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { RowRenderer } from "../RowRenderer";
import { TableController } from "../client/TableController";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { siteHref, text } from "../urls";

const NUMERIC = /^[-+]?[$£€]?\s?\d[\d,]*(?:\.\d+)?\s?%?$/;

const ALIGN_CLASS: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** Small deterministic hash (djb2) for a stable heading id. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** A stable, safe id for the table heading. */
export function tableHeadingId(content: TableBlockContent): string {
  const slug = text(content.heading)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);
  const all = [
    content.heading,
    ...(content.rows ?? []).flat().map((c) => c?.text ?? ""),
  ].join("\u0001");
  return `table-${slug || "t"}-${hash(all)}`;
}

/** Scroll-shadow fade: covers in the band colour scroll with the content (local), the
 * shadows stay at the edges (scroll), so a shadow shows only while more exists. */
function fadeStyle(band: string): CSSProperties {
  const shade = "color-mix(in srgb, var(--site-text) 18%, transparent)";
  return {
    background: [
      `linear-gradient(to right, var(${band}) 30%, transparent) left center / 40px 100% no-repeat local`,
      `linear-gradient(to left, var(${band}) 30%, transparent) right center / 40px 100% no-repeat local`,
      `linear-gradient(to right, ${shade}, transparent) left center / 16px 100% no-repeat scroll`,
      `linear-gradient(to left, ${shade}, transparent) right center / 16px 100% no-repeat scroll`,
    ].join(", "),
  };
}

const WIDTH_PX: Record<Exclude<TableColumnWidth, "auto">, number> = {
  narrow: 96,
  medium: 180,
  wide: 320,
};

const ICON_CLASS: Record<TableIcon, string> = {
  yes: "shrink-0 text-site-text",
  no: "shrink-0 text-site-text-muted",
  dash: "shrink-0 text-site-text-muted",
};

function iconOf(cell: { icon?: unknown } | null | undefined): TableIcon | null {
  const i = cell?.icon;
  return i === "yes" || i === "no" || i === "dash" ? i : null;
}

function CellIcon({ icon }: { icon: TableIcon }) {
  const Icon = icon === "yes" ? Check : icon === "no" ? X : Minus;
  return (
    <>
      <Icon size={20} aria-hidden="true" className={ICON_CLASS[icon]} />
      <span className="sr-only">{PRO_TABLE_ICON_LABELS[icon]}</span>
    </>
  );
}

function CellText({ cell }: { cell: TableCell }): ReactNode {
  let node: ReactNode = cell.text;
  if (cell.italic) node = <em>{node}</em>;
  if (cell.bold) node = <strong>{node}</strong>;
  const href = cell.link ? siteHref(cell.link) : "";
  if (href) {
    const external = /^https?:/i.test(href);
    node = (
      <a
        href={href}
        rel={external ? "noopener" : undefined}
        className="font-semibold text-site-text underline underline-offset-2 hover:decoration-2"
      >
        {node}
      </a>
    );
  }
  return node;
}

function CellContent({ cell }: { cell: TableCell }): ReactNode {
  const icon = iconOf(cell);
  if (!icon) return <CellText cell={cell} />;
  return (
    <span className="inline-flex items-center gap-2">
      <CellIcon icon={icon} />
      {cell.text !== "" && <CellText cell={cell} />}
    </span>
  );
}

function normalise(content: TableBlockContent): TableCell[][] {
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const width = rows.reduce(
    (w, r) => Math.max(w, Array.isArray(r) ? r.length : 0),
    0,
  );
  return rows.map((r) => {
    const out: TableCell[] = (Array.isArray(r) ? r : []).map((c) => {
      const cell: TableCell = {
        text: typeof c?.text === "string" ? c.text : "",
        bold: c?.bold === true,
        italic: c?.italic === true,
        link: typeof c?.link === "string" ? c.link : "",
      };
      const icon = iconOf(c);
      if (icon) cell.icon = icon;
      return cell;
    });
    while (out.length < width) {
      out.push({ text: "", bold: false, italic: false, link: "" });
    }
    return out;
  });
}

type ProView = {
  sticky: boolean;
  sortable: boolean;
  searchable: boolean;
  paged: boolean;
  highlight: { column: number; label: string } | null;
  /** [] when every column is auto, else one entry per column. */
  widths: TableColumnWidth[];
  sections: ReadonlySet<number>;
};

/** The Pro settings that are on, read defensively (null when none are). */
function proOf(
  c: TableBlockContent,
  width: number,
  rowCount: number,
): ProView | null {
  const p = (c.pro ?? null) as Partial<TablePro> | null;
  if (!p || typeof p !== "object") return null;
  const raw = p.highlight;
  const highlight =
    raw &&
    typeof raw === "object" &&
    Number.isInteger(raw.column) &&
    raw.column >= 0 &&
    raw.column < width
      ? {
          column: raw.column,
          label: typeof raw.label === "string" ? raw.label : "",
        }
      : null;
  const widths: TableColumnWidth[] =
    Array.isArray(p.widths) && p.widths.length === width
      ? p.widths.map((w) =>
          w === "narrow" || w === "medium" || w === "wide" ? w : "auto",
        )
      : [];
  const sections = new Set(
    (Array.isArray(p.section_rows) ? p.section_rows : []).filter(
      (r): r is number => Number.isInteger(r) && r >= 0 && r < rowCount,
    ),
  );
  const view: ProView = {
    sticky: p.sticky === true,
    sortable: p.sortable === true,
    searchable: p.searchable === true,
    paged: p.paged === true,
    highlight,
    widths: widths.some((w) => w !== "auto") ? widths : [],
    sections,
  };
  const on =
    view.sticky ||
    view.sortable ||
    view.searchable ||
    view.paged ||
    view.highlight !== null ||
    view.widths.length > 0 ||
    view.sections.size > 0;
  return on ? view : null;
}

const SORT_BUTTON =
  "hidden min-h-11 w-full cursor-pointer items-center gap-2 bg-transparent text-left " +
  "font-semibold text-inherit group-data-[ready=true]/tbl:inline-flex " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

/** Sort state icons, switched by the <th>'s aria-sort (CSS only). */
function SortIcons() {
  return (
    <>
      <ChevronsUpDown
        size={16}
        aria-hidden="true"
        className="shrink-0 group-aria-[sort=ascending]/th:hidden group-aria-[sort=descending]/th:hidden"
      />
      <ChevronUp
        size={16}
        aria-hidden="true"
        className="hidden shrink-0 group-aria-[sort=ascending]/th:inline"
      />
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="hidden shrink-0 group-aria-[sort=descending]/th:inline"
      />
    </>
  );
}

export function TableSection({
  content,
  layout,
  background,
}: SectionComponentProps<TableBlockContent>) {
  const c = (content ?? {}) as TableBlockContent;
  if (tableIsEmpty(c)) return null;
  const rows = normalise(c);
  if (rows.length === 0) return null;

  const heading = text(c.heading);
  const headingId = heading ? tableHeadingId(c) : undefined;
  const headerRow = c.header_row === true;
  const firstColHeader = c.first_column_header === true;
  const cards = c.mobile === "cards";
  const align = (i: number): string => {
    const a: unknown = Array.isArray(c.align) ? c.align[i] : undefined;
    return typeof a === "string" &&
      Object.prototype.hasOwnProperty.call(ALIGN_CLASS, a)
      ? ALIGN_CLASS[a as TableAlign]
      : ALIGN_CLASS.left;
  };
  const width = rows[0]?.length ?? 0;
  const pro = proOf(c, width, rows.length);
  const head = headerRow ? rows[0] : null;
  const bodyStart = headerRow ? 1 : 0;
  const body = headerRow ? rows.slice(1) : rows;
  const alternate = background === "alternate";
  const stripe = alternate ? "bg-site-surface" : "bg-site-surface-raised";
  const band = alternate ? "--site-surface-raised" : "--site-surface";

  const cellPad = "px-4 py-3 align-top";
  const num = (cell: TableCell) =>
    NUMERIC.test(cell.text.trim()) ? " tabular-nums" : "";
  const m = (cls: string) => (cards ? ` ${cls}` : "");

  // ---- Builder Pro presentation (every piece is "" / undefined for a free table) ----
  const sticky = pro?.sticky === true;
  const sortable = pro?.sortable === true && head !== null;
  const searchable = pro?.searchable === true;
  const paged = pro?.paged === true;
  const interactive = sortable || searchable || paged;
  const hl = pro?.highlight ?? null;
  const bandBg = alternate ? "bg-site-surface-raised" : "bg-site-surface";
  const stickHead = sticky
    ? ` sticky top-0 z-20 ${bandBg} shadow-[inset_0_-1px_0_var(--site-border)]`
    : "";
  const stickCol = (corner: boolean): string =>
    sticky
      ? ` sticky left-0 ${corner ? "z-30" : `z-10 ${bandBg}`} shadow-[inset_-1px_0_0_var(--site-border)]${m("max-md:static max-md:shadow-none")}`
      : "";
  const hlCell = (i: number): string =>
    hl && hl.column === i
      ? " bg-site-surface-raised border-x-2 border-site-primary"
      : "";
  const widthStyle = (i: number): CSSProperties | undefined => {
    const w = pro?.widths[i];
    return w && w !== "auto" ? { minWidth: `${WIDTH_PX[w]}px` } : undefined;
  };
  const regionClass = sticky
    ? `max-h-[70vh] overflow-auto${m("max-md:max-h-none max-md:overflow-visible max-md:bg-none!")}`
    : `overflow-x-auto${m("max-md:overflow-visible max-md:bg-none!")}`;

  const headerInner = (cell: TableCell, i: number): ReactNode => {
    const main = sortable ? (
      <>
        <span className="inline-flex min-h-11 items-center group-data-[ready=true]/tbl:hidden">
          <CellContent cell={cell} />
        </span>
        <button type="button" data-sort-button={i} className={SORT_BUTTON}>
          <span>{cell.text}</span>
          <SortIcons />
        </button>
      </>
    ) : (
      <CellContent cell={cell} />
    );
    if (!hl || hl.column !== i || hl.label === "") return main;
    // Chip above the header text, read after it: "Pro, Most popular".
    return (
      <span className="flex flex-col-reverse items-start gap-1">
        <span>{main}</span>
        <span className="w-fit rounded-site-button bg-site-primary px-2 py-0.5 text-sm font-semibold text-site-primary-contrast">
          <span className="sr-only">, </span>
          {hl.label}
        </span>
      </span>
    );
  };

  // WR-C02 (CLS): with paging, rows after the first page are hidden before the island
  // mounts (where scripts run), as the island will hide them; a section row goes with them
  // when none of its rows is on page 1. The island's fallback brings them back.
  const PRE_HIDE =
    "[@media(scripting:enabled)]:group-data-[premount]/tbl:hidden";
  const preHidden = new Set<number>();
  let rowCount = 0;
  {
    let section: number | null = null;
    let sectionShown = false;
    body.forEach((_, r) => {
      if (pro?.sections.has(r + bodyStart)) {
        if (section !== null && !sectionShown && paged) preHidden.add(section);
        section = r;
        sectionShown = false;
        return;
      }
      if (paged && rowCount >= PRO_TABLE_PAGE_SIZE) preHidden.add(r);
      else sectionShown = true;
      rowCount += 1;
    });
    if (section !== null && !sectionShown && paged) preHidden.add(section);
  }
  const pre = (r: number) => (preHidden.has(r) ? ` ${PRE_HIDE}` : "");

  const region = (
    <div
      role="region"
      tabIndex={0}
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : "Table"}
      className={regionClass}
      style={fadeStyle(band)}
      data-cds-table={cards ? "cards" : "scroll"}
    >
      <table
        role={cards ? "table" : undefined}
        aria-labelledby={headingId}
        className={`${BODY_CLASS} w-full border-collapse text-site-text${m("max-md:block")}`}
      >
        {pro && pro.widths.length > 0 && (
          <colgroup>
            {pro.widths.map((w, i) => (
              <col
                key={i}
                style={w === "auto" ? undefined : { width: `${WIDTH_PX[w]}px` }}
              />
            ))}
          </colgroup>
        )}
        {head && (
          <thead
            className={cards ? "max-md:sr-only" : undefined}
            role={cards ? "rowgroup" : undefined}
          >
            <tr role={cards ? "row" : undefined}>
              {head.map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  role={cards ? "columnheader" : undefined}
                  data-sort-col={sortable ? i : undefined}
                  className={`${cellPad} ${align(i)}${num(cell)} border-b-2 border-site-text font-semibold${sortable ? " group/th" : ""}${stickHead}${i === 0 ? stickCol(true) : ""}${hlCell(i)}`}
                  style={widthStyle(i)}
                >
                  {pro ? headerInner(cell, i) : <CellContent cell={cell} />}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody
          className={cards ? "max-md:block" : undefined}
          role={cards ? "rowgroup" : undefined}
        >
          {body.map((row, r) => {
            if (pro?.sections.has(r + bodyStart)) {
              const title = row.find((cell) => cell.text !== "");
              return (
                <tr
                  key={r}
                  data-section-row=""
                  role={cards ? "row" : undefined}
                  className={`border-b border-site-border${m("max-md:block")}${pre(r)}`}
                >
                  <th
                    scope="colgroup"
                    colSpan={width}
                    role={cards ? "rowheader" : undefined}
                    className={`${cellPad} bg-site-surface-raised text-left font-semibold${m("max-md:block")}`}
                  >
                    {title ? <CellContent cell={title} /> : null}
                  </th>
                </tr>
              );
            }
            return (
              <tr
                key={r}
                role={cards ? "row" : undefined}
                className={`border-b border-site-border${c.striped === true && r % 2 === 1 ? ` ${stripe}` : ""}${m("max-md:block max-md:py-2")}${pre(r)}`}
              >
                {row.map((cell, i) => {
                  const label =
                    cards && head && text(head[i]?.text) !== "" ? (
                      <span
                        data-card-label=""
                        className="font-semibold md:hidden"
                      >
                        {`${head[i].text}: `}
                      </span>
                    ) : null;
                  // WR-C01: the island sorts and searches the cell's own text, never the
                  // cards-mode label (hidden by CSS, still in textContent).
                  const value = interactive ? cell.text : undefined;
                  const cls = `${cellPad} ${align(i)}${num(cell)}${m("max-md:block max-md:py-1 max-md:text-left")}${hlCell(i)}`;
                  if (firstColHeader && i === 0) {
                    return (
                      <th
                        key={i}
                        scope="row"
                        role={cards ? "rowheader" : undefined}
                        className={`${cls} font-semibold${stickCol(false)}`}
                        style={widthStyle(i)}
                        data-v={value}
                      >
                        {label}
                        <CellContent cell={cell} />
                      </th>
                    );
                  }
                  return (
                    <td
                      key={i}
                      role={cards ? "cell" : undefined}
                      className={`${cls}${i === 0 ? stickCol(false) : ""}`}
                      style={widthStyle(i)}
                      data-v={value}
                    >
                      {label}
                      <CellContent cell={cell} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-6">
        {heading && (
          <h2 id={headingId} className={HEADING_CLASSES[2]}>
            {heading}
          </h2>
        )}
        {interactive ? (
          <TableController
            id={headingId ?? tableHeadingId(c)}
            sortable={sortable}
            searchable={searchable}
            paged={paged}
            rowCount={rowCount}
          >
            {region}
          </TableController>
        ) : (
          region
        )}
      </div>
    </RowRenderer>
  );
}
