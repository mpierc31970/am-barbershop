"use client";
// StaffTable (13-07 choice 1; D-UI-P13-2; 13-UI-SPEC "StaffTable columns", "Accessibility
// contract", "Responsive contract"). The console's one dense table:
// - a real <table>: visually hidden <caption>, <th scope="col">, aria-sort on sortable
//   headers whose links come from `onSortHref` (sort is a URL param, no client store);
// - 40px rows (44px on coarse pointers), cell padding 8px 16px, 14px Label text, header row
//   on surface-2, sticky under the 56px top bar, 1px row dividers, 44px checkbox column;
// - columns drop right to left by `priority` (1 never, 2 < 768px, 3 < 1024px, 4 < 1280px);
//   under 640px each row stacks (primary column + `stack` columns), never a horizontal scroll;
// - bulk select by checkbox named "Select #1042" (native accent-color), select all with an
//   indeterminate state;
// - keyboard: j / k move a roving tabindex over each row's primary link and announce the row
//   (polite), x toggles that row's selection, Enter follows the focused link natively. Single
//   keys respect `shortcutsEnabled` (D-UI-P13-19, WCAG 2.1.4) and are ignored while focus is
//   in a text field or a modifier is held.
// Every cell is React text: tenant-authored subjects and names never become markup.
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { isTypingTarget } from "../shell/ShortcutSheet";
import { STAFF_TABLE_COPY as C } from "./copy";

export type SortDirection = "asc" | "desc";

export interface StaffSort {
  column: string;
  direction: SortDirection;
}

export interface StaffColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Drop order right to left: 1 never drops, 2 below 768px, 3 below 1024px, 4 below 1280px. */
  priority: 1 | 2 | 3 | 4;
  align?: "start" | "end";
  nowrap?: boolean;
  /** CSS width for the <col>, e.g. "72px". */
  width?: string;
  /** The key column: its cell is wrapped in the row's primary link (one per table). */
  primary?: boolean;
  /** Shown in the stacked phone row (< 640px) after the primary column (badges, age). */
  stack?: boolean;
}

export interface StaffTableProps<Row> {
  /** Visually hidden caption, e.g. "Tickets, sorted by SLA urgency". */
  caption: string;
  columns: readonly StaffColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Short row name: "Select #1042" and the default j/k announcement. */
  rowLabel: (row: Row) => string;
  /** Longer j/k announcement ("#1042, Rivera Bakery, At risk, 2 hours left"). */
  rowAnnouncement?: (row: Row) => string;
  sort?: StaffSort;
  /** Href for sorting by a column; `direction` is the next one (the active column flips). */
  onSortHref?: (columnId: string, direction: SortDirection) => string;
  selectable?: boolean;
  /** Controlled selection (row keys). Uncontrolled when omitted. */
  selected?: readonly string[];
  onSelectionChange?: (keys: string[]) => void;
  primaryHref: (row: Row) => string;
  /** Intercept a primary link click (split view): call `event.preventDefault()` to stay. */
  onPrimaryClick?: (row: Row, event: MouseEvent<HTMLAnchorElement>) => void;
  /** The row open in the split view: surface-2 ground + aria-current="true". */
  currentKey?: string | null;
  /** Single-key shortcuts (j, k, x). Off for secondary tables on the same view. */
  shortcutsEnabled?: boolean;
}

const DROP: Record<StaffColumn<unknown>["priority"], string> = {
  1: "",
  2: "max-md:hidden",
  3: "max-lg:hidden",
  4: "max-xl:hidden",
};

function cellClass<Row>(col: StaffColumn<Row>, header: boolean): string {
  const parts = [
    "px-4 py-2 text-left align-middle text-sm",
    header ? "font-semibold text-hub-ink" : "text-hub-ink",
    col.align === "end" ? "text-right" : "",
    col.nowrap ? "whitespace-nowrap" : "",
    DROP[col.priority],
    // Stacked phone rows: only the primary column and `stack` columns stay.
    // (Header cells are screen-reader only on phones, so they keep every column.)
    header ? "" : col.primary || col.stack ? "max-sm:p-0" : "max-sm:hidden",
  ];
  return parts.filter(Boolean).join(" ");
}

function SortIcon({ dir }: { dir: SortDirection | null }) {
  const Icon =
    dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Icon aria-hidden size={14} strokeWidth={2} className="text-hub-ink" />
  );
}

export function StaffTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowLabel,
  rowAnnouncement,
  sort,
  onSortHref,
  selectable = false,
  selected,
  onSelectionChange,
  primaryHref,
  onPrimaryClick,
  currentKey = null,
  shortcutsEnabled = true,
}: StaffTableProps<Row>) {
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const [ownSelected, setOwnSelected] = useState<readonly string[]>([]);
  const chosen = selected ?? ownSelected;
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  // The roving row is tracked by key so polled rows inserting above it never move it.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const setSelection = useCallback(
    (next: Set<string>) => {
      const ordered = keys.filter((k) => next.has(k));
      if (selected === undefined) setOwnSelected(ordered);
      onSelectionChange?.(ordered);
    },
    [keys, selected, onSelectionChange],
  );

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(chosenSet);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setSelection(next);
    },
    [chosenSet, setSelection],
  );

  const selectedCount = keys.filter((k) => chosenSet.has(k)).length;
  const allChecked = keys.length > 0 && selectedCount === keys.length;
  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = selectedCount > 0 && !allChecked;
    }
  }, [selectedCount, allChecked]);

  const activeIndex = activeKey === null ? -1 : keys.indexOf(activeKey);
  const tabStop = activeIndex >= 0 ? activeIndex : 0;

  const focusRow = useCallback(
    (index: number) => {
      const key = keys[index];
      if (key === undefined) return;
      const row = rows[index]!;
      setActiveKey(key);
      setAnnounce((rowAnnouncement ?? rowLabel)(row));
      const link = tableRef.current?.querySelector<HTMLAnchorElement>(
        `a[data-staff-primary="${CSS.escape(key)}"]`,
      );
      link?.focus();
    },
    [keys, rows, rowAnnouncement, rowLabel],
  );

  useEffect(() => {
    if (!shortcutsEnabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      // WR-E03: never act on rows behind an open modal dialog or drawer.
      if (document.querySelector("dialog[open]")) return;
      if (keys.length === 0) return;
      if (e.key === "j") {
        e.preventDefault();
        focusRow(
          activeIndex < 0 ? 0 : Math.min(activeIndex + 1, keys.length - 1),
        );
      } else if (e.key === "k") {
        e.preventDefault();
        focusRow(activeIndex < 0 ? 0 : Math.max(activeIndex - 1, 0));
      } else if (e.key === "x" && selectable && activeIndex >= 0) {
        e.preventDefault();
        toggle(keys[activeIndex]!);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcutsEnabled, keys, activeIndex, focusRow, selectable, toggle]);

  return (
    <div className="font-hub">
      <table ref={tableRef} className="w-full border-collapse max-sm:block">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {selectable ? <col style={{ width: "44px" }} /> : null}
          {columns.map((c) => (
            <col
              key={c.id}
              className={DROP[c.priority]}
              style={c.width ? { width: c.width } : undefined}
            />
          ))}
        </colgroup>
        <thead className="sticky top-14 z-10 bg-hub-surface-2 max-sm:sr-only">
          <tr className="h-10 border-b border-hub-border">
            {selectable ? (
              <th scope="col" className="w-11 px-3 py-2 text-left">
                <input
                  ref={allRef}
                  type="checkbox"
                  aria-label={C.selectAll}
                  checked={allChecked}
                  onChange={() =>
                    setSelection(allChecked ? new Set() : new Set(keys))
                  }
                  className="size-4 accent-hub-accent pointer-coarse:size-5"
                />
              </th>
            ) : null}
            {columns.map((c) => {
              const active = sort?.column === c.id ? sort.direction : null;
              const sortable = c.sortable === true && onSortHref !== undefined;
              const ariaSort = !sortable
                ? undefined
                : active === "asc"
                  ? "ascending"
                  : active === "desc"
                    ? "descending"
                    : "none";
              const next: SortDirection = active === "asc" ? "desc" : "asc";
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cellClass(c, true)}
                >
                  {sortable ? (
                    <a
                      href={onSortHref(c.id, next)}
                      className={
                        "inline-flex items-center gap-1 rounded text-hub-ink " +
                        "hover:underline pointer-coarse:min-h-11 focus-visible:outline-2 " +
                        "focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                      }
                    >
                      {c.header}
                      <SortIcon dir={active} />
                    </a>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row, i) => {
            const key = keys[i]!;
            const isCurrent = currentKey === key;
            const isChecked = chosenSet.has(key);
            const isActive = activeKey === key;
            return (
              <tr
                key={key}
                data-staff-row={key}
                aria-current={isCurrent ? "true" : undefined}
                className={
                  "h-10 border-b border-hub-border pointer-coarse:h-11 " +
                  "max-sm:flex max-sm:h-auto max-sm:flex-wrap max-sm:items-center " +
                  "max-sm:gap-x-2 max-sm:gap-y-1 max-sm:px-4 max-sm:py-2 " +
                  (isCurrent || isChecked
                    ? "bg-hub-surface-2 "
                    : "hover:bg-hub-surface-2 ") +
                  (isActive ? "ring-2 ring-hub-accent ring-inset" : "")
                }
              >
                {selectable ? (
                  <td className="w-11 px-3 py-2 max-sm:p-0">
                    <input
                      type="checkbox"
                      aria-label={C.selectRow(rowLabel(row))}
                      checked={isChecked}
                      onChange={() => toggle(key)}
                      className="size-4 accent-hub-accent pointer-coarse:size-5"
                    />
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={
                      cellClass(c, false) +
                      (c.primary ? " max-sm:basis-full max-sm:order-first" : "")
                    }
                  >
                    {c.primary ? (
                      <a
                        href={primaryHref(row)}
                        data-staff-primary={key}
                        tabIndex={i === tabStop ? 0 : -1}
                        onClick={
                          onPrimaryClick
                            ? (e) => onPrimaryClick(row, e)
                            : undefined
                        }
                        onFocus={() => setActiveKey(key)}
                        className={
                          "rounded font-semibold text-hub-accent tabular-nums " +
                          "underline-offset-2 hover:underline pointer-coarse:inline-flex " +
                          "pointer-coarse:min-h-11 pointer-coarse:items-center " +
                          "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                          "focus-visible:outline-hub-accent"
                        }
                      >
                        {c.cell(row)}
                      </a>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
