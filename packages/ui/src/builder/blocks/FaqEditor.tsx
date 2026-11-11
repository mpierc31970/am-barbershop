"use client";
// FaqEditor (07-21; CONT-27; 07-UI-SPEC row "FAQ" line 362, line 664 Undo copy; D311 admin
// pattern; replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept).
//
// Heading (default "Questions and answers") · Questions in the shared SortableList (drag or
// Move up/down, Delete with "Question removed. Undo"): each holds Question (required,
// FAQ_QUESTION_MAX) and Answer (RichTextEditor: bold, italic, link, lists) · Add question
// (focuses the new Question field; disabled at FAQ_MAX_ITEMS with the core copy) · Open the
// first question. An answer with a blank question shows FAQ_QUESTION_COPY under that
// Question, as the validator will refuse it. Answers stay HTML strings: the server cleans
// them on save and publish (mapRichText) and the renderer sanitizes again. Background stays
// in SectionForm. Hub tokens and hub primitives only.
import { useId } from "react";
import { Plus } from "lucide-react";
import {
  FAQ_LIMIT_COPY,
  FAQ_MAX_ITEMS,
  FAQ_QUESTION_COPY,
  FAQ_QUESTION_MAX,
  isRichTextEmpty,
  newId,
  type FaqItem,
} from "@cds/core/content";
import { Button } from "../../hub/Button";
import { TextField } from "../../hub/fields";
import { Switch } from "../../hub/Switch";
import { RichTextEditor } from "../RichTextEditor";
import { reinsertItem, SortableList, useLatest } from "./SortableList";
import type { CoreBlockEditorProps } from "./types";

function readItems(content: Record<string, unknown>): FaqItem[] {
  const raw = Array.isArray(content.items) ? (content.items as unknown[]) : [];
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((x) => ({
      id: typeof x.id === "string" && x.id ? x.id : newId(),
      question: typeof x.question === "string" ? x.question : "",
      answer: typeof x.answer === "string" ? x.answer : "",
    }));
}

export function FaqEditor({ content, onChange, errors }: CoreBlockEditorProps) {
  const uid = useId();
  const items = readItems(content);
  const latest = useLatest(items);
  const heading =
    typeof content.heading === "string"
      ? content.heading
      : "Questions and answers";
  const openFirst = content.open_first === true;
  const atMax = items.length >= FAQ_MAX_ITEMS;
  const fieldId = (item: FaqItem) => `${uid}-q-${item.id}`;

  const setItems = (next: FaqItem[]) => onChange("items", next);
  const patch = (id: string, p: Partial<FaqItem>) =>
    setItems(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));

  function add() {
    if (latest.current.length >= FAQ_MAX_ITEMS) return;
    const item: FaqItem = { id: newId(), question: "", answer: "" };
    setItems([...latest.current, item]);
    setTimeout(() => document.getElementById(fieldId(item))?.focus(), 0);
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

      <section
        aria-labelledby={`${uid}-questions`}
        className="flex flex-col gap-3"
      >
        <h3
          id={`${uid}-questions`}
          className="text-sm font-semibold text-hub-ink"
        >
          Questions
        </h3>
        <SortableList<FaqItem>
          items={items}
          noun="Question"
          label={(_, i) => `Question ${i + 1}`}
          onReorder={setItems}
          onRemove={(i) => setItems(latest.current.filter((_, k) => k !== i))}
          onRestore={(item, i) => {
            if (latest.current.length >= FAQ_MAX_ITEMS) return;
            setItems(reinsertItem(latest.current, item, i));
          }}
          renderItem={(item) => (
            <>
              <TextField
                id={fieldId(item)}
                label="Question"
                required
                maxLength={FAQ_QUESTION_MAX}
                value={item.question}
                error={
                  item.question.trim() === "" && !isRichTextEmpty(item.answer)
                    ? FAQ_QUESTION_COPY
                    : undefined
                }
                onChange={(e) =>
                  patch(item.id, { question: e.currentTarget.value })
                }
              />
              <RichTextEditor
                id={`${uid}-a-${item.id}`}
                label="Answer"
                value={item.answer}
                helper="Questions without an answer stay hidden on your site."
                onChange={(html) => patch(item.id, { answer: html })}
              />
            </>
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
            Add question
          </Button>
          {atMax ? (
            <p id={`${uid}-max`} className="text-sm text-hub-ink-muted">
              {FAQ_LIMIT_COPY}
            </p>
          ) : null}
        </div>
      </section>

      <Switch
        id={`${uid}-open-first`}
        label="Open the first question"
        checked={openFirst}
        onChange={(v) => onChange("open_first", v)}
      />
    </div>
  );
}
