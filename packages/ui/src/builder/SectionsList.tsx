"use client";
// Block list for the page builder (03-13; CONT-05, CONT-06; D183, D71, D119; 03-UI-SPEC
// "SectionsList row", "Accessibility contract", "Motion contract", ERR-REORDER; CONTEXT
// A2-Q3; donor admin/SectionsList.tsx L339-630).
//
// Props-driven: the route owns the rows and the Server Actions. Reorder is optimistic
// (arrayMove), then onReorder(ids) saves through one action; a false result snaps the
// list back and shows ERR-REORDER. Every move has a non-drag path (Move up / Move down)
// for WCAG 2.5.7, and dnd-kit announces pick-up, move, drop and cancel in owner words.
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
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
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
} from "react";
import { isRowLayout } from "@cds/core/content";
import { Badge } from "../hub/Badge";
import { Button } from "../hub/Button";
import { IconButton } from "../hub/IconButton";
import { LayoutThumb } from "../hub/LayoutThumb";
import { useToast } from "../hub/Toast";
import { liftClasses, useReducedMotion } from "./ItemListEditor";
import { DRAG_INSTRUCTIONS, announce } from "./editor-logic";
import { useOptimisticCommits } from "./optimistic";
import {
  ERR_REORDER_COPY,
  blockLabel,
  previewText,
  type BuilderSection,
  type LabelRegistry,
} from "./section-form-logic";

export interface SectionsListProps {
  sections: readonly BuilderSection[];
  selectedId: string | null;
  /** The block that renders the page h1 (D-UI-11), shown with an "H1" badge. */
  h1OwnerId: string | null;
  onSelect: (id: string) => void;
  /** Save the new order; resolve false (or reject) when it did not save. */
  onReorder: (ids: string[]) => Promise<boolean>;
  /**
   * Told after Move up / Move down is chosen. The list itself moves the row optimistically
   * and saves through onReorder (one save path for drag, keyboard and buttons).
   */
  onMove?: (id: string, dir: -1 | 1) => void;
  onToggleHidden: (id: string, hidden: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  /** Label lookup for add-on block types. */
  registry?: LabelRegistry;
  /**
   * Block types whose add-on is off (05-UI-SPEC "Builder integration"): the row keeps its
   * place, gains an "Add-on off" badge and dims; delete stays available.
   */
  offTypes?: ReadonlySet<string>;
  /**
   * 10-32 (BILL-03, D27): off block types whose add-on is paused by a billing lapse, mapped
   * to the add-on's name. Those rows say "Paused" with PAUSED-BLOCK instead of "Add-on off"
   * (owner-uninstalled add-ons keep "Add-on off"). Rendering rules are unchanged.
   */
  pausedTypes?: Readonly<Record<string, string>>;
  /**
   * 07-28 (CONT-36, UI-SPEC "Soft-delete in the builder"): section id -> "Uses a deleted
   * form" (or pop-up / media), computed on the server. The block keeps rendering.
   */
  deletedRefLabels?: Readonly<Record<string, string>>;
}

/**
 * PAUSED-BLOCK (10-32; 10-UI-SPEC "Paused add-ons"): "Testimonials is paused, so this block
 * doesn't show on your site. It comes back when payment does."
 */
export function pausedBlockCopy(name: string): string {
  return `${name} is paused, so this block doesn't show on your site. It comes back when payment does.`;
}

interface RowProps {
  section: BuilderSection;
  index: number;
  count: number;
  label: string;
  selected: boolean;
  ownsH1: boolean;
  addonOff: boolean;
  /** 10-32: the paused add-on's name when this off block is paused by a billing lapse. */
  pausedName?: string;
  deletedLabel?: string;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

function SortableBlockRow({
  section,
  index,
  count,
  label,
  selected,
  ownsH1,
  addonOff,
  pausedName,
  deletedLabel,
  onSelect,
  onMove,
  onToggleHidden,
  onDelete,
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
    id: section.id,
    transition: reduced ? null : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const hidden = !section.is_published;
  const preview = previewText(section);
  const blockName = `${label} block`;
  const layout = isRowLayout(section.row_layout) ? section.row_layout : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        "border-b border-hub-border transition-colors duration-150 " +
        (selected ? "bg-hub-accent-tint " : "bg-hub-surface-2 ") +
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
          label={`Reorder ${blockName}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="-ml-2 cursor-grab touch-none active:cursor-grabbing"
        />
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className={
            "flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded px-1 text-left " +
            (hidden || addonOff ? "opacity-60" : "")
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`truncate text-base font-semibold ${selected ? "text-hub-accent" : "text-hub-ink"}`}
            >
              {label}
            </span>
            {layout && section.section_type === "columns" ? (
              <LayoutThumb layout={layout} size="sm" selected={selected} />
            ) : null}
          </span>
          {preview ? (
            <span className="truncate text-sm text-hub-ink-muted">
              {preview}
            </span>
          ) : (
            <span className="text-sm text-hub-ink-muted">Empty</span>
          )}
          {addonOff && pausedName ? (
            <span className="text-sm text-hub-ink-muted" data-paused-block>
              {pausedBlockCopy(pausedName)}
            </span>
          ) : null}
          {deletedLabel ? (
            <span className="text-sm text-hub-ink-muted" data-deleted-ref>
              {deletedLabel}
            </span>
          ) : null}
        </button>
        {ownsH1 ? (
          <Badge tone="home">
            <span aria-hidden>H1</span>
            <span className="sr-only">Page heading (H1)</span>
          </Badge>
        ) : null}
        {addonOff ? (
          <Badge tone="addon-off">{pausedName ? "Paused" : "Add-on off"}</Badge>
        ) : null}
        {hidden ? <Badge tone="hidden">Hidden</Badge> : null}
        <span className="hidden items-center lg:inline-flex">
          <IconButton
            size="sm"
            label={`Move ${blockName} up`}
            icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
            aria-disabled={index === 0 || undefined}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            label={`Move ${blockName} down`}
            icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
            aria-disabled={index === count - 1 || undefined}
            onClick={() => onMove(1)}
          />
        </span>
        <IconButton
          size="sm"
          label={`More actions for ${blockName}`}
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
          aria-label={`Actions for ${blockName}`}
          className="mx-4 mb-2 flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
        >
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              disabled={index === 0}
              onClick={() => {
                setMenuOpen(false);
                onMove(-1);
              }}
            >
              <ChevronUp aria-hidden size={16} strokeWidth={2} />
              Move up
            </button>
          </li>
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              disabled={index === count - 1}
              onClick={() => {
                setMenuOpen(false);
                onMove(1);
              }}
            >
              <ChevronDown aria-hidden size={16} strokeWidth={2} />
              Move down
            </button>
          </li>
          <li>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                setMenuOpen(false);
                onToggleHidden();
              }}
            >
              {hidden ? (
                <Eye aria-hidden size={16} strokeWidth={2} />
              ) : (
                <EyeOff aria-hidden size={16} strokeWidth={2} />
              )}
              {hidden ? "Show block" : "Hide block"}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`${MENU_ITEM} text-hub-danger hover:bg-hub-danger-tint`}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 aria-hidden size={16} strokeWidth={2} />
              Delete block
            </button>
          </li>
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The fixed first row of a page without a Hero (07-UI-SPEC "Heading rules", D-UI-P7-13):
 * the site renders the page title as the H1 (PageTitleHeader) exactly when this shows.
 * It opens nothing: no button, no drag handle, no menu, not focusable. The title is edited
 * in the page header. Adding a Hero makes it disappear.
 */
export function PageTitleRow() {
  return (
    <li
      data-page-title-row=""
      className="flex min-h-14 flex-col justify-center gap-0.5 border-b border-hub-border bg-hub-surface px-4 py-2"
    >
      <span className="text-base font-semibold text-hub-ink">
        Page title · H1
      </span>
      <span className="text-sm text-hub-ink-muted">
        Shows your page title as the main heading, because this page has no
        Hero.
      </span>
    </li>
  );
}

export function SectionsList({
  sections,
  selectedId,
  h1OwnerId,
  onSelect,
  onReorder,
  onMove,
  onToggleHidden,
  onDelete,
  onAdd,
  registry,
  offTypes,
  pausedTypes,
  deletedRefLabels,
}: SectionsListProps) {
  const toast = useToast();
  // PointerSensor waits 8px so clicks on row buttons never start a drag; KeyboardSensor
  // with sortableKeyboardCoordinates is the keyboard drag path (UI-SPEC a11y contract).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Optimistic order: a local id list while a reorder is in flight; the props win again
  // once the parent passes a new list and nothing is in flight. The shared tracker
  // (optimistic.ts) orders overlapping reorders, so a superseded failure never snaps the
  // list back over an order a newer save stored (WR-C01).
  const baseIds = useMemo(() => sections.map((s) => s.id), [sections]);
  const { value: ids, tracker } = useOptimisticCommits(baseIds);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const listed = new Set(ids);
  const view: BuilderSection[] = [
    ...ids.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    }),
    // A block added while a reorder was in flight is not in the pending ids yet.
    ...sections.filter((s) => !listed.has(s.id)),
  ];
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });

  const labelOf = (id: UniqueIdentifier) => {
    const s = latest.current.find((x) => x.id === id);
    return `${s ? blockLabel(s.section_type, registry) : "Block"} block`;
  };
  const pos = (id: UniqueIdentifier) =>
    latest.current.findIndex((x) => x.id === id) + 1;
  const total = () => latest.current.length;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      announce.pickUp(labelOf(active.id), pos(active.id), total()),
    onDragOver: ({ active, over }) =>
      over
        ? announce.over(labelOf(active.id), pos(over.id), total())
        : undefined,
    onDragEnd: ({ active, over }) =>
      announce.drop(
        labelOf(active.id),
        over ? pos(over.id) : pos(active.id),
        total(),
      ),
    onDragCancel: ({ active }) =>
      announce.cancel(labelOf(active.id), pos(active.id)),
  };

  function reorder(from: number, to: number) {
    const current = latest.current.map((s) => s.id);
    if (from === to || from < 0 || to < 0 || to >= current.length) return;
    const next = arrayMove(current, from, to);
    latest.current = next.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    });
    void tracker
      .commit(
        next,
        async (order) => {
          if (!(await onReorder(order))) throw new Error("reorder not saved");
        },
        () => toast.show({ message: ERR_REORDER_COPY }),
      )
      .catch(() => {});
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = latest.current.map((s) => s.id);
    reorder(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
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
        <SortableContext
          items={view.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol
            aria-label="Blocks on this page"
            className="flex flex-col"
            data-tour="builder-blocks"
          >
            {h1OwnerId === null ? <PageTitleRow /> : null}
            {view.map((s, i) => (
              <SortableBlockRow
                key={s.id}
                section={s}
                index={i}
                count={view.length}
                label={blockLabel(s.section_type, registry)}
                selected={s.id === selectedId}
                ownsH1={s.id === h1OwnerId}
                addonOff={offTypes?.has(s.section_type) ?? false}
                pausedName={
                  pausedTypes && Object.hasOwn(pausedTypes, s.section_type)
                    ? pausedTypes[s.section_type]
                    : undefined
                }
                deletedLabel={deletedRefLabels?.[s.id]}
                onSelect={() => onSelect(s.id)}
                onMove={(dir) => {
                  reorder(i, i + dir);
                  onMove?.(s.id, dir);
                }}
                onToggleHidden={() => onToggleHidden(s.id, s.is_published)}
                onDelete={() => onDelete(s.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="p-4">
        <Button
          variant="secondary"
          icon={<Plus aria-hidden size={16} strokeWidth={2} />}
          onClick={onAdd}
          className="w-full"
          data-tour="builder-add"
        >
          Add block
        </Button>
      </div>
    </div>
  );
}
