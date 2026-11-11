"use client";
// Link list editor shared by the menu and the footer's extra links (07-25 choices 10, 11;
// UI-SPEC "Navigation" lines 474-476, "Footer" line 484, line 664 Undo copy; D-UI-P7-28).
//
// 56px rows: grip · label (600) · target ("Page: About" or the web address's host, with
// ExternalLink when it opens a new tab) · overflow menu (Edit · Move up · Move down · Put
// under "X" / Move out of "X" · Remove). Child rows indent 24px with a 1px --hub-border
// guide. Drag (dnd-kit, keyboard sensor + announcements) reorders; with nesting on, a drop
// dragged 24px right nests under the row above and 24px left moves out (choice 11). Every
// transform comes from nav-logic.ts. Remove is immediate with an 8s Undo toast. "Add link"
// opens an inline row (not a modal): Label, Links to (A page / A web address), Open in a
// new tab (web addresses only), Add / Discard. Hub primitives and tokens only.
import {
  NAV_COPY,
  NAV_LABEL_MAX,
  parseNavTarget,
  type NavItem,
  type NavLink,
} from "@cds/core/content";
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
import { ExternalLink, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";
import { Button } from "../../hub/Button";
import { Select, TextField } from "../../hub/fields";
import { IconButton } from "../../hub/IconButton";
import { Switch } from "../../hub/Switch";
import { UNDO_TOAST_MS, useToast } from "../../hub/Toast";
import { useLatest } from "../blocks/SortableList";
import { DRAG_INSTRUCTIONS, announce } from "../editor-logic";
import {
  itemListCollision,
  liftClasses,
  useDndSensors,
  useReducedMotion,
} from "../ItemListEditor";
import {
  buildNav,
  checkRows,
  flattenNav,
  hasChildren,
  indent,
  indentTarget,
  moveRow,
  moveStep,
  outdent,
  parentIndex,
  removeRow,
  restoreRows,
  topCount,
  updateRow,
  type NavLimits,
  type NavRow,
  type NavRowsResult,
} from "./nav-logic";

/** A page the owner can link to; `published` false shows the "Shows once…" note. */
export type ChromePageOption = {
  id: string;
  title: string;
  path: string;
  published: boolean;
};

export interface LinkListEditorProps {
  items: readonly NavItem[];
  onChange: (next: NavItem[]) => void;
  pages: readonly ChromePageOption[];
  nesting: boolean;
  limits: NavLimits;
  /** Helper shown when the list is full. */
  limitCopy: string;
  /** "menu" | "footer": toast "About removed from the menu." */
  place: string;
  /** Primary label of the inline row's add button ("Add to menu"). */
  addVerb: string;
  idPrefix: string;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 disabled:cursor-not-allowed " +
  "disabled:opacity-50 pointer-coarse:min-h-11";

const NEST_PX = 24;

function hostOf(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./i, "");
  } catch {
    return href;
  }
}

export function targetSummary(
  link: NavLink,
  pages: readonly ChromePageOption[],
): { text: string; note: string | null } {
  const t = parseNavTarget(link.target);
  if (t?.kind === "page") {
    const page = pages.find((p) => p.id === t.id);
    if (!page) return { text: "Page", note: NAV_COPY.pageGone };
    return {
      text: `Page: ${page.title}`,
      note: page.published ? null : NAV_COPY.unpublished,
    };
  }
  if (t?.kind === "url") return { text: hostOf(t.href), note: null };
  return { text: "", note: NAV_COPY.target };
}

function newLinkId(): string {
  return globalThis.crypto.randomUUID();
}

export function LinkListEditor({
  items,
  onChange,
  pages,
  nesting,
  limits,
  limitCopy,
  place,
  addVerb,
  idPrefix,
}: LinkListEditorProps) {
  const sensors = useDndSensors();
  const toast = useToast();
  const rows = flattenNav(items);
  const latest = useLatest(rows);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const full = topCount(rows) >= limits.top;

  function commit(next: NavRow[]) {
    latest.current = next;
    setError(null);
    onChange(buildNav(next));
  }

  function apply(res: NavRowsResult, message?: string) {
    if ("error" in res) {
      setError(res.error);
      setLive(res.error);
      return;
    }
    commit(res.rows);
    if (message) setLive(message);
  }

  function step(i: number, dir: -1 | 1) {
    const next = moveStep(latest.current, i, dir);
    if (!next) return;
    commit(next);
    const label = latest.current.find((r) => r.id === rows[i]!.id)?.link.label;
    setLive(`${label ?? "Link"} moved ${dir === -1 ? "up" : "down"}.`);
  }

  function remove(i: number) {
    const current = latest.current;
    const row = current[i];
    if (!row) return;
    const { rows: next, removed } = removeRow(current, i);
    commit(next);
    toast.show({
      message: `${row.link.label} removed from the ${place}.`,
      action: {
        label: "Undo",
        // Same limits as any edit: the list may have filled up since (WR-E01).
        onClick: () =>
          apply(checkRows(restoreRows(latest.current, removed, i), limits)),
      },
      durationMs: UNDO_TOAST_MS,
    });
  }

  function saveLink(link: NavLink, id: string | null) {
    if (id === null) {
      commit([...latest.current, { id: link.id, depth: 0, link }]);
      setLive(`${link.label} added to the ${place}.`);
    } else {
      commit(updateRow(latest.current, id, link));
    }
    setEditing(null);
  }

  const nameOf = (id: unknown) =>
    latest.current.find((r) => r.id === id)?.link.label ?? "Link";
  const pos = (id: unknown) => latest.current.findIndex((r) => r.id === id) + 1;
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

  function onDragEnd({ active, over, delta }: DragEndEvent) {
    if (!over) return;
    const list = latest.current;
    const from = list.findIndex((r) => r.id === active.id);
    const to = list.findIndex((r) => r.id === over.id);
    if (from === -1 || to === -1) return;
    const intent: 0 | 1 | null = !nesting
      ? null
      : delta.x >= NEST_PX
        ? 1
        : delta.x <= -NEST_PX
          ? 0
          : null;
    if (from === to && intent === null) return;
    apply(moveRow(list, from, to, intent, limits));
  }

  const editingRow =
    editing && editing.id !== null
      ? rows.find((r) => r.id === editing.id)
      : undefined;

  return (
    <div className="flex flex-col gap-3 font-hub">
      {rows.length > 0 ? (
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
            items={rows.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="flex flex-col rounded border border-hub-border bg-hub-surface">
              {rows.map((row, i) => {
                const parent =
                  row.depth === 1 ? rows[parentIndex(rows, i)] : undefined;
                const target = nesting ? indentTarget(rows, i) : -1;
                return (
                  <LinkRow
                    key={row.id}
                    row={row}
                    pages={pages}
                    canUp={moveStep(rows, i, -1) !== null}
                    canDown={moveStep(rows, i, 1) !== null}
                    putUnder={
                      target !== -1 && !hasChildren(rows, i)
                        ? rows[target]!.link.label
                        : null
                    }
                    moveOutOf={nesting && parent ? parent.link.label : null}
                    onEdit={() => setEditing({ id: row.id })}
                    onMove={(dir) => step(i, dir)}
                    onIndent={() =>
                      apply(
                        indent(latest.current, i, limits),
                        `${row.link.label} is now inside ${rows[target]?.link.label ?? "the dropdown"}.`,
                      )
                    }
                    onOutdent={() =>
                      apply(
                        outdent(latest.current, i, limits),
                        `${row.link.label} moved out of ${parent?.link.label ?? "the dropdown"}.`,
                      )
                    }
                    onRemove={() => remove(i)}
                    removeText={`Remove from ${place}`}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}

      {editing ? (
        <LinkForm
          key={editing.id ?? "new"}
          idPrefix={`${idPrefix}-${editing.id === null ? "new" : "edit"}`}
          initial={editingRow?.link ?? null}
          pages={pages}
          addVerb={editing.id === null ? addVerb : "Save link"}
          onSave={(link) => saveLink(link, editing.id)}
          onDiscard={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <div>
            <Button
              variant="secondary"
              icon={<Plus aria-hidden size={16} strokeWidth={2} />}
              disabled={full}
              aria-describedby={full ? `${idPrefix}-full` : undefined}
              onClick={() => setEditing({ id: null })}
            >
              Add link
            </Button>
          </div>
          {full ? (
            <p id={`${idPrefix}-full`} className="text-sm text-hub-ink-muted">
              {limitCopy}
            </p>
          ) : null}
        </div>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </p>
    </div>
  );
}

interface LinkRowProps {
  row: NavRow;
  pages: readonly ChromePageOption[];
  canUp: boolean;
  canDown: boolean;
  putUnder: string | null;
  moveOutOf: string | null;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  onIndent: () => void;
  onOutdent: () => void;
  onRemove: () => void;
  removeText: string;
}

function LinkRow({
  row,
  pages,
  canUp,
  canDown,
  putUnder,
  moveOutOf,
  onEdit,
  onMove,
  onIndent,
  onOutdent,
  onRemove,
  removeText,
}: LinkRowProps) {
  const reduced = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, transition: reduced ? null : undefined });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const label = row.link.label;
  const summary = targetSummary(row.link, pages);
  const item = (text: string, onClick: () => void, extra = "") => (
    <li>
      <button
        type="button"
        className={`${MENU_ITEM} ${extra}`}
        onClick={() => {
          setMenuOpen(false);
          onClick();
        }}
      >
        {text}
      </button>
    </li>
  );

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-nav-row={row.id}
      data-depth={row.depth}
      className={`border-b border-hub-border bg-hub-surface last:border-b-0 ${liftClasses(isDragging)}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          e.stopPropagation();
          setMenuOpen(false);
        }
      }}
    >
      <div
        className={`flex min-h-14 items-center gap-2 px-4 ${
          row.depth === 1 ? "ml-6 border-l border-hub-border pl-3" : ""
        }`}
      >
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder ${label}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="-ml-2 cursor-grab touch-none active:cursor-grabbing"
        />
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <span className="truncate text-base font-semibold text-hub-ink">
            {label}
          </span>
          <span className="flex items-center gap-1 text-sm text-hub-ink-muted">
            <span className="truncate">{summary.text}</span>
            {row.link.new_tab ? (
              <ExternalLink
                aria-label="Opens in a new tab"
                size={16}
                strokeWidth={2}
              />
            ) : null}
          </span>
          {summary.note ? (
            <span
              className={`text-sm ${
                summary.note === NAV_COPY.unpublished
                  ? "text-hub-ink-muted"
                  : "text-hub-danger"
              }`}
            >
              {summary.note}
            </span>
          ) : null}
        </div>
        <IconButton
          size="sm"
          label={`More actions for ${label}`}
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
          aria-label={`Actions for ${label}`}
          className="mx-4 mb-2 flex flex-col gap-1 rounded border border-hub-border bg-hub-surface p-1"
        >
          {item("Edit", onEdit)}
          {canUp ? item("Move up", () => onMove(-1)) : null}
          {canDown ? item("Move down", () => onMove(1)) : null}
          {putUnder !== null ? item(`Put under "${putUnder}"`, onIndent) : null}
          {moveOutOf !== null
            ? item(`Move out of "${moveOutOf}"`, onOutdent)
            : null}
          {item(
            removeText,
            onRemove,
            "text-hub-danger hover:bg-hub-danger-tint",
          )}
        </ul>
      ) : null}
    </li>
  );
}

interface LinkFormProps {
  idPrefix: string;
  initial: NavLink | null;
  pages: readonly ChromePageOption[];
  addVerb: string;
  onSave: (link: NavLink) => void;
  onDiscard: () => void;
}

function LinkForm({
  idPrefix,
  initial,
  pages,
  addVerb,
  onSave,
  onDiscard,
}: LinkFormProps) {
  const t = initial ? parseNavTarget(initial.target) : null;
  const [kind, setKind] = useState<"page" | "url">(
    t?.kind === "url" ? "url" : "page",
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [pageId, setPageId] = useState(t?.kind === "page" ? t.id : "");
  const [url, setUrl] = useState(t?.kind === "url" ? t.href : "");
  const [newTab, setNewTab] = useState(initial?.new_tab ?? false);
  const [errors, setErrors] = useState<{ label?: string; target?: string }>({});

  function pickPage(id: string) {
    const prev = pages.find((p) => p.id === pageId)?.title ?? "";
    const next = pages.find((p) => p.id === id)?.title ?? "";
    setPageId(id);
    if (label.trim() === "" || label === prev) {
      setLabel(next.slice(0, NAV_LABEL_MAX));
    }
  }

  function submit() {
    const e: { label?: string; target?: string } = {};
    const l = label.trim();
    if (l === "") e.label = NAV_COPY.label;
    else if (l.length > NAV_LABEL_MAX) {
      e.label = `Keep this under ${NAV_LABEL_MAX} characters.`;
    }
    let target = "";
    if (kind === "page") {
      if (pageId === "") e.target = NAV_COPY.target;
      else target = `page:${pageId}`;
    } else {
      const parsed = parseNavTarget(url.trim());
      if (parsed?.kind !== "url") e.target = NAV_COPY.target;
      else target = parsed.href;
    }
    setErrors(e);
    if (e.label || e.target) return;
    onSave({
      id: initial?.id ?? newLinkId(),
      label: l,
      target,
      new_tab: kind === "url" && newTab,
    });
  }

  return (
    <div
      role="group"
      aria-label={initial ? `Edit ${initial.label}` : "New link"}
      className="flex flex-col gap-4 rounded border border-hub-border-strong bg-hub-surface p-4"
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          (e.target as HTMLElement).tagName === "INPUT"
        ) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <TextField
        id={`${idPrefix}-label`}
        label="Label"
        value={label}
        error={errors.label}
        onChange={(e) => setLabel(e.currentTarget.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-hub-ink">
          Links to
        </legend>
        {(
          [
            ["page", "A page"],
            ["url", "A web address"],
          ] as const
        ).map(([value, text]) => (
          <label
            key={value}
            className="flex min-h-10 cursor-pointer items-center gap-3 text-base text-hub-ink pointer-coarse:min-h-11"
          >
            <input
              type="radio"
              name={`${idPrefix}-kind`}
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
                setErrors({});
              }}
              className="h-4 w-4"
            />
            {text}
          </label>
        ))}
      </fieldset>
      {kind === "page" ? (
        <Select
          id={`${idPrefix}-page`}
          label="Page"
          value={pageId}
          error={errors.target}
          options={[
            { value: "", label: "Choose a page" },
            ...pages.map((p) => ({ value: p.id, label: p.title })),
          ]}
          onChange={(e) => pickPage(e.currentTarget.value)}
        />
      ) : (
        <>
          <TextField
            id={`${idPrefix}-url`}
            label="Web address"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={url}
            error={errors.target}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <Switch
            id={`${idPrefix}-new-tab`}
            label="Open in a new tab"
            checked={newTab}
            onChange={setNewTab}
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={submit}>
          {addVerb}
        </Button>
        <Button variant="ghost" onClick={onDiscard}>
          Discard link
        </Button>
      </div>
    </div>
  );
}
