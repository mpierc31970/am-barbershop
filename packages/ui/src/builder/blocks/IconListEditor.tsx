"use client";
// IconListEditor (07-21; CONT-27, CONTEXT decision 5; 07-UI-SPEC row "Icon list" line 363;
// D311 admin pattern; replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept).
//
// Heading · Items in the shared SortableList (drag or Move up/down, Delete with "Item removed.
// Undo"): each holds the IconPicker (60 curated icons, searchable listbox), Title (required,
// ICON_LIST_TITLE_MAX) and Text (optional, ICON_LIST_TEXT_MAX with a counter) · Add item (new
// item uses Check; disabled at ICON_LIST_MAX_ITEMS with the core copy). Items without a title
// are skipped on the site, and the helper says so. Background stays in SectionForm. Hub tokens
// and hub primitives only.
import { useId } from "react";
import { Plus } from "lucide-react";
import {
  ICON_LIST_ICON_IDS,
  ICON_LIST_LIMIT_COPY,
  ICON_LIST_MAX_ITEMS,
  ICON_LIST_TEXT_MAX,
  ICON_LIST_TITLE_MAX,
  newId,
  type IconListIconId,
  type IconListItem,
} from "@cds/core/content";
import { Button } from "../../hub/Button";
import { TextArea, TextField } from "../../hub/fields";
import { IconPicker } from "../IconPicker";
import { reinsertItem, SortableList, useLatest } from "./SortableList";
import type { CoreBlockEditorProps } from "./types";

const isIcon = (v: unknown): v is IconListIconId =>
  typeof v === "string" &&
  (ICON_LIST_ICON_IDS as readonly string[]).includes(v);

function readItems(content: Record<string, unknown>): IconListItem[] {
  const raw = Array.isArray(content.items) ? (content.items as unknown[]) : [];
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((x) => ({
      id: typeof x.id === "string" && x.id ? x.id : newId(),
      icon: isIcon(x.icon) ? x.icon : "check",
      title: typeof x.title === "string" ? x.title : "",
      text: typeof x.text === "string" ? x.text : "",
    }));
}

export function IconListEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const items = readItems(content);
  const latest = useLatest(items);
  const heading = typeof content.heading === "string" ? content.heading : "";
  const atMax = items.length >= ICON_LIST_MAX_ITEMS;

  const setItems = (next: IconListItem[]) => onChange("items", next);
  const patch = (id: string, p: Partial<IconListItem>) =>
    setItems(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));

  function add() {
    if (latest.current.length >= ICON_LIST_MAX_ITEMS) return;
    const item: IconListItem = {
      id: newId(),
      icon: "check",
      title: "",
      text: "",
    };
    setItems([...latest.current, item]);
    setTimeout(
      () => document.getElementById(`${uid}-t-${item.id}`)?.focus(),
      0,
    );
  }

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <section aria-labelledby={`${uid}-items`} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3
            id={`${uid}-items`}
            className="text-sm font-semibold text-hub-ink"
          >
            Items
          </h3>
          <p className="text-sm text-hub-ink-muted">
            Items without a title stay hidden on your site.
          </p>
        </div>
        <SortableList<IconListItem>
          items={items}
          noun="Item"
          label={(_, i) => `Item ${i + 1}`}
          onReorder={setItems}
          onRemove={(i) => setItems(latest.current.filter((_, k) => k !== i))}
          onRestore={(item, i) => {
            if (latest.current.length >= ICON_LIST_MAX_ITEMS) return;
            setItems(reinsertItem(latest.current, item, i));
          }}
          renderItem={(item) => (
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <IconPicker
                id={`${uid}-icon-${item.id}`}
                value={item.icon}
                onChange={(icon) => patch(item.id, { icon })}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <TextField
                  id={`${uid}-t-${item.id}`}
                  label="Title"
                  required
                  maxLength={ICON_LIST_TITLE_MAX}
                  value={item.title}
                  onChange={(e) =>
                    patch(item.id, { title: e.currentTarget.value })
                  }
                />
                <TextArea
                  id={`${uid}-x-${item.id}`}
                  label="Text"
                  rows={2}
                  maxLength={ICON_LIST_TEXT_MAX}
                  counter={{ value: item.text.length, max: ICON_LIST_TEXT_MAX }}
                  labelExtra={
                    <span className="text-sm text-hub-ink-muted">Optional</span>
                  }
                  value={item.text}
                  onChange={(e) =>
                    patch(item.id, { text: e.currentTarget.value })
                  }
                />
              </div>
            </div>
          )}
        />
        {errors.items ? (
          <p className="text-sm text-hub-danger">{errors.items}</p>
        ) : null}
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="secondary"
            disabled={atMax}
            aria-describedby={atMax ? `${uid}-max` : undefined}
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={add}
          >
            Add item
          </Button>
          {atMax ? (
            <p id={`${uid}-max`} className="text-sm text-hub-ink-muted">
              {ICON_LIST_LIMIT_COPY}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
