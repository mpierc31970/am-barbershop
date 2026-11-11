// Column item walkers (07-04; CONT-35 refs contract, T-03-18 generalized).
//
// 07-08 extends the switches in this file; registry.ts never walks items itself.
// Every walker is defensive: malformed content (non-array columns, non-array items,
// non-object items, unknown kinds) yields empty results rather than throwing (T-07-04-04).
// Slider and tab panels (07-06) reuse columnsItems / columnsRefs per panel.
//
// Pure and Edge-safe: type-only imports from ../types and ../registry; the one runtime import
// is mediaLinkFrom (07-08), which re-validates a stored provider pair before its URL is used.
import { mediaLinkFrom } from "../media-link";
import type { SectionRefs } from "../registry";
import type { ColumnItem } from "../types";

/** Keep only non-empty strings. */
export function nonEmpty(values: readonly (string | undefined)[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noRefs(): SectionRefs {
  return { popups: [], forms: [], media: [] };
}

/** Every item of every column, skipping anything that is not an object. */
export function columnsItems(content: unknown): ColumnItem[] {
  if (!isRecord(content) || !Array.isArray(content.columns)) return [];
  return content.columns.flatMap((col: unknown) =>
    isRecord(col) && Array.isArray(col.items)
      ? (col.items.filter(isRecord) as ColumnItem[])
      : [],
  );
}

/** Every human-written string of one item (plain and rich). */
export function itemTexts(item: ColumnItem): string[] {
  switch (item.kind) {
    case "heading":
      return [item.text];
    case "text":
      return [item.html];
    case "list":
      return Array.isArray(item.items) ? item.items : [];
    case "image":
      return [item.alt];
    case "button":
      return [item.text];
    case "countdown":
      return [item.zero_message];
    case "video":
    case "audio":
    case "embed":
      return [item.title];
    case "form":
      return [];
    default:
      return [];
  }
}

/** The embed URL we build for a link-source item ("" when none or invalid). */
function linkUrl(item: { provider?: unknown; provider_id?: unknown }): string {
  return mediaLinkFrom(item.provider, item.provider_id)?.embedUrl ?? "";
}

/** Every link and image URL of one item. */
export function itemUrls(item: ColumnItem): string[] {
  switch (item.kind) {
    case "button":
      return [item.link];
    case "image":
      return [item.url];
    case "video":
    case "audio":
      return item.source === "link" ? nonEmpty([linkUrl(item)]) : [];
    case "embed":
      return nonEmpty([linkUrl(item)]);
    case "form":
      return [];
    default:
      return [];
  }
}

function ref(value: unknown): string[] {
  return typeof value === "string" && value !== "" ? [value] : [];
}

/** Every pop-up, form and media asset one item references. */
export function itemRefs(item: ColumnItem): SectionRefs {
  const refs = noRefs();
  switch (item.kind) {
    case "button":
      if (
        item.action === "popup" &&
        typeof item.popup_id === "string" &&
        item.popup_id !== ""
      ) {
        refs.popups.push(item.popup_id);
      }
      return refs;
    case "image":
      refs.media.push(...ref(item.asset));
      return refs;
    case "video":
      refs.media.push(...ref(item.asset), ...ref(item.cover));
      return refs;
    case "audio":
      refs.media.push(...ref(item.asset));
      return refs;
    case "form":
      refs.forms.push(...ref(item.form_id));
      return refs;
    case "embed":
      return refs;
    default:
      return refs;
  }
}

/** Union of itemRefs over every column item, de-duplicated in first-seen order. */
export function columnsRefs(content: unknown): SectionRefs {
  const seen = {
    popups: new Set<string>(),
    forms: new Set<string>(),
    media: new Set<string>(),
  };
  for (const item of columnsItems(content)) {
    const r = itemRefs(item);
    for (const id of r.popups) seen.popups.add(id);
    for (const id of r.forms) seen.forms.add(id);
    for (const id of r.media) seen.media.add(id);
  }
  return {
    popups: [...seen.popups],
    forms: [...seen.forms],
    media: [...seen.media],
  };
}
