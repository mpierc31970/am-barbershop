"use client";
// Section 2 business-type chips (ONB-11; UI-SPEC "Section 2 · Your business",
// Accessibility; D215, D-UI-P6-6, D-UI-P6-7). A radiogroup of wrapping pill chips with
// roving tabindex. "Something else" reveals a required 80-character text field. A
// reviewed-first type shows the info note at pick: honest up front, no alarm styling.
import type { BusinessType } from "@cds/core/onboarding";
import { InlineAlert, TextField } from "@cds/ui/hub";
import { Check } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import {
  OTHER_LABEL,
  OTHER_MAX,
  REVIEWED_NOTE,
  rovingIndex,
} from "./start-logic";

export interface BusinessTypePickerProps {
  labelledBy: string;
  types: readonly BusinessType[];
  value: string;
  other: string;
  onChange: (id: string) => void;
  onOtherChange: (text: string) => void;
}

export function BusinessTypePicker({
  labelledBy,
  types,
  value,
  other,
  onChange,
  onOtherChange,
}: BusinessTypePickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = types.findIndex((t) => t.id === value);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const tabStop =
    focusIdx !== null && focusIdx < types.length
      ? focusIdx
      : selectedIdx >= 0
        ? selectedIdx
        : 0;
  const selected = selectedIdx >= 0 ? types[selectedIdx] : undefined;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = rovingIndex(i, e.key, types.length);
    if (next === null) return;
    e.preventDefault();
    setFocusIdx(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="flex flex-wrap gap-2"
      >
        {types.map((t, i) => {
          const on = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={t.id}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(t.id)}
              onFocus={() => setFocusIdx(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                "inline-flex min-h-11 items-center gap-2 rounded-full text-base " +
                "transition-colors duration-150 motion-reduce:transition-none " +
                (on
                  ? "border-2 border-hub-accent bg-hub-accent-tint px-[15px]"
                  : "border border-hub-border-strong bg-hub-surface px-4 hover:bg-hub-surface-2")
              }
            >
              {on ? (
                <Check
                  aria-hidden
                  size={16}
                  strokeWidth={2}
                  className="text-hub-accent"
                />
              ) : null}
              {t.label}
            </button>
          );
        })}
      </div>
      {selected?.id === "other" ? (
        <div className="max-w-md">
          <TextField
            id="start-business-other"
            label={OTHER_LABEL}
            value={other}
            maxLength={OTHER_MAX}
            required
            autoComplete="off"
            counter={{ value: other.length, max: OTHER_MAX }}
            onChange={(e) => onOtherChange(e.target.value)}
          />
        </div>
      ) : null}
      {selected?.aup === "review" ? (
        <InlineAlert tone="info">{REVIEWED_NOTE}</InlineAlert>
      ) : null}
    </div>
  );
}
