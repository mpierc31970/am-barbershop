"use client";
// One column's item list (03-08; CONT-05, CONT-09..12; 03-UI-SPEC "ColumnsEditor" items
// 4-6, "Accessibility contract", "Motion contract"; donor ColumnsEditor.tsx L156-293).
//
// ColumnItemRows is the shared list body: sortable rows (drag handle + visible Move
// up/down as the non-drag path, WCAG 2.5.7), accordion editing (one form open at a time),
// Delete item, Add item and the empty-column state. It holds no DndContext, so
// ColumnsEditor can put every column's rows in one context and move items across columns.
// ItemListEditor wraps it in its own context for the one-column editors (pop-ups).
//
// Components take callbacks and never touch data access; the route wires onChange to a
// Server Action. Delete is immediate with an 8s Undo toast (UI-SPEC "Destructive actions").
import { useState, useId, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  newColumnItem,
  type ColumnItem,
  type ColumnItemKind,
} from "@cds/core/content";
import { Button } from "../hub/Button";
import { IconButton } from "../hub/IconButton";
import { liftClasses, useReducedMotion } from "../hub/motion";
import { useToast } from "../hub/Toast";
import { ColumnItemForm, type PopupOption } from "./ColumnItemForm";
import { useOptimisticCommits } from "./optimistic";
import type { FormOption } from "./items/types";
import {
  ADD_ITEM_GROUPS,
  DRAG_INSTRUCTIONS,
  KIND_LABELS,
  announce,
  columnDropId,
  insertItemAt,
  itemSummary,
  moveInList,
  removeItemAt,
} from "./editor-logic";

const ERR_REORDER =
  "That move didn't save, so the block went back to where it was. Try again.";

// Reduced motion and the lifted-row look live in hub/motion (shared with RecordList).
export { liftClasses, useReducedMotion };

/**
 * One-list collisions: the item rows only. The list's own column-drop area wraps every
 * row and its centre sits mid-list, so letting it compete made a drop near the middle
 * resolve to the container and land at the end (WR-C03). The area counts only when the
 * list has no rows, the same rule ColumnsEditor uses per column.
 */
export const itemListCollision: CollisionDetection = (args) => {
  const items = args.droppableContainers.filter(
    (c) => c.data.current?.type === "item",
  );
  return items.length > 0
    ? closestCenter({ ...args, droppableContainers: items })
    : closestCenter(args);
};

// Keyboard moves step between item rows only, for the same reason.
const itemListKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const all = args.context.droppableContainers;
  const filtered = {
    getEnabled: () =>
      all.getEnabled().filter((c) => c.data.current?.type === "item"),
    get: (id: UniqueIdentifier | null | undefined) => all.get(id),
  } as unknown as typeof all;
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: filtered },
  });
};

export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: itemListKeyboardCoordinates,
    }),
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  item: ColumnItem;
  index: number;
  count: number;
  columnId: string;
  expanded: boolean;
  timeZone?: string;
  onToggle: () => void;
  onMove: (to: number) => void;
  onDelete: () => void;
  children?: ReactNode;
}

function SortableItemRow({
  item,
  index,
  count,
  columnId,
  expanded,
  timeZone,
  onToggle,
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
    id: item.id,
    data: { type: "item", columnId },
    transition: reduced ? null : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const kind = KIND_LABELS[item.kind];
  const summary = itemSummary(item, timeZone);
  const panelId = `item-panel-${item.id}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-item-id={item.id}
      className={`rounded border border-hub-border bg-hub-surface ${liftClasses(isDragging)}`}
    >
      <div className="flex min-h-12 items-center gap-1 px-1">
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder ${kind} item`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-10 min-w-0 flex-1 items-center rounded px-2 text-left text-base text-hub-ink hover:bg-hub-surface-2"
        >
          <span className="truncate">{summary}</span>
        </button>
        <IconButton
          size="sm"
          label={`Move ${kind} item up`}
          icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === 0 || undefined}
          onClick={() => onMove(index - 1)}
        />
        <IconButton
          size="sm"
          label={`Move ${kind} item down`}
          icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === count - 1 || undefined}
          onClick={() => onMove(index + 1)}
        />
        <IconButton
          size="sm"
          label={`Delete ${kind} item`}
          icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
          onClick={onDelete}
          className="hover:text-hub-danger"
        />
      </div>
      {expanded ? <div id={panelId}>{children}</div> : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add item menu (inline disclosure: no floating layer to position or trap)
// ---------------------------------------------------------------------------

function AddItemMenu({
  label,
  onPick,
}: {
  label: string;
  onPick: (kind: ColumnItemKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        icon={<Plus aria-hidden size={16} strokeWidth={2} />}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="self-start"
      >
        Add item
      </Button>
      {open ? (
        <div
          id={menuId}
          role="group"
          aria-label="Item types"
          className="grid grid-cols-1 gap-3 rounded border border-hub-border bg-hub-surface p-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          {ADD_ITEM_GROUPS.map((group, g) => (
            <div
              key={group.label}
              role="group"
              aria-labelledby={`${menuId}-g${g}`}
              className="flex flex-col gap-1"
            >
              <p
                id={`${menuId}-g${g}`}
                className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-hub-ink-muted"
              >
                {group.label}
              </p>
              <ul className="flex flex-col gap-1">
                {group.kinds.map((kind) => (
                  <li key={kind}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onPick(kind);
                      }}
                      className="flex min-h-10 w-full items-center rounded px-3 text-left text-sm text-hub-ink hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                    >
                      {KIND_LABELS[kind]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared list body
// ---------------------------------------------------------------------------

export interface ColumnItemRowsProps {
  columnId: string;
  /** "Column 2", used to name the Add item button's target. */
  columnLabel?: string;
  items: readonly ColumnItem[];
  popups: readonly PopupOption[];
  /** The site's forms for Form items (07-18 supplies them). */
  forms?: readonly FormOption[];
  allowPopupButton: boolean;
  timeZone?: string;
  /** The one open form across the editor (accordion). */
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  /** A new, unsaved item in this column, shown open at the end until saved. */
  draft: ColumnItem | null;
  onAddDraft: (item: ColumnItem) => void;
  onDiscardDraft: () => void;
  onSaveItem: (item: ColumnItem, isNew: boolean) => Promise<void>;
  onMoveItem: (from: number, to: number) => void;
  onDeleteItem: (index: number) => void;
  /** An open item form (keyed by item id, or "new:<id>" for a draft) gained/lost edits. */
  onFormDirty?: (key: string, dirty: boolean) => void;
  /** An open item form's "save now", or null when it closes. */
  onFormSave?: (key: string, save: (() => Promise<boolean>) | null) => void;
}

export function ColumnItemRows({
  columnId,
  columnLabel,
  items,
  popups,
  forms,
  allowPopupButton,
  timeZone,
  expandedId,
  setExpandedId,
  draft,
  onAddDraft,
  onDiscardDraft,
  onSaveItem,
  onMoveItem,
  onDeleteItem,
  onFormDirty,
  onFormSave,
}: ColumnItemRowsProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnDropId(columnId),
    data: { type: "column-drop", columnId },
  });
  const addLabel = columnLabel ? `Add item to ${columnLabel}` : "Add item";
  const pick = (kind: ColumnItemKind) => onAddDraft(newColumnItem(kind));
  const empty = items.length === 0 && !draft;

  return (
    <div ref={setNodeRef} className="flex flex-col gap-2">
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((item, index) => (
              <SortableItemRow
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                columnId={columnId}
                timeZone={timeZone}
                expanded={expandedId === item.id}
                onToggle={() =>
                  setExpandedId(expandedId === item.id ? null : item.id)
                }
                onMove={(to) => onMoveItem(index, to)}
                onDelete={() => onDeleteItem(index)}
              >
                {/* Keyed by id, never by content: the optimistic save changes the item
                    while the form awaits it, and a content key would remount the form,
                    dropping the owner's typing and its save error (CR-C01). */}
                <ColumnItemForm
                  key={item.id}
                  item={item}
                  popups={popups}
                  forms={forms}
                  allowPopupButton={allowPopupButton}
                  timeZone={timeZone}
                  onSave={(next) => onSaveItem(next, false)}
                  onCancel={() => setExpandedId(null)}
                  onDirtyChange={(d) => onFormDirty?.(item.id, d)}
                  registerSave={(fn) => onFormSave?.(item.id, fn)}
                />
              </SortableItemRow>
            ))}
          </ul>
        ) : null}
      </SortableContext>

      {draft ? (
        <div className="rounded border border-hub-accent bg-hub-surface">
          <p className="px-4 pt-3 text-sm font-semibold text-hub-ink">
            New {KIND_LABELS[draft.kind].toLowerCase()} item
          </p>
          <ColumnItemForm
            item={draft}
            popups={popups}
            forms={forms}
            allowPopupButton={allowPopupButton}
            timeZone={timeZone}
            onSave={(next) => onSaveItem(next, true)}
            onCancel={onDiscardDraft}
            onDirtyChange={(d) => onFormDirty?.(`new:${draft.id}`, d)}
            registerSave={(fn) => onFormSave?.(`new:${draft.id}`, fn)}
          />
        </div>
      ) : null}

      {empty ? (
        <div
          className={
            "flex min-h-24 flex-col items-center justify-center gap-2 rounded border border-dashed " +
            "border-hub-border-strong bg-hub-surface-2 p-4 text-center " +
            (isOver ? "outline-2 outline-hub-accent" : "")
          }
        >
          <p className="text-sm text-hub-ink-muted">Empty column</p>
          <AddItemMenu label={addLabel} onPick={pick} />
        </div>
      ) : draft ? null : (
        <AddItemMenu label={addLabel} onPick={pick} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-column editor (pop-ups reuse it)
// ---------------------------------------------------------------------------

export interface ItemListEditorProps {
  items: readonly ColumnItem[];
  popups: readonly PopupOption[];
  /** The site's forms for Form items (07-18 supplies them). */
  forms?: readonly FormOption[];
  allowPopupButton: boolean;
  onChange: (items: ColumnItem[]) => Promise<void>;
  timeZone?: string;
}

const LIST_ID = "item-list";

export function ItemListEditor({
  items,
  popups,
  forms,
  allowPopupButton,
  onChange,
  timeZone,
}: ItemListEditorProps) {
  const toast = useToast();
  const sensors = useDndSensors();
  // Optimistic view: a move shows at once and snaps back if the save fails. The shared
  // tracker orders overlapping commits (WR-C01; see optimistic.ts).
  const { value: view, tracker } = useOptimisticCommits(items as ColumnItem[]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ColumnItem | null>(null);

  function commit(
    next: ColumnItem[],
    failure: string | null = ERR_REORDER,
  ): Promise<void> {
    return tracker.commit(next, onChange, () => {
      if (failure) toast.show({ message: failure });
    });
  }

  const quiet = (p: Promise<void>) => void p.catch(() => {});

  function move(from: number, to: number) {
    const next = moveInList(tracker.latest, from, to);
    if (next !== tracker.latest) quiet(commit(next));
  }

  function remove(index: number) {
    const item = tracker.latest[index];
    if (!item) return;
    if (expandedId === item.id) setExpandedId(null);
    // Undo only after the delete is saved; never restore an id already in the list
    // (CR-C02: a failed delete plus Undo used to write a duplicate item id).
    commit(
      removeItemAt(tracker.latest, index),
      "That item wasn't deleted. Try again.",
    )
      .then(() =>
        toast.show({
          message: `${KIND_LABELS[item.kind]} deleted.`,
          action: {
            label: "Undo",
            onClick: () => {
              if (tracker.latest.some((i) => i.id === item.id)) return;
              quiet(
                commit(
                  insertItemAt(tracker.latest, index, item),
                  "Undo didn't save. Try again.",
                ),
              );
            },
          },
        }),
      )
      .catch(() => {});
  }

  async function save(item: ColumnItem, isNew: boolean) {
    const next = isNew
      ? [...tracker.latest, item]
      : tracker.latest.map((i) => (i.id === item.id ? item : i));
    // The form shows its own save error; no toast here.
    await commit(next, null);
    if (isNew) setDraft(null);
    setExpandedId(null);
  }

  const label = (id: unknown) => {
    const item = tracker.latest.find((i) => i.id === id);
    return item ? `${KIND_LABELS[item.kind]} item` : "Item";
  };
  const pos = (id: unknown) => tracker.latest.findIndex((i) => i.id === id) + 1;
  const total = () => tracker.latest.length;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      announce.pickUp(label(active.id), pos(active.id), total()),
    onDragOver: ({ active, over }) =>
      over && over.id !== columnDropId(LIST_ID)
        ? announce.over(label(active.id), pos(over.id), total())
        : undefined,
    onDragEnd: ({ active, over }) =>
      announce.drop(
        label(active.id),
        over && over.id !== columnDropId(LIST_ID)
          ? pos(over.id)
          : pos(active.id),
        total(),
      ),
    onDragCancel: ({ active }) =>
      announce.cancel(label(active.id), pos(active.id)),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = tracker.latest.findIndex((i) => i.id === active.id);
    const to =
      over.id === columnDropId(LIST_ID)
        ? tracker.latest.length - 1
        : tracker.latest.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;
    move(from, to);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={itemListCollision}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
      }}
    >
      <ColumnItemRows
        columnId={LIST_ID}
        items={view}
        popups={popups}
        forms={forms}
        allowPopupButton={allowPopupButton}
        timeZone={timeZone}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
        draft={draft}
        onAddDraft={(item) => {
          setDraft(item);
          setExpandedId(null);
        }}
        onDiscardDraft={() => setDraft(null)}
        onSaveItem={save}
        onMoveItem={move}
        onDeleteItem={remove}
      />
    </DndContext>
  );
}
