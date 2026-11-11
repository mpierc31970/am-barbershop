"use client";
// Pro table island (10-42; BILL-14, D233; 10-UI-SPEC "Pro table" › Public table; P7 progressive
// enhancement; T-10-42-01, T-10-42-03).
//
// TableSection renders the full table on the server (every row, plain headers, no search),
// and wraps it in this island only when the table turns on sorting, search or paging. Before
// mount the island renders its children alone, so the no-JS page is the full table. After
// mount (`data-ready="true"` on the root):
//   - sort: the server-rendered sort buttons inside each header show (CSS group variant on
//     the root, so the island never rewrites header markup). A click sorts ascending, then
//     descending, sets `aria-sort` on every sortable <th>, numbers by value when every value
//     in the column is a number, else locale text. Section rows stay with their group.
//   - search: "Search this table" above the table filters rows by cell text
//     (case-insensitive); a polite status reads "{n} of {total} rows" / "No rows match.".
//   - paging: 25 rows per page with the site Pagination under the table; sorting or
//     searching returns to page 1.
// WR-C02 (CLS): before mount the root carries `data-premount` (site/premount.ts). Where
// scripts run, an invisible stand-in keeps the search block's space, rows after the first 25
// are hidden (TableSection) and an invisible Pagination keeps its space, so mounting moves
// nothing. The island drops the attribute on mount; an inline fallback drops it after 5 s
// if the island never mounts, so the full table comes back. No JS: the full table, no gaps.
// Rows are reordered and hidden in place (`hidden`, Tailwind preflight -> display:none).
// Cell text is read with `textContent` only; nothing is ever injected as HTML. No
// transitions anywhere, so reduced motion needs nothing extra. Theme token classes only.
// Never imports the sanitizer.
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { PRO_TABLE_PAGE_SIZE } from "@cds/core/content";
import { Pagination } from "../Pagination";
import { PREMOUNT_FALLBACK_SCRIPT } from "../premount";
import { BODY_CLASS } from "../types";

export const TABLE_CONTROLLER_COPY = Object.freeze({
  search: "Search this table",
  none: "No rows match.",
  pages: "Table pages",
  count: (n: number, total: number) => `${n} of ${total} rows`,
});

export interface TableControllerProps {
  /** Stable id for the search input and page links (the table heading id). */
  id: string;
  sortable: boolean;
  searchable: boolean;
  paged: boolean;
  /** Data rows (section rows excluded): sizes the pre-mount stand-ins (WR-C02). */
  rowCount?: number;
  children: ReactNode;
}

/** Shown only before mount, where scripts run (WR-C02). Literal for Tailwind. */
const PRE_FLEX =
  "hidden [@media(scripting:enabled)]:group-data-[premount]/tbl:flex";
const PRE_BLOCK =
  "hidden [@media(scripting:enabled)]:group-data-[premount]/tbl:block";

type Sort = { col: number; dir: "ascending" | "descending" } | null;
type Group = {
  section: HTMLTableRowElement | null;
  rows: HTMLTableRowElement[];
};

const CONTROL =
  "w-full min-h-12 rounded-site-button border border-site-text-muted bg-site-surface " +
  "px-4 py-3 text-[length:var(--site-text-body)] text-site-text " +
  "placeholder:text-site-text-muted";

const NUMBER_STRIP = /[$£€,%\s]/g;

/** A cell value as a number, or null ("" never counts). */
export function tableNumber(value: string): number | null {
  const t = value.replace(NUMBER_STRIP, "");
  if (t === "" || !/^[-+]?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A cell's own text: the server's `data-v` (WR-C01: never the cards-mode "Header: " label,
 * which CSS hides but textContent keeps), else its text.
 */
function valueOf(cell: HTMLTableCellElement | undefined): string {
  if (!cell) return "";
  return (cell.getAttribute("data-v") ?? cell.textContent ?? "").trim();
}

function cellText(row: HTMLTableRowElement, col: number): string {
  return valueOf(row.cells[col]);
}

/** Groups in document order: rows before the first section row form a headless group. */
function readGroups(tbody: HTMLTableSectionElement): Group[] {
  const groups: Group[] = [{ section: null, rows: [] }];
  for (const tr of Array.from(tbody.rows)) {
    if (tr.hasAttribute("data-section-row")) {
      groups.push({ section: tr, rows: [] });
    } else {
      groups[groups.length - 1]!.rows.push(tr);
    }
  }
  return groups;
}

function sortRows(
  rows: HTMLTableRowElement[],
  sort: Sort,
  numeric: boolean,
  collator: Intl.Collator,
): HTMLTableRowElement[] {
  if (!sort) return rows;
  const sign = sort.dir === "ascending" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: cellText(row, sort.col) }))
    .sort((a, b) => {
      // Empty cells sort last in both directions.
      if (a.v === "" || b.v === "") {
        if (a.v === b.v) return a.i - b.i;
        return a.v === "" ? 1 : -1;
      }
      const d = numeric
        ? (tableNumber(a.v) ?? 0) - (tableNumber(b.v) ?? 0)
        : collator.compare(a.v, b.v);
      return d !== 0 ? d * sign : a.i - b.i;
    })
    .map((x) => x.row);
}

export function TableController({
  id,
  sortable,
  searchable,
  paged,
  rowCount = 0,
  children,
}: TableControllerProps) {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState({ n: 0, total: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groupsRef = useRef<Group[] | null>(null);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready) return;
    const root = rootRef.current;
    const tbody = root?.querySelector("tbody");
    if (!root || !tbody) return;
    // The original order is read once, so "unsorted" never drifts.
    groupsRef.current ??= readGroups(tbody);
    const groups = groupsRef.current;
    const all = groups.flatMap((g) => g.rows);

    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });
    const numeric =
      sort !== null &&
      all.some((r) => cellText(r, sort.col) !== "") &&
      all.every((r) => {
        const v = cellText(r, sort.col);
        return v === "" || tableNumber(v) !== null;
      });
    const q = query.trim().toLowerCase();
    const matches = (r: HTMLTableRowElement) =>
      q === "" ||
      Array.from(r.cells).some((c) => valueOf(c).toLowerCase().includes(q));

    const ordered = groups.map((g) => ({
      section: g.section,
      rows: sortRows(g.rows, sort, numeric, collator),
    }));
    const matched = ordered.flatMap((g) => g.rows.filter(matches));
    const visible = new Set(
      paged
        ? matched.slice(
            (page - 1) * PRO_TABLE_PAGE_SIZE,
            page * PRO_TABLE_PAGE_SIZE,
          )
        : matched,
    );
    const filtering = q !== "" || paged;
    for (const g of ordered) {
      if (g.section) {
        g.section.hidden = filtering
          ? !g.rows.some((r) => visible.has(r))
          : false;
        tbody.appendChild(g.section);
      }
      for (const r of g.rows) {
        r.hidden = !visible.has(r);
        tbody.appendChild(r);
      }
    }

    if (sortable) {
      root.querySelectorAll("th[data-sort-col]").forEach((th) => {
        const col = Number(th.getAttribute("data-sort-col"));
        th.setAttribute(
          "aria-sort",
          sort && sort.col === col ? sort.dir : "none",
        );
      });
    }
    setShown({ n: matched.length, total: all.length });
  }, [ready, query, sort, page, paged, sortable]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    const button = target?.closest?.("button[data-sort-button]");
    if (button && sortable) {
      const col = Number(button.getAttribute("data-sort-button"));
      if (!Number.isInteger(col)) return;
      setSort((s) =>
        s && s.col === col && s.dir === "ascending"
          ? { col, dir: "descending" }
          : { col, dir: "ascending" },
      );
      setPage(1);
      return;
    }
    const link = target?.closest?.("a[href]");
    const href = link?.getAttribute("href") ?? "";
    const prefix = `#${id}-page-`;
    if (paged && href.startsWith(prefix)) {
      e.preventDefault();
      const p = Number(href.slice(prefix.length));
      if (Number.isInteger(p) && p >= 1) setPage(p);
    }
  };

  const pages = Math.max(1, Math.ceil(shown.n / PRO_TABLE_PAGE_SIZE));
  const searchId = `${id}-search`;
  const prePages = Math.max(1, Math.ceil(rowCount / PRO_TABLE_PAGE_SIZE));
  const hinted = searchable || (paged && prePages > 1);

  return (
    <>
      <div
        ref={rootRef}
        data-table-pro=""
        data-sortable={sortable ? "true" : undefined}
        data-searchable={searchable ? "true" : undefined}
        data-paged={paged ? "true" : undefined}
        data-ready={ready ? "true" : undefined}
        data-premount={ready ? undefined : ""}
        className="group/tbl flex flex-col gap-4"
        onClick={onClick}
      >
        {!ready && searchable && (
          // Keeps the search block's space until the island renders it (never read or used).
          <div
            aria-hidden="true"
            inert
            data-search-standin=""
            className={`${BODY_CLASS} invisible ${PRE_FLEX} flex-col gap-2`}
          >
            <span className="font-semibold text-site-text">
              {TABLE_CONTROLLER_COPY.search}
            </span>
            <input type="search" tabIndex={-1} readOnly className={CONTROL} />
            <p className="text-sm text-site-text-muted tabular-nums">
              {TABLE_CONTROLLER_COPY.count(rowCount, rowCount)}
            </p>
          </div>
        )}
        {ready && searchable && (
          <div className={`${BODY_CLASS} flex flex-col gap-2`}>
            <label htmlFor={searchId} className="font-semibold text-site-text">
              {TABLE_CONTROLLER_COPY.search}
            </label>
            <input
              id={searchId}
              type="search"
              maxLength={100}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className={CONTROL}
            />
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-site-text-muted tabular-nums"
            >
              {shown.n === 0
                ? TABLE_CONTROLLER_COPY.none
                : TABLE_CONTROLLER_COPY.count(shown.n, shown.total)}
            </p>
          </div>
        )}
        {children}
        {ready && paged && pages > 1 && (
          <Pagination
            label={TABLE_CONTROLLER_COPY.pages}
            current={Math.min(page, pages)}
            total={pages}
            hrefFor={(p) => `#${id}-page-${p}`}
          />
        )}
        {!ready && paged && prePages > 1 && (
          <div
            aria-hidden="true"
            inert
            data-pages-standin=""
            className={`invisible ${PRE_BLOCK}`}
          >
            <Pagination
              label={TABLE_CONTROLLER_COPY.pages}
              current={1}
              total={prePages}
              hrefFor={(p) => `#${id}-page-${p}`}
            />
          </div>
        )}
      </div>
      {!ready && hinted ? (
        <script
          dangerouslySetInnerHTML={{ __html: PREMOUNT_FALLBACK_SCRIPT }}
        />
      ) : null}
    </>
  );
}
