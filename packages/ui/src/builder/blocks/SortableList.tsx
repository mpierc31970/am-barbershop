"use client";
// Shared sortable item list for block editors (07-21; CONT-27; 07-UI-SPEC line 664 Undo copy,
// line 686 "drag-sort everywhere keeps the P3 keyboard sensor + Move buttons + announcements";
// D311 admin pattern). Used by the FAQ, icon list and stats editors; reusable by 07-22's logo
// and gallery lists (props frozen: change them only together with the three 07-21 editors).
//
// Each row is a card: a grip handle (dnd-kit, pointer + keyboard sensors from ItemListEditor),
// the row label, Move up / Move down IconButtons named for the row (the WCAG 2.5.7 non-drag
// path, with a polite announcement) and Delete (ghost, danger hover). Below the bar the row's
// own fields render through renderItem. Delete is immediate and pushes "<Noun> removed." with
// an Undo action for UNDO_TOAST_MS; Undo calls onRestore(item, index) (draft until Save block).
// The list is controlled: it never holds the items itself. Hub tokens and primitives only.
import {
  DndContext,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Button } from "../../hub/Button";
import { IconButton } from "../../hub/IconButton";
import { UNDO_TOAST_MS, useToast } from "../../hub/Toast";
import { DRAG_INSTRUCTIONS, announce, moveInList } from "../editor-logic";
import {
  itemListCollision,
  liftClasses,
  useDndSensors,
  useReducedMotion,
} from "../ItemListEditor";

export interface SortableListProps<T extends { id: string }> {
  items: readonly T[];
  /** Singular noun for toasts, e.g. "Question". */
  noun: string;
  /** Row label, e.g. "Question 2" (names the Move and Delete buttons). */
  label: (item: T, index: number) => string;
  onReorder: (next: T[]) => void;
  onRemove: (index: number) => void;
  /** Undo of a Delete: put `item` back at `index`. */
  onRestore: (item: T, index: number) => void;
  /** False hides Delete's effect (minimum reached); default true. */
  canRemove?: boolean;
  /** Shown beside a soft-disabled Delete when canRemove is false. */
  minCopy?: string;
  renderItem: (item: T, index: number) => ReactNode;
}

/**
 * The newest value of `value`, readable from event handlers and toast actions that outlive
 * the render they were created in (Undo after a later edit).
 */
export function useLatest<V>(value: V): MutableRefObject<V> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Put `item` back at `index` (clamped); unchanged when it is already in the list. */
export function reinsertItem<T extends { id: string }>(
  list: readonly T[],
  item: T,
  index: number,
): T[] {
  if (list.some((x) => x.id === item.id)) return [...list];
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

export function SortableList<T extends { id: string }>({
  items,
  noun,
  label,
  onReorder,
  onRemove,
  onRestore,
  canRemove = true,
  minCopy,
  renderItem,
}: SortableListProps<T>) {
  const sensors = useDndSensors();
  const toast = useToast();
  const [live, setLive] = useState("");
  const latest = useLatest(items);

  function move(from: number, to: number) {
    const list = latest.current;
    const next = moveInList(list, from, to);
    if (next === list || to < 0 || to >= list.length) return;
    const name = label(list[from]!, from);
    latest.current = next;
    onReorder(next);
    setLive(`${name} moved to position ${to + 1}.`);
  }

  function remove(index: number) {
    const list = latest.current;
    const item = list[index];
    if (!item || !canRemove) return;
    onRemove(index);
    toast.show({
      message: `${noun} removed.`,
      action: { label: "Undo", onClick: () => onRestore(item, index) },
      durationMs: UNDO_TOAST_MS,
    });
  }

  const nameOf = (id: unknown) => {
    const i = latest.current.findIndex((x) => x.id === id);
    return i >= 0 ? label(latest.current[i]!, i) : noun;
  };
  const pos = (id: unknown) => latest.current.findIndex((x) => x.id === id) + 1;
  const total = () => latest.current.length;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      announce.pickUp(nameOf(active.id), pos(active.id), total()),
    onDragOver: ({ active, over }) =>
      over
        ? announce.over(nameOf(active.id), pos(over.id), total())
        : undefined,
    onDragEnd: ({ active, over }) =>
      announce.drop(
        nameOf(active.id),
        over ? pos(over.id) : pos(active.id),
        total(),
      ),
    onDragCancel: ({ active }) =>
      announce.cancel(nameOf(active.id), pos(active.id)),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const list = latest.current;
    const from = list.findIndex((x) => x.id === active.id);
    const to = list.findIndex((x) => x.id === over.id);
    if (from === -1 || to === -1) return;
    move(from, to);
  }

  return (
    <div className="flex flex-col gap-2 font-hub">
      <DndContext
        sensors={sensors}
        collisionDetection={itemListCollision}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
        }}
      >
        <SortableContext
          items={items.map((x) => x.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col gap-3">
            {items.map((item, index) => (
              <SortableRow
                key={item.id}
                id={item.id}
                title={label(item, index)}
                index={index}
                count={items.length}
                canRemove={canRemove}
                minCopy={minCopy}
                onMove={(dir) => move(index, index + dir)}
                onDelete={() => remove(index)}
              >
                {renderItem(item, index)}
              </SortableRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </p>
    </div>
  );
}

interface RowProps {
  id: string;
  title: string;
  index: number;
  count: number;
  canRemove: boolean;
  minCopy?: string;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  children: ReactNode;
}

function SortableRow({
  id,
  title,
  index,
  count,
  canRemove,
  minCopy,
  onMove,
  onDelete,
  children,
}: RowProps) {
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
    data: { type: "item" },
    transition: reduced ? null : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-sortable-row={id}
      className={`rounded border border-hub-border bg-hub-surface ${liftClasses(isDragging)}`}
    >
      <div className="flex min-h-12 items-center gap-1 border-b border-hub-border px-2">
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder ${title}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-hub-ink">
          {title}
        </span>
        <IconButton
          size="sm"
          label={`Move ${title} up`}
          icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === 0 || undefined}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          label={`Move ${title} down`}
          icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === count - 1 || undefined}
          onClick={() => onMove(1)}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete ${title}`}
          aria-disabled={!canRemove || undefined}
          title={!canRemove ? minCopy : undefined}
          icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
          onClick={canRemove ? onDelete : undefined}
          className="hover:text-hub-danger aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          Delete
        </Button>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </li>
  );
}
