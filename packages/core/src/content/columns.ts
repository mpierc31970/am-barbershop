// Columns block operations (CONT-05, CONT-06, CONT-07, D75-D77, CONTEXT A4-Q2/Q3).
//
// Ported from donor src/lib/columns-content.ts, plus the reorder/normalize operations.
// Every function is pure: inputs are never mutated and new objects are returned.
//
// The editor and @cds/db both call normalizeColumns; reorder always operates on stored
// columns by id, never the resolved view. The donor's resolveColumns merges surplus columns
// into the last one when a layout shrinks (D77), so a reorder computed on the resolved view
// and written back to storage would silently drop the merged items. Widths are positional
// (they come from row_layout), so moving a column moves content between fixed width slots;
// flipping (layouts.ts flipLayout) swaps widths and never touches content.
//
// Edge-safe: ids come from globalThis.crypto.randomUUID (Web Crypto, Node >= 19 and Edge).
import { InvalidInput } from "../errors";
import { columnCountFor } from "./layouts";
import type {
  Column,
  ColumnItem,
  ColumnItemKind,
  ColumnsContent,
  RowLayout,
} from "./types";

/** Ids exist for React keys and dnd-kit; nothing outside the block addresses them. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function newColumn(): Column {
  return { id: newId(), items: [] };
}

/**
 * Fresh starting content for a new `columns` block: the layout's column count, each with
 * its own id. Call this at the point a Columns template is selected; a module-level
 * literal would mint one column id shared by every block created from it.
 */
export function newColumnsBlockContent(
  layout: RowLayout = "full",
): ColumnsContent {
  return {
    columns: Array.from({ length: columnCountFor(layout) }, () => newColumn()),
  };
}

export function newColumnItem(kind: ColumnItemKind): ColumnItem {
  const id = newId();
  switch (kind) {
    case "heading":
      return { id, kind, text: "", level: 2 };
    case "text":
      return { id, kind, html: "" };
    case "list":
      return { id, kind, items: [] };
    case "image":
      return { id, kind, url: "", alt: "" };
    case "button":
      return {
        id,
        kind,
        text: "",
        link: "",
        style: "primary",
        action: "link",
        popup_id: "",
      };
    case "spacer":
      return { id, kind, height: "md" };
    case "divider":
      return { id, kind };
    case "countdown":
      return { id, kind, target_at: "", zero_message: "" };
    // P7 kinds (07-08). Literal defaults: no import from items/* (that cycles via newId).
    case "video":
      return {
        id,
        kind,
        title: "",
        source: "media",
        asset: "",
        provider: "",
        provider_id: "",
        cover: "",
        shape: "16:9",
        controls: true,
        loop: false,
        autoplay: false,
      };
    case "audio":
      return {
        id,
        kind,
        title: "",
        source: "media",
        asset: "",
        provider: "",
        provider_id: "",
      };
    case "form":
      return { id, kind, form_id: "" };
    case "embed":
      return { id, kind, title: "", provider: "", provider_id: "" };
  }
}

/**
 * Produce exactly the number of columns the layout draws (donor, verbatim logic).
 *
 * Shrinking a layout must never destroy content, so items from columns beyond the
 * layout's count are appended, in order, onto the last rendered column. Padded columns
 * get placeholder `col-auto-<i>` ids: fine for a read-only render, but they repeat across
 * blocks, so anything that stores the result must use normalizeColumns instead.
 */
export function resolveColumns(
  content: ColumnsContent | undefined,
  layout: RowLayout,
): Column[] {
  const count = columnCountFor(layout);
  const stored = Array.isArray(content?.columns) ? content.columns : [];

  const kept: Column[] = [];
  for (let i = 0; i < count; i += 1) {
    const source = stored[i];
    kept.push({
      id: source?.id ?? `col-auto-${i}`,
      items: Array.isArray(source?.items) ? [...source.items] : [],
    });
  }

  if (stored.length > count && kept.length > 0) {
    const last = kept[kept.length - 1]!;
    for (let i = count; i < stored.length; i += 1) {
      const surplus = stored[i];
      if (Array.isArray(surplus?.items)) last.items.push(...surplus.items);
    }
  }

  return kept;
}

/**
 * The stored form of a columns block for `layout` (CONT-07): resolveColumns, then fresh
 * ids for every padded `col-auto-` column and for any empty or duplicate id (RESEARCH
 * Pitfall 3). Item order and the item multiset are preserved.
 */
export function normalizeColumns(
  content: ColumnsContent | undefined,
  layout: RowLayout,
): ColumnsContent {
  const seen = new Set<string>();
  const columns = resolveColumns(content, layout).map((col) => {
    const id =
      typeof col.id !== "string" ||
      col.id === "" ||
      col.id.startsWith("col-auto-") ||
      seen.has(col.id)
        ? newId()
        : col.id;
    seen.add(id);
    return { id, items: col.items };
  });
  return { columns };
}

function assertIndex(value: number, length: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new InvalidInput(`${label} is out of range`);
  }
}

/**
 * Move a stored column from one width slot to another (CONT-05, D75). The row layout is
 * neither an input nor an output: widths stay positional, only content moves.
 */
export function moveColumn(
  content: ColumnsContent,
  from: number,
  to: number,
): ColumnsContent {
  const columns = [...content.columns];
  assertIndex(from, columns.length, "column index");
  assertIndex(to, columns.length, "target column index");
  const [moved] = columns.splice(from, 1);
  columns.splice(to, 0, moved!);
  return { columns };
}

export interface MoveItemInput {
  fromColumnId: string;
  fromIndex: number;
  toColumnId: string;
  /** Position in the target column after removal; clamped to its end. */
  toIndex: number;
}

/** Move one item within a column or across columns, by stored column id. */
export function moveItem(
  content: ColumnsContent,
  move: MoveItemInput,
): ColumnsContent {
  const columns = content.columns.map((c) => ({
    id: c.id,
    items: [...c.items],
  }));
  const from = columns.find((c) => c.id === move.fromColumnId);
  const to = columns.find((c) => c.id === move.toColumnId);
  if (!from || !to) throw new InvalidInput("unknown column");
  assertIndex(move.fromIndex, from.items.length, "item index");
  const [item] = from.items.splice(move.fromIndex, 1);
  const at = Number.isInteger(move.toIndex)
    ? Math.min(Math.max(move.toIndex, 0), to.items.length)
    : to.items.length;
  to.items.splice(at, 0, item!);
  return { columns };
}

/**
 * One-line admin summary of a columns row: how many columns, how many items.
 *
 * Counts what resolveColumns produces for the row's clamped layout, never
 * `content.columns.length`: three stored columns on a `full` row render as one. Returns
 * `undefined` for content that is not a columns block, the caller's cue to fall back.
 */
export function columnsSummary(
  content: unknown,
  layout: RowLayout,
): string | undefined {
  const stored = (content as { columns?: unknown } | undefined)?.columns;
  if (!Array.isArray(stored)) return undefined;

  const columns = resolveColumns(content as ColumnsContent, layout);
  const items = columns.reduce((sum, column) => sum + column.items.length, 0);

  return `${columns.length} ${columns.length === 1 ? "column" : "columns"}, ${items} ${items === 1 ? "item" : "items"}`;
}
