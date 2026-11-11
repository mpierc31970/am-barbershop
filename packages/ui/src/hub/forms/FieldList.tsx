"use client";
// Form editor field list (07-18; CONT-25, D119; 07-UI-SPEC "Form editor" field list, WCAG
// 2.5.7). "Form settings" first, then one 56px row per field: grip (dnd-kit pointer +
// keyboard sensors with the P3 announcements), type icon, label over the type name and
// "Required". Rows sort by drag and by visible Move up / Move down buttons (aria-disabled
// at the ends, so focus stays on the moved row's button). The selected row gets the accent
// tint and aria-current. A field with an error says "Needs attention" with an icon, never
// colour alone. The footer holds AddFieldMenu. Hub tokens and primitives only.
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
import type { FormField, FormFieldType, ProStep } from "@cds/core/forms";
import {
  AlignLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDot,
  Clock,
  EyeOff,
  FileCheck,
  GitBranch,
  GripVertical,
  Hash,
  Heading,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Pilcrow,
  Settings2,
  SquareCheck,
  SquareChevronDown,
  ToggleLeft,
  Type,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DRAG_INSTRUCTIONS, announce } from "../../builder/editor-logic";
import {
  itemListCollision,
  liftClasses,
  useDndSensors,
  useReducedMotion,
} from "../../builder/ItemListEditor";
import { IconButton } from "../IconButton";
import type { HubLinkComponent } from "../AddonCard";
import { AddFieldMenu } from "./AddFieldMenu";
import {
  EMPTY_FIELDS,
  NEEDS_ATTENTION,
  fieldMeta,
  fieldTitle,
} from "./form-logic";

export const FIELD_ICONS: Readonly<Record<FormFieldType, LucideIcon>> = {
  short_text: Type,
  long_text: AlignLeft,
  email: Mail,
  phone: Phone,
  number: Hash,
  name: User,
  address: MapPin,
  dropdown: SquareChevronDown,
  radio: CircleDot,
  checkboxes: SquareCheck,
  yes_no: ToggleLeft,
  date: Calendar,
  time: Clock,
  agreement: FileCheck,
  heading: Heading,
  paragraph: Pilcrow,
  hidden: EyeOff,
  file: Paperclip,
};

export const SETTINGS_ROW = "settings";

export interface FieldListProps {
  fields: readonly FormField[];
  selectedId: string;
  errors: Readonly<Record<string, string>>;
  readOnly: boolean;
  limitReached: boolean;
  onSelect: (id: string) => void;
  /** `kind`: Move up / Move down buttons ("button") or a drag ("drag"); steps treat them differently. */
  onMove: (from: number, to: number, kind?: "button" | "drag") => void;
  onAdd: (type: FormFieldType) => void;
  /** DOM id prefix for row buttons (focus after remove). */
  rowIdPrefix: string;
  /** Server-computed entitlement set for the Add field locks (10-17). */
  entitlements?: ReadonlySet<string>;
  canBuy?: boolean;
  LinkComponent?: HubLinkComponent;
  /** Forms Pro steps while Builder Pro is active (10-39): step headers group the rows. */
  steps?: readonly ProStep[];
  /** Field ids with a show/hide rule (GitBranch icon, 10-39). */
  ruleIds?: ReadonlySet<string>;
}

export const RULE_ICON_LABEL = "Has a show or hide rule";
export const EMPTY_STEP = "No fields in this step yet.";

export function FieldList({
  fields,
  selectedId,
  errors,
  readOnly,
  limitReached,
  onSelect,
  onMove,
  onAdd,
  rowIdPrefix,
  entitlements,
  canBuy,
  LinkComponent,
  steps,
  ruleIds,
}: FieldListProps) {
  const sensors = useDndSensors();
  const stepped = steps && steps.length > 0 ? steps : null;
  const stepOf = new Map<string, number>();
  stepped?.forEach((st, i) => st.fields.forEach((id) => stepOf.set(id, i)));
  const canMove = (index: number, dir: -1 | 1): boolean => {
    if (dir === -1 && index > 0) return true;
    if (dir === 1 && index < fields.length - 1) return true;
    if (!stepped) return false;
    const f = fields[index];
    const si = f ? (stepOf.get(f.id) ?? 0) : 0;
    return dir === -1 ? si > 0 : si < stepped.length - 1;
  };
  const [live, setLive] = useState("");
  const latest = useRef(fields);
  latest.current = fields;
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    document.querySelector<HTMLElement>(`[data-move-key="${key}"]`)?.focus();
  });

  function move(from: number, dir: -1 | 1) {
    const list = latest.current;
    const to = from + dir;
    if (!canMove(from, dir)) return;
    const field = list[from]!;
    refocus.current = `${field.id}:${dir}`;
    if (stepped) {
      const si = stepOf.get(field.id) ?? 0;
      const own = stepped[si]!;
      const edge =
        (dir === -1 && own.fields[0] === field.id && si > 0) ||
        (dir === 1 &&
          own.fields[own.fields.length - 1] === field.id &&
          si < stepped.length - 1);
      onMove(from, to, "button");
      setLive(
        edge
          ? `${fieldTitle(field)} moved to Step ${si + dir + 1}.`
          : announce.drop(fieldTitle(field), to + 1, list.length),
      );
      return;
    }
    onMove(from, to, "button");
    setLive(announce.drop(fieldTitle(field), to + 1, list.length));
  }

  const nameOf = (id: unknown) => {
    const f = latest.current.find((x) => x.id === id);
    return f ? fieldTitle(f) : "Field";
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
    onMove(from, to, "drag");
  }

  const row = (f: FormField, i: number) => (
    <FieldRow
      key={f.id}
      field={f}
      canUp={canMove(i, -1)}
      canDown={canMove(i, 1)}
      hasRule={ruleIds?.has(f.id) ?? false}
      selected={selectedId === f.id}
      error={Boolean(errors[f.id])}
      readOnly={readOnly}
      rowId={`${rowIdPrefix}-${f.id}`}
      onSelect={() => onSelect(f.id)}
      onMove={(dir) => move(i, dir)}
    />
  );

  const settingsSelected = selectedId === SETTINGS_ROW;
  return (
    <div className="flex h-full flex-col font-hub">
      <button
        type="button"
        id={`${rowIdPrefix}-${SETTINGS_ROW}`}
        aria-current={settingsSelected ? "true" : undefined}
        onClick={() => onSelect(SETTINGS_ROW)}
        className={
          "flex min-h-14 w-full items-center gap-3 border-b border-hub-border px-4 text-left " +
          "text-base font-semibold text-hub-ink transition-colors duration-150 " +
          "hover:bg-hub-surface focus-visible:outline-2 focus-visible:-outline-offset-2 " +
          "focus-visible:outline-hub-accent " +
          (settingsSelected ? "bg-hub-accent-tint" : "")
        }
      >
        <Settings2 aria-hidden size={20} strokeWidth={2} className="shrink-0" />
        Form settings
      </button>
      {fields.length === 0 ? (
        <p className="px-4 py-6 text-base text-hub-ink-muted">{EMPTY_FIELDS}</p>
      ) : (
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
            items={fields.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            {stepped ? (
              stepped.map((st, si) => (
                <div key={st.id} data-step-group={si + 1}>
                  <p
                    role="heading"
                    aria-level={3}
                    className="flex min-h-10 items-center border-b border-hub-border bg-hub-surface-2 px-4 text-sm font-semibold text-hub-ink"
                  >
                    {`Step ${si + 1}${st.title.trim() ? ` · ${st.title.trim()}` : ""}`}
                  </p>
                  {st.fields.length === 0 ? (
                    <p className="border-b border-hub-border px-4 py-3 text-sm text-hub-ink-muted">
                      {EMPTY_STEP}
                    </p>
                  ) : (
                    <ol
                      aria-label={`Step ${si + 1} fields`}
                      className="flex flex-col"
                    >
                      {st.fields.map((id) => {
                        const i = fields.findIndex((f) => f.id === id);
                        const f = fields[i];
                        return f ? row(f, i) : null;
                      })}
                    </ol>
                  )}
                </div>
              ))
            ) : (
              <ol aria-label="Fields" className="flex flex-col">
                {fields.map((f, i) => row(f, i))}
              </ol>
            )}
          </SortableContext>
        </DndContext>
      )}
      {readOnly ? null : (
        <div className="border-t border-hub-border p-4">
          <AddFieldMenu
            onAdd={onAdd}
            limitReached={limitReached}
            entitlements={entitlements}
            canBuy={canBuy}
            LinkComponent={LinkComponent}
          />
        </div>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </p>
    </div>
  );
}

interface RowProps {
  field: FormField;
  canUp: boolean;
  canDown: boolean;
  hasRule: boolean;
  selected: boolean;
  error: boolean;
  readOnly: boolean;
  rowId: string;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
}

function FieldRow({
  field,
  canUp,
  canDown,
  hasRule,
  selected,
  error,
  readOnly,
  rowId,
  onSelect,
  onMove,
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
    id: field.id,
    data: { type: "item" },
    disabled: readOnly,
    transition: reduced ? null : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const Icon = FIELD_ICONS[field.type] ?? Type;
  const title = fieldTitle(field);
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-field-row={field.id}
      className={
        "flex min-h-14 items-center gap-1 border-b border-hub-border pr-2 pl-1 " +
        (selected ? "bg-hub-accent-tint " : "") +
        liftClasses(isDragging)
      }
    >
      {readOnly ? (
        <span className="w-2" aria-hidden />
      ) : (
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder ${title}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
      )}
      <button
        type="button"
        id={rowId}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={
          "flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded px-2 text-left " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        }
      >
        <Icon
          aria-hidden
          size={16}
          strokeWidth={2}
          className="shrink-0 text-hub-ink-muted"
        />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base text-hub-ink">{title}</span>
            {hasRule ? (
              <span
                className="inline-flex shrink-0 text-hub-ink-muted"
                data-rule-icon=""
              >
                <GitBranch aria-hidden size={16} strokeWidth={2} />
                <span className="sr-only">{RULE_ICON_LABEL}</span>
              </span>
            ) : null}
          </span>
          <span className="truncate text-sm text-hub-ink-muted">
            {fieldMeta(field)}
          </span>
          {error ? (
            <span className="flex items-center gap-1 text-sm font-semibold text-hub-danger">
              <CircleAlert aria-hidden size={16} strokeWidth={2} />
              {NEEDS_ATTENTION}
            </span>
          ) : null}
        </span>
      </button>
      {readOnly ? null : (
        <>
          <IconButton
            size="sm"
            label={`Move ${title} up`}
            data-move-key={`${field.id}:-1`}
            icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
            aria-disabled={!canUp || undefined}
            onClick={() => onMove(-1)}
          />
          <IconButton
            size="sm"
            tooltipAlign="end"
            label={`Move ${title} down`}
            data-move-key={`${field.id}:1`}
            icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
            aria-disabled={!canDown || undefined}
            onClick={() => onMove(1)}
          />
        </>
      )}
    </li>
  );
}
