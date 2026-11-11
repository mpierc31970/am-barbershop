"use client";
// Shared list-of-panels editor for slides and tab panels (07-20; CONT-23, CONT-27, D229;
// 07-UI-SPEC rows "Slider" / "Tabs", line 587 Duplicate slide, line 664 Undo copy; D311
// admin pattern; invariant 6: each panel is a columns row edited by the stock
// ColumnsEditor, so slides get the full Add item menu with no wiring of their own).
//
// Rows (56px): drag grip (dnd-kit, keyboard sensor too), the title button that opens the
// panel, optional extra (the tab label field), Move up / Move down (WCAG 2.5.7, with a
// polite announcement) and a "More actions" disclosure holding Duplicate and Delete.
// Delete is immediate with an 8 s Undo toast (draft until Save block). One panel is open
// at a time (decision 10): switching first flushes the open item form and stays put if it
// does not validate. Every change is draft-only (decision 9): ColumnsEditor runs with
// draftOnly, its commits land in the block draft, and Save block persists the block.
// latestRef is updated synchronously before every onPanelsChange, so the handle's
// latest() never lags a state update (WR-C02 analog). Limits here are UX only; the 07-06
// validator stays the authority. Hub tokens and hub primitives only.
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
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { ColumnsContent, RowLayout, SliderSlide } from "@cds/core/content";
import { Button } from "../../hub/Button";
import { IconButton } from "../../hub/IconButton";
import { useToast } from "../../hub/Toast";
import type { PopupOption } from "../ColumnItemForm";
import { ColumnsEditor, type ColumnsEditorHandle } from "../ColumnsEditor";
import { DRAG_INSTRUCTIONS, announce, moveInList } from "../editor-logic";
import {
  itemListCollision,
  liftClasses,
  useDndSensors,
  useReducedMotion,
} from "../ItemListEditor";
import type { CoreBlockEditorHandle } from "./types";

/** A slide or tab panel: a columns row (core PanelRow; SliderSlide is its alias). */
export type PanelRowValue = SliderSlide;

export interface PanelListEditorProps<P extends PanelRowValue> {
  panels: readonly P[];
  noun: "slide" | "tab";
  max: number;
  min: number;
  /** Helper under a disabled Add button. */
  overCopy: string;
  /** Helper beside a disabled Delete action. */
  minCopy: string;
  /** Row title, e.g. "Slide 2 · Spring menu" or the tab label. */
  rowTitle: (panel: P, index: number) => string;
  /** Short name for toasts and announcements, e.g. "Slide 2" or the tab label. */
  nameOf: (panel: P, index: number) => string;
  /** Extra row content (the tab label field); `update` writes through the panel list. */
  renderRowExtra?: (
    panel: P,
    index: number,
    update: (patch: Partial<P>) => void,
  ) => ReactNode;
  onPanelsChange: (next: P[]) => void;
  /** Duplicate one panel; null when not allowed. Slides only. */
  duplicate?: (panels: readonly P[], panelId: string) => P[] | null;
  newPanel: (index: number) => P;
  popups: readonly PopupOption[];
  timeZone?: string;
  onDirtyChange?: (dirty: boolean) => void;
  handleRef?: MutableRefObject<CoreBlockEditorHandle | null>;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PanelListEditor<P extends PanelRowValue>({
  panels,
  noun,
  max,
  min,
  overCopy,
  minCopy,
  rowTitle,
  nameOf,
  renderRowExtra,
  onPanelsChange,
  duplicate,
  newPanel,
  popups,
  timeZone,
  onDirtyChange,
  handleRef,
}: PanelListEditorProps<P>) {
  const toast = useToast();
  const sensors = useDndSensors();
  const uid = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const columnsHandle = useRef<ColumnsEditorHandle | null>(null);

  // Newest panels, ahead of any re-render (synchronously set before onPanelsChange).
  const latestRef = useRef<readonly P[]>(panels);
  const propsRef = useRef<readonly P[]>(panels);
  useEffect(() => {
    latestRef.current = panels;
    propsRef.current = panels;
  }, [panels]);

  const key = noun === "slide" ? "slides" : "tabs";

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      flush: async () => (await columnsHandle.current?.flush()) ?? true,
      discard: () => {
        columnsHandle.current?.discard();
        latestRef.current = propsRef.current;
      },
      latest: () => ({ [key]: [...latestRef.current] }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, key]);

  function emit(next: P[]) {
    latestRef.current = next;
    onPanelsChange(next);
  }

  /** Open or close a panel; the open item form is saved first (decision 10). */
  async function openPanel(id: string | null): Promise<boolean> {
    if (openId !== null && openId !== id) {
      const ok = (await columnsHandle.current?.flush()) ?? true;
      if (!ok) return false;
    }
    setOpenId(id);
    return true;
  }

  /** Patch one panel against the newest list (label edits). */
  function updatePanel(id: string, patch: Partial<P>) {
    emit(latestRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function move(from: number, to: number) {
    const list = latestRef.current;
    const next = moveInList(list, from, to);
    if (next === list) return;
    const name = nameOf(list[from], from);
    emit(next);
    setLive(`${name} moved to position ${to + 1}.`);
  }

  function remove(index: number) {
    const list = latestRef.current;
    const panel = list[index];
    if (!panel || list.length <= min) return;
    const name = nameOf(panel, index);
    if (openId === panel.id) setOpenId(null);
    emit(list.filter((p) => p.id !== panel.id));
    toast.show({
      message: `${name} removed.`,
      action: {
        label: "Undo",
        onClick: () => {
          const cur = latestRef.current;
          if (cur.some((p) => p.id === panel.id) || cur.length >= max) return;
          const at = Math.min(index, cur.length);
          emit([...cur.slice(0, at), panel, ...cur.slice(at)]);
        },
      },
    });
  }

  async function dup(panelId: string) {
    if (!duplicate) return;
    // Copy what the owner sees: save the open panel's item form first (decision 10).
    if (openId === panelId) {
      const ok = (await columnsHandle.current?.flush()) ?? true;
      if (!ok) return;
    }
    const next = duplicate(latestRef.current, panelId);
    if (next && next.length > latestRef.current.length) emit(next);
  }

  async function add() {
    if (latestRef.current.length >= max) return;
    if (!(await openPanel(null))) return;
    // Read after the flush: it may have emitted the open panel's item edit.
    const list = latestRef.current;
    if (list.length >= max) return;
    const p = newPanel(list.length);
    emit([...list, p]);
    setOpenId(p.id);
  }

  const openPanelValue = panels.find((p) => p.id === openId) ?? null;
  const openContent = useMemo<ColumnsContent | null>(
    () => (openPanelValue ? { columns: openPanelValue.columns } : null),
    [openPanelValue],
  );

  async function onColumnsChange(
    panelId: string,
    next: { layout: RowLayout; content: ColumnsContent },
  ): Promise<void> {
    emit(
      latestRef.current.map((p) =>
        p.id === panelId
          ? { ...p, row_layout: next.layout, columns: next.content.columns }
          : p,
      ),
    );
  }

  const label = (id: unknown) => {
    const i = latestRef.current.findIndex((p) => p.id === id);
    return i >= 0 ? nameOf(latestRef.current[i], i) : cap(noun);
  };
  const pos = (id: unknown) =>
    latestRef.current.findIndex((p) => p.id === id) + 1;
  const total = () => latestRef.current.length;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      announce.pickUp(label(active.id), pos(active.id), total()),
    onDragOver: ({ active, over }) =>
      over ? announce.over(label(active.id), pos(over.id), total()) : undefined,
    onDragEnd: ({ active, over }) =>
      announce.drop(
        label(active.id),
        over ? pos(over.id) : pos(active.id),
        total(),
      ),
    onDragCancel: ({ active }) =>
      announce.cancel(label(active.id), pos(active.id)),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const list = latestRef.current;
    const from = list.findIndex((p) => p.id === active.id);
    const to = list.findIndex((p) => p.id === over.id);
    if (from === -1 || to === -1) return;
    move(from, to);
  }

  const atMax = panels.length >= max;
  const addHelperId = `${uid}-add-helper`;

  return (
    <div className="flex flex-col gap-3 font-hub">
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
          items={panels.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col overflow-hidden rounded border border-hub-border">
            {panels.map((panel, index) => (
              <SortablePanelRow
                key={panel.id}
                id={panel.id}
                noun={noun}
                index={index}
                count={panels.length}
                title={rowTitle(panel, index)}
                open={openId === panel.id}
                panelRegionId={`${uid}-panel-${panel.id}`}
                extra={renderRowExtra?.(panel, index, (patch) =>
                  updatePanel(panel.id, patch),
                )}
                canDelete={panels.length > min}
                minCopy={minCopy}
                canDuplicate={duplicate ? !atMax : null}
                onToggle={() =>
                  void openPanel(openId === panel.id ? null : panel.id)
                }
                onMove={(dir) => move(index, index + dir)}
                onDuplicate={() => void dup(panel.id)}
                onDelete={() => remove(index)}
              >
                {openId === panel.id && openContent ? (
                  <ColumnsEditor
                    layout={panel.row_layout}
                    content={openContent}
                    popups={popups}
                    timeZone={timeZone}
                    draftOnly
                    handleRef={columnsHandle}
                    onDirtyChange={onDirtyChange}
                    onChange={(next) => onColumnsChange(panel.id, next)}
                  />
                ) : null}
              </SortablePanelRow>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="secondary"
          disabled={atMax}
          aria-describedby={atMax ? addHelperId : undefined}
          onClick={() => void add()}
        >
          <Plus aria-hidden size={16} strokeWidth={2} />
          {`Add ${noun}`}
        </Button>
        {atMax ? (
          <p id={addHelperId} className="text-sm text-hub-ink-muted">
            {overCopy}
          </p>
        ) : null}
      </div>
      <p role="status" className="sr-only">
        {live}
      </p>
    </div>
  );
}

interface RowProps {
  id: string;
  noun: "slide" | "tab";
  index: number;
  count: number;
  title: string;
  open: boolean;
  panelRegionId: string;
  extra?: ReactNode;
  canDelete: boolean;
  minCopy: string;
  /** null = no Duplicate action (tabs). */
  canDuplicate: boolean | null;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  children?: ReactNode;
}

function SortablePanelRow({
  id,
  noun,
  index,
  count,
  title,
  open,
  panelRegionId,
  extra,
  canDelete,
  minCopy,
  canDuplicate,
  onToggle,
  onMove,
  onDuplicate,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const minId = useId();
  const Noun = cap(noun);

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-panel-row={id}
      className={
        "border-b border-hub-border bg-hub-surface last:border-b-0 " +
        liftClasses(isDragging)
      }
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          e.stopPropagation();
          setMenuOpen(false);
        }
      }}
    >
      <div className="flex min-h-14 items-center gap-2 px-4">
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder ${title}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="-ml-2 cursor-grab touch-none active:cursor-grabbing"
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelRegionId}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center rounded px-1 text-left"
        >
          <span
            className={`truncate text-base font-semibold ${open ? "text-hub-accent" : "text-hub-ink"}`}
          >
            {title}
          </span>
        </button>
        <IconButton
          size="sm"
          label={`Move ${title} up`}
          icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          label={`Move ${title} down`}
          icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        />
        <IconButton
          size="sm"
          label={`More actions for ${title}`}
          tooltipAlign="end"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          icon={<MoreHorizontal aria-hidden size={16} strokeWidth={2} />}
          onClick={() => setMenuOpen((o) => !o)}
        />
      </div>
      {menuOpen ? (
        <ul
          id={menuId}
          aria-label={`Actions for ${title}`}
          className="mx-4 mb-2 flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
        >
          {canDuplicate !== null ? (
            <li>
              <button
                type="button"
                className={MENU_ITEM}
                disabled={!canDuplicate}
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
              >
                <Copy aria-hidden size={16} strokeWidth={2} />
                {`Duplicate ${noun}`}
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
              disabled={!canDelete}
              aria-describedby={canDelete ? undefined : minId}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 aria-hidden size={16} strokeWidth={2} />
              {`Delete ${noun}`}
            </button>
            {canDelete ? null : (
              <p id={minId} className="px-3 pb-1 text-sm text-hub-ink-muted">
                {minCopy}
              </p>
            )}
          </li>
        </ul>
      ) : null}
      {extra ? <div className="px-4 pb-3">{extra}</div> : null}
      <div
        id={panelRegionId}
        role="region"
        aria-label={`${Noun} ${index + 1} content`}
        hidden={!open}
        className="border-t border-hub-border bg-hub-surface-2 p-4"
      >
        {children}
      </div>
    </li>
  );
}
