"use client";
// TableEditor (07-21; CONT-26, D232, D-UI-P7-23, D120; 07-UI-SPEC row "Table" line 361 and
// the table-replace copy; replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept).
//
// Heading · a cell toolbar (Bold, Italic, Link) acting on the last-focused cell · the grid of
// single-line cell inputs (first 50 rows until "Show all N rows"), a row-number gutter with
// per-row "Row N options" (Insert above, Insert below, Delete row) and a column strip with
// per-column "Column M options" (Insert left, Insert right, Delete column) plus that column's
// alignment · Add row / Add column · Import CSV / Export CSV · Options (Header row, First
// column as headers, Striped rows, On phones). Background stays in SectionForm.
//
// Paste from Excel or Google Sheets into any cell fills the grid from that cell
// (tsvGridForPaste -> pasteGrid) with an Undo toast; a paste past the limits changes nothing
// and shows TABLE_LIMIT_COPY. Import CSV runs in the browser over the draft (plan decision 2)
// through the shared CsvImportDialog in replaceOnly mode (decision 3); pasted and imported
// cells are plain text (decision 4). Every change calls onChange with the whole new field
// value; validateTableBlock re-checks every cell at Save block (T-07-21-06). Menus are inline
// disclosures (no floating layer). Hub tokens and hub primitives only.
//
// 10-41 (BILL-14, BILL-04, D233; 10-UI-SPEC "Pro table", D-UI-P10-24..27): with Builder Pro
// (useBuilderPlan().builderPro, server-computed) the grid grows to 20 x 1,000, the cell toolbar
// sets an icon, the row menu makes a section heading, the column menu sets a width and the
// highlight, and Options ends with a "Builder Pro" group. Without it the group renders through
// FeatureGuard (lock panel) and the Icon select through FeatureInline; the Pro menu items are
// not offered. A lapsed table (Pro content, no Builder Pro) shows PAUSED-PRO-TABLE and its
// settings read-only; assertTablePlan on save stays the authority (T-10-41-01).
import { useId, useRef, useState, type ClipboardEvent } from "react";
import {
  Bold,
  Check,
  Download,
  Italic,
  Link2,
  Minus,
  MoreHorizontal,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  PRO_TABLE_COPY,
  PRO_TABLE_HIGHLIGHT_LABEL_MAX,
  PRO_TABLE_ICON_LABELS,
  safeHref,
  tableUsesPro,
  type TableAlign,
  type TableBlockContent,
  type TableColumnWidth,
  type TableIcon,
  type TableMobile,
} from "@cds/core/content";
import type { CsvFile, ImportCommitResult } from "../../hub/addon-types";
import { Button } from "../../hub/Button";
import { CsvImportDialog } from "../../hub/CsvImportDialog";
import { FeatureGuard } from "../../hub/FeatureGuard";
import { FeatureInline } from "../../hub/FeatureInline";
import { InlineAlert } from "../../hub/feedback";
import { TextField } from "../../hub/fields";
import { IconButton } from "../../hub/IconButton";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { Switch } from "../../hub/Switch";
import { UNDO_TOAST_MS, useToast } from "../../hub/Toast";
import { tsvGridForPaste } from "../paste";
import {
  applyCsvRows,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  pasteGrid,
  pausedEditAddsPro,
  setAlign,
  setCell,
  setCellIcon,
  setColumnWidth,
  setHighlight,
  setTablePro,
  tableDraft,
  tableLimits,
  tablePreviewFromCsv,
  tableRowsFromCsv,
  tableToCsv,
  toggleSectionRow,
  type CellAt,
  type TableProSwitch,
} from "./table-logic";
import { useBuilderPlan } from "./business-context";
import type { CoreBlockEditorProps } from "./types";

/** Rows rendered before "Show all N rows" (UI-SPEC). */
export const TABLE_EDITOR_ROW_WINDOW = 50;

/** 10-UI-SPEC PAUSED-PRO-TABLE (D-UI-P10-27). */
export const PAUSED_PRO_TABLE_COPY =
  "Builder Pro is paused because payment stopped. This table shows as a basic table on your site, and its Pro settings are kept.";

const BUILDER_PRO = "builder-pro";
const BUILDER_PRO_NAME = "Builder Pro";

const PRO_SWITCHES: readonly { key: TableProSwitch; label: string }[] = [
  { key: "sticky", label: "Keep the header row and first column in place" },
  { key: "sortable", label: "Let visitors sort by column" },
  { key: "searchable", label: "Add a search box" },
  { key: "paged", label: "Show 25 rows per page" },
];
const ICON_OPTIONS: readonly { value: TableIcon | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "yes", label: `✓ ${PRO_TABLE_ICON_LABELS.yes}` },
  { value: "no", label: `✗ ${PRO_TABLE_ICON_LABELS.no}` },
  { value: "dash", label: `– ${PRO_TABLE_ICON_LABELS.dash}` },
];
const WIDTH_OPTIONS: readonly { value: TableColumnWidth; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
];

function CellIconGlyph({ icon }: { icon: TableIcon }) {
  const Icon = icon === "yes" ? Check : icon === "no" ? X : Minus;
  return (
    <Icon
      aria-hidden
      size={16}
      strokeWidth={2}
      className={`shrink-0 ${icon === "yes" ? "text-hub-ink" : "text-hub-ink-muted"}`}
    />
  );
}

const ALIGN_OPTIONS: readonly { value: TableAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const MOBILE_OPTIONS: readonly {
  value: TableMobile;
  title: string;
  description: string;
}[] = [
  {
    value: "scroll",
    title: "Scroll sideways",
    description: "The table keeps its columns and scrolls left and right.",
  },
  {
    value: "cards",
    title: "Stack as cards",
    description: "Each row becomes a card with the header beside each value.",
  },
];
const CSV_NOTE =
  "Bold, italic and links aren't kept in CSV files. Add them again after importing.";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Browser download of a CSV file (Blob + object URL, as the hub list helpers do). */
export function downloadCsvFile(file: CsvFile): void {
  const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function slugFile(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "table"}.csv`;
}

type Menu = { kind: "row" | "col"; index: number } | null;

const CELL_INPUT =
  "h-9 w-full min-w-28 rounded border border-transparent bg-hub-surface px-2 font-hub text-sm " +
  "text-hub-ink transition-colors duration-150 hover:border-hub-border-strong " +
  "focus-visible:border-hub-accent";
const MENU_ITEM =
  "flex min-h-9 w-full items-center rounded px-3 text-left text-sm text-hub-ink " +
  "hover:bg-hub-surface-2 disabled:cursor-not-allowed disabled:opacity-50 " +
  "pointer-coarse:min-h-11";

export function TableEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const toast = useToast();
  const t = tableDraft(content);
  const width = t.rows[0]?.length ?? 1;
  const [active, setActive] = useState<CellAt>({ row: 0, col: 0 });
  const [showAll, setShowAll] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const pendingImport = useRef<TableBlockContent | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);

  const cur =
    t.rows[active.row]?.[active.col] !== undefined
      ? active
      : { row: 0, col: 0 };
  const activeCell = t.rows[cur.row]![cur.col]!;
  const plan = useBuilderPlan();
  const pro = plan.builderPro;
  const entitled: ReadonlySet<string> = new Set(pro ? [BUILDER_PRO] : []);
  const limits = tableLimits(pro);
  const atRowLimit = t.rows.length >= limits.rows;
  const atColLimit = width >= limits.columns;
  const paused = !pro && tableUsesPro(t);
  const sections = new Set(t.pro?.section_rows ?? []);
  const highlight = t.pro?.highlight ?? null;

  /**
   * Write rows, align and pro (each only when it changed) into the draft. While the table is
   * paused, an edit that adds Pro use is refused in place with PRO_TABLE_COPY and changes
   * nothing (WR-C03), so Save block never fails on an edit the owner cannot see. Returns
   * whether the edit went in.
   */
  function commit(next: TableBlockContent): boolean {
    if (paused && pausedEditAddsPro(t, next)) {
      setLimitError(PRO_TABLE_COPY);
      return false;
    }
    if (next.rows !== t.rows) onChange("rows", next.rows);
    if (next.align !== t.align) onChange("align", next.align);
    if (
      next.pro !== undefined &&
      JSON.stringify(next.pro) !== JSON.stringify(t.pro)
    ) {
      onChange("pro", next.pro);
    }
    return true;
  }

  function restore(prev: TableBlockContent) {
    onChange("rows", prev.rows);
    onChange("align", prev.align);
    if (prev.pro !== undefined || t.pro !== undefined) {
      onChange("pro", prev.pro);
    }
  }

  function headerLabel(c: number): string {
    const head = t.header_row ? (t.rows[0]?.[c]?.text.trim() ?? "") : "";
    return head ? `Column ${c + 1}: ${head}` : `Column ${c + 1}`;
  }

  function cellName(r: number, c: number): string {
    const head = t.header_row && r > 0 ? t.rows[0]![c]!.text.trim() : "";
    return `Row ${r + 1}, ${head || `Column ${c + 1}`}`;
  }

  function focusCell(r: number, c: number) {
    setTimeout(() => {
      gridRef.current
        ?.querySelector<HTMLInputElement>(`input[data-cell="${r}-${c}"]`)
        ?.focus();
    }, 0);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, at: CellAt) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const grid = tsvGridForPaste(text);
    if (grid === null) return;
    e.preventDefault();
    const res = pasteGrid(t, at, grid, limits);
    if ("error" in res) {
      setLimitError(res.error);
      return;
    }
    setLimitError(null);
    const prev = t;
    if (!commit(res.content)) return;
    const cols = grid.reduce((w, r) => Math.max(w, r.length), 0);
    toast.show({
      message: `Pasted ${plural(grid.length, "row", "rows")} and ${plural(cols, "column", "columns")}.`,
      action: { label: "Undo", onClick: () => restore(prev) },
      durationMs: UNDO_TOAST_MS,
    });
  }

  function toggle(flag: "bold" | "italic") {
    commit(setCell(t, cur.row, cur.col, { [flag]: !activeCell[flag] }));
  }

  function openLink() {
    setLinkDraft(activeCell.link);
    setLinkError(null);
    setLinkOpen((o) => !o);
  }

  function applyLink() {
    const raw = linkDraft.trim();
    if (raw === "") {
      commit(setCell(t, cur.row, cur.col, { link: "" }));
      setLinkOpen(false);
      return;
    }
    try {
      const href = safeHref(raw);
      commit(setCell(t, cur.row, cur.col, { link: href }));
      setLinkError(null);
      setLinkOpen(false);
    } catch (err) {
      setLinkError(
        err instanceof Error && err.message
          ? err.message
          : "Use a full web address, like https://example.com.",
      );
    }
  }

  function rowAction(next: TableBlockContent) {
    setMenu(null);
    setLimitError(null);
    commit(next);
  }

  /** The CSV import's write; refused like any other edit while paused (WR-C03). */
  function importRows(next: TableBlockContent): boolean {
    setLimitError(null);
    return commit(next);
  }

  function exportCsv() {
    downloadCsvFile({ filename: slugFile(t.heading), csv: tableToCsv(t) });
  }

  /** The Builder Pro group's controls; read-only for a lapsed table (D-UI-P10-27). */
  function proControls(readOnly: boolean) {
    return (
      <div className="flex flex-col gap-2">
        {PRO_SWITCHES.map((s) => (
          <Switch
            key={s.key}
            id={`${uid}-pro-${s.key}`}
            label={s.label}
            checked={t.pro?.[s.key] === true}
            disabled={readOnly}
            onChange={(v) => commit(setTablePro(t, { [s.key]: v }))}
          />
        ))}
        <label
          htmlFor={`${uid}-pro-highlight`}
          className="mt-2 text-sm font-semibold text-hub-ink"
        >
          Highlight a column
        </label>
        <select
          id={`${uid}-pro-highlight`}
          value={highlight ? String(highlight.column) : ""}
          disabled={readOnly}
          onChange={(e) => {
            const v = e.currentTarget.value;
            commit(setHighlight(t, v === "" ? null : Number(v)));
          }}
          className="h-11 max-w-sm rounded border border-hub-border-strong bg-hub-surface px-2 text-base text-hub-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">None</option>
          {Array.from({ length: width }, (_, c) => (
            <option key={c} value={String(c)}>
              {headerLabel(c)}
            </option>
          ))}
        </select>
        {highlight ? (
          <TextField
            id={`${uid}-pro-highlight-label`}
            label="Label for the highlight"
            helper='For example "Most popular".'
            value={highlight.label}
            maxLength={PRO_TABLE_HIGHLIGHT_LABEL_MAX}
            disabled={readOnly}
            onChange={(e) =>
              commit(setHighlight(t, highlight.column, e.currentTarget.value))
            }
          />
        ) : null}
        {readOnly ? null : (
          <p className="text-sm text-hub-ink-muted">
            Set icons from the cell toolbar, section headings from a row&apos;s
            options, and widths from a column&apos;s options.
          </p>
        )}
      </div>
    );
  }

  const visibleRows =
    showAll || t.rows.length <= TABLE_EDITOR_ROW_WINDOW
      ? t.rows
      : t.rows.slice(0, TABLE_EDITOR_ROW_WINDOW);

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        helper="Names the table for screen readers too."
        value={t.heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <section aria-labelledby={`${uid}-cells`} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3
            id={`${uid}-cells`}
            className="text-sm font-semibold text-hub-ink"
          >
            Cells
          </h3>
          <p className="text-sm text-hub-ink-muted">
            Type in the cells, or paste cells copied from Excel or Google
            Sheets.
          </p>
        </div>

        <div
          role="toolbar"
          aria-label="Cell formatting"
          className="flex flex-wrap items-center gap-2 rounded border border-hub-border bg-hub-surface-2 p-2"
        >
          <span
            className="px-1 text-sm text-hub-ink-muted tabular-nums"
            aria-live="polite"
          >
            {cellName(cur.row, cur.col)}
          </span>
          <Button
            size="sm"
            variant={activeCell.bold ? "primary" : "secondary"}
            aria-pressed={activeCell.bold}
            icon={<Bold aria-hidden size={16} strokeWidth={2} />}
            onClick={() => toggle("bold")}
          >
            Bold
          </Button>
          <Button
            size="sm"
            variant={activeCell.italic ? "primary" : "secondary"}
            aria-pressed={activeCell.italic}
            icon={<Italic aria-hidden size={16} strokeWidth={2} />}
            onClick={() => toggle("italic")}
          >
            Italic
          </Button>
          <Button
            size="sm"
            variant={activeCell.link ? "primary" : "secondary"}
            aria-expanded={linkOpen}
            aria-controls={`${uid}-link`}
            icon={<Link2 aria-hidden size={16} strokeWidth={2} />}
            onClick={openLink}
          >
            Link
          </Button>
          <FeatureInline
            feature={BUILDER_PRO}
            entitlements={entitled}
            featureName={BUILDER_PRO_NAME}
            canBuy={plan.canBuy}
          >
            {(locked) => (
              <span className="flex items-center gap-2 px-1 text-sm text-hub-ink">
                <span aria-hidden>Icon</span>
                <select
                  aria-label="Icon for this cell"
                  value={activeCell.icon ?? ""}
                  disabled={locked}
                  onChange={(e) =>
                    commit(
                      setCellIcon(
                        t,
                        cur.row,
                        cur.col,
                        e.currentTarget.value as TableIcon | "",
                      ),
                    )
                  }
                  className="h-9 rounded border border-hub-border-strong bg-hub-surface px-2 text-sm text-hub-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {ICON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </FeatureInline>
        </div>

        {linkOpen ? (
          <div
            id={`${uid}-link`}
            className="flex flex-col gap-2 rounded border border-hub-border p-3 md:flex-row md:items-end"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setLinkOpen(false);
              }
            }}
          >
            <div className="min-w-0 flex-1">
              <TextField
                id={`${uid}-link-field`}
                label="Link for this cell"
                placeholder="https://example.com or /contact"
                value={linkDraft}
                error={linkError ?? undefined}
                autoFocus
                onChange={(e) => setLinkDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button size="md" variant="primary" onClick={applyLink}>
                Apply
              </Button>
              {activeCell.link ? (
                <Button
                  size="md"
                  variant="ghost"
                  onClick={() => {
                    commit(setCell(t, cur.row, cur.col, { link: "" }));
                    setLinkDraft("");
                    setLinkOpen(false);
                  }}
                >
                  Remove link
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {limitError ? (
          <InlineAlert tone="error">{limitError}</InlineAlert>
        ) : null}

        <div className="overflow-x-auto rounded border border-hub-border">
          <table ref={gridRef} className="w-full border-collapse text-sm">
            <caption className="sr-only">Table cells</caption>
            <thead className="bg-hub-surface-2">
              <tr>
                <td className="w-16 border-b border-hub-border" />
                {Array.from({ length: width }, (_, c) => {
                  const open = menu?.kind === "col" && menu.index === c;
                  const menuId = `${uid}-col-${c}`;
                  return (
                    <th
                      key={c}
                      scope="col"
                      className="border-b border-l border-hub-border px-2 py-1 text-left align-top font-normal"
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-hub-ink-muted">
                          {`Column ${c + 1}`}
                        </span>
                        {highlight?.column === c ? (
                          <span className="rounded bg-hub-surface px-1 text-xs font-semibold text-hub-ink">
                            Highlighted
                          </span>
                        ) : null}
                        <select
                          aria-label={`Column ${c + 1} alignment`}
                          value={t.align[c] ?? "left"}
                          onChange={(e) =>
                            commit(
                              setAlign(
                                t,
                                c,
                                e.currentTarget.value as TableAlign,
                              ),
                            )
                          }
                          className="h-8 rounded border border-hub-border-strong bg-hub-surface px-1 text-xs text-hub-ink"
                        >
                          {ALIGN_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <IconButton
                          size="sm"
                          label={`Column ${c + 1} options`}
                          aria-expanded={open}
                          aria-controls={menuId}
                          icon={
                            <MoreHorizontal
                              aria-hidden
                              size={16}
                              strokeWidth={2}
                            />
                          }
                          onClick={() =>
                            setMenu(open ? null : { kind: "col", index: c })
                          }
                        />
                      </div>
                      {open ? (
                        <div
                          id={menuId}
                          role="group"
                          aria-label={`Column ${c + 1} options`}
                          className="mt-1 flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setMenu(null);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className={MENU_ITEM}
                            disabled={atColLimit}
                            onClick={() =>
                              rowAction(insertColumn(t, c, limits))
                            }
                          >
                            Insert left
                          </button>
                          <button
                            type="button"
                            className={MENU_ITEM}
                            disabled={atColLimit}
                            onClick={() =>
                              rowAction(insertColumn(t, c + 1, limits))
                            }
                          >
                            Insert right
                          </button>
                          <button
                            type="button"
                            className={`${MENU_ITEM} text-hub-danger`}
                            disabled={width <= 1}
                            onClick={() => rowAction(deleteColumn(t, c))}
                          >
                            Delete column
                          </button>
                          {pro ? (
                            <>
                              <label className="flex flex-col gap-1 px-3 py-1 text-sm text-hub-ink">
                                Column width
                                <select
                                  value={t.pro?.widths[c] ?? "auto"}
                                  onChange={(e) =>
                                    rowAction(
                                      setColumnWidth(
                                        t,
                                        c,
                                        e.currentTarget
                                          .value as TableColumnWidth,
                                      ),
                                    )
                                  }
                                  className="h-9 rounded border border-hub-border-strong bg-hub-surface px-2 text-sm text-hub-ink"
                                >
                                  {WIDTH_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                className={MENU_ITEM}
                                onClick={() =>
                                  rowAction(
                                    setHighlight(
                                      t,
                                      highlight?.column === c ? null : c,
                                    ),
                                  )
                                }
                              >
                                {highlight?.column === c
                                  ? "Remove highlight"
                                  : "Highlight this column"}
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, r) => {
                const open = menu?.kind === "row" && menu.index === r;
                const menuId = `${uid}-row-${r}`;
                const isHeader = t.header_row && r === 0;
                return (
                  <tr
                    key={r}
                    className="border-b border-hub-border last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="w-16 bg-hub-surface-2 px-1 py-1 text-left align-top font-normal"
                    >
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-right text-xs text-hub-ink-muted tabular-nums">
                          {r + 1}
                        </span>
                        {sections.has(r) ? (
                          <span className="rounded bg-hub-surface px-1 text-xs font-semibold text-hub-ink">
                            Heading
                          </span>
                        ) : null}
                        <IconButton
                          size="sm"
                          tooltipAlign="start"
                          label={`Row ${r + 1} options`}
                          aria-expanded={open}
                          aria-controls={menuId}
                          icon={
                            <MoreHorizontal
                              aria-hidden
                              size={16}
                              strokeWidth={2}
                            />
                          }
                          onClick={() =>
                            setMenu(open ? null : { kind: "row", index: r })
                          }
                        />
                      </div>
                      {open ? (
                        <div
                          id={menuId}
                          role="group"
                          aria-label={`Row ${r + 1} options`}
                          className="mt-1 flex w-48 flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setMenu(null);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className={MENU_ITEM}
                            disabled={atRowLimit}
                            onClick={() => rowAction(insertRow(t, r, limits))}
                          >
                            Insert above
                          </button>
                          <button
                            type="button"
                            className={MENU_ITEM}
                            disabled={atRowLimit}
                            onClick={() =>
                              rowAction(insertRow(t, r + 1, limits))
                            }
                          >
                            Insert below
                          </button>
                          <button
                            type="button"
                            className={`${MENU_ITEM} text-hub-danger`}
                            disabled={t.rows.length <= 1}
                            onClick={() => rowAction(deleteRow(t, r))}
                          >
                            Delete row
                          </button>
                          {pro ? (
                            <button
                              type="button"
                              className={MENU_ITEM}
                              onClick={() => rowAction(toggleSectionRow(t, r))}
                            >
                              {sections.has(r)
                                ? "Remove section heading"
                                : "Make section heading"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </th>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className="border-l border-hub-border p-1 align-top"
                      >
                        <div className="flex items-center gap-1">
                          {cell.icon ? (
                            <CellIconGlyph icon={cell.icon} />
                          ) : null}
                          <input
                            type="text"
                            data-cell={`${r}-${c}`}
                            aria-label={cellName(r, c)}
                            value={cell.text}
                            maxLength={500}
                            onFocus={() => setActive({ row: r, col: c })}
                            onChange={(e) =>
                              commit(
                                setCell(t, r, c, {
                                  text: e.currentTarget.value,
                                }),
                              )
                            }
                            onPaste={(e) => onPaste(e, { row: r, col: c })}
                            className={`${CELL_INPUT}${isHeader || cell.bold ? " font-semibold" : ""}${cell.italic ? " italic" : ""}${cell.link ? " text-hub-accent underline" : ""} ${
                              t.align[c] === "right"
                                ? "text-right"
                                : t.align[c] === "center"
                                  ? "text-center"
                                  : "text-left"
                            }`}
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleRows.length < t.rows.length ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setShowAll(true)}
          >
            {`Show all ${t.rows.length} rows`}
          </Button>
        ) : null}

        {errors.rows ? (
          <p className="text-sm text-hub-danger">{errors.rows}</p>
        ) : null}
        {errors.align ? (
          <p className="text-sm text-hub-danger">{errors.align}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Plus aria-hidden size={16} strokeWidth={2} />}
              disabled={atRowLimit}
              aria-describedby={
                atRowLimit || atColLimit ? `${uid}-limit` : undefined
              }
              onClick={() => {
                const next = insertRow(t, t.rows.length, limits);
                commit(next);
                setShowAll(true);
                focusCell(next.rows.length - 1, 0);
              }}
            >
              Add row
            </Button>
            <Button
              size="sm"
              icon={<Plus aria-hidden size={16} strokeWidth={2} />}
              disabled={atColLimit}
              aria-describedby={
                atRowLimit || atColLimit ? `${uid}-limit` : undefined
              }
              onClick={() => {
                commit(insertColumn(t, width, limits));
                focusCell(0, width);
              }}
            >
              Add column
            </Button>
            <span
              className="mx-1 hidden w-px self-stretch bg-hub-border sm:block"
              aria-hidden
            />
            <Button
              size="sm"
              icon={<Upload aria-hidden size={16} strokeWidth={2} />}
              onClick={() => setImportOpen(true)}
            >
              Import CSV
            </Button>
            <Button
              size="sm"
              icon={<Download aria-hidden size={16} strokeWidth={2} />}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </div>
          {atRowLimit || atColLimit ? (
            <p id={`${uid}-limit`} className="text-sm text-hub-ink-muted">
              {limits.copy}
            </p>
          ) : null}
        </div>
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-hub-ink">
          Options
        </legend>
        <Switch
          id={`${uid}-header-row`}
          label="Header row"
          checked={t.header_row}
          onChange={(v) => onChange("header_row", v)}
        />
        <Switch
          id={`${uid}-first-col`}
          label="First column as headers"
          checked={t.first_column_header}
          onChange={(v) => onChange("first_column_header", v)}
        />
        <Switch
          id={`${uid}-striped`}
          label="Striped rows"
          checked={t.striped}
          onChange={(v) => onChange("striped", v)}
        />
        <fieldset className="mt-4 flex flex-col gap-2" data-table-pro-group="">
          <legend className="mb-2 text-sm font-semibold text-hub-ink">
            {BUILDER_PRO_NAME}
          </legend>
          <FeatureGuard
            feature={BUILDER_PRO}
            entitlements={entitled}
            featureName={BUILDER_PRO_NAME}
            canBuy={plan.canBuy}
            fallback={
              paused ? (
                <div className="flex flex-col gap-2">
                  <InlineAlert tone="warning">
                    {PAUSED_PRO_TABLE_COPY}
                  </InlineAlert>
                  {proControls(true)}
                </div>
              ) : undefined
            }
          >
            {proControls(false)}
          </FeatureGuard>
        </fieldset>
      </fieldset>

      <RadioCardGroup<TableMobile>
        name={`${uid}-mobile`}
        legend="On phones"
        options={MOBILE_OPTIONS}
        value={t.mobile}
        onChange={(v) => onChange("mobile", v)}
      />

      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import a table"
        singular="row"
        plural="rows"
        onTemplate={() => {}}
        onPreview={(text) => tablePreviewFromCsv(text, limits)}
        onCommit={async (text) => {
          const res = tableRowsFromCsv(text, limits);
          if (!res.ok) {
            return { ok: false, code: "invalid_input", message: res.message };
          }
          const before = t;
          if (!importRows(applyCsvRows(t, res.rows, res.columns))) {
            return {
              ok: false,
              code: "invalid_input",
              message: PRO_TABLE_COPY,
            };
          }
          pendingImport.current = before;
          const data: ImportCommitResult = {
            added: res.rows.length,
            updated: 0,
            removed: 0,
            backupId: "",
          };
          return { ok: true, data };
        }}
        onDone={() => {
          const prev = pendingImport.current;
          pendingImport.current = null;
          toast.show({
            message:
              "Table replaced from your file. Save the block to keep it.",
            action: prev
              ? { label: "Undo", onClick: () => restore(prev) }
              : undefined,
            durationMs: UNDO_TOAST_MS,
          });
        }}
        replaceOnly={{
          summary: (p) =>
            `${plural(p.changes, "row", "rows")}, ${plural(p.columns.length, "column", "columns")}`,
          primaryLabel: "Replace table…",
          confirmTitle: "Replace this table?",
          confirmBody: (p) =>
            `Your table becomes exactly this file: ${plural(p.changes, "row", "rows")}, ${plural(p.columns.length, "column", "columns")}.`,
          confirmLabel: "Replace table",
          note: CSV_NOTE,
        }}
      />
    </div>
  );
}
