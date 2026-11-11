"use client";
// Columns block editor (03-08; CONT-05, CONT-06, CONT-07, D75, D76, D77; CONT-10, CONT-12;
// 03-UI-SPEC "ColumnsEditor" items 1-8, "Accessibility contract", "Motion contract";
// CONTEXT A4-Q2, A4-Q3; donor ColumnsEditor.tsx).
//
// Layout belongs to the container (invariant 6), so the layout never moves with content:
// - Column reorder moves stored columns by id (moveColumn) between fixed width slots.
// - Flip widths swaps the layout's widths (flipLayout) and leaves content where it is.
// - A layout change persists normalizeColumns(stored, newLayout) via applyLayoutChange and
//   shows the shrink notice; nothing is lost (T-03-30).
// resolveColumns is used only to DRAW columns. Every edit starts from the stored columns;
// when stored and layout disagree (an older row) the editor first normalizes, so merged
// surplus items are written back rather than silently dropped.
//
// Reorder, flip and layout changes call onChange immediately (donor save-immediately
// model) with an optimistic view that snaps back, with a toast, if the save fails.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useId,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
} from "lucide-react";
import {
  ALL_LAYOUTS,
  canFlip,
  columnCountFor,
  flipLayout,
  moveColumn,
  moveItem,
  normalizeColumns,
  resolveColumns,
  type ColumnItem,
  type ColumnsContent,
  type RowLayout,
} from "@cds/core/content";
import { Button } from "../hub/Button";
import { IconButton } from "../hub/IconButton";
import { InlineAlert } from "../hub/feedback";
import { LayoutThumb, layoutName, layoutRatios } from "../hub/LayoutThumb";
import { useToast } from "../hub/Toast";
import type { PopupOption } from "./ColumnItemForm";
import type { FormOption } from "./items/types";
import { useOptimisticCommits } from "./optimistic";
import {
  ColumnItemRows,
  liftClasses,
  useReducedMotion,
} from "./ItemListEditor";
import {
  DRAG_INSTRUCTIONS,
  KIND_LABELS,
  announce,
  applyLayoutChange,
  insertItemAt,
  planItemDrop,
  replaceItemInColumns,
} from "./editor-logic";

export interface ColumnsEditorProps {
  layout: RowLayout;
  content: ColumnsContent;
  popups: readonly PopupOption[];
  /** The site's forms for Form items (07-18 supplies them through SectionForm). */
  forms?: readonly FormOption[];
  onChange: (next: {
    layout: RowLayout;
    content: ColumnsContent;
  }) => Promise<void>;
  /** IANA zone for countdown items; defaults to the browser's. */
  timeZone?: string;
  /** Lets the block form read the editor's live value (SectionForm, WR-C02). */
  handleRef?: MutableRefObject<ColumnsEditorHandle | null>;
  /**
   * True while an open item form (or a new-item draft) holds unsaved edits, so the
   * block's leave guard and Save block count them (WR-C10).
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * 07-20: the editor sits inside a slide or tab panel whose changes only land in the
   * block draft (Save block persists them), so the "Saved" flash never shows.
   */
  draftOnly?: boolean;
}

interface EditorValue {
  layout: RowLayout;
  content: ColumnsContent;
}

export interface ColumnsEditorHandle {
  /**
   * The newest layout and content, including commits still being saved. Save block sends
   * this, never its own older copy, so it cannot revert a column change in flight.
   */
  latest: () => EditorValue;
  /** Save every open item form with edits; resolves false if one did not save. */
  flush: () => Promise<boolean>;
  /** Close every item form and new-item draft, dropping their edits. */
  discard: () => void;
}

const ERR_REORDER =
  "That move didn't save, so the block went back to where it was. Try again.";
const ERR_LAYOUT = "That layout change didn't save. Try again.";
const FLIP_HELPER =
  "The wide and narrow sides swap. Your content stays where it is.";
const SAVED_MS = 3000;

const columnLabel = (index: number) => `Column ${index + 1}`;

type DragType = "column" | "item" | "column-drop";
const typeOf = (data: { current?: Record<string, unknown> | null }) =>
  data.current?.type as DragType | undefined;

// Columns collide only with columns; items with items, or with an empty column's area.
const collisionDetection: CollisionDetection = (args) => {
  const only = (types: DragType[]) =>
    args.droppableContainers.filter((c) => {
      const t = typeOf(c.data);
      return t !== undefined && types.includes(t);
    });
  if (typeOf(args.active.data) === "column") {
    return closestCenter({ ...args, droppableContainers: only(["column"]) });
  }
  const areas = only(["column-drop"]);
  const hits = args.pointerCoordinates
    ? pointerWithin({ ...args, droppableContainers: areas })
    : rectIntersection({ ...args, droppableContainers: areas });
  const items = only(["item"]);
  const hit = hits[0];
  if (hit) {
    const columnId = areas.find((a) => a.id === hit.id)?.data.current?.columnId;
    const inColumn = items.filter((c) => c.data.current?.columnId === columnId);
    if (inColumn.length === 0) return [hit];
    return closestCenter({ ...args, droppableContainers: inColumn });
  }
  return closestCenter({ ...args, droppableContainers: items });
};

// Keyboard moves consider only targets of the dragged thing's own kind.
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { context } = args;
  const activeType = context.active ? typeOf(context.active.data) : undefined;
  const allowed: DragType[] =
    activeType === "column" ? ["column"] : ["item", "column-drop"];
  const all = context.droppableContainers;
  const filtered = {
    getEnabled: () =>
      all.getEnabled().filter((c) => {
        const t = typeOf(c.data);
        return t !== undefined && allowed.includes(t);
      }),
    get: (id: UniqueIdentifier | null | undefined) => all.get(id),
  } as unknown as typeof all;
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...context, droppableContainers: filtered },
  });
};

// ---------------------------------------------------------------------------
// Layout picker: a radiogroup of the 12 LayoutThumbs
// ---------------------------------------------------------------------------

function LayoutPicker({
  value,
  onSelect,
}: {
  value: RowLayout;
  onSelect: (layout: RowLayout) => void;
}) {
  const labelId = `${useId()}-layout`;
  const selectedIndex = Math.max(ALL_LAYOUTS.indexOf(value), 0);
  const [focusIndex, setFocusIndex] = useState(selectedIndex);
  useEffect(() => setFocusIndex(selectedIndex), [selectedIndex]);

  // Arrow keys move focus through the thumbs; Space/Enter (or a click) applies one.
  // Applying is immediate and a shrink merges columns, so arrowing past a layout must
  // not apply it (recorded in 03-08-SUMMARY).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = ALL_LAYOUTS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = focusIndex === last ? 0 : focusIndex + 1;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = focusIndex === 0 ? last : focusIndex - 1;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [next]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-semibold text-hub-ink">
        Layout
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {ALL_LAYOUTS.map((layout, i) => {
          const selected = layout === value;
          return (
            <button
              key={layout}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={i === focusIndex ? 0 : -1}
              onFocus={() => setFocusIndex(i)}
              onClick={() => {
                if (!selected) onSelect(layout);
              }}
              className={
                "flex min-h-11 min-w-16 flex-col items-center rounded border p-2 " +
                "transition-colors duration-150 hover:bg-hub-surface-2 " +
                (selected
                  ? "border-hub-accent bg-hub-accent-tint"
                  : "border-hub-border bg-hub-surface")
              }
            >
              <LayoutThumb
                layout={layout}
                selected={selected}
                label={layoutName(layout)}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One sortable column
// ---------------------------------------------------------------------------

interface ColumnViewProps {
  id: string;
  index: number;
  count: number;
  ratio: number;
  onMove: (to: number) => void;
  children: ReactNode;
}

function SortableColumn({
  id,
  index,
  count,
  ratio,
  onMove,
  children,
}: ColumnViewProps) {
  const reduced = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: "column" },
    transition: reduced ? null : undefined,
  });
  const label = columnLabel(index);
  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
    "--col-grow": ratio,
  } as CSSProperties;
  const movable = count > 1;

  return (
    <section
      ref={setNodeRef}
      style={style}
      aria-label={label}
      className={
        "flex min-w-0 flex-col gap-2 rounded border border-hub-border bg-hub-surface-2 p-2 " +
        "lg:min-w-40 lg:flex-[var(--col-grow)_1_160px] " +
        liftClasses(isDragging)
      }
    >
      <header className="flex items-center gap-1">
        {movable ? (
          <IconButton
            {...attributes}
            {...listeners}
            size="sm"
            tooltipAlign="start"
            label={`Reorder ${label}`}
            icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
            className="cursor-grab touch-none active:cursor-grabbing"
          />
        ) : null}
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-hub-ink">
          {label}
        </h4>
        {movable ? (
          <>
            <span className="hidden gap-1 lg:flex">
              <IconButton
                size="sm"
                label={`Move ${label} left`}
                icon={<ChevronLeft aria-hidden size={16} strokeWidth={2} />}
                aria-disabled={index === 0 || undefined}
                onClick={() => onMove(index - 1)}
              />
              <IconButton
                size="sm"
                label={`Move ${label} right`}
                icon={<ChevronRight aria-hidden size={16} strokeWidth={2} />}
                aria-disabled={index === count - 1 || undefined}
                onClick={() => onMove(index + 1)}
              />
            </span>
            <span className="flex gap-1 lg:hidden">
              <IconButton
                size="sm"
                label={`Move ${label} up`}
                icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
                aria-disabled={index === 0 || undefined}
                onClick={() => onMove(index - 1)}
              />
              <IconButton
                size="sm"
                label={`Move ${label} down`}
                icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
                aria-disabled={index === count - 1 || undefined}
                onClick={() => onMove(index + 1)}
              />
            </span>
          </>
        ) : null}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function ColumnsEditor({
  layout,
  content,
  popups,
  forms,
  onChange,
  timeZone,
  handleRef,
  onDirtyChange,
  draftOnly = false,
}: ColumnsEditorProps) {
  const toast = useToast();
  // PointerSensor waits 8px so clicks on row buttons never start a drag; KeyboardSensor
  // uses the kind-filtered coordinates above (WCAG 2.5.7 keeps Move buttons as well).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const flipHelperId = `${useId()}-flip`;

  // Stored columns, normalized only when they disagree with the layout's count.
  const count = columnCountFor(layout);
  const stored = useMemo(
    () =>
      Array.isArray(content?.columns) && content.columns.length === count
        ? content
        : normalizeColumns(content, layout),
    [content, layout, count],
  );

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  function flashSaved() {
    if (draftOnly) return;
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS);
  }

  // Optimistic view shared with ItemListEditor (optimistic.ts): overlapping commits are
  // ordered, a superseded failure never rolls back a change a newer commit saved, and a
  // failure reverts to the last confirmed value, not the props (WR-C01).
  const base = useMemo<EditorValue>(
    () => ({ layout, content: stored }),
    [layout, stored],
  );
  const { value, tracker } = useOptimisticCommits(base, flashSaved);

  // Open item forms with unsaved edits (WR-C10), and each open form's "save now".
  const dirtyForms = useRef(new Set<string>());
  const formSaves = useRef(new Map<string, () => Promise<boolean>>());
  const [formsDirty, setFormsDirty] = useState(false);
  function onFormDirty(key: string, dirty: boolean) {
    if (dirty) dirtyForms.current.add(key);
    else dirtyForms.current.delete(key);
    setFormsDirty(dirtyForms.current.size > 0);
  }
  function onFormSave(key: string, save: (() => Promise<boolean>) | null) {
    if (save) formSaves.current.set(key, save);
    else formSaves.current.delete(key);
  }
  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
  });
  useEffect(() => {
    onDirtyRef.current?.(formsDirty);
  }, [formsDirty]);
  useEffect(
    () => () => {
      onDirtyRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      latest: () => tracker.latest,
      flush: async () => {
        for (const key of [...dirtyForms.current]) {
          const save = formSaves.current.get(key);
          if (save && !(await save())) return false;
        }
        return true;
      },
      discard: () => {
        setExpandedId(null);
        setDraft(null);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, tracker]);

  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    columnId: string;
    item: ColumnItem;
  } | null>(null);

  function commit(next: EditorValue, failure: string | null): Promise<void> {
    return tracker.commit(next, onChange, () => {
      if (failure) toast.show({ message: failure });
    });
  }
  const quiet = (p: Promise<void>) => void p.catch(() => {});

  // (1) Layout: normalize stored columns for the new layout, then show the notice.
  function selectLayout(nextLayout: RowLayout) {
    const cur = tracker.latest;
    const { content: next, notice: n } = applyLayoutChange(
      cur.content,
      nextLayout,
    );
    setNotice(n);
    quiet(commit({ layout: nextLayout, content: next }, ERR_LAYOUT));
  }

  // (2) Flip widths: layout only; content is passed through untouched.
  function flip() {
    const cur = tracker.latest;
    setNotice(null);
    quiet(
      commit(
        { layout: flipLayout(cur.layout), content: cur.content },
        ERR_LAYOUT,
      ),
    );
  }

  // (3) Column reorder, on stored columns by index of id.
  function moveColumnTo(from: number, to: number) {
    const cur = tracker.latest;
    if (to < 0 || to >= cur.content.columns.length || from === to) return;
    quiet(
      commit(
        { layout: cur.layout, content: moveColumn(cur.content, from, to) },
        ERR_REORDER,
      ),
    );
  }

  function moveItemWithin(columnId: string, from: number, to: number) {
    const cur = tracker.latest;
    const column = cur.content.columns.find((c) => c.id === columnId);
    if (!column || to < 0 || to >= column.items.length || from === to) return;
    quiet(
      commit(
        {
          layout: cur.layout,
          content: moveItem(cur.content, {
            fromColumnId: columnId,
            fromIndex: from,
            toColumnId: columnId,
            toIndex: to,
          }),
        },
        ERR_REORDER,
      ),
    );
  }

  function deleteItem(columnId: string, index: number) {
    const cur = tracker.latest;
    const column = cur.content.columns.find((c) => c.id === columnId);
    const item = column?.items[index];
    if (!item) return;
    if (expandedId === item.id) setExpandedId(null);
    const content: ColumnsContent = {
      columns: cur.content.columns.map((c) =>
        c.id === columnId
          ? { id: c.id, items: c.items.filter((_, i) => i !== index) }
          : c,
      ),
    };
    // Undo is offered only once the delete is saved: after a failed delete the item is
    // back in the list, and an Undo would insert a second copy with the same id (CR-C02).
    commit(
      { layout: cur.layout, content },
      "That item wasn't deleted. Try again.",
    )
      .then(() =>
        toast.show({
          message: `${KIND_LABELS[item.kind]} deleted.`,
          action: {
            label: "Undo",
            onClick: () => restoreItem(columnId, index, item),
          },
        }),
      )
      .catch(() => {});
  }

  function restoreItem(columnId: string, index: number, item: ColumnItem) {
    const cur = tracker.latest;
    const cols = cur.content.columns;
    // Never restore an item that is already there (a duplicate id breaks every edit).
    if (cols.some((c) => c.items.some((i) => i.id === item.id))) return;
    // The column may be gone after a layout change: restore onto the last column.
    const target = cols.find((c) => c.id === columnId) ?? cols[cols.length - 1];
    if (!target) return;
    const content: ColumnsContent = {
      columns: cols.map((c) =>
        c.id === target.id
          ? { id: c.id, items: insertItemAt(c.items, index, item) }
          : c,
      ),
    };
    quiet(
      commit({ layout: cur.layout, content }, "Undo didn't save. Try again."),
    );
  }

  async function saveItem(columnId: string, item: ColumnItem, isNew: boolean) {
    const cur = tracker.latest;
    const content: ColumnsContent = isNew
      ? {
          columns: cur.content.columns.map((c) =>
            c.id === columnId ? { id: c.id, items: [...c.items, item] } : c,
          ),
        }
      : replaceItemInColumns(cur.content, item);
    // The item form shows its own save error, so no toast here.
    await commit({ layout: cur.layout, content }, null);
    if (isNew) setDraft(null);
    setExpandedId(null);
  }

  // (4) Drag end: columns by stored index, items via planItemDrop (within and across).
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const cur = tracker.latest;
    if (typeOf(active.data) === "column") {
      const ids = cur.content.columns.map((c) => c.id);
      moveColumnTo(
        ids.indexOf(String(active.id)),
        ids.indexOf(String(over.id)),
      );
      return;
    }
    const plan = planItemDrop(cur.content, String(active.id), String(over.id));
    if (!plan) return;
    quiet(
      commit(
        { layout: cur.layout, content: moveItem(cur.content, plan) },
        ERR_REORDER,
      ),
    );
  }

  const describe = (id: UniqueIdentifier) => {
    const cols = tracker.latest.content.columns;
    const colIndex = cols.findIndex((c) => c.id === id);
    if (colIndex !== -1) {
      return {
        label: columnLabel(colIndex),
        pos: colIndex + 1,
        total: cols.length,
      };
    }
    for (const col of cols) {
      const i = col.items.findIndex((it) => it.id === id);
      if (i !== -1) {
        return {
          label: `${KIND_LABELS[col.items[i]!.kind]} item`,
          pos: i + 1,
          total: col.items.length,
        };
      }
    }
    return null;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const a = describe(active.id);
      return a ? announce.pickUp(a.label, a.pos, a.total) : undefined;
    },
    onDragOver: ({ active, over }) => {
      const a = describe(active.id);
      const o = over ? describe(over.id) : null;
      return a && o ? announce.over(a.label, o.pos, o.total) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const a = describe(active.id);
      if (!a) return undefined;
      const o = over ? describe(over.id) : null;
      return announce.drop(a.label, (o ?? a).pos, (o ?? a).total);
    },
    onDragCancel: ({ active }) => {
      const a = describe(active.id);
      return a ? announce.cancel(a.label, a.pos) : undefined;
    },
  };

  // Drawing only: resolveColumns never feeds an edit.
  const drawn = resolveColumns(value.content, value.layout);
  const ratios = layoutRatios(value.layout);

  return (
    <div className="flex flex-col gap-6 font-hub">
      <div className="flex flex-col gap-4">
        <LayoutPicker value={value.layout} onSelect={selectLayout} />
        {canFlip(value.layout) ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="secondary"
              icon={<ArrowLeftRight aria-hidden size={16} strokeWidth={2} />}
              onClick={flip}
              aria-describedby={flipHelperId}
            >
              Flip widths
            </Button>
            <p id={flipHelperId} className="text-sm text-hub-ink-muted">
              {FLIP_HELPER}
            </p>
          </div>
        ) : null}
        {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
        }}
      >
        <SortableContext
          items={drawn.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap">
            {drawn.map((column, index) => (
              <SortableColumn
                key={column.id}
                id={column.id}
                index={index}
                count={drawn.length}
                ratio={ratios[index] ?? 1}
                onMove={(to) => moveColumnTo(index, to)}
              >
                <ColumnItemRows
                  columnId={column.id}
                  columnLabel={columnLabel(index)}
                  items={column.items}
                  popups={popups}
                  forms={forms}
                  allowPopupButton
                  timeZone={timeZone}
                  expandedId={expandedId}
                  setExpandedId={(id) => {
                    setExpandedId(id);
                    if (id !== null) setDraft(null);
                  }}
                  draft={draft?.columnId === column.id ? draft.item : null}
                  onAddDraft={(item) => {
                    setExpandedId(null);
                    setDraft({ columnId: column.id, item });
                  }}
                  onDiscardDraft={() => setDraft(null)}
                  onSaveItem={(item, isNew) => saveItem(column.id, item, isNew)}
                  onMoveItem={(from, to) => moveItemWithin(column.id, from, to)}
                  onDeleteItem={(i) => deleteItem(column.id, i)}
                  onFormDirty={onFormDirty}
                  onFormSave={onFormSave}
                />
              </SortableColumn>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <p role="status" className="min-h-5 text-sm text-hub-ink-muted">
        {saved ? (
          <span className="inline-flex items-center gap-1">
            <Check aria-hidden size={16} strokeWidth={2} />
            Saved
          </span>
        ) : null}
      </p>
    </div>
  );
}
