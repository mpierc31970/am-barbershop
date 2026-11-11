// Pure page-builder editor logic (03-08; CONT-05, CONT-06, CONT-07, CONT-10, CONT-12;
// D75-D77; 03-UI-SPEC "Accessibility contract", "ColumnsEditor"; RESEARCH Pitfall 8).
//
// No React, no DOM: every function here is a plain input -> output transform, unit-tested
// in editor-logic.test.ts. The builder components (ColumnsEditor, ItemListEditor,
// ColumnItemForm) hold state and events; the decisions live here.
//
// Time zones (T-03-31): the browser converts a datetime-local value to a UTC ISO instant
// before anything leaves the page, so the server never guesses a zone. Every time helper
// takes an optional IANA zone: omitted means the runtime's own zone (the browser's), and
// tests pass one explicitly so they do not depend on the machine they run on.
import {
  AUDIO_NOT_ALLOWED_COPY,
  AUDIO_SOURCE_COPY,
  AUDIO_TITLE_COPY,
  EMBED_LINK_EMPTY_COPY,
  EMBED_NOT_ALLOWED_COPY,
  EMBED_TITLE_COPY,
  FORM_ITEM_COPY,
  LINK_NOT_ALLOWED_COPY,
  VIDEO_SOURCE_COPY,
  VIDEO_TITLE_COPY,
  columnCountFor,
  htmlToPlainText,
  normalizeColumns,
  safeHref,
  safeImageUrl,
  validateColumnItem,
  type ColumnItem,
  type ColumnItemKind,
  type ColumnItemOptions,
  type ColumnsContent,
  type MoveItemInput,
  type RowLayout,
} from "@cds/core/content";

// ---------------------------------------------------------------------------
// dnd-kit announcements (UI-SPEC "Accessibility contract", WCAG 4.1.3)
// ---------------------------------------------------------------------------

export const announce = {
  pickUp: (label: string, pos: number, total: number) =>
    `Picked up ${label}. Position ${pos} of ${total}.`,
  over: (label: string, pos: number, total: number) =>
    `${label} moved to position ${pos} of ${total}.`,
  drop: (label: string, pos: number, total: number) =>
    `${label} dropped at position ${pos} of ${total}.`,
  cancel: (label: string, pos: number) =>
    `Move cancelled. ${label} is back at position ${pos}.`,
} as const;

/** dnd-kit keyboard instructions, read once when a drag handle gains focus. */
export const DRAG_INSTRUCTIONS =
  "To pick up, press Space or Enter. Use the arrow keys to move, Space or Enter to drop, Escape to cancel.";

// ---------------------------------------------------------------------------
// Item kinds: the one label list (Record is exhaustive, so a new kind cannot compile
// without a label). The "Add item" menu order and grouping is ADD_ITEM_GROUPS below
// (07-UI-SPEC "Column item menu").
// ---------------------------------------------------------------------------

export const KIND_LABELS: Record<ColumnItemKind, string> = {
  heading: "Heading",
  text: "Text",
  list: "List",
  image: "Image",
  button: "Button",
  countdown: "Countdown",
  spacer: "Spacer",
  divider: "Divider",
  video: "Video",
  audio: "Audio",
  form: "Form",
  embed: "Booking calendar",
};

export interface AddItemGroup {
  label: string;
  kinds: readonly ColumnItemKind[];
}

/** The grouped "Add item" menu (07-UI-SPEC): every kind appears in exactly one group. */
export const ADD_ITEM_GROUPS: readonly AddItemGroup[] = Object.freeze([
  Object.freeze({
    label: "Text",
    kinds: Object.freeze(["heading", "text", "list"] as ColumnItemKind[]),
  }),
  Object.freeze({
    label: "Photos and media",
    kinds: Object.freeze(["image", "video", "audio"] as ColumnItemKind[]),
  }),
  Object.freeze({
    label: "Actions",
    kinds: Object.freeze(["button", "form", "embed"] as ColumnItemKind[]),
  }),
  Object.freeze({
    label: "Other",
    kinds: Object.freeze([
      "countdown",
      "spacer",
      "divider",
    ] as ColumnItemKind[]),
  }),
]);

/** Every kind in menu order: ADD_ITEM_GROUPS flattened. */
export const ADD_ITEM_KINDS: readonly ColumnItemKind[] = Object.freeze(
  ADD_ITEM_GROUPS.flatMap((g) => g.kinds),
);

export const SPACER_LABELS = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
} as const;

// ---------------------------------------------------------------------------
// Layout change (CONT-07, D77)
// ---------------------------------------------------------------------------

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The info notice after a layout shrinks from `fromCount` to `toCount` columns
 * (UI-SPEC "Layout shrink notice"); null when nothing shrank.
 */
export function shrinkNotice(
  fromCount: number,
  toCount: number,
): string | null {
  if (!(fromCount > toCount) || toCount < 1) return null;
  const moved: string[] = [];
  for (let n = toCount + 1; n <= fromCount; n += 1) moved.push(String(n));
  const subject =
    moved.length === 1 ? `Column ${moved[0]}` : `Columns ${joinList(moved)}`;
  return `${subject}'s items moved to the end of column ${toCount}.`;
}

/**
 * Apply a new row layout to stored columns: normalizeColumns (surplus items merge onto
 * the last kept column, padded columns get fresh ids), plus the notice to show. The
 * notice names only surplus columns that actually held items, so shrinking away empty
 * columns stays silent.
 */
export function applyLayoutChange(
  content: ColumnsContent,
  newLayout: RowLayout,
): { content: ColumnsContent; notice: string | null } {
  const count = columnCountFor(newLayout);
  const stored = Array.isArray(content?.columns) ? content.columns : [];
  let lastWithItems = 0;
  stored.forEach((col, i) => {
    if (i >= count && Array.isArray(col?.items) && col.items.length > 0) {
      lastWithItems = i + 1;
    }
  });
  return {
    content: normalizeColumns(content, newLayout),
    notice: lastWithItems > count ? shrinkNotice(lastWithItems, count) : null,
  };
}

// ---------------------------------------------------------------------------
// Time: datetime-local <-> UTC ISO (Pitfall 8, T-03-31)
// ---------------------------------------------------------------------------

interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of instant `ms` in `timeZone`, or in the runtime zone when omitted. */
function wallParts(ms: number, timeZone?: string): WallParts {
  if (!timeZone) {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }
  const out: Record<string, number> = {};
  for (const p of zoneFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
  };
}

function wallAsUtc(p: WallParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** How far `timeZone`'s wall clock is ahead of UTC at instant `ms`, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(wallParts(whole, timeZone)) - whole;
}

/** The runtime's IANA zone ("America/Chicago" in the owner's browser). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * A datetime-local value ("2026-10-12T09:00", read as wall time in `timeZone`, default
 * the browser's) to a UTC ISO instant; "" when empty or not a real date.
 */
export function localInputToUtcIso(value: string, timeZone?: string): string {
  const m = typeof value === "string" ? LOCAL_INPUT.exec(value.trim()) : null;
  if (!m) return "";
  const wall: WallParts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
  };
  const guess = wallAsUtc(wall);
  // Reject rollovers like 2026-02-31 or 25:00.
  const check = new Date(guess);
  if (
    !Number.isFinite(guess) ||
    check.getUTCMonth() + 1 !== wall.month ||
    check.getUTCDate() !== wall.day ||
    check.getUTCHours() !== wall.hour ||
    check.getUTCMinutes() !== wall.minute
  ) {
    return "";
  }

  let ms: number;
  if (!timeZone) {
    ms = new Date(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    ).getTime();
  } else {
    // Two passes settle the offset across a DST boundary.
    const first = zoneOffset(guess, timeZone);
    ms = guess - first;
    const second = zoneOffset(ms, timeZone);
    if (second !== first) ms = guess - second;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A UTC ISO instant to a datetime-local value in `timeZone` (default the browser's). */
export function utcIsoToLocalInput(iso: string, timeZone?: string): string {
  const ms = typeof iso === "string" && iso !== "" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const p = wallParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "12 Oct, 9:00 am" in `timeZone` (default the browser's); "" when invalid. */
export function formatShortInZone(iso: string, timeZone?: string): string {
  const ms = typeof iso === "string" && iso !== "" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const p = wallParts(ms, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}, ${hour12}:${pad(p.minute)} ${p.hour < 12 ? "am" : "pm"}`;
}

// ---------------------------------------------------------------------------
// Item summaries (UI-SPEC "ColumnsEditor" item 4)
// ---------------------------------------------------------------------------

const SUMMARY_MAX = 40;

function quoted(text: string): string {
  const t = text.trim();
  return `"${t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX)}…` : t}"`;
}

function detail(item: ColumnItem, timeZone?: string): string | null {
  switch (item.kind) {
    case "heading":
      return item.text.trim() ? quoted(item.text) : "Empty";
    case "text": {
      const plain = htmlToPlainText(item.html);
      return plain ? quoted(plain) : "Empty";
    }
    case "list": {
      const n = item.items.filter((s) => s.trim() !== "").length;
      return n === 0 ? "Empty" : `${n} ${n === 1 ? "item" : "items"}`;
    }
    case "image":
      if (item.alt.trim()) return quoted(item.alt);
      if (item.asset) return "Photo from your media";
      if (item.url.trim()) {
        const tail = item.url.split("/").pop() || item.url;
        return quoted(tail);
      }
      return "No image yet";
    case "video":
    case "audio":
    case "embed":
      return item.title.trim() ? quoted(item.title) : "No title yet";
    case "form":
      return item.form_id.trim() ? "Chosen" : "No form yet";
    case "button":
      return item.text.trim() ? quoted(item.text) : "No label yet";
    case "countdown":
      return formatShortInZone(item.target_at, timeZone) || "No date yet";
    case "spacer":
      return SPACER_LABELS[item.height] ?? SPACER_LABELS.md;
    case "divider":
      return null;
  }
}

/** One scannable line per item: `Heading · "Meet Dana"`, `Countdown · 12 Oct, 9:00 am`. */
export function itemSummary(item: ColumnItem, timeZone?: string): string {
  const label = KIND_LABELS[item.kind] ?? "Item";
  const d = detail(item, timeZone);
  return d === null ? label : `${label} · ${d}`;
}

// ---------------------------------------------------------------------------
// List operations (ItemListEditor, Undo delete). Inputs are never mutated.
// ---------------------------------------------------------------------------

/** Move one entry; out-of-range moves return the same array (no-op). */
export function moveInList<T>(
  list: readonly T[],
  from: number,
  to: number,
): T[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list as T[];
  }
  if (from === to) return list as T[];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function removeItemAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Insert at `index`, clamped to 0..length (Undo re-inserts where the item was). */
export function insertItemAt<T>(
  list: readonly T[],
  index: number,
  item: T,
): T[] {
  const at = Math.min(
    Math.max(Number.isInteger(index) ? index : list.length, 0),
    list.length,
  );
  const next = [...list];
  next.splice(at, 0, item);
  return next;
}

/** Replace the item with the same id, wherever it sits in the stored columns. */
export function replaceItemInColumns(
  content: ColumnsContent,
  item: ColumnItem,
): ColumnsContent {
  return {
    columns: content.columns.map((col) => ({
      id: col.id,
      items: col.items.map((i) => (i.id === item.id ? item : i)),
    })),
  };
}

/** List item text area: one item per line, blank lines dropped. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function listToLines(items: readonly string[]): string {
  return items.join("\n");
}

// ---------------------------------------------------------------------------
// Drag planning for items across stored columns (CONT-05; T-03-30)
// ---------------------------------------------------------------------------

const COLUMN_DROP_PREFIX = "column-drop:";

/** The droppable id of a column's item area (lets an item land in an empty column). */
export function columnDropId(columnId: string): string {
  return `${COLUMN_DROP_PREFIX}${columnId}`;
}

function locateItem(
  content: ColumnsContent,
  itemId: string,
): { columnId: string; index: number } | null {
  for (const col of content.columns) {
    const index = col.items.findIndex((i) => i.id === itemId);
    if (index !== -1) return { columnId: col.id, index };
  }
  return null;
}

/**
 * Where a dragged item lands: over another item takes that item's position, over a
 * column's drop area appends. Works on stored column ids, never the resolved view.
 */
export function planItemDrop(
  content: ColumnsContent,
  activeId: string,
  overId: string | null | undefined,
): MoveItemInput | null {
  if (!overId || overId === activeId) return null;
  const from = locateItem(content, activeId);
  if (!from) return null;
  if (overId.startsWith(COLUMN_DROP_PREFIX)) {
    const columnId = overId.slice(COLUMN_DROP_PREFIX.length);
    const target = content.columns.find((c) => c.id === columnId);
    if (!target) return null;
    const toIndex =
      target.id === from.columnId
        ? target.items.length - 1
        : target.items.length;
    if (target.id === from.columnId && toIndex === from.index) return null;
    return {
      fromColumnId: from.columnId,
      fromIndex: from.index,
      toColumnId: columnId,
      toIndex,
    };
  }
  const to = locateItem(content, overId);
  if (!to) return null;
  return {
    fromColumnId: from.columnId,
    fromIndex: from.index,
    toColumnId: to.columnId,
    toIndex: to.index,
  };
}

// ---------------------------------------------------------------------------
// Instant field errors for ColumnItemForm. The server re-validates everything (03-06);
// these checks only put the right message under the right field.
// ---------------------------------------------------------------------------

/** Validator messages that belong under the link field of a video, audio or embed item. */
const LINK_ERRORS: ReadonlySet<string> = new Set([
  LINK_NOT_ALLOWED_COPY,
  AUDIO_NOT_ALLOWED_COPY,
  EMBED_NOT_ALLOWED_COPY,
  VIDEO_SOURCE_COPY,
  AUDIO_SOURCE_COPY,
  EMBED_LINK_EMPTY_COPY,
]);

const ALT_COPY =
  "Add a short description of the image for people who can't see it.";
const ZERO_COPY =
  'Write what visitors see when the countdown ends, like "Doors are open."';
const TARGET_COPY = "Choose the date and time the countdown ends.";
const POPUP_COPY = "Choose which pop-up this button opens.";
const NO_POPUP_COPY = "Buttons here can open links only, not pop-ups.";

function messageOf(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "Check this item and try again.";
}

/** Field name -> message; `form` holds anything not tied to one field. Empty = valid. */
export function itemFieldErrors(
  item: ColumnItem,
  opts: ColumnItemOptions,
): Record<string, string> {
  const errors: Record<string, string> = {};
  switch (item.kind) {
    case "image":
      try {
        safeImageUrl(item.url);
      } catch (err) {
        errors.url = messageOf(err);
      }
      if (
        (item.url.trim() !== "" || (item.asset ?? "") !== "") &&
        item.alt.trim() === ""
      )
        errors.alt = ALT_COPY;
      break;
    case "video":
    case "audio": {
      if (item.title.trim() === "") {
        errors.title =
          item.kind === "video" ? VIDEO_TITLE_COPY : AUDIO_TITLE_COPY;
      }
      if (item.asset === "" && item.provider === "") {
        errors.link =
          item.kind === "video" ? VIDEO_SOURCE_COPY : AUDIO_SOURCE_COPY;
      }
      break;
    }
    case "embed":
      if (item.title.trim() === "") errors.title = EMBED_TITLE_COPY;
      if (item.provider === "") errors.link = EMBED_LINK_EMPTY_COPY;
      break;
    case "form":
      if (item.form_id.trim() === "") errors.form_id = FORM_ITEM_COPY;
      break;
    case "button":
      if (item.action === "popup") {
        if (!opts.allowPopupButton) errors.action = NO_POPUP_COPY;
        else if (item.popup_id.trim() === "") errors.popup_id = POPUP_COPY;
      } else {
        try {
          safeHref(item.link);
        } catch (err) {
          errors.link = messageOf(err);
        }
      }
      break;
    case "countdown":
      if (!Number.isFinite(Date.parse(item.target_at))) {
        errors.target_at = TARGET_COPY;
      }
      if (item.zero_message.trim() === "") errors.zero_message = ZERO_COPY;
      break;
    default:
      break;
  }
  if (Object.keys(errors).length === 0) {
    try {
      validateColumnItem(item, opts);
    } catch (err) {
      const message = messageOf(err);
      if (LINK_ERRORS.has(message)) errors.link = message;
      else if (message === FORM_ITEM_COPY) errors.form_id = message;
      else errors.form = message;
    }
  }
  return errors;
}
