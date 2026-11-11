// Shared helpers for core block group A (owner 07-06): gallery, slider, tabs, logo strip,
// stats (CONTEXT decisions 1 and 5; D228, D229).
//
// 07-07 may import these read-only. Deny by default: own-property reads, fresh output,
// lists length-checked before any per-item work (T-07-06-03, T-07-06-04).
// Never imports a runtime value from ../registry (07-04: that would form an import cycle),
// so it has its own mergeRefs instead of unionRefs.
// Panel helpers (slider slides, tab panels): each panel is a columns row (CONTEXT
// decision 1, D229, invariant 6) validated by validateColumnsContent with pop-up buttons
// allowed. 07-08 extends items/walk.ts for video/audio/form/embed/image asset; panels pick
// that up with no change here.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import { newColumnsBlockContent, newId } from "../columns";
import {
  columnsItems,
  columnsRefs,
  itemTexts,
  itemUrls,
  nonEmpty,
} from "../items/walk";
import { isRowLayout } from "../layouts";
import type { SectionRefs } from "../registry";
import type { Column, ColumnItem, RowLayout } from "../types";
import {
  MAX_ITEMS_PER_BLOCK,
  assertUniqueItemIds,
  validateColumnsContent,
} from "../validate";
import {
  MALFORMED_COPY,
  SAFE_ID,
  asRecord,
  isRecord,
  own,
  safeId,
  type Raw,
} from "../validate-helpers";

/**
 * A media asset id: a trimmed string matching SAFE_ID, else InvalidInput(copy). Never mints
 * a new id: a media ref must point at a real row (org ownership is 07-04's assertRefsOwned).
 */
export function assetId(value: unknown, copy: string): string {
  if (typeof value !== "string") throw new InvalidInput(copy);
  const id = value.trim();
  if (!SAFE_ID.test(id)) throw new InvalidInput(copy);
  return id;
}

/** Own-property boolean, else the fallback (no truthy coercion: "true" is not true). */
export function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const v = own(raw, key);
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Own-property list: undefined -> []; non-array -> InvalidInput(MALFORMED_COPY); longer than
 * `max` -> InvalidInput(overCopy). The length is checked before any per-item work.
 */
export function boundedArray(
  raw: Raw,
  key: string,
  max: number,
  overCopy: string,
): unknown[] {
  const v = own(raw, key);
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new InvalidInput(MALFORMED_COPY);
  if (v.length > max) throw new InvalidInput(overCopy);
  return v;
}

/** A finite number, truncated and clamped to [min, max]; anything else (strings too) -> fallback. */
export function intInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

const REF_KEYS = ["popups", "forms", "media"] as const;

/** Three fresh empty ref lists. */
export function noRefs(): SectionRefs {
  return { popups: [], forms: [], media: [] };
}

/** Union of ref lists: per-key de-dup in first-seen order; non-strings and "" skipped. */
export function mergeRefs(list: readonly SectionRefs[]): SectionRefs {
  const out = noRefs();
  for (const key of REF_KEYS) {
    const seen = new Set<string>();
    for (const refs of list) {
      const ids: unknown = refs?.[key];
      if (!Array.isArray(ids)) continue;
      for (const id of ids as unknown[]) {
        if (typeof id !== "string" || id === "" || seen.has(id)) continue;
        seen.add(id);
        out[key].push(id);
      }
    }
  }
  return out;
}

/** Media-only refs, de-duplicated in first-seen order. */
export function mediaRefs(ids: readonly string[]): SectionRefs {
  return mergeRefs([{ popups: [], forms: [], media: [...ids] }]);
}

/** InvalidInput(MALFORMED_COPY) on a repeated id (images, logos, stats, panels). */
export function assertUniqueIds(list: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.id)) throw new InvalidInput(MALFORMED_COPY);
    seen.add(entry.id);
  }
}

// ---- Panels (slider slides, tab panels) ----

/** One slide or tab panel: a columns row. */
export type PanelRow = { id: string; row_layout: RowLayout; columns: Column[] };

const BLOCK_ITEMS_COPY = `A block can hold up to ${MAX_ITEMS_PER_BLOCK} items.`;

/** A fresh empty full-width panel. */
export function newPanel(): PanelRow {
  return {
    id: newId(),
    row_layout: "full",
    columns: newColumnsBlockContent("full").columns,
  };
}

/**
 * A bounded list of columns-row panels. Each panel's columns go through
 * validateColumnsContent (allowPopupButton: true) normalized to its row_layout (unknown ->
 * "full"). Items across all panels share one block-wide cap (MAX_ITEMS_PER_BLOCK); panel
 * ids and item ids must be unique across the block.
 */
export function validatePanels(
  raw: Raw,
  key: string,
  max: number,
  overCopy: string,
): PanelRow[] {
  let total = 0;
  const panels = boundedArray(raw, key, max, overCopy).map((value) => {
    const p = asRecord(value);
    const layoutRaw = own(p, "row_layout");
    const row_layout: RowLayout = isRowLayout(layoutRaw) ? layoutRaw : "full";
    const { columns } = validateColumnsContent(
      { columns: own(p, "columns") },
      row_layout,
      { allowPopupButton: true },
    );
    for (const col of columns) total += col.items.length;
    if (total > MAX_ITEMS_PER_BLOCK) throw new InvalidInput(BLOCK_ITEMS_COPY);
    return { id: safeId(own(p, "id")), row_layout, columns };
  });
  assertUniqueIds(panels);
  assertUniqueItemIds(panels.flatMap((p) => p.columns.flatMap((c) => c.items)));
  return panels;
}

function panelList(panels: unknown): Record<string, unknown>[] {
  return Array.isArray(panels) ? panels.filter(isRecord) : [];
}

/** `fn` over every text item's html in every panel; every other field kept. */
export function mapPanelsRichText<P extends PanelRow>(
  panels: unknown,
  fn: (html: string) => string,
): P[] {
  return panelList(panels).map((panel) => {
    const columns = Array.isArray(panel.columns)
      ? (panel.columns.filter(isRecord) as unknown as Column[])
      : [];
    return {
      ...panel,
      columns: columns.map((col) => ({
        id: col.id,
        items: (Array.isArray(col.items) ? col.items : []).map(
          (item: ColumnItem) =>
            item.kind === "text" ? { ...item, html: fn(item.html) } : item,
        ),
      })),
    } as unknown as P;
  });
}

/** Every human-written string in every panel. */
export function panelsTexts(panels: unknown): string[] {
  return nonEmpty(
    panelList(panels).flatMap((p) => columnsItems(p).flatMap(itemTexts)),
  );
}

/** Every link and image URL in every panel. */
export function panelsUrls(panels: unknown): string[] {
  return nonEmpty(
    panelList(panels).flatMap((p) => columnsItems(p).flatMap(itemUrls)),
  );
}

/** Every pop-up, form and media ref in every panel, merged. */
export function panelsRefs(panels: unknown): SectionRefs {
  return mergeRefs(panelList(panels).map((p) => columnsRefs(p)));
}

/**
 * 07-20: a deep copy of one panel with a fresh id for the panel, every column and every
 * item (Duplicate slide / tab), so validatePanels accepts source and copy together.
 * Every other field is copied by value. Extra panel fields (a tab's label) are kept.
 */
export function clonePanelFreshIds<T extends PanelRow>(panel: T): T {
  const copy = structuredClone(panel);
  return {
    ...copy,
    id: newId(),
    columns: (Array.isArray(copy.columns) ? copy.columns : []).map((col) => ({
      ...col,
      id: newId(),
      items: (Array.isArray(col.items) ? col.items : []).map((item) => ({
        ...item,
        id: newId(),
      })),
    })),
  };
}
