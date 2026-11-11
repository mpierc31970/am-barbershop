"use client";
// StatsEditor (07-21; CONT-27, D-UI-P7-27; 07-UI-SPEC row "Stats" line 366; D311 admin
// pattern; replaces the 07-06 stub body, name and BUILDER_BLOCKS_A entry kept).
//
// Heading (optional) · Numbers in the shared SortableList (drag or Move up/down; Delete with
// "Number removed. Undo", unavailable at STATS_LIMITS.minItems): each row holds Number
// (required, inputMode decimal, inline error when it is not a stat number), Before (e.g. "$"),
// After (e.g. "+" or "%") and Label (required) · Add number (disabled at maxItems) · Count up
// when visible (on). Limits and the number pattern come from @cds/core/content; the value
// and over-limit sentences are typed here because core keeps them private (no core edits,
// plan decision 1) and they match the validator's copy. Incomplete numbers are skipped on the
// site. Background stays in SectionForm. Hub tokens and hub primitives only.
import { useId } from "react";
import { Plus } from "lucide-react";
import {
  STATS_LIMITS,
  STATS_VALUE,
  newId,
  type StatsItem,
} from "@cds/core/content";
import { Button } from "../../hub/Button";
import { TextField } from "../../hub/fields";
import { Switch } from "../../hub/Switch";
import { reinsertItem, SortableList, useLatest } from "./SortableList";
import type { CoreBlockEditorProps } from "./types";

/** Same sentence as the stats validator (core keeps it private). */
export const STATS_VALUE_COPY =
  "Use digits for the number, like 250, 1,200 or 4.9.";
const OVER_COPY = "Stats hold up to 6 numbers.";
const MIN_COPY = "Stats need at least 2 numbers.";
const COUNT_UP_HELPER = "Skipped for visitors who turn off animations.";

function readItems(content: Record<string, unknown>): StatsItem[] {
  const raw = Array.isArray(content.items) ? (content.items as unknown[]) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((x) => ({
      id: typeof x.id === "string" && x.id ? x.id : newId(),
      value: str(x.value),
      prefix: str(x.prefix),
      suffix: str(x.suffix),
      label: str(x.label),
    }));
}

export function StatsEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const items = readItems(content);
  const latest = useLatest(items);
  const heading = typeof content.heading === "string" ? content.heading : "";
  const countUp = content.count_up !== false;
  const atMax = items.length >= STATS_LIMITS.maxItems;
  const canRemove = items.length > STATS_LIMITS.minItems;

  const setItems = (next: StatsItem[]) => onChange("items", next);
  const patch = (id: string, p: Partial<StatsItem>) =>
    setItems(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));

  function add() {
    if (latest.current.length >= STATS_LIMITS.maxItems) return;
    const item: StatsItem = {
      id: newId(),
      value: "0",
      prefix: "",
      suffix: "",
      label: "",
    };
    setItems([...latest.current, item]);
    setTimeout(
      () => document.getElementById(`${uid}-v-${item.id}`)?.focus(),
      0,
    );
  }

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        labelExtra={
          <span className="text-sm text-hub-ink-muted">Optional</span>
        }
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <section
        aria-labelledby={`${uid}-numbers`}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h3
            id={`${uid}-numbers`}
            className="text-sm font-semibold text-hub-ink"
          >
            Numbers
          </h3>
          <p className="text-sm text-hub-ink-muted">
            A number shows on your site once it has a label.
          </p>
        </div>
        <SortableList<StatsItem>
          items={items}
          noun="Number"
          label={(_, i) => `Number ${i + 1}`}
          canRemove={canRemove}
          minCopy={MIN_COPY}
          onReorder={setItems}
          onRemove={(i) => setItems(latest.current.filter((_, k) => k !== i))}
          onRestore={(item, i) => {
            if (latest.current.length >= STATS_LIMITS.maxItems) return;
            setItems(reinsertItem(latest.current, item, i));
          }}
          renderItem={(item) => {
            const bad =
              item.value.trim() !== "" && !STATS_VALUE.test(item.value.trim());
            return (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <TextField
                  id={`${uid}-v-${item.id}`}
                  label="Number"
                  required
                  inputMode="decimal"
                  maxLength={STATS_LIMITS.valueMax}
                  helper="Like 250 or 1,200"
                  error={bad ? STATS_VALUE_COPY : undefined}
                  value={item.value}
                  className="tabular-nums"
                  onChange={(e) =>
                    patch(item.id, { value: e.currentTarget.value })
                  }
                />
                <TextField
                  id={`${uid}-p-${item.id}`}
                  label="Before"
                  placeholder="$"
                  maxLength={STATS_LIMITS.prefixMax}
                  value={item.prefix}
                  onChange={(e) =>
                    patch(item.id, { prefix: e.currentTarget.value })
                  }
                />
                <TextField
                  id={`${uid}-s-${item.id}`}
                  label="After"
                  placeholder="+ or %"
                  maxLength={STATS_LIMITS.suffixMax}
                  value={item.suffix}
                  onChange={(e) =>
                    patch(item.id, { suffix: e.currentTarget.value })
                  }
                />
                <div className="sm:col-span-3">
                  <TextField
                    id={`${uid}-l-${item.id}`}
                    label="Label"
                    required
                    placeholder="clients served"
                    maxLength={STATS_LIMITS.labelMax}
                    value={item.label}
                    onChange={(e) =>
                      patch(item.id, { label: e.currentTarget.value })
                    }
                  />
                </div>
              </div>
            );
          }}
        />
        {!canRemove ? (
          <p className="text-sm text-hub-ink-muted">{MIN_COPY}</p>
        ) : null}
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
            Add number
          </Button>
          {atMax ? (
            <p id={`${uid}-max`} className="text-sm text-hub-ink-muted">
              {OVER_COPY}
            </p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-1">
        <Switch
          id={`${uid}-count-up`}
          label="Count up when visible"
          checked={countUp}
          aria-describedby={`${uid}-count-up-helper`}
          onChange={(v) => onChange("count_up", v)}
        />
        <p id={`${uid}-count-up-helper`} className="text-sm text-hub-ink-muted">
          {COUNT_UP_HELPER}
        </p>
      </div>
    </div>
  );
}
