"use client";
// Sortable record list for every list add-on (05-06; 05-UI-SPEC "Add-on tabs" item 4,
// "Credentials tab" grouped list, "Accessibility contract"; WCAG 2.5.7; D-UI-P5-17).
// Pattern: builder/SectionsList.tsx (dnd-kit, KeyboardSensor + sortableKeyboardCoordinates,
// optimistic reorder through the shared OptimisticCommits tracker, owner-word announcements).
//
// Props-driven: the panel owns the records and the Server Action. Every move (drag,
// keyboard drag, Move up / Move down from the row's own menu) goes through one path:
// optimistic arrayMove, then onReorder(ids). A false (or rejected) result snaps the list
// back; the caller shows the toast. Rows render through renderRow; the list supplies the
// drag handle ("Reorder <noun> <label>") and a move handle for the row's overflow menu.
//
// Grouped (groupOf set): one 40px header row per group ("Licenses · 3"), first-seen order,
// records with an empty group under "Other" (last). Each group is its own SortableContext,
// so a drag over another group's rows shows no drop indicator and changes nothing, and the
// announcement explains it: "Can't move RN License into Memberships. Change its group
// instead." Move up / Move down stop at group edges.
//
// Label convention: label(item) completes "<noun> <label>", e.g. noun "testimonial" +
// label "from Maria Lopez", or noun "credential" + label "RN License".
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DRAG_INSTRUCTIONS, announce } from "../builder/editor-logic";
import { liftClasses, useReducedMotion } from "./motion";
import { useOptimisticCommits } from "../builder/optimistic";
import { IconButton } from "./IconButton";

export const OTHER_GROUP = "Other";

/** What a row gets to wire its Move up / Move down menu items. */
export interface RecordMoveHandle {
  moveUp: () => void;
  moveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface RecordListProps<T extends { id: string }> {
  items: readonly T[];
  /** Completes "<noun> <label>": "from Maria Lopez", "RN License". */
  label: (item: T) => string;
  renderRow: (item: T, handle: RecordMoveHandle) => ReactNode;
  /** Save the new order; resolve false (or reject) when it did not save. */
  onReorder: (ids: string[]) => Promise<boolean>;
  /** Group name per record; empty goes under "Other". Unset = one flat list. */
  groupOf?: (item: T) => string;
  groupLabel?: (group: string, count: number) => string;
  /** Singular record noun, "testimonial". */
  noun: string;
  /** Accessible name of the list. Default "Your <noun>s". */
  listLabel?: string;
  /** View only (an Editor): no drag handle, no drag, and every move handle is off (C-WR-05). */
  readOnly?: boolean;
}

const SEP = "\u0000";

function groupName(raw: string | undefined): string {
  const g = (raw ?? "").trim();
  return g === "" ? OTHER_GROUP : g;
}

/**
 * Group-contiguous order: groups in first-seen order, "Other" last, records inside a
 * group in their given order. Without groups the order is unchanged.
 */
export function groupedOrder<T extends { id: string }>(
  items: readonly T[],
  groupOf?: (item: T) => string,
): T[] {
  if (!groupOf) return [...items];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const g = groupName(groupOf(item));
    const list = groups.get(g);
    if (list) list.push(item);
    else groups.set(g, [item]);
  }
  const other = groups.get(OTHER_GROUP);
  groups.delete(OTHER_GROUP);
  const out = [...groups.values()].flat();
  return other ? [...out, ...other] : out;
}

export type RecordMovePlan =
  | { kind: "none" }
  | { kind: "move"; next: string[] }
  | { kind: "refused"; group: string };

/**
 * Where a drop (or a Move up / down) lands. A move into another group is refused and
 * names the group; the list stays as it is.
 */
export function planRecordMove(
  ids: readonly string[],
  activeId: string,
  overId: string | null,
  groupOfId?: (id: string) => string | null,
): RecordMovePlan {
  if (overId === null || overId === activeId) return { kind: "none" };
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return { kind: "none" };
  if (groupOfId) {
    const a = groupOfId(activeId);
    const b = groupOfId(overId);
    if (a !== null && b !== null && a !== b)
      return { kind: "refused", group: b };
  }
  return { kind: "move", next: arrayMove([...ids], from, to) };
}

export function refusedMoveCopy(label: string, group: string): string {
  return `Can't move ${label} into ${group}. Change its group instead.`;
}

export interface RecordAnnouncementDeps {
  /** "<noun> <label>" for an id. */
  nameOf: (id: string) => string;
  /** Position and total (within the record's group when grouped). */
  positionOf: (id: string) => { pos: number; total: number };
  /** Record label alone (for the refusal line) and group per id, when grouped. */
  labelOf: (id: string) => string;
  groupOfId?: (id: string) => string | null;
}

/** dnd-kit announcements in owner words, naming the record (05-UI-SPEC a11y contract). */
export function recordAnnouncements(d: RecordAnnouncementDeps): Announcements {
  const refused = (active: UniqueIdentifier, over: UniqueIdentifier) => {
    if (!d.groupOfId) return null;
    const a = d.groupOfId(String(active));
    const b = d.groupOfId(String(over));
    return a !== null && b !== null && a !== b
      ? refusedMoveCopy(d.labelOf(String(active)), b)
      : null;
  };
  return {
    onDragStart: ({ active }) => {
      const { pos, total } = d.positionOf(String(active.id));
      return announce.pickUp(d.nameOf(String(active.id)), pos, total);
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const no = refused(active.id, over.id);
      if (no) return no;
      const { pos, total } = d.positionOf(String(over.id));
      return announce.over(d.nameOf(String(active.id)), pos, total);
    },
    onDragEnd: ({ active, over }) => {
      if (over) {
        const no = refused(active.id, over.id);
        if (no) return no;
      }
      const { pos, total } = d.positionOf(String(over ? over.id : active.id));
      return announce.drop(d.nameOf(String(active.id)), pos, total);
    },
    onDragCancel: ({ active }) => {
      const { pos } = d.positionOf(String(active.id));
      return announce.cancel(d.nameOf(String(active.id)), pos);
    },
  };
}

interface RowProps {
  id: string;
  name: string;
  readOnly: boolean;
  children: ReactNode;
}

function SortableRecordRow({ id, name, readOnly, children }: RowProps) {
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
    disabled: readOnly,
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
      data-record-id={id}
      className={
        "border-b border-hub-border bg-hub-surface transition-colors duration-150 " +
        liftClasses(isDragging)
      }
    >
      <div className="flex min-h-16 items-center gap-2 px-4">
        {readOnly ? null : (
          <IconButton
            {...attributes}
            {...listeners}
            size="sm"
            tooltipAlign="start"
            label={`Reorder ${name}`}
            icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
            className="-ml-2 cursor-grab touch-none active:cursor-grabbing"
          />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      </div>
    </li>
  );
}

export function RecordList<T extends { id: string }>({
  items,
  label,
  renderRow,
  onReorder,
  groupOf,
  groupLabel = (group, count) => `${group} · ${count}`,
  noun,
  listLabel,
  readOnly = false,
}: RecordListProps<T>) {
  const baseId = useId();
  // PointerSensor waits 8px so clicks on row controls never start a drag; KeyboardSensor
  // with sortableKeyboardCoordinates is the keyboard drag path.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ordered = groupedOrder(items, groupOf);
  // A stable base across renders: the joined ids, so a new items array with the same
  // order never resets an in-flight optimistic order.
  const key = ordered.map((i) => i.id).join(SEP);
  const baseIds = useMemo(() => (key === "" ? [] : key.split(SEP)), [key]);
  const { value: ids, tracker } = useOptimisticCommits(baseIds);

  const byId = new Map(items.map((i) => [i.id, i]));
  const listed = new Set(ids);
  const view: T[] = [
    ...ids.flatMap((id) => {
      const it = byId.get(id);
      return it ? [it] : [];
    }),
    // A record added while a reorder was in flight is not in the pending ids yet.
    ...ordered.filter((i) => !listed.has(i.id)),
  ];

  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });

  const groupOfItem = (item: T) => (groupOf ? groupName(groupOf(item)) : null);
  const find = (id: string) => latest.current.find((x) => x.id === id);
  const groupOfId = groupOf
    ? (id: string) => {
        const it = find(id);
        return it ? groupOfItem(it) : null;
      }
    : undefined;
  const peers = (id: string) => {
    const g = groupOfId ? groupOfId(id) : null;
    return g === null
      ? latest.current
      : latest.current.filter((x) => groupOfItem(x) === g);
  };

  const announcements = recordAnnouncements({
    nameOf: (id) => {
      const it = find(id);
      return it ? `${noun} ${label(it)}` : noun;
    },
    labelOf: (id) => {
      const it = find(id);
      return it ? label(it) : noun;
    },
    positionOf: (id) => {
      const list = peers(id);
      return {
        pos: list.findIndex((x) => x.id === id) + 1,
        total: list.length,
      };
    },
    groupOfId,
  });

  function commit(next: string[]) {
    latest.current = next.flatMap((id) => {
      const it = byId.get(id);
      return it ? [it] : [];
    });
    void tracker
      .commit(next, async (order) => {
        if (!(await onReorder(order))) throw new Error("reorder not saved");
      })
      .catch(() => {});
  }

  function move(activeId: string, overId: string | null) {
    if (readOnly) return;
    const plan = planRecordMove(
      latest.current.map((x) => x.id),
      activeId,
      overId,
      groupOfId,
    );
    if (plan.kind === "move") commit(plan.next);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    move(String(active.id), over ? String(over.id) : null);
  }

  function handleFor(index: number): RecordMoveHandle {
    const item = view[index]!;
    const prev = view[index - 1];
    const next = view[index + 1];
    const g = groupOfItem(item);
    const canMoveUp =
      !readOnly && prev !== undefined && groupOfItem(prev) === g;
    const canMoveDown =
      !readOnly && next !== undefined && groupOfItem(next) === g;
    return {
      canMoveUp,
      canMoveDown,
      moveUp: () => {
        if (canMoveUp) move(item.id, prev.id);
      },
      moveDown: () => {
        if (canMoveDown) move(item.id, next.id);
      },
    };
  }

  const rowsOf = (list: readonly T[], offset: number) =>
    list.map((item, i) => (
      <SortableRecordRow
        key={item.id}
        id={item.id}
        name={`${noun} ${label(item)}`}
        readOnly={readOnly}
      >
        {renderRow(item, handleFor(offset + i))}
      </SortableRecordRow>
    ));

  // Groups as runs of the (group-contiguous) view.
  const runs: { group: string; items: T[]; offset: number }[] = [];
  if (groupOf) {
    view.forEach((item, i) => {
      const g = groupOfItem(item) ?? OTHER_GROUP;
      const last = runs[runs.length - 1];
      if (last && last.group === g) last.items.push(item);
      else runs.push({ group: g, items: [item], offset: i });
    });
  }

  return (
    <div className="flex flex-col font-hub">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
        }}
      >
        {groupOf ? (
          runs.map((run, r) => {
            const headerId = `${baseId}-g${r}`;
            return (
              <div key={run.group} className="flex flex-col">
                <p
                  id={headerId}
                  data-group-header=""
                  className={
                    "flex h-10 items-center border-b border-hub-border bg-hub-surface-2 px-4 " +
                    "text-sm font-semibold text-hub-ink tabular-nums"
                  }
                >
                  {groupLabel(run.group, run.items.length)}
                </p>
                <SortableContext
                  items={run.items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol aria-labelledby={headerId} className="flex flex-col">
                    {rowsOf(run.items, run.offset)}
                  </ol>
                </SortableContext>
              </div>
            );
          })
        ) : (
          <SortableContext
            items={view.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol
              aria-label={listLabel ?? `Your ${noun}s`}
              className="flex flex-col"
            >
              {rowsOf(view, 0)}
            </ol>
          </SortableContext>
        )}
      </DndContext>
    </div>
  );
}
