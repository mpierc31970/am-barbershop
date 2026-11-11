"use client";
// CustomizeTodaySheet (11-19; DASH-22; 11-UI-SPEC "Today" § 5; WCAG 2.5.7). Right Drawer
// "Customize Today": one 56px row per card with a drag handle (dnd-kit pointer + keyboard
// sensors, the P3 announcements), the card name, a Show switch and Move up / Move down
// IconButtons (the non-drag path). Saves on every change through `onSave` (AutosaveStatus in
// the header); the Today page updates behind the sheet. A hidden card leaves the saved
// `order` and goes into `hidden`. Reset to default order saves an empty order (hidden cards
// stay hidden). Impersonating CDS staff see the sheet read-only with an info note: a person's
// layout is theirs alone (T-11-19-02; the action refuses too).
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
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  DRAG_INSTRUCTIONS,
  announce,
  moveInList,
} from "../../builder/editor-logic";
import { itemListCollision, useDndSensors } from "../../builder/ItemListEditor";
import type { HubActionResult } from "../addon-types";
import { AutosaveStatus } from "../AutosaveStatus";
import { Button } from "../Button";
import { Drawer } from "../Drawer";
import { InlineAlert } from "../feedback";
import { IconButton } from "../IconButton";
import { liftClasses, useReducedMotion } from "../motion";
import { Switch } from "../Switch";
import { useAutosave } from "../useAutosave";
import { TODAY_CARDS_COPY } from "./copy";

export type CustomizeCard = { id: string; title: string };
export type TodayLayout = { order: string[]; hidden: string[] };

export interface CustomizeTodaySheetProps {
  open: boolean;
  onClose: () => void;
  /** Every card the person may see, in their current order (shown first, then hidden). */
  cards: readonly CustomizeCard[];
  hidden: readonly string[];
  /** Card ids in the default order (path lead card, then manifest order). */
  defaultOrder: readonly string[];
  onSave: (layout: TodayLayout) => Promise<HubActionResult<unknown>>;
  /** After a save went through (the page re-renders behind the sheet). */
  onSaved?: (layout: TodayLayout) => void;
  impersonating?: boolean;
}

/** The layout a sheet state saves: visible ids in order, hidden ids apart. */
export function layoutOf(
  ids: readonly string[],
  hidden: ReadonlySet<string>,
): TodayLayout {
  return {
    order: ids.filter((id) => !hidden.has(id)),
    hidden: ids.filter((id) => hidden.has(id)),
  };
}

export function CustomizeTodaySheet(props: CustomizeTodaySheetProps) {
  const titleId = useId();
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      label={TODAY_CARDS_COPY.sheetTitle}
      side="right"
    >
      {props.open ? <SheetBody {...props} titleId={titleId} /> : null}
    </Drawer>
  );
}

function SheetBody({
  onClose,
  cards,
  hidden: hiddenIn,
  defaultOrder,
  onSave,
  onSaved,
  impersonating = false,
  titleId,
}: CustomizeTodaySheetProps & { titleId: string }) {
  const known = new Map(cards.map((c) => [c.id, c.title]));
  const [ids, setIds] = useState<string[]>(() => cards.map((c) => c.id));
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(hiddenIn.filter((id) => known.has(id))),
  );
  const [live, setLive] = useState("");
  const latest = useRef({ ids, hidden });
  useEffect(() => {
    latest.current = { ids, hidden };
  }, [ids, hidden]);
  const save = useAutosave<TodayLayout>(onSave, {
    onSaved: (_d, layout) => onSaved?.(layout),
  });
  const sensors = useDndSensors();
  const locked = impersonating;
  const nameOf = (id: unknown) =>
    typeof id === "string" ? (known.get(id) ?? id) : "";

  function commit(
    nextIds: string[],
    nextHidden: Set<string>,
    layout?: TodayLayout,
  ) {
    latest.current = { ids: nextIds, hidden: nextHidden };
    setIds(nextIds);
    setHidden(nextHidden);
    save.run(layout ?? layoutOf(nextIds, nextHidden));
  }

  function move(from: number, to: number) {
    if (locked) return;
    const list = latest.current.ids;
    if (to < 0 || to >= list.length) return;
    const next = moveInList(list, from, to);
    if (next === list) return;
    commit(next, latest.current.hidden);
    setLive(`${nameOf(list[from])} moved to position ${to + 1}.`);
  }

  function toggle(id: string, show: boolean) {
    if (locked) return;
    const next = new Set(latest.current.hidden);
    if (show) next.delete(id);
    else next.add(id);
    commit(latest.current.ids, next);
  }

  function reset() {
    if (locked) return;
    const order = [
      ...defaultOrder.filter((id) => known.has(id)),
      ...latest.current.ids.filter((id) => !defaultOrder.includes(id)),
    ];
    const h = latest.current.hidden;
    commit(order, h, { order: [], hidden: order.filter((id) => h.has(id)) });
    setLive(TODAY_CARDS_COPY.resetOrder);
  }

  const pos = (id: unknown) => latest.current.ids.indexOf(String(id)) + 1;
  const total = () => latest.current.ids.length;
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
    const list = latest.current.ids;
    const from = list.indexOf(String(active.id));
    const to = list.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    move(from, to);
  }

  return (
    <div className="flex h-full flex-col" data-customize-today="">
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          {TODAY_CARDS_COPY.sheetTitle}
        </h2>
        <div className="flex items-center gap-2">
          <AutosaveStatus state={save.status} onRetry={save.retry} />
          <IconButton
            label={TODAY_CARDS_COPY.close}
            tooltipAlign="end"
            onClick={onClose}
            icon={<X aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-6 py-6">
        <p className="text-sm text-hub-ink-muted">
          {TODAY_CARDS_COPY.sheetIntro}
        </p>
        {locked ? (
          <InlineAlert tone="info">
            {TODAY_CARDS_COPY.impersonating}
          </InlineAlert>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={itemListCollision}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol aria-labelledby={titleId} className="flex flex-col gap-2">
              {ids.map((id, index) => (
                <SheetRow
                  key={id}
                  id={id}
                  name={nameOf(id)}
                  index={index}
                  count={ids.length}
                  shown={!hidden.has(id)}
                  locked={locked}
                  onMove={(dir) => move(index, index + dir)}
                  onToggle={(on) => toggle(id, on)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {live}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hub-border px-6 py-4">
        <Button
          variant="ghost"
          onClick={reset}
          aria-disabled={locked || undefined}
        >
          {TODAY_CARDS_COPY.resetOrder}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {TODAY_CARDS_COPY.done}
        </Button>
      </div>
    </div>
  );
}

interface SheetRowProps {
  id: string;
  name: string;
  index: number;
  count: number;
  shown: boolean;
  locked: boolean;
  onMove: (dir: -1 | 1) => void;
  onToggle: (on: boolean) => void;
}

function SheetRow({
  id,
  name,
  index,
  count,
  shown,
  locked,
  onMove,
  onToggle,
}: SheetRowProps) {
  const reduced = useReducedMotion();
  const switchId = useId();
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
    disabled: locked,
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
      data-customize-row={id}
      data-shown={shown ? "true" : "false"}
      className={`flex min-h-14 items-center gap-1 rounded border border-hub-border bg-hub-surface px-2 ${liftClasses(isDragging)}`}
    >
      <IconButton
        {...attributes}
        {...listeners}
        size="sm"
        tooltipAlign="start"
        label={TODAY_CARDS_COPY.reorder(name)}
        aria-disabled={locked || undefined}
        icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
        className="cursor-grab touch-none active:cursor-grabbing"
      />
      <span className="min-w-0 flex-1 truncate px-1 text-base text-hub-ink">
        {name}
      </span>
      <Switch
        id={switchId}
        label="Show"
        aria-label={TODAY_CARDS_COPY.show(name)}
        checked={shown}
        disabled={locked}
        onChange={onToggle}
      />
      <IconButton
        size="sm"
        label={TODAY_CARDS_COPY.moveUp(name)}
        icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
        aria-disabled={locked || index === 0 || undefined}
        onClick={() => onMove(-1)}
      />
      <IconButton
        size="sm"
        tooltipAlign="end"
        label={TODAY_CARDS_COPY.moveDown(name)}
        icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
        aria-disabled={locked || index === count - 1 || undefined}
        onClick={() => onMove(1)}
      />
    </li>
  );
}
